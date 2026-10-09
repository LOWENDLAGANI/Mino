// ── Admin subscription access ────────────────────────────────────────────────
// What the console needs from a subscription that the simple AdminSubscription
// view does not carry: the pause state, the raw parsed record, and the helpers
// to change it.

import {
  type PlanId,
  type Subscription,
  type PauseState,
  parseSubscription,
  parsePauseState,
  isPaused,
  readPausedUntil,
  effectiveExpiry,
} from "./subscriptionState";
import { isActive } from "./subscriptionState";

export type { PlanId, Subscription, PauseState };

/** Re-export the pausedUntil accessor for callers that still use the old name. */
export { readPausedUntil as pausedUntil };

export interface AdminSubscriptionDetail {
  /** The uid whose record this is. */
  uid: string;
  /** The active subscription, or null. */
  subscription: Subscription | null;
  /** The pause state, if any. */
  pause: PauseState | null;
  /** Whether the plan is usable right now. */
  usable: boolean;
  /** When access ends, if usable. */
  expiresAt: number;
  /** When the current pause ends, or 0. */
  pausedUntil: number;
  /** How long until a paused plan becomes usable again. 0 when not paused. */
  untilResumesAt: number;
}

/** Reads everything the console shows for one visitor's plan. */
export function detailFromRaw(uid: string, raw: unknown, now = Date.now()): AdminSubscriptionDetail {
  const subscription = parseSubscription(raw);
  const pause = parsePauseState(raw ? (raw as Record<string, unknown>).pause : null);
  const effective = effectiveExpiry(subscription, now);
  return {
    uid,
    subscription,
    pause,
    usable: effective.planId !== null && isActive(subscription, now) && !effective.paused,
    expiresAt: effective.expiresAt,
    pausedUntil: effective.pausedUntil,
    untilResumesAt: effective.paused ? effective.pausedUntil : 0,
  };
}
