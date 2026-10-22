"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { signInAsAdmin, signOutAdmin, verifyAdminAccess } from "@/lib/firebaseAdmin";
import { firebaseConfigured, getServices } from "@/lib/firebaseHistory";

interface AdminGateProps {
  open: boolean;
  onClose: () => void;
  /** Fires once Firebase confirms the signed-in account is the administrator. */
  onUnlocked: () => void;
}

type Mode = "checking" | "signin" | "denied" | "unavailable" | "notconfigured";

/** The longest the initial check may sit on "Checking this browser…". */
const CHECK_DEADLINE_MS = 20_000;
/** A sign-in window that never reports back must not spin forever. */
const SIGN_IN_DEADLINE_MS = 120_000;

/** Turns a Firebase error into something worth reading on a phone. */
function describe(cause: unknown): { code: string; message: string } {
  const error = cause as { code?: string; name?: string } | null;
  const code = error?.code ?? error?.name ?? "unknown";
  const message = cause instanceof Error ? cause.message : String(cause);

  const hints: Record<string, string> = {
    "auth/operation-not-allowed":
      "This sign-in method is switched off. Under Firebase → Authentication → Sign-in method, turn on Anonymous (the app signs every first-time visitor in anonymously) and Google.",
    "auth/network-request-failed":
      "The request to Firebase never completed. Check the connection, and whether an ad blocker or privacy extension is blocking googleapis.com.",
    "auth/unauthorized-domain":
      "This domain is not authorised. Under Firebase → Authentication → Settings → Authorized domains, add the domain you are visiting from.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    PERMISSION_DENIED:
      "The database rules do not list this account as the administrator. The rules may still contain the ADMIN_EMAIL placeholder — publish database.rules.json with your real address.",
  };

  return { code, message: hints[code] ?? message };
}

/**
 * The hidden admin prompt, reached by tapping the logo on the About page ten
 * times.
 *
 * There is no PIN and no address listed in the code. The prompt signs you in
 * and then attempts a real read; Firebase alone decides whether that succeeds,
 * so `database.rules.json` stays the single source of truth for who the
 * administrator is.
 */
export default function AdminGate({ open, onClose, onUnlocked }: AdminGateProps) {
  const [mode, setMode] = useState<Mode>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ code: string; message: string } | null>(null);
  // Bumped by "Try again"; re-runs the check below against a fresh deadline.
  const [retry, setRetry] = useState(0);

  // Ask Firebase on every account change, so signing out drops back to the
  // sign-in screen instead of leaving a stale console open.
  useEffect(() => {
    if (!open) return;
    if (!firebaseConfigured) {
      setMode("notconfigured");
      return;
    }

    setMode("checking");
    setError(null);
    setDetail(null);

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    // Once *any* answer exists there is nothing left to time out.
    let answered = false;

    // An unanswered check must never look like one that is still asking.
    // Firebase can hold the auth state open indefinitely behind a proxy, an ad
    // blocker or a captive portal, and nothing used to bound this side of the
    // check — so the gate sat on "Checking this browser…" for as long as the
    // tab stayed open. `verifyAdminAccess` bounds each request it makes; this
    // is the backstop for everything around them.
    const deadline = window.setTimeout(() => {
      if (cancelled || answered) return;
      answered = true;
      setDetail({
        code: "auth/timeout",
        message:
          "Firebase did not answer in time. A proxy, an ad blocker or a captive network can hold the sign-in service open.",
      });
      setMode("unavailable");
    }, CHECK_DEADLINE_MS);

    const answer = (next: Mode) => {
      if (cancelled) return;
      answered = true;
      window.clearTimeout(deadline);
      setMode(next);
    };

    const fail = (cause: unknown) => {
      if (cancelled) return;
      console.error("[mino admin]", cause);
      setDetail(describe(cause));
      answer("unavailable");
    };

    const check = async () => {
      try {
        const allowed = await verifyAdminAccess();
        if (cancelled) return;
        // Not being the administrator (including nobody being signed in) is a
        // real answer, and the answer that shows the Google button.
        if (allowed) onUnlocked();
        else answer("signin");
      } catch (cause: unknown) {
        fail(cause);
      }
    };

    void getServices()
      .then((services) => {
        if (cancelled) return;
        if (!services) {
          // The env values are present (checked above), so this is the SDK
          // failing to start — not a deployment that never configured it.
          fail(new Error("Firebase could not be initialised in this browser."));
          return;
        }
        // `getServices` has already waited for the initial auth state, with a
        // deadline of its own. Asking `authStateReady` again here would only
        // add a second place for the gate to hang.
        void check();
        unsubscribe = onAuthStateChanged(services.auth, () => {
          if (!cancelled) void check();
        });
      })
      .catch(fail);

    return () => {
      cancelled = true;
      answered = true;
      window.clearTimeout(deadline);
      unsubscribe?.();
    };
  }, [open, onUnlocked, retry]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDetail(null);

    // The popup reports its own failures; the one failure it cannot report is
    // never reporting at all. A window that cannot talk back to this tab —
    // third-party storage blocked, a strict extension, an embedded view —
    // leaves `signInWithPopup` pending for good, and the button used to stay on
    // "Opening Google…" indefinitely. This only stops the spinner and says so;
    // a sign-in that still completes afterwards opens the console as normal.
    const timer = window.setTimeout(() => {
      setBusy(false);
      setError(
        "The sign-in window never finished. Close it and try again — if this browser blocks third-party cookies or pop-ups, allow them for this site."
      );
    }, SIGN_IN_DEADLINE_MS);

    try {
      await signInAsAdmin();
      try {
        if (await verifyAdminAccess()) onUnlocked();
        else setMode("denied");
      } catch (cause: unknown) {
        console.error("[mino admin] verify after sign-in", cause);
        setDetail(describe(cause));
        setError(describe(cause).message);
        setMode("signin");
      }
    } catch (cause: unknown) {
      const code = (cause as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setError("Sign-in was cancelled.");
      } else {
        console.error("[mino admin]", cause);
        setDetail(describe(cause));
        setError(describe(cause).message);
      }
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  }, [onUnlocked]);

  const leave = useCallback(async () => {
    setBusy(true);
    try {
      await signOutAdmin();
      setError(null);
      setDetail(null);
      setMode("signin");
    } catch (cause: unknown) {
      setError(describe(cause).message);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Shown when the account is signed in but the rules refuse it. */
  const showWho = useCallback(async () => {
    const services = await getServices();
    const email = services?.auth.currentUser?.email;
    setDetail({
      code: "not-the-admin",
      message: email
        ? `Signed in as ${email}. Put that address in place of ADMIN_EMAIL in database.rules.json, publish, and try again.`
        : "The database rules do not list this account as the administrator.",
    });
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
        className="relative w-full max-w-sm rounded-t-[28px] border border-white/[0.09] bg-[#141f1a] p-5 shadow-2xl shadow-black/80 animate-rise sm:rounded-[28px]"
      >
        <h2 className="text-[15px] font-semibold text-white">Mino administrator</h2>

        {mode === "checking" && <p className="mt-2 text-[13px] text-white/50">Checking this browser…</p>}

        {mode === "notconfigured" && (
          <p className="mt-2 text-[13px] text-red-200/80">
            The NEXT_PUBLIC_FIREBASE_* values are missing, so Mino has no database to talk to. Add
            them to the deployment and redeploy.
          </p>
        )}

        {mode === "unavailable" && (
          <div className="mt-2 space-y-2 text-[13px] text-white/60">
            <p>Mino could not reach Firebase, so the console cannot be opened.</p>
            {detail && (
              <p className="break-words rounded-lg bg-black/40 px-2 py-2 font-mono text-[11px] leading-relaxed text-white/75">
                {detail.code}
                {detail.message ? ` — ${detail.message}` : ""}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setDetail(null);
                setMode("checking");
                setRetry((count) => count + 1);
              }}
              className="w-full rounded-xl bg-white/[0.08] py-2.5 text-[13px] font-medium text-white transition hover:bg-white/[0.12]"
            >
              Try again
            </button>
          </div>
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
              The administrator is named by email address in database.rules.json.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void showWho()}
                className="flex-1 rounded-xl border border-white/[0.09] py-2 text-[13px] text-white/70 transition hover:bg-white/[0.06]"
              >
                Show my email
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
            {detail && (
              <p className="break-all text-[12px] text-red-200/80">{detail.message}</p>
            )}
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
