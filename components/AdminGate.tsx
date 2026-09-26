"use client";

import { useEffect, useState } from "react";
import {
  ADMIN_ERROR_COPY,
  createAdminPin,
  needsSetup,
  verifyPin,
  type AdminResult,
} from "@/lib/adminPin";

interface AdminGateProps {
  open: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}

type Mode = "loading" | "setup" | "unlock";

export default function AdminGate({ open, onClose, onUnlocked }: AdminGateProps) {
  const [mode, setMode] = useState<Mode>("loading");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
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

  // Ask the database whether a PIN already exists so the right form shows.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPin("");
    setConfirmPin("");
    setError(null);
    setMode("loading");

    void needsSetup().then((result) => {
      if (cancelled) return;
      if (result.reason === "rules-not-published" || result.reason === "offline") {
        setError(ADMIN_ERROR_COPY[result.reason]);
        setMode("setup");
        return;
      }
      setMode(result.needsSetup ? "setup" : "unlock");
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const fail = (result: AdminResult) => {
    if (result.ok) return;
    const reason = result.reason;
    let message = ADMIN_ERROR_COPY[reason];
    if (reason === "mismatch" && mode === "setup") {
      message = "The two PINs do not match.";
    } else if (reason === "mismatch" && result.remaining !== undefined) {
      message += ` ${result.remaining} attempt${result.remaining === 1 ? "" : "s"} left.`;
    }
    setError(message);
    setPin("");
    setConfirmPin("");
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = mode === "setup"
        ? await createAdminPin(pin, confirmPin)
        : await verifyPin(pin);
      if (result.ok) {
        onUnlocked();
        return;
      }
      fail(result);
      if (mode === "setup" && result.reason === "already-set") setMode("unlock");
    } catch {
      setError(ADMIN_ERROR_COPY.unknown);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-[15px] tracking-[0.3em] text-white outline-none placeholder:tracking-normal placeholder:text-white/25 focus:border-[#8b7cf6]/60";

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

        {mode === "loading" ? (
          <p className="py-4 text-[12px] text-white/40">Checking Firebase…</p>
        ) : mode === "setup" ? (
          <>
            <p className="mb-4 text-[11px] leading-relaxed text-white/40">
              No admin PIN exists yet. Choose one and Mino will store its hash in the Realtime
              Database automatically. This can only be done once.
            </p>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="New PIN (min 4 characters)"
                className={inputClass}
              />
              <input
                type="password"
                autoComplete="off"
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value)}
                placeholder="Confirm PIN"
                className={inputClass}
              />
              {error && <p className="pt-1 text-[11px] leading-relaxed text-red-300/90">{error}</p>}
              <GateActions busy={busy} disabled={pin === "" || confirmPin === ""} onClose={onClose} label="Create" />
            </form>
          </>
        ) : (
          <>
            <p className="mb-4 text-[11px] leading-relaxed text-white/40">
              Enter the admin PIN to open the Mino console.
            </p>
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
                className={inputClass}
              />
              {error && <p className="mt-2 text-[11px] leading-relaxed text-red-300/90">{error}</p>}
              <GateActions busy={busy} disabled={pin.trim() === ""} onClose={onClose} label="Unlock" />
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function GateActions({
  busy,
  disabled,
  onClose,
  label,
}: {
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  label: string;
}) {
  return (
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
        disabled={busy || disabled}
        className="flex-1 rounded-[12px] bg-white px-3 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Working…" : label}
      </button>
    </div>
  );
}
