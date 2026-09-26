"use client";

import { useState } from "react";
import MinoMark from "./MinoMark";
import AdminGate from "./AdminGate";
import AdminPanel from "./AdminPanel";
import { useAdminTaps } from "@/lib/useAdminTaps";

// ── The maintenance notice ──────────────────────────────────────────────────
// Shown in place of a page rather than on top of one, so while Mino is closed
// there is nothing behind it to reach. The routes refuse independently, and
// that refusal is what actually holds.
//
// The logo is the one thing left usable: ten taps and a Google sign-in open
// the console, from which the switch is turned off. Without that the site could
// be closed with no way back in.

export default function MaintenanceScreen({ message }: { message: string }) {
  const [gateOpen, setGateOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { registerTap } = useAdminTaps(() => setGateOpen(true));

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto bg-[#030304] px-6 text-center">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(circle at 50% 40%, rgba(112,94,255,0.10), transparent 32%), radial-gradient(ellipse 70% 34% at 50% 100%, rgba(32,77,216,0.18), transparent 72%)",
        }}
      />

      <div className="relative flex w-full max-w-md flex-col items-center py-10">
        <div className="relative flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
          <div className="absolute inset-[-40%] animate-breathe rounded-full bg-[#7567e8]/20 blur-3xl" />
          <button
            type="button"
            onClick={() => registerTap()}
            className="relative h-full w-full cursor-default select-none"
            aria-label="Mino"
            title="Mino"
          >
            <MinoMark className="h-full w-full" title="Mino" />
          </button>
        </div>

        <h1 className="mt-8 text-[38px] font-normal leading-none tracking-[-0.05em] text-white sm:text-[52px]">
          Mino
        </h1>

        <div className="mt-4 flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/[0.07] px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100/85">
            Maintenance mode
          </span>
        </div>

        {message && (
          <p className="mt-6 text-balance text-[14px] leading-relaxed text-white/60 sm:text-[15px]">
            {message}
          </p>
        )}

        <p className="mt-8 text-[11px] text-white/25">Please check back shortly</p>
      </div>

      <AdminGate
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        onUnlocked={() => {
          setGateOpen(false);
          setPanelOpen(true);
        }}
      />
      <AdminPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}
