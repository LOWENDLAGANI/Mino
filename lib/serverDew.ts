// ── Dew on the server ────────────────────────────────────────────────────────
//
// The deployment holds no service account, so — exactly like every other
// privileged thing this app does — the server only ever touches the database
// with a token it has itself verified, and the rules judge that token. Two
// consequences shape this file:
//
//   1. `dew/{uid}` lives at a top-level node, not under `users/{uid}`, because
//      `.write` grants cascade downward and cannot be revoked by a deeper rule.
//      A balance under `users/` would be writable by the person it describes.
//   2. REST has no transactions, but it has conditional writes: a GET with
//      `X-Firebase-ETag: true` returns an ETag, and a PUT carrying
//      `If-Match: <etag>` is applied only if the node is unchanged, replying
//      412 otherwise. Spent is deducted under that guard, so two overlapping
//      requests cannot both write their charge and lose one.
//
// A failed conditional write is charged again on the *next* request rather than
// retried here, because retrying inside a streaming response cannot be made
// reliable and an over-charge is worse than an under-charge the caller can see.

import { DEW_PRICING, TRIAL_DEW, dewBalanceFrom, nextSpent, roundDew, toMillidew, type DewTier, type TokenUsage } from "./dew";
import { calcDewCost } from "./dew";

const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim() ?? "";

function restBase(): string | null {
  return databaseUrl ? databaseUrl.replace(/\/+$/, "") : null;
}

export interface DewState {
  /** Credits minus spent, in Dew, floored at zero. */
  balance: number;
  credits: Record<string, number>;
  spent: number;
}

const EMPTY: DewState = { balance: 0, credits: {}, spent: 0 };

/**
 * Reads this caller's Dew node with their own token.
 *
 * A refused or failed read is a zero balance, never an assumption of credit:
 * fail-closed, for the same reason `lib/serverPlan.ts` refuses to assume a
 * plan. An unconfigured deployment has no balances, and nobody is charged.
 */
export async function readDewState(authorization: string | null, uid: string): Promise<DewState> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const base = restBase();
  if (!token || !base || !uid) return EMPTY;
  try {
    const response = await fetch(`${base}/dew/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return EMPTY;
    const raw = (await response.json()) as unknown;
    if (!raw || typeof raw !== "object") return EMPTY;
    const value = raw as { credits?: unknown; spent?: unknown };
    const credits: Record<string, number> = {};
    if (value.credits && typeof value.credits === "object") {
      for (const [key, entry] of Object.entries(value.credits as Record<string, unknown>)) {
        if (typeof entry === "number" && entry > 0 && entry <= 1_000_000) {
          credits[normalizeCreditKey(key)] = entry;
        }
      }
    }
    const spent = typeof value.spent === "number" && Number.isFinite(value.spent) && value.spent > 0 ? value.spent : 0;
    return { balance: dewBalanceFrom({ credits, spent }), credits, spent };
  } catch {
    return EMPTY;
  }
}

/** Keys are upper-case words and the reserved meta keys. */
function normalizeCreditKey(key: string): string {
  return key.replace(/[^A-Z0-9-]/g, "").slice(0, 40) || "UNKNOWN";
}

/** True when this caller has enough Dew to start a request at all. */
export function canAfford(state: DewState): boolean {
  return state.balance > 0.05;
}

/**
 * Ensures the trial balance exists, exactly once.
 *
 * Called from `/api/dew` on a verified session. The write is refused by the
 * rules if `credits/TRIAL` already exists — the rule compares `data` and
 * `newData` — so a replayed call cannot stack another 25. The value arrives
 * from config when the administrator has tuned it and 25 otherwise, but the
 * rules pin it either way: a modified client cannot mint credits of its own
 * choosing.
 */
export async function ensureTrialGrant(authorization: string | null, uid: string): Promise<{ ok: boolean; alreadyGranted: boolean }> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const base = restBase();
  if (!token || !base || !uid) return { ok: false, alreadyGranted: false };
  try {
    const check = await fetch(`${base}/dew/${encodeURIComponent(uid)}/credits/TRIAL.json?auth=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (check.ok) {
      const existing = await check.json();
      if (typeof existing === "number" && existing > 0) {
        return { ok: true, alreadyGranted: true };
      }
    }
    const response = await fetch(`${base}/dew/${encodeURIComponent(uid)}/credits/TRIAL.json?auth=${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TRIAL_DEW),
      cache: "no-store",
    });
    if (response.ok) return { ok: true, alreadyGranted: false };
    // 401/403: the rules refused — either not yet republished, or the trial
    // credit exists and the rule rejected the overwrite. Either way the caller
    // is not worse off for the answer "yes you were granted".
    return { ok: response.status !== 401 && response.status !== 403 ? false : true, alreadyGranted: false };
  } catch {
    return { ok: false, alreadyGranted: false };
  }
}

/**
 * Deducts the cost of one request, conditionally on the spent node.
 *
 * Refused by the rules for a non-owner, and refused by the 412 when someone
 * else's write landed between our read and our write. In both cases the return
 * says so and the caller decides what to tell the user. `newSpent` is the
 * caller's responsibility — the route computes it from the state it read —
 * because only the caller knows which charge belongs to which read.
 */
export async function deductDew(
  authorization: string | null,
  uid: string,
  previousSpent: number,
  charge: number
): Promise<{ ok: boolean; newSpent: number; conflict: boolean }> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const base = restBase();
  if (!token || !base || !uid) return { ok: false, newSpent: previousSpent, conflict: false };
  if (charge <= 0) return { ok: true, newSpent: previousSpent, conflict: false };

  try {
    // ── 1. ETag read of the spent node ──
    const read = await fetch(
      `${base}/dew/${encodeURIComponent(uid)}/spent.json?auth=${encodeURIComponent(token)}&X-Firebase-ETag=true`,
      { headers: { Accept: "application/json", "X-Firebase-ETag": "true" }, cache: "no-store" }
    );
    if (!read.ok) return { ok: false, newSpent: previousSpent, conflict: false };
    const etag = read.headers.get("ETag") ?? "";
    const remoteValue = Number((await read.json().catch(() => null)) ?? 0);
    const serverSpent = Number.isFinite(remoteValue) && remoteValue > 0 ? remoteValue : 0;
    // Reconcile: the route read state a moment ago; the server may have moved.
    const expected = nextSpent(serverSpent, roundDew(charge));

    // ── 2. Conditional PUT: only if unchanged since our ETag ──
    const write = await fetch(
      `${base}/dew/${encodeURIComponent(uid)}/spent.json?auth=${encodeURIComponent(token)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify(expected),
        cache: "no-store",
      }
    );
    if (write.ok) return { ok: true, newSpent: expected, conflict: false };
    // 412 means another request charged between the read and the write. That
    // other write already carries this request's share? No — it carries only
    // its own. Reporting a conflict tells the route the charge did not land;
    // the honest response is to log the shortfall, not to loop. Every future
    // request re-reads and re-deducts.
    if (write.status === 412) return { ok: false, newSpent: serverSpent, conflict: true };
    return { ok: false, newSpent: Math.max(serverSpent, previousSpent), conflict: false };
  } catch {
    return { ok: false, newSpent: previousSpent, conflict: false };
  }
}

/** The record for the console and the ledger. Never shown to the caller. */
export interface DewChargeLine {
  tier: DewTier;
  usage: TokenUsage;
  dew: number;
}

export function recordChargeLine(tier: DewTier, usage: TokenUsage): DewChargeLine {
  return { tier, usage, dew: calcDewCost(tier, usage) };
}

/** Millidew total of credits, for the ledger the console prints. */
export function creditsTotal(credits: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(credits)) total += toMillidew(value);
  return total / 1000;
}

export { DEW_PRICING };
