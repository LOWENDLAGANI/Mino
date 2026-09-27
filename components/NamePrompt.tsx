"use client";

import { useEffect, useState } from "react";

interface NamePromptProps {
  open: boolean;
  onSave: (name: string) => void;
  /**
   * Runs the Google sign-in. It resolves the name to use — the account's own, or
   * Google's — and reports it back through `onSave`. Resolving to nothing means
   * the sign-in succeeded but offered no name to go on, which is shown as a
   * message rather than a failure.
   */
  onGoogle: () => Promise<void>;
  /**
   * False when the deployment has no account service. The door is then hidden
   * rather than shown and broken, because a button that cannot work is worse
   * than an absence nobody misses.
   */
  googleAvailable?: boolean;
  googleBusy?: boolean;
  googleError?: string | null;
}

/**
 * Entry gate: Mino cannot be used until a name is given.
 *
 * There is deliberately no skip, no backdrop dismissal and no Escape handler —
 * the name is what the admin console lists visitors by, so it is required.
 *
 * Typing a name is the primary way in and always has been, so someone who has
 * been using Mino under a name is never asked to make an account. Google is a
 * second door rather than a replacement: it fills the same field, and someone who
 * arrives without a name can still type one afterwards.
 */
export default function NamePrompt({
  open,
  onSave,
  onGoogle,
  googleAvailable = true,
  googleBusy = false,
  googleError = null,
}: NamePromptProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-5">
      <div
        className="absolute inset-0 bg-black/80"
        style={{ backdropFilter: "blur(8px)" }}
        aria-hidden
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Mino"
        className="relative w-full max-w-sm rounded-[26px] border border-white/[0.09] bg-[#131316] p-6 shadow-2xl shadow-black/80 animate-rise"
      >
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white">Welcome to Mino</h2>

        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            className="w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/25 focus:border-[#8b7cf6]/60"
          />
          <button
            type="submit"
            disabled={name.trim() === ""}
            className="mt-4 w-full rounded-[12px] bg-white px-3 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Enter Mino
          </button>
        </form>

        {googleAvailable && (
          <>
            <div className="my-4 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/25">or</span>
              <span className="h-px flex-1 bg-white/[0.08]" />
            </div>

            <button
              type="button"
              onClick={() => void onGoogle()}
              disabled={googleBusy}
              className="flex w-full items-center justify-center gap-2.5 rounded-[12px] border border-white/[0.09] bg-white/[0.04] py-2.5 text-[12px] font-semibold text-white transition hover:bg-white/[0.07] disabled:opacity-50"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1a6.2 6.2 0 0 1 0-12.4c1.76 0 2.94.75 3.62 1.4l2.57-2.47A9.9 9.9 0 0 0 12 2.5a9.5 9.5 0 1 0 0 19c5.5 0 9.13-3.86 9.13-9.3 0-.62-.07-1.1-.15-1.6z"
                />
              </svg>
              {googleBusy ? "Opening Google…" : "Continue with Google"}
            </button>

            <p className="mt-3 text-center text-[10px] leading-relaxed text-white/30">
              An account carries your chats to another browser. You can use Mino without one, and
              link one later in Settings.
            </p>
          </>
        )}

        {googleError && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-red-200/80">{googleError}</p>
        )}
      </section>
    </div>
  );
}
