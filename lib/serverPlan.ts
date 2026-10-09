// ── Reading a caller's plan on the server ────────────────────────────────────
//
// The server needs to know what this caller paid for, and it may only find out
// from the database, using a token it has itself verified. There is no service
// account in this deployment and none is being added: the record at
// `subscriptions/$uid` is readable by `$uid` under the published rules, so the
// server forwards the caller's own ID token on the read and the rules judge it
// exactly as they would for the browser. Access stays decided in
// `database.rules.json` and nowhere else.
//
// What that buys is the property this file exists for: the plan that gates a
// request is the plan in the database, resolved from a token the server
// verified with Google. A caller cannot name a plan, cannot send a plan, and
// gains nothing by editing the bundle.
//
// A failed read is reported as *no plan*, never as a plan. The failure modes
// are an unconfigured deployment, a rules file that has not been republished, a
// database that is briefly unreachable — and in all three the honest answer is
// that this caller has no verified plan, which is exactly what an anonymous
// visitor has. Failing open here would mean the one outage in which the paywall
// disappears is also the outage in which it is being tested.

import { parseSubscription, isActive } from "./subscriptionState";
import type { PlanId } from "./plans";

const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim() ?? "";

/** `https://x.firebaseio.com/` -> `https://x.firebaseio.com` */
function restBase(): string | null {
  return databaseUrl ? databaseUrl.replace(/\/+$/, "") : null;
}

export interface CallerPlan {
  /** The active plan, or null. An expired or held grant is no plan. */
  planId: PlanId | null;
  /** When the grant runs out, for the log line. 0 when there is no plan. */
  expiresAt: number;
  /**
   * True when the owner has this caller's grant on hold (see
   * `subscriptionState.pause`). A held plan grants nothing — the buyer still
   * owns the time, it simply cannot be spent until the owner continues it —
   * but the two refusals are not the same sentence, so this rides along and
   * the routes can tell "you never paid" from "your plan is on hold".
   */
  paused: boolean;
}

/**
 * What this caller has paid for.
 *
 * `authorization` is the same header the routes already verify with
 * `verifyCaller`; the uid must be the one that verification returned, and this
 * module never accepts a uid from the request. Reading another person's record
 * is not merely discouraged: the rules refuse it, because the read below is made
 * with this caller's token.
 */
export async function readCallerPlan(
  authorization: string | null,
  uid: string
): Promise<CallerPlan> {
  const none: CallerPlan = { planId: null, expiresAt: 0, paused: false };
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const base = restBase();
  if (!token || !base || !uid) return none;

  try {
    const response = await fetch(`${base}/subscriptions/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    // A refusal is a genuine "no plan for you", not an error to retry: the rules
    // answer 401/403 when the token does not match the uid, which is the correct
    // outcome for a caller trying to reach somebody else's record.
    if (!response.ok) return none;

    const subscription = parseSubscription(await response.json());
    if (!subscription) return none;
    // The hold is checked before the clock: a paused plan whose end date has
    // since passed is still a held plan, not a lapsed one — the remaining time
    // was frozen rather than spent, and saying otherwise would tell the buyer
    // the days they were owed have disappeared.
    if (subscription.pause) {
      return { planId: null, expiresAt: subscription.expiresAt, paused: true };
    }
    if (!isActive(subscription, Date.now())) return none;
    return { planId: subscription.plan, expiresAt: subscription.expiresAt, paused: false };
  } catch (error) {
    console.warn(`[mino paywall] plan read failed for uid ${uid}:`, error);
    return none;
  }
}

/**
 * The same read, for a caller whose identity has not been established.
 *
 * An unidentified caller has no plan. Anonymous visitors are the overwhelming
 * majority of traffic, so this is the ordinary path and it does no network work.
 */
export function planForUnidentified(): CallerPlan {
  return { planId: null, expiresAt: 0, paused: false };
}