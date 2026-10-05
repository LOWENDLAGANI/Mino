"use client";

import { useCallback, useEffect, useState } from "react";
import {
  bindGoogleAccount,
  detachGoogleAccount,
  watchAccount,
} from "@/lib/account";
import {
  accountExplanation,
  accountHeadline,
  describeLinkError,
  isDismissed,
  type AccountView,
} from "@/lib/accountState";
import { loadChatsFromAccount, syncFirebaseHistory } from "@/lib/firebaseHistory";

interface AccountSectionProps {
  displayName: string;
}

/**
 * The account row in Settings: what this browser is signed in as, and the button
 * that changes it.
 *
 * This is the whole of the visitor's sign-in. It is kept away from the
 * administrator's prompt on purpose — that one is reached by tapping the logo ten
 * times, and the two share nothing but the Firebase project. Signing in here
 * grants a token; only `database.rules.json` decides what a token is worth, and
 * it grants one named address and no others.
 *
 * Binding is offered, never required. Someone who never links an account still
 * has a name, a working Mino, and a chat history in their browser.
 */
export default function AccountSection({ displayName }: AccountSectionProps) {
  const [view, setView] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => watchAccount(setView), []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);

  /**
   * Brings the account's chats in, then writes this device's own back out.
   *
   * The order matters and is the whole point. Pulling first means a computer
   * that signs in to an account holding a phone's history adopts it instead of
   * uploading an empty library over the top of it; pushing afterwards means this
   * device's chats exist on the account too. Doing it here rather than inside
   * the bind keeps `lib/account.ts` free of chat logic and means a failed sync
   * never blocks the sign-in itself.
   */
  const resync = useCallback(async () => {
    try {
      const adopted = await loadChatsFromAccount();
      await syncFirebaseHistory();
      if (adopted && adopted.chats > 0) {
        setNotice(
          `Pulled ${adopted.chats} chat${adopted.chats === 1 ? "" : "s"} from your account.`
        );
      }
    } catch (cause: unknown) {
      console.error("[Mino] Could not sync this device's chats with the account", cause);
    }
  }, []);

  const bind = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bindGoogleAccount(displayName);
      if (result.outcome === "dismissed") return;
      if (result.outcome === "adopted") {
        await resync();
      } else {
        await resync();
        setNotice("Linked. Your chats and your name now follow this Google account.");
      }
    } catch (cause: unknown) {
      if (isDismissed(cause)) return;
      console.error("[Mino] Could not link the account", cause);
      setError(describeLinkError(cause));
    } finally {
      setBusy(false);
    }
  }, [displayName, resync]);

  const detach = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await detachGoogleAccount();
      setNotice("This device is back to a name on its own. Your account is untouched.");
    } catch (cause: unknown) {
      console.error("[Mino] Could not detach the account", cause);
      setError(describeLinkError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!view || view.status === "unconfigured" || view.status === "unreachable") return null;

  const linked = view.isLinked;

  return (
    <section>
      <h3 className="mb-2.5 text-[13px] font-semibold text-white">Account</h3>

      <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/60"
          >
            {linked ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
              </svg>
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white/90">
              {accountHeadline(view, displayName)}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/40">
              {accountExplanation(view)}
            </p>
          </div>
        </div>

        {!linked && (
          <button
            type="button"
            onClick={bind}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.08] py-2.5 text-[13px] font-medium text-white transition hover:bg-white/[0.12] disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1a6.2 6.2 0 0 1 0-12.4c1.76 0 2.94.75 3.62 1.4l2.57-2.47A9.9 9.9 0 0 0 12 2.5a9.5 9.5 0 1 0 0 19c5.5 0 9.13-3.86 9.13-9.3 0-.62-.07-1.1-.15-1.6z"
              />
            </svg>
            {busy ? "Opening Google…" : "Link a Google account"}
          </button>
        )}

        {linked && (
          <button
            type="button"
            onClick={detach}
            disabled={busy}
            className="mt-3 w-full rounded-xl border border-white/[0.09] py-2.5 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.06] disabled:opacity-50"
          >
            {busy ? "Working…" : "Use this device without an account"}
          </button>
        )}

        {error && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-red-200/80">{error}</p>
        )}
        {notice && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-[#a9d8bb]/70">{notice}</p>
        )}
      </div>
    </section>
  );
}
