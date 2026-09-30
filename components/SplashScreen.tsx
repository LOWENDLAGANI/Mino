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
// ── Two images, because a phone is not a small laptop ───────────────────────
// The splash fills the screen edge to edge, so the crop is driven entirely by
// the screen's shape. A 16:9 desktop image shown on a tall phone has to be
// cropped to roughly the middle third to cover it, and whatever is at the
// sides is simply gone — the branding is the first thing a visitor sees, so
// losing most of it is not acceptable. `object-position` can shift the crop
// but cannot invent the missing pixels.
//
// So the artwork is supplied twice: a portrait composition for narrow screens
// and the landscape one for everything wider. The swap is a `<source>` inside a
// `<picture>`, which the browser resolves from the media query before any of
// this paints — no measuring, no resize listener, no second render. Both files
// are asked for independently, so neither is downloaded unless it is chosen.

import { useEffect, useState } from "react";

/** Landscape artwork, used from 768px up. */
const DESKTOP_IMAGE = "/mino-splash.jpg";

/** Portrait artwork, used below 768px. Falls back to the desktop one. */
const MOBILE_IMAGE = "/mino-splash-mobile.jpg";

/** Shown if neither artwork is found, so a wrong filename never shows a gap. */
const FALLBACK_IMAGE = "/mino-logo.png";

/** Where the `<picture>` element stops offering the portrait source. */
const WIDE_QUERY = "(min-width: 768px)";

const SESSION_KEY = "mino:splash-seen";
const HOLD_MS = 1600; // image sits crisp while the app loads behind it
const FADE_MS = 1100; // blur + fade out

type Phase = "pending" | "hold" | "fade" | "gone";

/**
 * Which artwork to try next when one fails to load.
 *
 * A `<picture>` reports a failed `<source>` through the `<img>`'s error event,
 * but the event does not say which URL was attempted, so the fallback is a
 * fixed ladder rather than a comparison: the portrait source is simply dropped
 * from the markup, the browser re-resolves the media query against the desktop
 * file, and only after that does the logo come into play.
 */
function nextStage(stage: number): number {
  return Math.min(stage + 1, 2);
}

export default function SplashScreen() {
  const [stage, setStage] = useState(0);
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
      {stage === 0 ? (
        // The portrait file is the `<img>` default, so it is what a narrow
        // screen gets; the `<source>` above it overrides that on wide screens
        // before anything paints.
        <picture>
          <source media={WIDE_QUERY} srcSet={DESKTOP_IMAGE} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={MOBILE_IMAGE}
            onError={() => setStage(nextStage)}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </picture>
      ) : stage === 1 ? (
        // Portrait artwork absent: use the landscape one, cropped as before.
        // This is the state a deployment without the second file is always in,
        // so it must look correct rather than merely not be blank.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={DESKTOP_IMAGE}
          onError={() => setStage(nextStage)}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        // Neither artwork present. A logo beats an empty black screen.
        <div className="flex h-full w-full items-center justify-center p-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={FALLBACK_IMAGE}
            onError={() => setStage(nextStage)}
            alt=""
            className="h-full w-full object-contain"
            draggable={false}
          />
        </div>
      )}

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
