"use client";

// ── Asking the visitor to install Mino ──────────────────────────────────────
// A phone browser is a trap: no address bar, no back button, and a tab swiped
// away mid-answer. Installing turns that into an app with its own icon on the
// home screen, which is where the return trip starts from.
//
// The pitch is built around that single pain rather than a list of features.
// A feature list reads as an ad; the loss of the conversation being one swipe
// away is something the visitor has already felt.
//
// ── When it asks ────────────────────────────────────────────────────────────
// Once per visit, after the first message. Waiting for a message is the point:
// asking someone to keep an app they have never used is how a prompt gets
// dismissed without being read. Once per visit — rather than once ever, or once
// a week — because a return trip to a site you already use is exactly when the
// offer is worth making, and because a permanent "no" cannot be revised.
//
// sessionStorage is what makes "once per visit" true. It dies with the tab, so
// a reload or a fresh visit starts over, while surviving the client-side
// navigations in between so it cannot reappear mid-conversation.
//
// It never appears twice for the same reason that matters most: if Mino is
// already installed, there is nothing to offer.
//
// ── Two browsers, no shared API ─────────────────────────────────────────────
//   - Chromium fires `beforeinstallprompt`, and only that event can reach the
//     native confirm sheet.
//   - iOS Safari has no install API at all. The only route is Share → Add to
//     Home Screen, so the dialog teaches it with the real iconography rather
//     than showing a button that cannot work.
//
// Chromium also withholds the event until a service worker *controls* the
// page, and a worker registered during this visit does not control it until the
// next navigation. Where there is no programmatic install to call, the menu
// route is shown instead — a button that fails silently is worse than no
// button, because it teaches people that the whole interface fails silently.

import { useCallback, useEffect, useRef, useState } from "react";
import MinoMark from "@/components/MinoMark";

/**
 * Marks this tab as already asked. Per-visit by design — see the note above.
 * sessionStorage rather than localStorage is the entire mechanism.
 */
const ASKED_KEY = "mino:install-asked";

/**
 * `?installPrompt=1` shows the dialog regardless of width, install state, or
 * whether this tab has already been asked.
 *
 * A prompt that can only be triggered once can only ever be tested once, by
 * whoever happens to try it first. This strips itself from the URL after firing
 * so it cannot turn every reload and shared link into a popup, and does not
 * record an answer, so a rehearsal never becomes a real opt-out.
 */
const FORCE_PARAM = "installPrompt";

/** Shown below this width. An install prompt on a desktop is noise. */
const MOBILE_MAX_WIDTH = 820;

/** How long the dialog takes to rise after the trigger fires. */
const APPEAR_MS = 900;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** iOS Safari exposes neither of these, so both are feature-detected. */
function isIos(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !/crios|fxios/i.test(navigator.userAgent)
  );
}

/**
 * Whether Mino is already running as an installed app.
 *
 * `display-mode: standalone` alone is not enough. A browser tab can match it,
 * and some Android browsers report it for a normal tab, so `installed` is
 * checked too — that one is only ever true for a real install. iOS Safari
 * predates both and still reports `navigator.standalone`.
 */
function isInstalled(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(display-mode: installed)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export default function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  // Whether the browser has actually offered a programmatic install. The
  // dialog opens on engagement alone, which is deliberately not the same
  // thing — so this decides whether the button is real or a fallback.
  const [canPrompt, setCanPrompt] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const install = useCallback(async () => {
    const event = deferred.current;
    // Guarded, because this button is only rendered when `canPrompt` is true.
    // The reference is cleared after one use — a `BeforeInstallPromptEvent` is
    // single-use, and calling `prompt()` twice throws.
    if (!event) return;
    try {
      // The browser only allows one prompt() per user gesture, and the native
      // sheet it opens is the only real install path on this browser.
      await event.prompt();
      await event.userChoice;
      // Accepted or not, the dialog has done its job either way. The tab is
      // already marked as asked, and an install is detected by `isInstalled`
      // on the next visit regardless of what was chosen here.
      setOpen(false);
    } catch {
      // A refused prompt is not an error worth surfacing; the visitor can
      // still install from the browser menu.
      setCanPrompt(false);
    } finally {
      deferred.current = null;
    }
  }, []);

  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get(FORCE_PARAM) === "1";

    // Never ask someone who already has the app. This is checked before
    // anything else, including width, because it is the one condition with no
    // acceptable exception.
    if (!forced && isInstalled()) return;
    if (!forced && window.innerWidth > MOBILE_MAX_WIDTH) return;

    const alreadyAsked = () => {
      if (forced) return false;
      try {
        return sessionStorage.getItem(ASKED_KEY) === "1";
      } catch {
        // sessionStorage blocked. Returning false risks asking twice in one
        // visit, which is far less bad than never asking at all.
        return false;
      }
    };

    if (alreadyAsked()) return;

    // Held until the visitor has actually used Mino.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let asked = false;

    const ask = () => {
      // `mino:engage` fires on every message sent. Arming this more than once
      // would leave a second copy pending, so the dialog could reappear after
      // being dismissed.
      if (asked || alreadyAsked()) return;
      asked = true;
      try {
        sessionStorage.setItem(ASKED_KEY, "1");
      } catch {
        // Nothing to do — it simply asks again next visit.
      }
      // The param was only ever a request to see it; leaving it in the address
      // bar would re-open the dialog on every reload.
      if (forced) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      timer = setTimeout(() => setOpen(true), APPEAR_MS);
    };

    const onBeforeInstall = (event: Event) => {
      // Suppress the browser's own mini-infobar so this dialog is the only
      // thing competing for the tap.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };

    // Once the app is installed there is nothing left to ask, so any dialog
    // currently open goes away without being dismissed.
    const onInstalled = () => {
      setOpen(false);
      try {
        sessionStorage.removeItem(ASKED_KEY);
      } catch {
        // Nothing to do.
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    window.addEventListener("mino:engage", ask);

    // Fired by `ServiceWorker.tsx` once a worker takes control of this page.
    // Chromium may have dispatched `beforeinstallprompt` before this listener
    // was attached, and it fires at most once per navigation — so when the
    // event was withheld until the worker claimed the page, this is the signal
    // that the button should now be real.
    const onSwReady = () => {
      if (deferred.current) setCanPrompt(true);
    };
    window.addEventListener("mino:sw-ready", onSwReady);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("mino:engage", ask);
      window.removeEventListener("mino:sw-ready", onSwReady);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!open) return null;

  // iOS gets instructions instead of a button, because the button cannot work.
  // The same is true on Chromium before a service worker controls the page:
  // there is no programmatic install to call yet, so the menu route is all
  // there is. Either way, a button that would do nothing is the one outcome
  // worth avoiding.
  const ios = isIos();
  const showButton = !ios && canPrompt;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mino-install-title"
      className="fixed inset-0 z-[150] flex items-end justify-center px-3 pb-3"
    >
      <button
        type="button"
        aria-label="Not now"
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      <section className="animate-rise relative w-full max-w-sm overflow-hidden rounded-[28px] border border-white/[0.14] bg-[#111116]/[0.98] pb-2 shadow-2xl shadow-black/80 backdrop-blur-2xl">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-64 -translate-x-1/2 rounded-full bg-[#7567e8]/25 blur-3xl"
        />

        <div className="relative p-5 pb-4">
          <div className="flex items-start gap-4">
            {/* The installed icon, shown at its real size, is the single most
                persuasive element here: it shows what lands on the home screen
                rather than describing it. */}
            <div className="relative shrink-0">
              <div className="absolute inset-[-18%] animate-breathe rounded-[20px] bg-[#7567e8]/25 blur-xl" />
              <MinoMark className="relative h-16 w-16 rounded-[16px]" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9ee7ff]/80">
                Keep Mino
              </p>
              <h2
                id="mino-install-title"
                className="mt-1 text-[19px] font-semibold leading-tight tracking-[-0.02em] text-white"
              >
                {ios ? "Add Mino to your Home Screen" : "Install Mino on this phone"}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">
                {ios
                  ? "Takes about five seconds."
                  : "Opens from your home screen, like any other app."}
              </p>
            </div>
          </div>

          <p className="mt-4 text-[13.5px] leading-relaxed text-white/70">
            A browser tab can be swiped away in one motion, and the conversation
            goes with it. Installed, Mino opens from an icon like any other app
            and your chats stay where you left them.
          </p>

          {ios && (
            <ol className="mt-4 space-y-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
              <li className="flex items-center gap-3 text-[13px] text-white/75">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.07] text-[15px] leading-none">
                  <ShareIcon />
                </span>
                Tap <span className="font-medium text-white">Share</span> in the bottom bar
              </li>
              <li className="flex items-center gap-3 text-[13px] text-white/75">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.07] text-[15px] leading-none">
                  <PlusIcon />
                </span>
                Choose <span className="font-medium text-white">Add to Home Screen</span>
              </li>
            </ol>
          )}

          {!ios && !canPrompt && (
            // No service worker in control yet, so no programmatic install is
            // available. The browser menu still is not, which is why this is a
            // real route and not a consolation prize.
            <ol className="mt-4 space-y-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
              <li className="flex items-center gap-3 text-[13px] text-white/75">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.07] text-[15px] leading-none">
                  <MenuIcon />
                </span>
                Tap the <span className="font-medium text-white">⋮ menu</span> in Chrome
              </li>
              <li className="flex items-center gap-3 text-[13px] text-white/75">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.07] text-[15px] leading-none">
                  <DownloadIcon />
                </span>
                Choose <span className="font-medium text-white">Install app</span>
              </li>
            </ol>
          )}

          <div className="mt-5 flex items-center gap-2.5">
            {showButton && (
              <button
                type="button"
                onClick={install}
                className="lift flex-1 rounded-full px-4 py-3 text-[14px] font-semibold text-[#08080a] transition-opacity hover:opacity-90 active:opacity-70"
                style={{ background: "linear-gradient(180deg, #a9a4ff 0%, #7c7cf4 100%)" }}
              >
                Install Mino
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className={showButton ? "shrink-0 rounded-full border border-white/[0.12] px-5 py-3 text-[14px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white" : "w-full rounded-full px-4 py-3 text-[14px] font-semibold text-[#08080a] transition-opacity hover:opacity-90 active:opacity-70"}
              style={showButton ? undefined : { background: "linear-gradient(180deg, #a9a4ff 0%, #7c7cf4 100%)" }}
            >
              {showButton ? "Not now" : ios ? "Got it" : "Done"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** iOS Share glyph: a box with an arrow leaving the top. */
function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}

/** iOS Add-to-Home-Screen glyph: a plus over a rounded square. */
function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Chrome overflow menu: three stacked dots. */
function MenuIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="12" cy="19" r="1.9" />
    </svg>
  );
}

/** Chrome's "Install app" entry: an arrow into a tray. */
function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}