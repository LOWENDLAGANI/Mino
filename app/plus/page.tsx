"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import MaintenanceGate from "@/components/MaintenanceGate";
import PayQrDialog from "@/components/PayQrDialog";
import { DEFAULT_PLAN, FEATURES, PLANS, formatRinggit, planById, type PlanId } from "@/lib/plans";

// ── Mino subscriptions ──────────────────────────────────────────────────────
// Two real paid plans. Everything about them — price, features, payment QR —
// lives in lib/plans.ts, so this file is only the page that presents it. Pressing
// a plan opens its payment QR; there is no charge until the buyer scans it.

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
  const [plan, setPlan] = useState<PlanId>(DEFAULT_PLAN.id);
  // Which plan the payment QR is open for, or null when the dialog is closed.
  // Kept separate from `plan` so switching tabs with the dialog shut does not
  // open it, and so the QR is never shown for a plan the buyer did not choose.
  const [paying, setPaying] = useState<PlanId | null>(null);

  const closePay = useCallback(() => setPaying(null), []);

  const active = planById(plan);

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

          <h1 className="mt-7 text-[clamp(2.1rem,8vw,3.6rem)] font-semibold leading-[1.05] tracking-tight">
            Mino{" "}
            <span className="bg-gradient-to-r from-[#4da3ff] via-[#9ee7ff] to-[#4da3ff] bg-clip-text text-transparent">
              {active.name.replace("Mino ", "")}
            </span>
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
                className={`relative overflow-hidden rounded-full px-3 py-3 text-[15px] font-medium transition-all ${
                  plan === item.id
                    ? "bg-white/[0.14] text-white shadow-[0_0_22px_-4px_rgba(77,163,255,0.75),0_1px_0_rgba(255,255,255,0.1)_inset]"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {plan === item.id && (
                  <span className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                )}
                <span className="relative flex items-center justify-center gap-1.5">
                  {item.featured && plan === item.id && (
                    <span className="text-[13px] leading-none" aria-hidden>
                      🔥
                    </span>
                  )}
                  {item.short}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[14px] text-white/45">
            <span className="font-semibold text-white/85">{active.name}</span> — {active.blurb}.{" "}
            {formatRinggit(active.ringgit)} a month, cancel any time.
          </p>

          {/* Features */}
          <section className="relative mt-6 overflow-hidden rounded-[26px] border border-[#4da3ff]/20 bg-white/[0.035] p-4 shadow-[0_0_50px_-18px_rgba(77,163,255,0.6)] sm:p-6">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 sm:gap-x-8">
              <span className="text-[15px] text-white/50">Features</span>
              <span className="w-9 text-center text-[13px] text-white/50 sm:w-20 sm:text-[15px]">
                Free
              </span>
              <span className="w-11 text-center text-[13px] text-white/50 sm:w-20 sm:text-[15px]">
                Mini
              </span>
              <span className="w-12 text-center text-[13px] font-medium text-[#4da3ff] sm:w-20 sm:text-[15px]">
                Lunar
              </span>
            </div>

            <ul className="mt-2">
              {FEATURES.map((feature) => (
                <li
                  key={feature.label}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 border-t border-white/[0.06] py-4 sm:gap-x-8 sm:py-5"
                >
                  <span className="text-[clamp(0.95rem,3.4vw,1.15rem)] leading-snug text-white/90">
                    {feature.label}
                  </span>
                  <span className="w-9 sm:w-20">
                    <Mark on={feature.free} />
                  </span>
                  <span className="w-11 sm:w-20">
                    <Mark on={feature.mini} />
                  </span>
                  <span className="w-12 sm:w-20">
                    <Mark on={feature.lunar} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="relative mt-5">
            {/* Breathing halo behind the button, plus a thin conic ring that
                sweeps once per loop. Both are siblings, so the button stays
                clickable and the glow never shifts layout. */}
            <span
              aria-hidden
              className="animate-halo pointer-events-none absolute -inset-3 rounded-full bg-[#4da3ff]/45 blur-2xl"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-[3px] overflow-hidden rounded-full"
            >
              <span className="animate-sheen absolute inset-y-0 -left-1/2 w-1/2 bg-[conic-gradient(from_90deg_at_50%_50%,transparent,rgba(158,231,255,0.9),transparent)] blur-[2px]" />
            </span>
            <button
              onClick={() => setPaying(plan)}
              className="lift relative flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-4 text-[clamp(1rem,3.8vw,1.15rem)] font-semibold text-black transition-transform sm:py-[18px]"
            >
              Get {active.short} — {formatRinggit(active.ringgit)}/mo
            </button>
          </div>

          <p className="mt-4 text-center text-[14px] text-white/45">
            Billed monthly. Cancel anytime.
          </p>
        </div>
      </main>

      {/* The payment QR for whichever plan was pressed. Keyed on the plan so a
          switch starts from a clean image, free of a previous plan's error. */}
      {paying && <PayQrDialog key={paying} plan={planById(paying)} onClose={closePay} />}
    </MaintenanceGate>
  );
}