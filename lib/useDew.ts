"use client";

import { useCallback, useSyncExternalStore } from "react";
import { authHeader } from "./firebaseHistory";
import { LOW_BALANCE_THRESHOLD, roundDew } from "./dew";

// ── The balance, as the interface sees it ────────────────────────────────────
//
// One answer to "how much Dew do I have", held once for the whole app. It
// reads `/api/dew` — the authoritative derivation the enforcement modules use —
// rather than the raw database node, so the number on screen and the number the
// server bills against are computed by the same code. Display only: a caller
// that faked the hook gains nothing, because every decision is made in the
// routes.
//
// It used to be one `useState` per component, which meant every consumer held
// its own copy: the sidebar chip, the top-up page and the redeem box each had a
// balance, and refreshing one of them left the others showing the number the
// account no longer had. A charge made by a message would then sit unseen until
// somebody happened to reload. So the state lives at module level, subscribers
// are notified together, and `refresh` re-reads for all of them at once —
// including from outside React, after a message finishes or a code lands.

export interface DewSnapshot {
  /** False until the first answer arrives, so nothing flashes first. */
  ready: boolean;
  /** Current balance in Dew, derived credits − spent. */
  balance: number;
  /** True under LOW_BALANCE_THRESHOLD, for the amber chip. */
  low: boolean;
  /** True when the caller has a verified identity. False when signed out,
   *  unidentified, or the deployment has no Firebase — the balance is then
   *  unknown rather than zero, and the chip must not claim otherwise. */
  signedIn: boolean;
}

const UNKNOWN: DewSnapshot = { ready: false, balance: 0, low: false, signedIn: false };

let snapshot: DewSnapshot = UNKNOWN;
const listeners = new Set<() => void>();
/** One read in flight at a time; a second ask waits for it rather than racing. */
let inFlight: Promise<void> | null = null;
/** When the last answer arrived, so a mount does not re-read a number from
 *  moments ago — or fire a burst of reads at a rate-limited endpoint. */
let lastLoadedAt = 0;
const STALE_AFTER_MS = 5_000;

function publish(next: DewSnapshot): void {
  snapshot = next;
  lastLoadedAt = Date.now();
  for (const listener of listeners) listener();
}

/** Signed out, unreachable, or unconfigured: no identity, no balance. */
function publishUnknown(): void {
  publish({ ready: true, balance: 0, low: false, signedIn: false });
}

async function load(): Promise<void> {
  try {
    const headers = await authHeader();
    if (!headers.Authorization) {
      // Signed out or Firebase not configured: no identity, no balance.
      // The chip must not claim a zero the caller never had.
      publishUnknown();
      return;
    }
    const response = await fetch("/api/dew", { headers, cache: "no-store" });
    if (!response.ok) {
      // Offline, or rules not republished: show nothing
      // rather than a number that is not theirs.
      publishUnknown();
      return;
    }
    const data = (await response.json()) as { balance?: number; low?: boolean };
    const value = typeof data.balance === "number" && Number.isFinite(data.balance) ? roundDew(data.balance) : 0;
    publish({
      ready: true,
      balance: value,
      low: typeof data.low === "boolean" ? data.low : value < LOW_BALANCE_THRESHOLD,
      signedIn: true,
    });
  } catch {
    publishUnknown();
  }
}

/**
 * Re-reads the balance for every consumer at once.
 *
 * Safe to call from anywhere — a route handler's caller, an event handler, a
 * component — and always worth calling after anything that spends or adds Dew:
 * a finished message, a redeemed code, a completed image.
 */
export function refreshDew(): Promise<void> {
  if (inFlight) return inFlight.then(() => refreshDew());
  const run = load().finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

export interface UseDew {
  /** False until the first answer arrives, so nothing flashes first. */
  ready: boolean;
  /** Current balance in Dew, derived credits − spent. */
  balance: number;
  /** True under LOW_BALANCE_THRESHOLD, for the amber chip. */
  low: boolean;
  /** True when the caller has a verified identity. False when signed out. */
  signedIn: boolean;
  /** Re-reads from the server; call after a redeem or a top-up. */
  refresh: () => Promise<void>;
}

export function useDew(): UseDew {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    // Every mount starts from a number that is current: a chip that survives a
    // sign-in change, or a page opened minutes after the last charge, must not
    // show what was true when it was last asked. A mount within a few seconds
    // of the last answer, or while one is already in flight, is content with
    // that answer — several consumers arrive together and the endpoint they
    // are asking is rate-limited.
    if (!inFlight && Date.now() - lastLoadedAt > STALE_AFTER_MS) void refreshDew();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => snapshot, []);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(() => refreshDew(), []);

  return {
    ready: state.ready,
    balance: state.balance,
    low: state.low,
    signedIn: state.signedIn,
    refresh,
  };
}
