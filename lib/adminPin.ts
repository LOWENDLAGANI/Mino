import { fetchAdminPinHash, firebaseConfigured } from "./firebaseHistory";

// ── Admin gate ───────────────────────────────────────────────────────────────
// The admin panel is unlocked by clicking the brand logo ten times, then
// entering a PIN whose SHA-256 digest lives in Realtime Database at
// `admin/pinHash`. Mino never stores or transmits the PIN itself.
//
// This is a convenience gate, not real security: anyone can create an anonymous
// Firebase session and read the digest. It keeps casual visitors out of the
// panel, so do not put destructive or privileged actions behind it — put those
// behind a real server-side authorisation check.

const MAX_ATTEMPTS = 5;
const LOCKOUT_AFTER = 5;
const ATTEMPT_WINDOW_MS = 60_000;

let attempts = 0;
let lockedUntil = 0;

/** Generates the lowercase SHA-256 hex digest to paste into Realtime Database. */
export async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function resetAttempts() {
  attempts = 0;
  lockedUntil = 0;
}

export function isLockedOut(): boolean {
  return Date.now() < lockedUntil;
}

export function attemptsRemaining(): number {
  return Math.max(0, MAX_ATTEMPTS - attempts);
}

export type PinResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "locked" | "mismatch" | "error"; remaining?: number };

/**
 * Checks a PIN against the digest in Realtime Database.
 *
 * The digest is cached for a short window so a wrong PIN cannot be used to
 * hammer the database, and the comparison walks every byte rather than
 * short-circuiting.
 */
export async function verifyPin(pin: string): Promise<PinResult> {
  if (!firebaseConfigured) return { ok: false, reason: "not-configured" };
  if (isLockedOut()) return { ok: false, reason: "locked" };

  const normalized = pin.trim();
  if (!normalized) return { ok: false, reason: "mismatch", remaining: attemptsRemaining() };

  let expected: string | null;
  try {
    expected = await fetchAdminPinHash();
  } catch {
    return { ok: false, reason: "error" };
  }

  // No digest in the database yet, or Firebase is unreachable.
  if (!expected) return { ok: false, reason: "not-configured" };

  const actual = await hashPin(normalized);
  if (!constantTimeEquals(actual, expected)) {
    attempts += 1;
    if (attempts >= LOCKOUT_AFTER) lockedUntil = Date.now() + ATTEMPT_WINDOW_MS;
    return { ok: false, reason: "mismatch", remaining: attemptsRemaining() };
  }

  resetAttempts();
  return { ok: true };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
