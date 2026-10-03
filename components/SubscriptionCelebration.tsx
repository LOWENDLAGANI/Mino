"use client";

import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeSubscription,
  readLocalAck,
  watchSubscription,
  writeLocalAck,
} from "@/lib/subscription";
import {
  renewalNote,
  shouldCelebrate,
  subscriptionDetails,
  type Subscription,
  type SubscriptionView,
} from "@/lib/subscriptionState";
import { planById } from "@/lib/plans";

// ── Payment received ─────────────────────────────────────────────────────────
// Shown when the owner grants a plan, and shown once.
//
// Three things make that true, and each is deliberate:
//
//   * It listens to the buyer's own subscription node live, so a tab that is
//     already open sees the news the moment the grant is written — no reload,
//     no poll, and no waiting for them to come back.
//   * The grant carries an announcement id, and the dialog is owed whenever that
//     id is newer than the one this person has already acknowledged. That makes
//     it one-shot per grant while a genuine renewal — a new id — announces
//     itself again.
//   * Nothing but the button closes it. No backdrop click, no Escape, no
//     outside tap. This is the one screen a person must actually read, and the
//     accidental dismissal of a dialog like this is how somebody misses that
//     their money landed and waits a day to ask about it.
//
// The two halves are separate on purpose: `SubscriptionDialog` is the screen and
// knows nothing about Firebase, and everything above it is the wiring that
// decides when to put that screen on top of the page.

/**
 * Dates in the reader's own locale, which is not this module's to decide.
 *
 * `toLocaleString`, not `toLocaleDateString`: the date alone would be ambiguous
 * to somebody deciding whether a month is left, and Chromium throws outright on
 * `timeStyle` passed to the date-only form.
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

/** The screen itself. Everything about the purchase is on it. */
export function SubscriptionDialog({
  subscription,
  onClose,
}: {
  subscription: Subscription;
  onClose: () => void;
}) {
  const plan = planById(subscription.plan);

  // The page behind cannot be scrolled away from while this is up. It belongs
  // here rather than in the wiring above, because it is a property of the
  // screen: anything that puts this on screen owes the page a lock.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mino-subscription-title"
      data-testid="subscription-celebration"
      // Nothing is bound here, and nothing is bound to the overlay below.
      // Clicking anywhere outside the card must do nothing at all — see the
      // note at the top.
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <div aria-hidden className="absolute inset-0 cursor-default" />

      {/* Capped to the viewport, with only the detail list scrolling inside it.
          A small phone has no room for the whole card, and the one thing that
          must never be the part you have to scroll to find is the button that
          closes it. */}
      <div className="animate-pop relative my-auto flex max-h-[92dvh] w-full max-w-md flex-col rounded-[28px] border border-[#4da3ff]/25 bg-[#101012] p-6 text-white shadow-[0_0_70px_-20px_rgba(77,163,255,0.9)] sm:p-7">
        <span
          aria-hidden
          className="animate-halo pointer-events-none absolute left-1/2 top-2 h-24 w-24 -translate-x-1/2 rounded-full bg-[#4da3ff]/40 blur-2xl"
        />

        <div className="relative flex shrink-0 flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[#4da3ff]/30 bg-[#4da3ff]/10">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9ee7ff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m4.5 12.5 5 5 10-11" />
            </svg>
          </span>

          <h2
            id="mino-subscription-title"
            className="mt-4 text-[22px] font-semibold leading-tight tracking-tight"
          >
            Payment received
          </h2>
          <p className="mt-1.5 text-[14.5px] leading-snug text-white/60">
            <span className="font-medium text-white/90">{plan.name}</span> is active on your
            account. Everything it unlocks is already on.
          </p>
        </div>

        <dl className="relative mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-white/[0.06] rounded-[18px] border border-white/[0.07] bg-white/[0.03] px-4">
          {subscriptionDetails(subscription, formatDate).map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-[12.5px] text-white/40">{row.label}</dt>
              <dd className="text-right text-[13px] font-medium text-white/90">{row.value}</dd>
            </div>
          ))}
        </dl>

        <p className="relative mt-4 shrink-0 text-center text-[13px] leading-relaxed text-white/45">
          {renewalNote(subscription, formatDate)}
        </p>

        {/* The only way out of this dialog, on purpose. */}
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="lift relative mt-5 w-full shrink-0 rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform"
        >
          Enjoy {plan.short}
        </button>
      </div>
    </div>
  );
}

/** Watches for a grant and puts the screen on top of whatever is open. */
export default function SubscriptionCelebration() {
  const [celebration, setCelebration] = useState<Subscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    const report = (view: SubscriptionView | null) => {
      if (cancelled) return;
      setCelebration(shouldCelebrate(view, { local: readLocalAck(), now: Date.now() }));
    };

    // `watchSubscription` reports the current value immediately and then every
    // change, so one call covers both the tab that is already open and the one
    // that is being opened now.
    return watchSubscription(report);
  }, []);

  // The page behind is locked by the dialog itself, so there is nothing to do
  // here but decide whether to show it.
  const close = useCallback(() => {
    const seen = celebration;
    // Record it before the network call rather than after, so a reload while
    // that write is in flight still does not repeat the dialog.
    if (seen) writeLocalAck(seen.announcementId);
    setCelebration(null);
    if (seen) void acknowledgeSubscription(seen.announcementId);
  }, [celebration]);

  if (!celebration) return null;
  return <SubscriptionDialog subscription={celebration} onClose={close} />;
}