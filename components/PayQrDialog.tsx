"use client";

import { useEffect, useState } from "react";
import { formatRinggit, type Plan } from "@/lib/plans";

// ── Pay ─────────────────────────────────────────────────────────────────────
// Pressing a plan on /plus opens this: the payment QR for that plan, the exact
// amount to enter, and what happens next. `onClose` must be a stable callback
// from the parent, because it is an effect dependency that locks the page
// behind the dialog while it is open.

export default function PayQrDialog({
  plan,
  onClose,
}: {
  plan: Plan;
  onClose: () => void;
}) {
  // Reset per mount, not per render: the parent keys this dialog on the plan,
  // so switching plans remounts it and a working QR stays working.
  const [qrBroken, setQrBroken] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const amount = formatRinggit(plan.ringgit);
  // What the buyer must confirm in their banking app. A static DuitNow QR
  // carries no amount, so this number is the whole instruction. Always two
  // decimals, because that is what a payment screen asks for.
  const payable = `RM ${plan.ringgit.toFixed(2)}`;

  async function copyAmount() {
    try {
      await navigator.clipboard.writeText(plan.ringgit.toFixed(2));
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission); the
      // amount is on screen anyway, so failing quietly is fine.
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pay for ${plan.name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm sm:p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="animate-pop relative my-auto w-full max-w-md rounded-[28px] border border-[#4da3ff]/25 bg-[#101012] p-6 shadow-[0_0_60px_-20px_rgba(77,163,255,0.8)] sm:p-7"
      >
        <button
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

        <h2 className="pr-10 text-[19px] font-semibold leading-tight tracking-tight">
          Pay for {plan.name}
        </h2>
        <p className="mt-1 text-[14px] leading-snug text-white/55">{plan.blurb}</p>

        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-[clamp(2.2rem,9vw,3rem)] font-semibold leading-none tracking-tight text-white">
            {amount}
          </span>
          <span className="text-[15px] text-white/50">/month</span>
          <button
            type="button"
            onClick={copyAmount}
            aria-label={`Copy the amount ${payable}`}
            className="ml-auto shrink-0 rounded-full border border-white/[0.12] px-2.5 py-1 text-[11.5px] font-medium text-white/60 transition-colors hover:border-white/25 hover:text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {qrBroken ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/[0.14] px-5 py-9 text-center">
            <p className="text-[15px] font-medium text-white/85">QR not added yet</p>
            <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-white/45">
              Put your DuitNow QR in <code className="text-white/70">public/</code> named{" "}
              <code className="text-white/70">{plan.qr.replace("/", "")}</code>, or set{" "}
              <code className="text-white/70">qr</code> on this plan in{" "}
              <code className="text-white/70">lib/plans.ts</code>.
            </p>
          </div>
        ) : (
          <>
            <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3">
              {/* A fixed square box so the code always scans at the same size
                  and is never letterboxed by its own aspect ratio. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={plan.qr}
                alt={`Payment QR code for ${plan.name}`}
                onError={() => setQrBroken(true)}
                width={208}
                height={208}
                className="h-[164px] w-[164px] object-contain sm:h-[208px] sm:w-[208px]"
              />
            </div>
            <p className="mt-3 text-center text-[13px] text-white/45">{plan.qrCaption}</p>
          </>
        )}

        <ol className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-4 text-left text-[13.5px] leading-snug text-white/60">
          <li className="flex gap-2.5">
            <span className="shrink-0 font-semibold text-[#4da3ff]">1</span>
            <span>Scan the code with your banking app.</span>
          </li>
          <li className="flex gap-2.5">
            <span className="shrink-0 font-semibold text-[#4da3ff]">2</span>
            <span>
              Enter <span className="font-medium text-white">{payable}</span> and confirm the
              payment.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="shrink-0 font-semibold text-[#4da3ff]">3</span>
            <span>
              Your {plan.name} starts once the payment lands, and runs for a month.
            </span>
          </li>
        </ol>

        <button
          onClick={onClose}
          className="lift mt-6 w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform"
        >
          Done
        </button>
      </div>
    </div>
  );
}