"use client";

import { useEffect, useState } from "react";
import { attemptsRemaining, verifyPin, type PinResult } from "@/lib/adminPin";

interface AdminGateProps {
  open: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}

export default function AdminGate({ open, onClose, onUnlocked }: AdminGateProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    let result: PinResult;
    try {
      result = await verifyPin(pin);
    } catch {
      result = { ok: false, reason: "error" };
    }
    setBusy(false);

    if (result.ok) {
      onUnlocked();
      return;
    }

    if (result.reason === "not-configured") {
      setError("Admin access is not configured. Add admin/pinHash to the Realtime Database.");
    } else if (result.reason === "locked") {
      setError("Too many attempts. Try again in a minute.");
    } else if (result.reason === "error") {
      setError("Could not reach the Realtime Database. Check your connection.");
    } else {
      setPin("");
      setError(`Incorrect PIN. ${attemptsRemaining()} attempt${attemptsRemaining() === 1 ? "" : "s"} left.`);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-5">
      <div
        className="absolute inset-0 bg-black/75"
        style={{ backdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Admin access"
        className="relative w-full max-w-sm rounded-[26px] border border-white/[0.09] bg-[#131316] p-6 shadow-2xl shadow-black/80 animate-rise"
      >
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.09] text-white">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">Admin access</h2>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-white/40">Enter the admin PIN to open the Mino console.</p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="PIN"
            className="w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-[15px] tracking-[0.3em] text-white outline-none placeholder:tracking-normal placeholder:text-white/25 focus:border-[#8b7cf6]/60"
          />
          {error && <p className="mt-2 text-[11px] leading-relaxed text-red-300/90">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[12px] px-3 py-2.5 text-[12px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || pin.trim() === ""}
              className="flex-1 rounded-[12px] bg-white px-3 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Checking…" : "Unlock"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
