import { fetchAdminPinHash, firebaseConfigured, setAdminPinHash } from "./firebaseHistory";

// ── Admin gate ───────────────────────────────────────────────────────────────
// Unlocked by clicking a Mino logo ten times, then entering a PIN. The PIN's
// SHA-256 digest lives in Realtime Database at `admin/pinHash`; the PIN itself
// is never stored or transmitted.
//
// The node is created on first use. The database rule allows exactly one
// write — creating a missing node — and refuses every later write, so the
// digest cannot be changed or read back as plaintext by the client.
//
// This is a convenience gate, not real security: anyone can create an anonymous
// Firebase session and read the digest, and the first person to reach the setup
// screen becomes the administrator. Do not put destructive or privileged
// actions behind it.

const MAX_ATTEMPTS = 5;
const LOCKOUT_AFTER = 5;
const ATTEMPT_WINDOW_MS = 60_000;

let attempts = 0;
let lockedUntil = 0;

export function isLockedOut(): boolean {
  return Date.now() < lockedUntil;
}

export function attemptsRemaining(): number {
  return Math.max(0, MAX_ATTEMPTS - attempts);
}

/** Generates the lowercase SHA-256 hex digest stored in the database. */
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

/** Turns a Firebase SDK error into a specific reason the UI can explain. */
function classifyError(error: unknown): AdminErrorReason {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "PERMISSION_DENIED") return "rules-not-published";
  if (code === "network-error" || code === "network-request-failed") return "offline";
  return "unknown";
}

export type AdminErrorReason =
  | "not-configured"
  | "rules-not-published"
  | "offline"
  | "locked"
  | "mismatch"
  | "already-set"
  | "too-short"
  | "unknown";

export type AdminResult = { ok: true } | { ok: false; reason: AdminErrorReason; remaining?: number };

export const ADMIN_ERROR_COPY: Record<AdminErrorReason, string> = {
  "not-configured": "No admin PIN has been set up yet. Choose one below to create it.",
  "rules-not-published": "Firebase denied this. Publish the latest database.rules.json in the Firebase console, then try again.",
  offline: "Could not reach Firebase. Check your internet connection and try again.",
  locked: "Too many wrong attempts. Wait a minute and try again.",
  mismatch: "That PIN is not correct.",
  "already-set": "An admin PIN already exists. The database only allows it to be created once — delete admin/pinHash in Firebase to start over.",
  "too-short": "Use a PIN of at least 4 characters.",
  unknown: "Something went wrong talking to Firebase. Check the browser console for details.",
};

/** True when the database has no digest yet and the setup form should show. */
export async function needsSetup(): Promise<{ needsSetup: boolean; reason?: AdminErrorReason }> {
  if (!firebaseConfigured) return { needsSetup: true, reason: "not-configured" };
  try {
    const hash = await fetchAdminPinHash();
    return { needsSetup: hash === null };
  } catch (error) {
    return { needsSetup: true, reason: classifyError(error) };
  }
}

/**
 * Creates the admin PIN on first use.
 *
 * The database rule permits this exactly once; a second attempt is rejected by
 * Firebase rather than silently overwriting the existing digest.
 */
export async function createAdminPin(pin: string, confirmPin: string): Promise<AdminResult> {
  if (!firebaseConfigured) return { ok: false, reason: "not-configured" };
  if (pin !== confirmPin) return { ok: false, reason: "mismatch" };
  if (pin.trim().length < 4) return { ok: false, reason: "too-short" };

  const digest = await hashPin(pin.trim());
  try {
    await setAdminPinHash(digest);
  } catch (error) {
    // The rule rejects any write to an existing node.
    if ((error as { code?: string } | null)?.code === "PERMISSION_DENIED") {
      return { ok: false, reason: "already-set" };
    }
    return { ok: false, reason: classifyError(error) };
  }

  resetAttempts();
  return { ok: true };
}

/** Checks an entered PIN against the digest in the database. */
export async function verifyPin(pin: string): Promise<AdminResult> {
  if (!firebaseConfigured) return { ok: false, reason: "not-configured" };
  if (isLockedOut()) return { ok: false, reason: "locked" };

  const normalized = pin.trim();
  if (normalized.length < 4) return { ok: false, reason: "too-short" };

  let expected: string | null;
  try {
    expected = await fetchAdminPinHash();
  } catch (error) {
    return { ok: false, reason: classifyError(error) };
  }

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
