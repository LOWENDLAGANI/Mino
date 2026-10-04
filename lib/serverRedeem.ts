// ── Resolving a claim into a plan, on the server ──────────────────────────────
//
// The rule this file exists to hold: **a claim says which code, never what it
// is worth.** A claim node carries a timestamp and nothing else. The plan and
// the duration are read here, from the code record itself, using a token the
// server verified with Google. There is no code path in which a value written
// by the person claiming decides what they receive.
//
// That is the whole difference between this and a paywall that can be walked
// through. If the claim could carry `plan: "lunar"`, then anything able to
// write a claim could write itself a plan, and the enforcement added in
// `lib/paywallServer.ts` would be reading a value the caller controls.
//
// Why the caller writes the claim at all, rather than the server writing the
// grant: the deployment holds no service account. The rules give the
// administrator write access to `subscriptions/`, and deliberately withhold it
// from everyone else so a visitor cannot forge a plan for themselves. So the
// claim is recorded in the caller's own node — the one thing the rules already
// let them write — and the server folds it into what they are entitled to.
//
// Termination is enforced twice, on purpose. The rules refuse a claim against a
// switched-off code at write time, so a terminated code stops working for a
// modified client immediately; and `resolveEffectivePlan` re-checks it on every
// request, so a code terminated *after* it was claimed grants nothing either.
// One check without the other leaves a hole: rules alone would keep honouring
// claims made before the switch.

import { readCallerPlan } from "./serverPlan";
import {
  bestPlan,
  checkRedeemable,
  normalizeCode,
  parseRedeemCode,
  redeemValue,
  type Redemption,
} from "./redeemState";
import type { PlanId } from "./plans";

interface RestConfig {
  base: string;
  apiKey: string;
}

function rest(): RestConfig | null {
  const base = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "";
  return base && apiKey ? { base, apiKey } : null;
}

/** Reads one node with the caller's token, so the rules judge it as they would the browser. */
async function readAsCaller(authorization: string | null, path: string): Promise<unknown> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const config = rest();
  if (!token || !config) return null;
  try {
    const response = await fetch(`${config.base}/${path}.json?auth=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Reads a code record with the caller's own token.
 *
 * Not a public read: the rules require a signed-in caller to read a code, and
 * the server has no credential of its own in this deployment. Reading it with
 * the caller's token is also the safer arrangement — it means the server can
 * only ever resolve a code in the company of somebody who has been told it,
 * rather than being able to sweep the whole `codes/` tree unattended.
 */
async function readCodeAsCaller(authorization: string | null, code: string): Promise<unknown> {
  return readAsCaller(authorization, `codes/${encodeURIComponent(code)}`);
}

/** The codes this caller has claimed, as code words. */
export async function readClaimedCodes(authorization: string | null, uid: string): Promise<string[]> {
  const raw = (await readAsCaller(authorization, `redeems/${encodeURIComponent(uid)}`)) as
    | Record<string, unknown>
    | null;
  if (!raw || typeof raw !== "object") return [];
  return Object.keys(raw)
    .map(normalizeCode)
    .filter((code) => code.length > 0);
}

/**
 * Every code this caller has claimed, resolved to what each is currently worth.
 *
 * A code that has been terminated, exhausted, deleted, or is otherwise
 * unreadable contributes nothing. A failure to read is treated as "worth
 * nothing" rather than as "worth everything", which is the same fail-closed
 * choice `lib/serverPlan.ts` makes and for the same reason.
 */
export async function readRedemptions(
  authorization: string | null,
  uid: string
): Promise<Redemption[]> {
  const words = await readClaimedCodes(authorization, uid);
  if (words.length === 0) return [];

  const now = Date.now();
  const values = await Promise.all(
    words.map(async (word) => {
      const code = parseRedeemCode(await readCodeAsCaller(authorization, word));
      const status = checkRedeemable(code, now);
      return status.ok ? redeemValue(status.code, now) : null;
    })
  );
  return values.filter((value): value is Redemption => value !== null);
}

export interface EffectivePlan {
  /** The tier to enforce, or null when this caller is on the free tier. */
  planId: PlanId | null;
  /** When the winning access runs out, or 0 on the free tier. */
  expiresAt: number;
}

/**
 * What this caller is entitled to right now, across every route that grants it.
 *
 * The paid grant and the claimed codes are combined rather than ranked against
 * each other, because both are things the owner deliberately gave: a buyer who
 * paid for Mini and then redeems a Mini code should end up with more time, not
 * whichever of the two the server happened to look at last.
 *
 * The higher tier always wins, whatever its end date. Somebody redeeming a
 * Lunar code while holding Mini must not end up back on Mini because the Mini
 * grant happens to run for longer — that would mean paying more and receiving
 * less, which is the single most damaging thing this file could do.
 */
export async function resolveEffectivePlan(
  authorization: string | null,
  uid: string
): Promise<EffectivePlan> {
  const [subscription, redemptions] = await Promise.all([
    readCallerPlan(authorization, uid),
    readRedemptions(authorization, uid),
  ]);

  const entries: Redemption[] = [...redemptions];
  if (subscription.planId) {
    // The same shape as a redemption, with `days` unused: what matters here is
    // only the tier and the end date, and a grant has no length attached to it —
    // its length is already baked into the date it ends on.
    entries.push({ plan: subscription.planId, days: 0, expiresAt: subscription.expiresAt });
  }

  const best = bestPlan(entries);
  if (!best) return { planId: null, expiresAt: 0 };
  return { planId: best.plan, expiresAt: best.expiresAt };
}