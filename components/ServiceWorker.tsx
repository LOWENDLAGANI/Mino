"use client";

// ── Service worker registration ─────────────────────────────────────────────
// Installing Mino as an app requires a service worker alongside the manifest.
// Chromium refuses to fire `beforeinstallprompt` without one, so the install
// prompt in `InstallPrompt.tsx` is inert until this runs.
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

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
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
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}