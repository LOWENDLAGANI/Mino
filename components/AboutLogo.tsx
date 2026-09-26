"use client";

import { useState } from "react";
import MinoMark from "./MinoMark";
import AdminGate from "./AdminGate";
import AdminPanel from "./AdminPanel";
import { useAdminTaps } from "@/lib/useAdminTaps";

/** The About page logo. Ten taps opens the PIN-gated admin console. */
export default function AboutLogo({ className }: { className?: string }) {
  const [gateOpen, setGateOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { registerTap } = useAdminTaps(() => setGateOpen(true));

  return (
    <>
      <button
        type="button"
        onClick={() => registerTap()}
        className={`shrink-0 cursor-default select-none ${className ?? ""}`}
        aria-label="Mino"
        title="Mino"
      >
        <MinoMark className="h-full w-full" title="Mino" />
      </button>

      <AdminGate
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        onUnlocked={() => {
          setGateOpen(false);
          setPanelOpen(true);
        }}
      />
      <AdminPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}
