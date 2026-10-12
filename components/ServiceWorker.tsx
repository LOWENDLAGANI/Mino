"use client";

// ── Service worker registration ─────────────────────────────────────────────
// Installing Mino as an app requires a service worker alongside the manifest.
// Chromium refuses to fire `beforeinstallprompt` without one, so the install
// prompt in `InstallPrompt.tsx` is inert until this runs.
//
// The worker calls `clients.claim()` on activate, which is load-bearing rather
// than tidy. A worker registered during a visit does not control that visit's
// page, and Chromium will not offer installation until one does — so without
// the claim, the first visitor after every deploy is someone we invite to
// install but cannot actually install.
//
// Registration is skipped in development. A cached worker would serve stale
// modules to a dev server that is actively recompiling, which looks exactly
// like a broken change and costs far more time than it saves.
//
// This is deliberately not the place to put cache logic: the worker's own
// comments explain why it stays out of the application code's way.

import { useEffect } from "react";

export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    // A worker that is merely *registered* does not control the current page —
    // that only happens on the next navigation. Chromium withholds
    // `beforeinstallprompt` until a worker is in control, so without this the
    // first visit after a deploy could never offer a real install prompt.
    // `clients.claim()` inside the worker is what actually closes that gap;
    // calling `controllerchange` here is only the signal to re-check.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          if (cancelled) return;
          if (!navigator.serviceWorker.controller) {
            // The worker claimed this page a moment ago. Re-asking the browser
            // is what surfaces the install prompt that was withheld until now.
            navigator.serviceWorker.addEventListener("controllerchange", () => {
              window.dispatchEvent(new Event("mino:sw-ready"));
            });
          }
        })
        .catch((error: unknown) => {
          // A failed registration costs the install prompt, nothing else. The
          // app is fully usable in a browser tab without it.
          console.error("[Mino] Service worker registration failed", error);
        });
    };

    // Registering after load keeps the worker off the critical path, so it can
    // never delay the first paint of the chat.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}