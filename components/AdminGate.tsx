"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  ADMIN_UID,
  adminConfigured,
  currentUid,
  isAdminUser,
  signInAsAdmin,
  signOutAdmin,
} from "@/lib/firebaseAdmin";
import { firebaseConfigured, getServices } from "@/lib/firebaseHistory";

interface AdminGateProps {
  open: boolean;
  onClose: () => void;
  /** Fires once the signed-in account is the administrator. */
  onUnlocked: () => void;
}

type Mode = "checking" | "signin" | "denied" | "setup" | "unavailable";

/**
 * The hidden admin prompt. Reached by tapping the logo on the About page ten
 * times, so the gesture stays as unobtrusive as before — only the credential
 * changes. There is no PIN to guess: the console opens for exactly the one
 * Firebase Auth UID named in the database rules, and Firebase enforces that on
 * every read regardless of what this component decides.
 */
export default function AdminGate({ open, onClose, onUnlocked }: AdminGateProps) {
  const [mode, setMode] = useState<Mode>("checking");
  const [uid, setUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // React to the account changing so a sign-out lands back on the sign-in
  // screen rather than leaving a stale console open.
  useEffect(() => {
    if (!open || !firebaseConfigured) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void getServices()
      .then((services) => {
        if (!services || cancelled) return;
        unsubscribe = onAuthStateChanged(services.auth, (user) => {
          const current = user?.uid ?? null;
          setUid(current);
          if (!adminConfigured()) setMode("setup");
          else if (isAdminUser(current)) {
            setMode("checking");
            onUnlocked();
          } else {
            setMode((previous) => (previous === "checking" ? "signin" : previous));
          }
        });
      })
      .catch(() => {
        if (!cancelled) setMode("unavailable");
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [open, onUnlocked]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const signedInUid = await signInAsAdmin();
      if (isAdminUser(signedInUid)) {
        onUnlocked();
      } else {
        setUid(signedInUid);
        setMode("denied");
      }
    } catch (cause: unknown) {
      const code = (cause as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setError("Sign-in was cancelled.");
      } else {
        setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }, [onUnlocked]);

  const leave = useCallback(async () => {
    setBusy(true);
    try {
      await signOutAdmin();
      setError(null);
      setMode("signin");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="absolute inset-0 cursor-default bg-black/75"
        style={{ backdropFilter: "blur(6px)" }}
        aria-hidden
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mino administrator sign-in"
        className="relative w-full max-w-sm rounded-t-[28px] border border-white/[0.09] bg-[#131316] p-5 shadow-2xl shadow-black/80 animate-rise sm:rounded-[28px]"
      >
        <h2 className="text-[15px] font-semibold text-white">Mino administrator</h2>

        {mode === "checking" && <p className="mt-2 text-[13px] text-white/50">Checking this browser…</p>}

        {mode === "unavailable" && (
          <p className="mt-2 text-[13px] text-red-200/80">
            Mino cannot reach Firebase right now, so the console cannot be opened.
          </p>
        )}

        {mode === "setup" && (
          <div className="mt-2 space-y-2 text-[13px] text-white/60">
            <p>
              The console is not configured yet. Sign in, then paste the UID below into{" "}
              <code className="rounded bg-black/40 px-1">lib/firebaseAdmin.ts</code> and into{" "}
              <code className="rounded bg-black/40 px-1">database.rules.json</code>, then
              publish the rules.
            </p>
            {uid && (
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(uid)}
                className="w-full break-all rounded-lg bg-black/40 px-2 py-2 text-left font-mono text-[11px] text-white/80"
              >
                {uid}
              </button>
            )}
            {uid && <p className="text-[11px] text-white/35">Tap the UID above to copy it.</p>}
            <SignInButton busy={busy} onClick={signIn} />
          </div>
        )}

        {mode === "signin" && (
          <div className="mt-2 space-y-2 text-[13px] text-white/60">
            <p>Sign in with the Google account that owns this Firebase project.</p>
            <SignInButton busy={busy} onClick={signIn} />
            {error && <p className="text-[12px] text-red-200/80">{error}</p>}
          </div>
        )}

        {mode === "denied" && (
          <div className="mt-2 space-y-2 text-[13px] text-white/60">
            <p>
              That account is signed in, but it is not the administrator. The UID the rules expect
              is {ADMIN_UID || "(not set)"}.
            </p>
            <button
              type="button"
              onClick={() => void leave()}
              disabled={busy}
              className="w-full rounded-xl border border-white/[0.09] py-2 text-[13px] text-white/70 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              {busy ? "Signing out…" : "Use a different account"}
            </button>
            {error && <p className="text-[12px] text-red-200/80">{error}</p>}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-white/[0.09] py-2 text-[13px] text-white/70 transition hover:bg-white/[0.06]"
        >
          Cancel
        </button>
      </section>
    </div>
  );
}

function SignInButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="w-full rounded-xl bg-white/[0.08] py-2.5 text-[13px] font-medium text-white transition hover:bg-white/[0.12] disabled:opacity-50"
    >
      {busy ? "Opening Google…" : "Sign in with Google"}
    </button>
  );
}
