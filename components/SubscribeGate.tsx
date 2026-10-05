"use client";

import { useEffect, useState } from "react";
import { bindGoogleAccount } from "@/lib/account";
import { describeLinkError, isDismissed } from "@/lib/accountState";
import { firebaseConfigured } from "@/lib/firebaseHistory";
import { describeDuration } from "@/lib/durations";
import type { Plan, PlanTerm } from "@/lib/plans";

// ── Sign in to subscribe ─────────────────────────────────────────────────────
// Stands between the pricing page and the payment QR.
//
// A subscription is attached to the account, not to the browser, because that is
// the only thing that survives losing the device. Which means the QR must not
// open until there *is* an account: a transfer made from a browser that never
// signs in could not be granted to anybody, because the owner would have no way
// to tell whose money it was. So the sign-in comes first, and the QR opens only
// once it has succeeded.
//
// Binding — not signing in — is what makes this safe. `linkWithPopup` attaches
// the Google credential to the anonymous account this browser already has, so
// the UID never changes and anything already logged under it stays put. The plan
// the buyer is about to pay for lands on the same UID they already had.

export default function SubscribeGate({
  plan,
  term,
  onSignedIn,
  onClose,
}: {
  plan: Plan;
  term: PlanTerm;
  onSignedIn: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the account service is even there. A deployment with no Firebase has
  // no accounts and no database to record a grant in, so it cannot take a
  // subscription at all — and saying so is better than taking the money.
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    setAvailable(firebaseConfigured);
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await bindGoogleAccount();
      if (result.outcome === "dismissed") return;
      onSignedIn();
    } catch (cause: unknown) {
      if (!isDismissed(cause)) setError(describeLinkError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mino-subscribe-gate-title"
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm sm:items-center sm:p-8"
    >
      <div className="animate-pop relative my-auto w-full max-w-md rounded-[28px] border border-[#2f6b48]/25 bg-[#111a16] p-6 text-white shadow-[0_0_60px_-20px_rgba(47,107,72,0.8)] sm:p-7">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="lift absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.07] text-white/70 transition-colors hover:bg-white/[0.14] hover:text-white"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
          </svg>
        </button>

        <h2 id="mino-subscribe-gate-title" className="pr-10 text-[19px] font-semibold leading-tight tracking-tight">
          One step first
        </h2>

        {available ? (
          <>
            <p className="mt-2 text-[14px] leading-relaxed text-white/60">
              Sign in with Google and your {plan.name} — {describeDuration(term.days)} — belongs to
              your account, not to this browser. Change phones, lose the laptop, come back anywhere,
              and it is still there.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-white/45">
              Mino attaches the account you sign in with to the one this browser already has, so
              nothing you have written moves. It takes a moment and asks for no payment details.
            </p>

            {error && (
              <p className="mt-4 rounded-[12px] border border-red-400/20 bg-red-500/[0.08] px-3 py-2.5 text-[12.5px] leading-relaxed text-red-200/95">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void signIn()}
              disabled={busy}
              className="lift mt-6 w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Continue with Google"}
            </button>
            <p className="mt-3 text-center text-[12.5px] text-white/35">
              Then the QR opens, and you pay as usual.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[14px] leading-relaxed text-white/60">
              Subscriptions are unavailable on this deployment.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-white/45">
              A plan is stored against an account so it can follow you to another device, and this
              deployment has no account service set up — so a transfer could not be recorded, and
              nobody would be able to hand it to you. Mino works exactly as it always does.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="lift mt-6 w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}