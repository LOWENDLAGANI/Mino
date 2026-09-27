import { authHeader } from "./firebaseHistory";
import type { VerificationResult } from "./types";

// ── Mino — talking to the project's own checks ───────────────────────────────

export type CheckId = "typecheck" | "lint" | "test" | "build";

export interface VerifyResponse extends VerificationResult {
  exitCode?: number | null;
  durationMs?: number;
}

let availableCache: CheckId[] | null = null;

/** Which checks this repository defines. Cached for the life of the page. */
export async function availableChecks(): Promise<CheckId[]> {
  if (availableCache) return availableCache;
  try {
    const response = await fetch("/api/verify");
    if (!response.ok) return [];
    const data = (await response.json()) as { available?: CheckId[] };
    availableCache = Array.isArray(data.available) ? data.available : [];
  } catch {
    availableCache = [];
  }
  return availableCache;
}

export async function runCheck(check: CheckId, signal?: AbortSignal): Promise<VerifyResponse> {
  const response = await fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ check }),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      check,
      passed: false,
      at: Date.now(),
      output: payload?.error ?? `The check could not run (HTTP ${response.status}).`,
    };
  }

  return (await response.json()) as VerifyResponse;
}
