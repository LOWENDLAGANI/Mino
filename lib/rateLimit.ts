// ── Rate-limit countdown ─────────────────────────────────────────────────────
// The server already refuses politely and says how long to wait. The client's
// job is to turn that sentence into a countdown the composer can show, so the
// refusal reads as a queue position rather than as a failure.

/** Pulls the wait out of a server message like "Please wait 12s and try again." */
export function parseRetrySeconds(message: string): number | null {
  const match = /wait\s+(\d+)\s*s\b/i.exec(message);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // A server that somehow says an hour is clamped to something a person will
  // actually sit through reading; beyond that the message says it all anyway.
  return Math.min(seconds, 600);
}

/** Whole seconds left on a countdown, never negative. */
export function secondsRemaining(until: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
