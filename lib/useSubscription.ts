"use client";

import { useCallback, useEffect, useState } from "react";
import { watchSubscription } from "./subscription";
import { isActive, type Subscription } from "./subscriptionState";
import { authHeader } from "./firebaseHistory";
import { DAY_MS } from "./durations";
import type { PlanId } from "./plans";

// ── What this visitor has ────────────────────────────────────────────────────
// One hook, one answer to "what have you paid for", asked of two places.
//
// A paid grant lives in `subscriptions/{uid}` and arrives on a live listener,
// which is also what the celebration dialog listens to — so that path is left
// exactly as it was.
//
// A redeemed code does not live there. It lives in the caller's own claim node,
// because a plan record is one the visitor deliberately cannot write. So the
// server resolves it (the same resolver the paywall enforces with) and answers
// at `/api/plan`. Asking only the database is what made a buyer with a working
// code see "Free" immediately after being told the code was accepted.

export interface UseSubscription {
  /** False until the first answer arrives, so nothing flashes "Free" first. */
  ready: boolean;
  /** The active plan, or null. */
  subscription: Subscription | null;
  /** Just the id, for the paywall, or null. */
  planId: PlanId | null;
  /**
   * Re-reads the plan from the server.
   *
   * Needed straight after a code is redeemed: the claim is written, but nothing
   * the page watches has changed, so without this the buyer would be staring at
   * an unchanged screen that says Free.
   */
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscription {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Asks the server what this account is entitled to.
   *
   * A failure changes nothing: showing Free because a check could not complete
   * would be worse than showing the last thing we knew, and a plan that has
   * merely failed to load is not the same as a plan that has ended.
   */
  const refresh = useCallback(async () => {
    try {
      const header = await authHeader();
      if (!header.Authorization) return;
      const response = await fetch("/api/plan", {
        headers: header,
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { planId?: PlanId | null; expiresAt?: number };

      const planId = data.planId ?? null;
      const expiresAt = Number(data.expiresAt ?? 0);
      const live = Boolean(planId) && Number.isFinite(expiresAt) && expiresAt > Date.now();

      setSubscription((current) => {
        if (!live) {
          // The server answering with no plan is the only thing that downgrades
          // somebody to Free. A lapsed code has to stop counting.
          return current && isActive(current, Date.now()) ? current : null;
        }
        // Keep the real record when it is the same plan and runs at least as
        // long: the celebration and the receipt need `announcementId`, the
        // owner's note and the granted-at date, none of which a synthesised
        // record has.
        if (current && current.plan === planId && current.expiresAt >= expiresAt) return current;
        return {
          plan: planId as PlanId,
          // A code has no purchase date of its own, so the window is measured
          // backwards from when it ends. `announcementId: 0` is deliberate: this
          // is not a new grant, so nothing should pop a celebration for it.
          grantedAt: expiresAt,
          expiresAt,
          days: Math.max(1, Math.round((expiresAt - Date.now()) / DAY_MS)),
          note: "",
          announcementId: 0,
        };
      });
    } catch {
      // Offline, or the endpoint is unreachable. Keep the last known state.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const report = (view: Parameters<Parameters<typeof watchSubscription>[0]>[0]) => {
      if (cancelled) return;
      const current = view?.subscription ?? null;
      setSubscription(current && isActive(current, Date.now()) ? current : null);
      setReady(true);
    };
    // Reports the current value on arrival and every change after it, so this
    // one call covers the page being opened now and a grant landing while it is
    // open.
    const stop = watchSubscription(report);
    void refresh();
    return () => {
      cancelled = true;
      stop();
    };
  }, [refresh]);

  return { ready, subscription, planId: subscription?.plan ?? null, refresh };
}