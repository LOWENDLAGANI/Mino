"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals streamed text at a steady, readable pace instead of snapping to
 * whatever length the last network chunk happened to be.
 *
 * The answer arrives in provider-chosen chunks: some models emit a token at a
 * time, others hand over a whole paragraph at once, and every chunk is written
 * through IndexedDB before it is rendered. That makes the text visibly jump —
 * long pauses, then a wall of words. The real text is never delayed or altered;
 * this only decides how much of it the reader has been shown so far, and it
 * catches up as fast as the backlog allows.
 */
export function useSmoothText(target: string, active: boolean): string {
  const [shown, setShown] = useState(active ? "" : target);
  const stateRef = useRef({ shown: active ? "" : target, frame: 0, target });
  stateRef.current.target = target;

  useEffect(() => {
    const state = stateRef.current;

    // A shorter target means the answer was regenerated or edited, so there is
    // nothing to catch up to — the new text starts from nothing.
    if (target.length < state.shown.length) {
      state.shown = active ? "" : target;
      setShown(state.shown);
    }

    // Once the answer is finished, showing less than the truth would be a lie
    // the reader cannot see the end of, so the remainder is released at once.
    if (!active) {
      if (state.shown !== target) {
        state.shown = target;
        setShown(target);
      }
      return;
    }

    if (state.shown >= target || state.frame) return;

    const step = () => {
      state.frame = 0;
      const full = state.target;
      const current = state.shown;
      if (current.length >= full.length) return;

      const backlog = full.length - current.length;
      // Far behind means a big chunk arrived, so move faster to catch up — but
      // never so fast that the text becomes a blur, and never so slow that the
      // cursor trails the answer that is already on screen.
      const chars = Math.min(Math.max(1, Math.ceil(backlog / 8)), 10);
      let next = Math.min(full.length, current.length + chars);
      // Never end between the halves of an emoji or another astral character.
      const code = full.charCodeAt(next);
      if (next < full.length && code >= 0xdc00 && code <= 0xdfff) next += 1;

      state.shown = full.slice(0, next);
      setShown(state.shown);
      if (state.shown.length < state.target.length) {
        state.frame = requestAnimationFrame(step);
      }
    };

    state.frame = requestAnimationFrame(step);
    return () => {
      if (state.frame) {
        cancelAnimationFrame(state.frame);
        state.frame = 0;
      }
    };
  }, [target, active]);

  return shown;
}

export default useSmoothText;