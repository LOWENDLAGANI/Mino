// ── Pause-aware subscription resolution on the server ────────────────────────
// Extends the existing plan resolver with the pause check, so a paused plan is
// still owned but not usable. The expiry is preserved; pausing does not spend
// the time bought.

import { readCallerPlan } from "./serverPlan";
import { resolveEffectivePlan, type EffectivePlan } from "./serverRedeem";
import { isPaused, pausedUntil, type Subscription } from "./subscriptionState";

export interface PausedEffectivePlan extends EffectivePlan {
  /** Whether the caller's best plan is currently paused. */
  paused: boolean;
  /** When the current pause ends, or 0. */
  pausedUntil: number;
}

/**
 * What this caller is entitled to right now, including pause state.
 *
 * Reuses the existing resolver (paid grant + claimed codes, higher tier wins),
 * then layers pause on top. A paused plan is still the caller's plan — it just
 * cannot be used until the pause lifts.
 */
export async function resolveEffectivePlanWithPause(
  authorization: string | null,
  uid: string
): Promise<PausedEffectivePlan> {
  const plan = await resolveEffectivePlan(authorization, uid);
  if (!plan.planId || plan.expiresAt === 0) {
    return { ...plan, paused: false, pausedUntil: 0 };
  }

  const subscription = await readCallerPlan(authorization, uid);
  const paused = isPaused(
    subscription.planId ? { plan: subscription.planId, grantedAt: 0, expiresAt: subscription.expiresAt, days: 30, note: "", announcementId: 1 } satisfies Subscription : null,
    Date.now()
  );
  const until = pausedUntil(
    subscription.planId ? { plan: subscription.planId, grantedAt: 0, expiresAt: subscription.expiresAt, days: 30, note: "", announcementId: 1 } satisfies Subscription : null
  );

  return { ...plan, paused, pausedUntil: until };
}

/**
 * A smaller shape for callers that only need to know if the caller may proceed.
 */
export async function callerMayProceed(
  authorization: string | null,
  uid: string
): Promise<{ allowed: boolean; reason?: string }> {
  const plan = await resolveEffectivePlanWithPause(authorization, uid);
  if (!plan.planId) return { allowed: true }; // free tier is always usable
  if (plan.paused) {
    return {
      allowed: false,
      reason: "Your subscription is paused. The owner can resume it from the admin console, and any time remaining will still be there.",
    };
  }
  return { allowed: true };
}
