"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MaintenanceGate from "@/components/MaintenanceGate";

// ── Mino Plus ───────────────────────────────────────────────────────────────
// A convincing upgrade screen. Tapping Subscribe does not charge anyone: it
// reveals a picture instead. To personalise the reveal, drop your image at
// public/ and give it any name you like, then update this one constant.

/** Path (in /public) of the image shown after tapping Subscribe. */
export const PRANK_IMAGE = "/mino-plus-prank.png";

const FEATURES: Array<{ label: string; free: boolean; plus: boolean }> = [
  { label: "Access to the newest model", free: true, plus: true },
  { label: "Advanced reasoning", free: false, plus: true },
  { label: "More messages and uploads", free: false, plus: true },
  { label: "Advanced image creation", free: false, plus: true },
  { label: "More memory", free: false, plus: true },
  { label: "Early access to new features", free: false, plus: true },
  { label: "Agent mode with deep research", free: false, plus: true },
];

const PLANS = [
  { id: "go", name: "Go", price: "Free", blurb: "For everyday chatting" },
  { id: "plus", name: "Plus", price: "RM 95.99 / mo", blurb: "For the full experience" },
] as const;

function Mark({ on }: { on: boolean }) {
  if (on) {
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto text-[#4da3ff]"
        aria-label="Included"
      >
        <path d="m4.5 12.5 5 5 10-11" />
      </svg>
    );
  }
  return <span className="mx-auto block h-px w-5 bg-white/35" aria-label="Not included" />;
}

export default function MinoPlusPage() {
  const [plan, setPlan] = useState<(typeof PLANS)[number]["id"]>("plus");
  const [revealed, setRevealed] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);

  // The reveal is a punchline, so it dismisses the same way every time.
  useEffect(() => {
    if (!revealed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRevealed(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [revealed]);

  const active = PLANS.find((item) => item.id === plan) ?? PLANS[1];

  return (
    <MaintenanceGate>
      <main className="min-h-dvh bg-[#0a0a0b] px-5 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-8">
        <div className="mx-auto w-full max-w-2xl lg:max-w-3xl">
          <Link
            href="/"
            aria-label="Back to Mino"
            className="lift inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.07] text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 5.5 8.5 12l6.5 6.5" />
            </svg>
          </Link>

          <h1 className="mt-7 text-[clamp(2.5rem,9vw,4rem)] font-semibold leading-[1.05] tracking-tight">
            Mino <span className="text-[#4da3ff]">Plus</span>
          </h1>
          <p className="mt-3 max-w-xl text-[clamp(1rem,3.6vw,1.3rem)] leading-snug text-white/60">
            Get more access with advanced intelligence and agents
          </p>

          {/* Plan switch */}
          <div
            role="tablist"
            aria-label="Choose a plan"
            className="mt-6 grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1"
          >
            {PLANS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={plan === item.id}
                onClick={() => setPlan(item.id)}
                className={`rounded-full px-4 py-3 text-[15px] font-medium transition-all ${
                  plan === item.id
                    ? "bg-white/[0.12] text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[14px] text-white/45">
            {active.name} — {active.blurb}.{" "}
            {plan === "go" ? "Upgrade any time." : "Billed monthly in ringgit."}
          </p>

          {/* Features */}
          <section className="mt-6 overflow-hidden rounded-[26px] border border-white/[0.08] bg-white/[0.035] p-4 sm:p-6">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 sm:gap-x-8">
              <span className="text-[15px] text-white/50">Features</span>
              <span className="w-12 text-center text-[15px] text-white/50 sm:w-16">Free</span>
              <span className="w-12 text-center text-[15px] font-medium text-[#4da3ff] sm:w-16">Plus</span>
            </div>

            <ul className="mt-2">
              {FEATURES.map((feature) => (
                <li
                  key={feature.label}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-t border-white/[0.06] py-4 sm:gap-x-8 sm:py-5"
                >
                  <span className="text-[clamp(0.95rem,3.4vw,1.15rem)] leading-snug text-white/90">
                    {feature.label}
                  </span>
                  <span className="w-12 sm:w-16">
                    <Mark on={feature.free} />
                  </span>
                  <span className="w-12 sm:w-16">
                    <Mark on={feature.plus} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <button className="mt-5 w-full py-3 text-center text-[15px] font-medium text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
            Restore subscription
          </button>

          <button
            onClick={() => {
              setImageBroken(false);
              setRevealed(true);
            }}
            className="lift mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-4 text-[clamp(1rem,3.8vw,1.15rem)] font-semibold text-black transition-transform sm:py-[18px]"
          >
            {plan === "go" ? "Upgrade for RM 95.99" : "Subscribe"}
          </button>

          <p className="mt-4 text-center text-[14px] text-white/45">
            Renews monthly. Cancel anytime.
          </p>
        </div>
      </main>

      {/* The punchline */}
      {revealed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Subscription"
          onClick={() => setRevealed(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="animate-pop relative flex max-h-full w-full max-w-3xl flex-col items-center justify-center"
          >
            <button
              onClick={() => setRevealed(false)}
              aria-label="Close"
              className="lift absolute -top-2 right-0 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white sm:-top-3 sm:-right-3"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
              </svg>
            </button>

            {imageBroken ? (
              <div className="w-full rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-12 text-center">
                <p className="text-[17px] font-medium text-white">No reveal image yet</p>
                <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-white/55">
                  Add your picture to <code className="text-white/75">public/</code> and name it{" "}
                  <code className="text-white/75">{PRANK_IMAGE.replace("/", "")}</code>.
                </p>
              </div>
            ) : (
              // Intrinsic sizing: fills the width on phones, capped by the
              // viewport height on desktop, so it is never cropped or blurry.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={PRANK_IMAGE}
                alt=""
                onError={() => setImageBroken(true)}
                className="max-h-[80dvh] w-auto max-w-full rounded-2xl object-contain shadow-2xl"
              />
            )}
          </div>
        </div>
      )}
    </MaintenanceGate>
  );
}
