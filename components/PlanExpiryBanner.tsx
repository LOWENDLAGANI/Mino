"use client";

// ── Your plan is running out ─────────────────────────────────────────────────
// Renewals are the whole revenue of this product, and they are lost silently:
// a grant is a date in a database, and nothing has ever told anybody when it
// was close. This is the thing that tells them.
//
// Three decisions worth stating:
//
//   * It reads the same live subscription node the celebration dialog listens
//     to, so the banner appears when the plan actually crosses three days —
//     not the next time somebody happens to open the app.
//   * Dismissing is remembered per grant, not forever. The key includes the
//     end date, so a renewal — a new end date — earns a fresh reminder while
//     the same window can never nag twice.
//   * It is a banner, not a dialog. Nothing is blocked, no action is owed,
//     and a person in the middle of a conversation is never stopped to be
//     told about a date they can read in Settings.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSubscription } from "@/lib/useSubscription";
import { isPaused } from "@/lib/subscriptionState";
import { planById } from "@/lib/plans";
import { DAY_MS } from "@/lib/durations";

/** How long before the end the banner starts showing. */
const WARN_MS = 3 * DAY_MS;
const DISMISS_PREFIX = "mino:expiry-dismissed:";

function dismissKey(expiresAt: number): string {
  return `${DISMISS_PREFIX}${expiresAt}`;
}

export default function PlanExpiryBanner() {
  const { ready, subscription } = useSubscription();
  const [dismissed, setDismissed] = useState(false);

  const expiresAt = subscription?.expiresAt ?? 0;
  useEffect(() => {
    if (!expiresAt) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(window.localStorage.getItem(dismissKey(expiresAt)) === "1");
    } catch {
      // Private mode: the banner simply shows again next time.
    }
  }, [expiresAt]);

  if (!ready || !subscription || dismissed) return null;

  // A held plan's countdown is frozen, not falling — warning about the end
  // date while the owner has paused it would be a warning about a number that
  // is not moving.
  if (isPaused(subscription)) return null;

  const msLeft = subscription.expiresAt - Date.now();
  if (msLeft > WARN_MS) return null;

  const plan = planById(subscription.plan);
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS));
  const when =
    msLeft < 12 * 60 * 60 * 1000
      ? "ends today"
      : daysLeft === 1
        ? "ends tomorrow"
        : `${daysLeft} days left`;

  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(subscription.expiresAt), "1");
    } catch {
      // Not fatal: the worst case is seeing it again.
    }
    setDismissed(true);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex justify-center px-3 pb-3">
      <div
        role="status"
        className="animate-rise pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-amber-300/20 bg-[#1a160f]/95 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur-md"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-300/10" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f5d38b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 1.8" />
          </svg>
        </span>

        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-white/70">
          <span className="font-semibold text-white">{plan.name}</span> {when}. Mino Azure,
          advanced reasoning and image creation stop with it.
        </p>

        <Link
          href="/plus"
          className="shrink-0 rounded-full bg-[#2f6b48] px-3.5 py-1.5 text-[12px] font-semibold text-black transition-colors hover:bg-[#3a7d55]"
        >
          Renew
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss the renewal reminder"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
