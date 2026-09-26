"use client";

import Link from "next/link";
import MinoMark from "./MinoMark";
import AboutLogo from "./AboutLogo";

// ── Maintenance notice ──────────────────────────────────────────────────────
// Shown instead of the chat while the administrator has Mino closed. It blocks
// the interface rather than merely disabling it, and it deliberately leaves the
// About page reachable: that page's logo is the ten-tap trigger, which is how
// the administrator gets back in to turn this off.

export default function MaintenanceGate({ message }: { message: string }) {
  return (
    <div className="app-surface flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <div className="surface-glow pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative flex w-full max-w-md flex-col items-center">
        {/* Doubles as the administrator's way back in during maintenance. */}
        <AboutLogo className="h-16 w-16 sm:h-20 sm:w-20" />

        <h1 className="mt-8 text-balance text-[26px] font-normal leading-tight tracking-[-0.04em] text-white sm:text-[32px]">
          Mino is down for maintenance
        </h1>
        <p className="mt-3 text-balance text-[13px] leading-relaxed text-white/50 sm:text-[14px]">
          {message}
        </p>

        <div className="mt-7 flex items-center gap-2 text-[11px] text-white/25">
          <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-white/40" />
          Please check back shortly
        </div>

        <Link
          href="/about"
          className="mt-8 text-[11px] text-white/30 underline-offset-4 transition-colors hover:text-white/60 hover:underline"
        >
          About Mino
        </Link>
      </div>
    </div>
  );
}
