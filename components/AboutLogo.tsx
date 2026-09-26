"use client";

import { useState } from "react";
import MinoMark from "./MinoMark";
import AdminGate from "./AdminGate";
import AdminPanel from "./AdminPanel";
import { useAdminTaps } from "@/lib/useAdminTaps";
import { hashPin, readStoredDigest } from "@/lib/adminPin";

/** The About page logo. Ten taps opens the PIN-gated admin console. */
export default function AboutLogo({ className }: { className?: string }) {
  const [gateOpen, setGateOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // The digest is held in memory only; the PIN itself never leaves the gate.
  const [digest, setDigest] = useState("");
  const [browserMismatch, setBrowserMismatch] = useState(false);
  const { registerTap } = useAdminTaps(() => setGateOpen(true));

  const handleUnlocked = async (pin: string) => {
    setGateOpen(false);
    const computed = await hashPin(pin);

    // The gate already compared the PIN against the browser's view of the
    // database. Record whether that view agrees, so the console can tell a
    // browser/server split apart from a genuinely wrong PIN.
    try {
      const stored = await readStoredDigest();
      setBrowserMismatch(stored !== null && stored !== computed);
    } catch {
      setBrowserMismatch(false);
    }

    setDigest(computed);
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
        onUnlocked={(verified) => void handleUnlocked(verified)}
      />
      <AdminPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        digest={digest}
        browserMismatch={browserMismatch}
      />
    </>
  );
}
