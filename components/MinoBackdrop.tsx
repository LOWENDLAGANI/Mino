"use client";

// The terminal field behind every page, tuned once.
//
// It is a wrapper rather than a raw FaultyTerminal because the settings below are
// a considered choice, not defaults: they are the difference between an effect
// that reads as atmosphere and one that competes with reading. Keeping them in
// one component also means there is exactly one place to answer "why is it this
// dim" and "why is it running at thirty frames".
//
// Cost is the reason each value is what it is. The fragment shader evaluates
// `digit` nine times per pixel — once for the glyph, then an eight-tap sum for
// the bleed — and each of those runs a three-octave fBm. On a 1080p screen that
// is millions of nine-fBm evaluations every frame, so the backing store is
// capped below the device's own pixel ratio and frames are capped at thirty.
// A CRT that never quite settles is not more convincing for being smooth.

import FaultyTerminal from "@/components/FaultyTerminal";

export default function MinoBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 select-none opacity-[0.5]"
      aria-hidden
    >
      <FaultyTerminal
        scale={1.6}
        gridMul={[3, 2]}
        digitSize={1.15}
        timeScale={0.22}
        scanlineIntensity={0.45}
        glitchAmount={0.55}
        flickerAmount={0.4}
        noiseAmp={0.8}
        chromaticAberration={0}
        curvature={0.12}
        // Mino's own accent, so the field belongs to the product rather than
        // sitting on top of it as a separate brand.
        tint="#7c7cf4"
        // Off: a backdrop that chases the cursor fights the thing being read,
        // and on the chat page the cursor is always moving.
        mouseReact={false}
        pageLoadAnimation
        brightness={0.9}
        dpr={1.25}
        fps={30}
      />
    </div>
  );
}
