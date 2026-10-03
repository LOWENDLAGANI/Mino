"use client";

import { useEffect, useState } from "react";
import { watchSubscription } from "./subscription";
import { isActive, type Subscription } from "./subscriptionState";
import type { PlanId } from "./plans";

// ── What this visitor has ────────────────────────────────────────────────────
// One hook, one subscription, one place that decides whether it still counts.
//
// Everything that needs to know what somebody has paid for — the lock on a
// mode, the panel on the pricing page, the promotion in the sidebar — asks this
// and gets the same answer, so they cannot drift into telling two people
// different things about the same plan.
//
// An expired plan is reported as no plan, not as an expired one. Everywhere
// that asks is a question about what somebody may use *now*, and "your plan
// ended on the 3rd" is a thing to say once, in the receipt, rather than a
// permanent discount on everything.

export interface UseSubscription {
  /** False until the first answer arrives, so nothing flashes "Free" first. */
  ready: boolean;
  /** The active plan, or null. */
  subscription: Subscription | null;
  /** Just the id, for the paywall, or null. */
  planId: PlanId | null;
}

export function useSubscription(): UseSubscription {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const report = (view: Parameters<Parameters<typeof watchSubscription>[0]>[0]) => {
      if (cancelled) return;
      const current = view?.subscription ?? null;
      setSubscription(current && isActive(current, Date.now()) ? current : null);
      setReady(true);
    };
    // Reports the current value on arrival and every change after it, so this
    // one call covers the page being opened now and a grant landing while it
    // is open.
    return watchSubscription(report);
  }, []);

  return { ready, subscription, planId: subscription?.plan ?? null };
}