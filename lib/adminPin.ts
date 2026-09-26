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
//
// Every failure is mapped to a specific reason with plain instructions, and the
// raw Firebase error code is returned with it. The panel is mostly opened on a
// phone, where there is no developer console to read, so the diagnosis has to
// happen on screen.

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

export type AdminErrorReason =
  | "firebase-not-configured"
  | "rules-not-published"
  | "bad-credentials"
  | "anonymous-auth-disabled"
  | "offline"
  | "locked"
  | "mismatch"
  | "already-set"
  | "no-pin-yet"
  | "too-short"
  | "unknown";

export interface AdminFailure {
  reason: AdminErrorReason;
  /** The raw Firebase error code, shown on screen so it can be reported. */
  detail?: string;
}

export type AdminResult = ({ ok: true } | ({ ok: false } & AdminFailure)) & { remaining?: number };

export const ADMIN_ERROR_COPY: Record<AdminErrorReason, string> = {
  "firebase-not-configured":
    "Firebase is not set up on this deployment. In Vercel → Settings → Environment Variables add NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_DATABASE_URL, NEXT_PUBLIC_FIREBASE_PROJECT_ID and NEXT_PUBLIC_FIREBASE_APP_ID, then redeploy.",
  "rules-not-published":
    "Firebase refused this request, which almost always means the database rules are still the old ones. Open Realtime Database → Rules in the Firebase console, paste database.rules.json from the repository, and press Publish.",
  "bad-credentials":
    "Firebase rejected the values in this deployment, and the API key is the usual culprit. In the Firebase console open Project settings → General → Your apps → SDK setup and configuration and copy the current API key and project ID. Paste them into Vercel as NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID, then redeploy. Check the database URL too: it must be https://<project-id>.default…firebasedatabase.app with no trailing slash. A key copied with a stray space or a truncated paste fails exactly this way.",
  "anonymous-auth-disabled":
    "Anonymous sign-in is switched off. In the Firebase console open Authentication → Sign-in method and enable Anonymous, then try again.",
  offline: "This device cannot reach Firebase. Check your internet connection, then tap Retry.",
  locked: "Too many wrong attempts. Wait one minute, then try again.",
  mismatch: "That PIN is not correct.",
  "already-set":
    "An admin PIN already exists, and the database only allows it to be created once. To start over, delete the admin/pinHash node in the Firebase console and reopen this prompt.",
  "no-pin-yet": "No admin PIN has been created yet.",
  "too-short": "Use a PIN of at least 4 characters.",
  unknown: "Mino could not talk to Firebase. The error code below explains what the service returned.",
};

/**
 * Turns a Firebase SDK error into a specific, actionable reason.
 *
 * The Firebase modular SDK puts a slash-delimited code on `error.code`; those
 * are the only useful signal here, so they are matched explicitly rather than
 * collapsing everything into a generic failure.
 */
function classifyError(error: unknown): AdminFailure {
  const code = (error as { code?: string } | null)?.code ?? "";
  const detail = code || (error instanceof Error ? error.name : undefined);

  if (code === "PERMISSION_DENIED") return { reason: "rules-not-published", detail };
  if (code === "app/not-configured") return { reason: "firebase-not-configured", detail };
  if (code === "auth/operation-not-allowed" || code === "auth/user-disabled") {
    return { reason: "anonymous-auth-disabled", detail };
  }
  if (
    code === "network-error" ||
    code === "network-request-failed" ||
    code === "auth/network-request-failed"
  ) {
    return { reason: "offline", detail };
  }
  if (
    code.startsWith("auth/invalid-api-key") ||
    // Firebase appends the human-readable suffix, e.g.
    // "auth/api-key-not-valid.-please-pass-a-valid-api-key".
    code.startsWith("auth/api-key-not-valid") ||
    code.startsWith("auth/invalid-app-credential") ||
    code.startsWith("auth/invalid-credential") ||
    code.startsWith("app/invalid-api-key") ||
    code.startsWith("auth/project-not-found")
  ) {
    return { reason: "bad-credentials", detail };
  }
  return { reason: "unknown", detail };
}

export interface SetupState {
  needsSetup: boolean;
  failure?: AdminFailure;
}

/** True when the database has no digest yet and the setup form should show. */
export async function needsSetup(): Promise<SetupState> {
  if (!firebaseConfigured) {
    return { needsSetup: false, failure: { reason: "firebase-not-configured", detail: "app/not-configured" } };
  }
  try {
    const hash = await fetchAdminPinHash();
    return { needsSetup: hash === null };
  } catch (error) {
    // A read failure means we cannot tell whether a PIN exists, so do not offer
    // to create one — that would fail confusingly instead.
    return { needsSetup: false, failure: classifyError(error) };
  }
}

/**
 * Creates the admin PIN on first use.
 *
 * The database rule permits this exactly once; a second attempt is rejected by
 * Firebase rather than silently overwriting the existing digest.
 */
export async function createAdminPin(pin: string, confirmPin: string): Promise<AdminResult> {
  if (!firebaseConfigured) return { ok: false, reason: "firebase-not-configured" };
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
    return { ok: false, ...classifyError(error) };
  }

  resetAttempts();
  return { ok: true };
}

/** Checks an entered PIN against the digest in the database. */
export async function verifyPin(pin: string): Promise<AdminResult> {
  if (!firebaseConfigured) return { ok: false, reason: "firebase-not-configured" };
  if (isLockedOut()) return { ok: false, reason: "locked" };

  const normalized = pin.trim();
  if (normalized.length < 4) return { ok: false, reason: "too-short" };

  let expected: string | null;
  try {
    expected = await fetchAdminPinHash();
  } catch (error) {
    return { ok: false, ...classifyError(error) };
  }

  if (expected === null) return { ok: false, reason: "no-pin-yet" };

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
