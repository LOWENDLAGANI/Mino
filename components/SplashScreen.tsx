"use client";

// ── The opening splash ─────────────────────────────────────────────────────
// Shown on top of the fully-rendered home page: the app mounts and loads in
// the background while this image sits over it, then blurs and dissolves away
// to reveal the ready app. Nothing about the app is blocked by this.
//
// It plays once per browser session, on a fresh visit to `/` only. Returning
// to the page, reloading, or opening `/about` skips it — sessionStorage is the
// marker, so closing the tab gives the next visit its splash back.
//
// Drop your image in `public/` and point SPLASH_IMAGE at it. If the file is
// missing the browser fires `onError` and we fall back to the brand logo, so a
// wrong filename degrades instead of showing a broken image.

import { useEffect, useState } from "react";

const SPLASH_IMAGE = "/mino-splash.jpg";
const FALLBACK_IMAGE = "/mino-logo.png";

const SESSION_KEY = "mino:splash-seen";
const HOLD_MS = 1600; // image sits crisp while the app loads behind it
const FADE_MS = 1100; // blur + fade out

type Phase = "pending" | "hold" | "fade" | "gone";

export default function SplashScreen() {
  const [src, setSrc] = useState(SPLASH_IMAGE);
  const [phase, setPhase] = useState<Phase>("pending");

  useEffect(() => {
    // Decided in an effect rather than during render: the server has no
    // sessionStorage, and reading it on first paint would show a splash to
    // someone who has already seen one this session.
    let seen = false;
    try {
      seen = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      // Storage blocked (private mode, strict settings). Fall through to
      // showing the splash rather than skipping branding entirely.
    }
    if (seen) {
      setPhase("gone");
      return;
    }
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Nothing to do — the splash simply plays again next visit.
    }
    setPhase("hold");
  }, []);

  useEffect(() => {
    if (phase !== "hold") return;
    const hold = setTimeout(() => setPhase("fade"), HOLD_MS);
    return () => clearTimeout(hold);
  }, [phase]);

  useEffect(() => {
    if (phase !== "fade") return;
    const done = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(done);
  }, [phase]);

  if (phase !== "hold" && phase !== "fade") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[200] bg-[#030304]"
      style={{
        opacity: phase === "fade" ? 0 : 1,
        filter: phase === "fade" ? "blur(18px)" : "blur(0px)",
        transform: phase === "fade" ? "scale(1.06)" : "scale(1)",
        transition: `opacity ${FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1), filter ${FADE_MS}ms ease-out, transform ${FADE_MS}ms ease-out`,
        pointerEvents: phase === "fade" ? "none" : "auto",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        onError={() => {
          if (src !== FALLBACK_IMAGE) setSrc(FALLBACK_IMAGE);
        }}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 50%, transparent 40%, rgba(3,3,4,0.65) 100%)",
        }}
      />
    </div>
  );
}
