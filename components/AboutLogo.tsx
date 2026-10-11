"use client";

import dynamic from "next/dynamic";

import { useState } from "react";
import MinoMark from "./MinoMark";
import AdminGate from "./AdminGate";
// The console is ~2,400 lines of admin UI that no visitor ever sees. Loading
// it on demand rather than in the page bundle keeps it off every visitor's
// first paint; it is only reachable after ten taps on the logo and a Google
// sign-in, so the deferred fetch is invisible in practice.
const AdminPanel = dynamic(() => import("./AdminPanel"), { ssr: false });
import { useAdminTaps } from "@/lib/useAdminTaps";

/** The About page logo. Ten taps opens the admin console. */
export default function AboutLogo({ className }: { className?: string }) {
  const [gateOpen, setGateOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { registerTap } = useAdminTaps(() => setGateOpen(true));

  const handleUnlocked = () => {
    setGateOpen(false);
    setPanelOpen(true);
  };

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
        onUnlocked={handleUnlocked}
      />
      <AdminPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}
