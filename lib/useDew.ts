"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeader } from "./firebaseHistory";
import { LOW_BALANCE_THRESHOLD, roundDew } from "./dew";

// ── The balance, as the interface sees it ────────────────────────────────────
//
// One hook answers "how much Dew do I have". It reads `/api/dew` — the
// authoritative derivation the enforcement modules use — rather than the raw
// database node, so the number on screen and the number the server bills
// against are computed by the same code. Display only: a caller that faked
// the hook gains nothing, because every decision is made in the routes.

export interface UseDew {
  /** False until the first answer arrives, so nothing flashes first. */
  ready: boolean;
  /** Current balance in Dew, derived credits − spent. */
  balance: number;
  /** True under LOW_BALANCE_THRESHOLD, for the amber chip. */
  low: boolean;
  /** Re-reads from the server; call after a redeem or a top-up. */
  refresh: () => Promise<void>;
}

export function useDew(): UseDew {
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(0);
  const [low, setLow] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authHeader();
        const response = await fetch("/api/dew", {
          headers,
          cache: "no-store",
        });
        if (cancelled) return;
        if (!response.ok) {
          // Signed-out, offline, or rules not republished: show nothing
          // rather than a number that is not theirs.
          setBalance(0);
          setLow(true);
          setReady(true);
          return;
        }
        const data = (await response.json()) as { balance?: number; low?: boolean };
        const value = typeof data.balance === "number" && Number.isFinite(data.balance) ? roundDew(data.balance) : 0;
        setBalance(value);
        setLow(typeof data.low === "boolean" ? data.low : value < LOW_BALANCE_THRESHOLD);
        setReady(true);
      } catch {
        if (!cancelled) {
          setBalance(0);
          setLow(true);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ready, balance, low, refresh };
}
