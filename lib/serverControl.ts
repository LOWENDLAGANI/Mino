import { normalizeConfig, DEFAULT_CONFIG, type AppConfig } from "./appConfig";

// ── Server-side enforcement of the administrator's controls ─────────────────
// The deployment holds no service account, so this module does exactly two
// things with the database:
//
//   1. Reads `config/` unauthenticated. The rules grant a public read there,
//      so this is a plain REST GET and needs no credential.
//   2. Writes on behalf of a caller who has already proved who they are, by
//      forwarding their own Firebase ID token. The rules then judge that
//      token, so `database.rules.json` stays the only place access is decided.

const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim() ?? "";
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "";
const adminEmail = process.env.MINO_ADMIN_EMAIL?.trim().toLowerCase() ?? "";

/** `https://x.firebaseio.com` -> `https://x.firebaseio.com` (no trailing slash). */
function restBase(): string | null {
  if (!databaseUrl) return null;
  return databaseUrl.replace(/\/+$/, "");
}

export const serverControlsConfigured = Boolean(restBase());

/** Result of authenticating a caller, resolved from the token itself. */
export interface CallerIdentity {
  uid: string;
  email: string;
}

let cached: { config: AppConfig; at: number } | null = null;
const CACHE_MS = 5000;

/**
 * Reads the administrator's settings from the database.
 *
 * Cached for a few seconds so a busy chat does not issue one database read per
 * keystroke-sized request. A failure returns the permissive defaults: if the
 * database is unreachable the app must keep answering rather than locking
 * everybody out, and a control that cannot be read cannot be enforced anyway.
 */
export async function readConfig(): Promise<AppConfig> {
  const base = restBase();
  if (!base) return DEFAULT_CONFIG;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.config;

  try {
    const response = await fetch(`${base}/config.json`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return DEFAULT_CONFIG;
    const config = normalizeConfig(await response.json());
    cached = { config, at: Date.now() };
    return config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Drops the cache so an admin's change takes effect on the very next request. */
export function invalidateConfig(): void {
  cached = null;
}

/**
 * Verifies a Firebase ID token and returns who it belongs to.
 *
 * The API key below is the project's public web key, which is already in the
 * browser bundle; it identifies the project, not the user. Identity comes from
 * the signed token, so possession of the key grants nothing on its own.
 * Returns null for anything missing, malformed, expired, or revoked.
 */
export async function verifyCaller(authorization: string | null): Promise<CallerIdentity | null> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !apiKey || !restBase()) return null;

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { users?: Array<{ uid?: string; email?: string }> };
    const user = payload.users?.[0];
    if (!user?.uid || typeof user.email !== "string") return null;
    return { uid: user.uid, email: user.email.toLowerCase() };
  } catch {
    return null;
  }
}

/** Whether a verified caller is the administrator named in the rules. */
export function isAdmin(identity: CallerIdentity | null): boolean {
  return Boolean(identity && adminEmail && identity.email === adminEmail);
}

export { adminEmail };

/**
 * Writes to the database using the caller's own token, so the rules evaluate
 * it exactly as they would for the browser. Returns false when the write was
 * refused, which is how a non-admin caller is detected.
 */
export async function writeAsCaller(
  authorization: string | null,
  path: string,
  value: unknown
): Promise<boolean> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const base = restBase();
  if (!token || !base) return false;

  try {
    const response = await fetch(`${base}/${path}.json?auth=${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Today's key in UTC, which is what daily caps are counted against. */
export function usageDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type UsageKind = "chat" | "image";

/**
 * Reads today's counters for a visitor, then adds one and writes the result.
 *
 * The write is a read-modify-write, which two simultaneous requests can race
 * on. A cap can therefore be exceeded by a small margin under a burst. Closing
 * that gap needs a transaction the REST API cannot express, and the honest
 * trade is a cap that is approximate rather than a control that is exact.
 */
export async function consumeUsage(
  authorization: string | null,
  uid: string,
  kind: UsageKind
): Promise<{ used: number; allowed: boolean }> {
  const day = usageDay();
  const path = `usage/${uid}/${day}`;
  const current = await readUsage(authorization, path);
  const used = (current[kind] ?? 0) + 1;
  const written = await writeAsCaller(authorization, path, {
    chat: kind === "chat" ? used : current.chat ?? 0,
    image: kind === "image" ? used : current.image ?? 0,
  });
  // A refused write means the caller is not who they claim; the caller's route
  // treats that as unauthenticated rather than silently trusting the counter.
  if (!written) return { used, allowed: false };
  return { used, allowed: true };
}

async function readUsage(authorization: string | null, path: string): Promise<Partial<Record<UsageKind, number>>> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const base = restBase();
  if (!token || !base) return {};
  try {
    const response = await fetch(`${base}/${path}.json?auth=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return {};
    const value = (await response.json()) as Record<string, unknown> | null;
    return {
      chat: typeof value?.chat === "number" ? value.chat : 0,
      image: typeof value?.image === "number" ? value.image : 0,
    };
  } catch {
    return {};
  }
}
