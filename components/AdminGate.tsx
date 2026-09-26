"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_ERROR_COPY,
  createAdminPin,
  needsSetup,
  verifyPin,
  type AdminFailure,
  type AdminResult,
} from "@/lib/adminPin";

interface AdminGateProps {
  open: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}

type Mode = "checking" | "setup" | "unlock" | "blocked";

export default function AdminGate({ open, onClose, onUnlocked }: AdminGateProps) {
  const [mode, setMode] = useState<Mode>("checking");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [failure, setFailure] = useState<(AdminFailure & { remaining?: number }) | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setPin("");
    setConfirmPin("");
    setFailure(null);
  }, []);

  const check = useCallback(async () => {
    setMode("checking");
    setFailure(null);
    const state = await needsSetup();
    if (state.failure) {
      setFailure(state.failure);
      setMode("blocked");
      return;
    }
    setMode(state.needsSetup ? "setup" : "unlock");
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    void check();
  }, [open, reset, check]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fail = (result: AdminResult) => {
    if (result.ok) return;
    setFailure({ reason: result.reason, detail: result.detail, remaining: result.remaining });
    setPin("");
    setConfirmPin("");
    if (result.reason === "no-pin-yet") setMode("setup");
    if (result.reason === "already-set") setMode("unlock");
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = mode === "setup"
        ? await createAdminPin(pin, confirmPin)
        : await verifyPin(pin);
      if (result.ok) {
        onUnlocked();
        return;
      }
      // A mismatch while creating simply means the two entries differ.
      if (mode === "setup" && result.reason === "mismatch") {
        setFailure({ reason: "mismatch" });
        setPin("");
        setConfirmPin("");
      } else {
        fail(result);
      }
    } catch (error) {
      setFailure({ reason: "unknown", detail: (error as { code?: string } | null)?.code });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
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
        className="relative max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-[26px] border border-white/[0.09] bg-[#131316] p-5 shadow-2xl shadow-black/80 animate-rise sm:p-6"
      >
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">Admin access</h2>
        </div>

        {mode === "checking" ? (
          <p className="py-5 text-center text-[12px] text-white/40">Checking Firebase…</p>
        ) : mode === "blocked" ? (
          <BlockedState failure={failure} onRetry={() => void check()} onClose={onClose} />
        ) : (
          <>
            <p className="mb-4 text-[11px] leading-relaxed text-white/40">
              {mode === "setup"
                ? "No admin PIN exists yet. Choose one and Mino stores its hash in the Realtime Database automatically. This can only be done once."
                : "Enter the admin PIN to open the Mino console."}
            </p>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <input
                key={mode}
                autoFocus
                type="password"
                autoComplete="off"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder={mode === "setup" ? "New PIN (min 4 characters)" : "PIN"}
                className="w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-[15px] tracking-[0.3em] text-white outline-none placeholder:tracking-normal placeholder:text-white/25 focus:border-[#8b7cf6]/60"
              />
              {mode === "setup" && (
                <input
                  type="password"
                  autoComplete="off"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value)}
                  placeholder="Confirm PIN"
                  className="w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-[15px] tracking-[0.3em] text-white outline-none placeholder:tracking-normal placeholder:text-white/25 focus:border-[#8b7cf6]/60"
                />
              )}
              {failure && <ErrorBlock failure={failure} />}
              <GateActions
                busy={busy}
                disabled={pin === "" || (mode === "setup" && confirmPin === "")}
                onClose={onClose}
                label={mode === "setup" ? "Create" : "Unlock"}
              />
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function ErrorBlock({ failure }: { failure: AdminFailure & { remaining?: number } }) {
  const copy = ADMIN_ERROR_COPY[failure.reason] ?? ADMIN_ERROR_COPY.unknown;
  const remaining = failure.remaining;
  return (
    <div className="mt-1 rounded-[12px] border border-red-400/20 bg-red-500/[0.08] p-3">
      <p className="text-[11px] leading-relaxed text-red-200/95">
        {copy}
        {failure.reason === "mismatch" && remaining !== undefined && (
          <> {remaining} attempt{remaining === 1 ? "" : "s"} left.</>
        )}
      </p>
      {failure.detail && (
        <p className="mt-2 break-all rounded-lg bg-black/30 px-2 py-1.5 font-mono text-[10px] text-red-200/70">
          Error code: {failure.detail}
        </p>
      )}
    </div>
  );
}

function BlockedState({
  failure,
  onRetry,
  onClose,
}: {
  failure: (AdminFailure & { remaining?: number }) | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pt-1">
      {failure && <ErrorBlock failure={failure} />}
      <p className="mt-3 text-[10px] leading-relaxed text-white/30">
        Mino cannot continue until Firebase is reachable, so the setup form is hidden rather than
        failing on submit. Fix the problem above, then tap Retry.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-[12px] px-3 py-2.5 text-[12px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 rounded-[12px] bg-white px-3 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90"
        >
          Retry
        </button>
      </div>
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
