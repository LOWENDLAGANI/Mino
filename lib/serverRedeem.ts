// ── Resolving a claim into Dew, on the server ──────────────────────────────────
//
// The rule this file exists to hold: **a claim says which code, never what it
// is worth.** A claim node carries a timestamp and nothing else. The amount is
// read here, from the code record itself, using a token the server verified
// with Google. There is no code path in which a value written by the person
// claiming decides what they receive.
//
// That is the whole difference between this and a balance that can be walked
// through. If the claim could carry `dew: 1000`, then anything able to write a
// claim could write itself a balance, and the amount the rules pin on the
// credit write would be checking a value the caller controls.
//
// Why the caller writes the claim at all, rather than the server writing the
// credit: the deployment holds no service account. The rules give the
// administrator write access to `codes/` and deliberately withhold it from
// everyone else so a visitor cannot mint a code for themselves. So the claim is
// recorded in the caller's own node — the one thing the rules already let them
// write — and the server folds it into their balance.
//
// Termination is enforced twice, on purpose. The rules refuse a claim against a
// switched-off code at write time, so a terminated code stops working for a
// modified client immediately; and `resolveDew` re-checks it on every request,
// so a code terminated *after* it was claimed tops up nothing either. One check
// without the other leaves a hole: rules alone would keep honouring claims made
// before the switch.

import { ensureTrialGrant, readDewState, writeCredit, type DewState } from "./serverDew";
import {
  checkRedeemable,
  dewRedemptionValue,
  normalizeCode,
  parseRedeemCode,
  type DewRedemption,
} from "./redeemState";

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

/** One claim: which word, and when it was used. */
export interface Claim {
  code: string;
  claimedAt: number;
}

/** The codes this caller has claimed, with the moment each was used. */
export async function readClaimedCodes(authorization: string | null, uid: string): Promise<Claim[]> {
  const raw = (await readAsCaller(authorization, `redeems/${encodeURIComponent(uid)}`)) as
    | Record<string, unknown>
    | null;
  if (!raw || typeof raw !== "object") return [];
  const claims: Claim[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const code = normalizeCode(key);
    if (code.length === 0) continue;
    const claimedAt = Number((value as { claimedAt?: unknown } | null)?.claimedAt);
    claims.push({
      code,
      // A claim with no usable time is anchored to now rather than discarded:
      // it is still a real claim, and discarding it would silently take away a
      // plan somebody was given.
      claimedAt: Number.isFinite(claimedAt) && claimedAt > 0 ? claimedAt : Date.now(),
    });
  }
  return claims;
}

/**
 * Every code this caller has claimed, resolved to what each is currently worth.
 *
 * A code that has been terminated, exhausted, deleted, or is otherwise
 * unreadable contributes nothing. A failure to read is treated as "worth
 * nothing" rather than as "worth everything", which is the same fail-closed
 * choice `lib/serverPlan.ts` makes and for the same reason.
 */
export async function readDewRedemptions(
  authorization: string | null,
  uid: string
): Promise<DewRedemption[]> {
  const claims = await readClaimedCodes(authorization, uid);
  if (claims.length === 0) return [];

  const now = Date.now();
  const values = await Promise.all(
    claims.map(async (claim) => {
      const code = parseRedeemCode(await readCodeAsCaller(authorization, claim.code));
      const status = checkRedeemable(code, now);
      // Only a live Dew code becomes a credit here. A code that was terminated,
      // deleted, or that cannot be read resolves to nothing — the same
      // fail-closed choice every other read in this file makes.
      return status.ok ? dewRedemptionValue(status.code) : null;
    })
  );
  return values.filter((value): value is DewRedemption => value !== null);
}

/**
 * This caller's Dew balance, derived from their credits and their spend.
 *
 * Combines the trial/code credits in `dew/{uid}` with any claims on live codes
 * that the rules have already accepted, then subtracts what has been spent.
 * A read that fails answers zero — fail-closed, for the same reason every other
 * read here refuses to assume credit.
 *
 * A record that is not a Dew code contributes nothing. Old plan-shaped codes
 * are not converted here, or anywhere: they are simply not codes any more, and
 * the code that honours a claim must never pick a second meaning for one.
 */
export async function resolveDew(
  authorization: string | null,
  uid: string
): Promise<DewState> {
  await ensureTrialGrant(authorization, uid);
  const [state, claimed] = await Promise.all([
    readDewState(authorization, uid),
    readDewRedemptions(authorization, uid),
  ]);
  const missing = claimed.filter((entry) => state.credits[entry.code] === undefined);
  if (missing.length === 0) return state;
  await Promise.all(missing.map((entry) => writeCredit(authorization, uid, entry.code, entry.dew)));
  return readDewState(authorization, uid);
}