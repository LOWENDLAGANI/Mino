"use client";

import { useCallback, useRef } from "react";

const REQUIRED_TAPS = 10;
/** Past this many taps the sequence is clearly deliberate, not a mis-tap. */
const ARM_AFTER_TAPS = 3;
const WINDOW_MS = 2500;

export interface TapResult {
  /** True once ten taps have landed — the caller should open the admin prompt. */
  unlocked: boolean;
  /** True when the tap is part of a deliberate sequence and the normal action must be skipped. */
  suppressAction: boolean;
  /** How many taps are currently counted in the rolling window. */
  count: number;
}

/**
 * Counts rapid taps on a brand mark and fires once ten land in a row.
 *
 * The result is returned synchronously rather than through state so the host
 * can decide about the same tap. Without that, tapping the sidebar logo would
 * start a new chat and close the drawer on the first tap, and the remaining
 * nine would never land.
 */
export function useAdminTaps(onUnlock: () => void) {
  const tapsRef = useRef<number[]>([]);

  const registerTap = useCallback((): TapResult => {
    const now = Date.now();
    const recent = tapsRef.current.filter((time) => now - time < WINDOW_MS);
    recent.push(now);
    tapsRef.current = recent;

    if (recent.length >= REQUIRED_TAPS) {
      tapsRef.current = [];
      onUnlock();
      return { unlocked: true, suppressAction: true, count: recent.length };
    }

    return {
      unlocked: false,
      suppressAction: recent.length >= ARM_AFTER_TAPS,
      count: recent.length,
    };
  }, [onUnlock]);

  const reset = useCallback(() => {
    tapsRef.current = [];
  }, []);

  return { registerTap, reset, requiredTaps: REQUIRED_TAPS };
}
