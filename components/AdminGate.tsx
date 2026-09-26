"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  currentUid,
  signInAsAdmin,
  signOutAdmin,
  verifyAdminAccess,
} from "@/lib/firebaseAdmin";
import { firebaseConfigured, getServices } from "@/lib/firebaseHistory";

interface AdminGateProps {
  open: boolean;
  onClose: () => void;
  /** Fires once Firebase confirms the signed-in account is the administrator. */
  onUnlocked: () => void;
}

type Mode = "checking" | "signin" | "denied" | "unavailable";

/**
 * The hidden admin prompt, reached by tapping the logo on the About page ten
 * times.
 *
 * There is no PIN and no UID listed in the code. The prompt signs you in and
 * then attempts a real read; Firebase alone decides whether that succeeds, so
 * `database.rules.json` stays the single source of truth for who the
 * administrator is.
 */
export default function AdminGate({ open, onClose, onUnlocked }: AdminGateProps) {
  const [mode, setMode] = useState<Mode>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask Firebase on every account change, so signing out drops back to the
  // sign-in screen instead of leaving a stale console open.
  useEffect(() => {
    if (!open || !firebaseConfigured) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void getServices()
      .then(async (services) => {
        if (!services || cancelled) return;
        const check = async () => {
          const allowed = await verifyAdminAccess();
          if (cancelled) return;
          if (allowed) onUnlocked();
          else setMode("signin");
        };
        await services.auth.authStateReady();
        await check();
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(services.auth, () => void check());
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
      await signInAsAdmin();
      if (await verifyAdminAccess()) onUnlocked();
      else setMode("denied");
    } catch (cause: unknown) {
      const code = (cause as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setError("Sign-in was cancelled.");
      } else if (code === "auth/operation-not-allowed") {
        setError("Google sign-in is not enabled for this Firebase project.");
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

  /** Shown when the account is signed in but the rules refuse it. */
  const denied = useCallback(async () => {
    const uid = await currentUid();
    setError(
      `Signed in as ${uid ?? "an unknown account"}, which the database rules do not list as the administrator. Add that UID to ADMIN_UID in database.rules.json, publish, and try again.`
    );
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6">
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

        {mode === "signin" && (
          <div className="mt-2 space-y-2 text-[13px] text-white/60">
            <p>Sign in with the Google account that owns this Firebase project.</p>
            <button
              type="button"
              onClick={signIn}
              disabled={busy}
              className="w-full rounded-xl bg-white/[0.08] py-2.5 text-[13px] font-medium text-white transition hover:bg-white/[0.12] disabled:opacity-50"
            >
              {busy ? "Opening Google…" : "Sign in with Google"}
            </button>
            {error && <p className="text-[12px] text-red-200/80">{error}</p>}
          </div>
        )}

        {mode === "denied" && (
          <div className="mt-2 space-y-2 text-[13px] text-white/60">
            <p>That account is signed in, but the database rules do not list it as the administrator.</p>
            <p className="text-[12px] text-white/45">
              Your UID appears in the Firebase console under Authentication → Users.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void denied()}
                className="flex-1 rounded-xl border border-white/[0.09] py-2 text-[13px] text-white/70 transition hover:bg-white/[0.06]"
              >
                Show my UID
              </button>
              <button
                type="button"
                onClick={() => void leave()}
                disabled={busy}
                className="flex-1 rounded-xl border border-white/[0.09] py-2 text-[13px] text-white/70 transition hover:bg-white/[0.06] disabled:opacity-50"
              >
                {busy ? "Signing out…" : "Use another account"}
              </button>
            </div>
            {error && <p className="break-all text-[12px] text-red-200/80">{error}</p>}
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
