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
  /** Empty for an anonymous visitor, who has no Google account attached. */
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
  if (!token) return fail("no-token");
  if (!apiKey) return fail("no-api-key");
  if (!restBase()) return fail("no-database-url");

  let response: Response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
        cache: "no-store",
      }
    );
  } catch (error) {
    return fail("lookup-threw", error);
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    return fail(`lookup-http-${response.status}`, body);
  }
  const payload = (await response.json().catch(() => null)) as {
    users?: Array<{ localId?: string; uid?: string; email?: string }>;
  } | null;
  const user = payload?.users?.[0];
  // The Identity Toolkit REST API names the user id `localId`. `uid` is what
  // the client SDK exposes on a user object, and reading that field here
  // silently identified nobody.
  const uid = user?.localId ?? user?.uid;
  if (!uid) return fail("lookup-returned-no-user", payload);
  // An anonymous visitor has no email, and that is the normal case: almost
  // every caller is anonymous. Demanding an email here would identify nobody,
  // which silently disables the ban list and the daily caps as well. The uid
  // is what those controls act on; only the admin check needs an address.
  return { uid, email: typeof user?.email === "string" ? user.email.toLowerCase() : "" };
}

/**
 * Records why an identity could not be established.
 *
 * Without this the only symptom is a generic 401, which is indistinguishable
 * from a genuine permission failure. The token itself is never logged.
 */
function fail(reason: string, detail?: unknown): null {
  console.warn(`[mino control] caller not identified: ${reason}`, detail ?? "");
  return null;
}

/** Whether a verified caller is the administrator named in the rules. */
export function isAdmin(identity: CallerIdentity | null): boolean {
  return Boolean(identity && adminEmail && identity.email === adminEmail);
}

/**
 * A small in-process rate limiter, keyed by client address.
 *
 * This exists because the identity controls above can be switched off: with no
 * ban list and no cap configured, anyone can post to the routes and spend the
 * deployment's provider quota. Per-device caps are the wrong tool for that,
 * since the attacker controls the device, so there needs to be a backstop that
 * does not depend on anything they send.
 *
 * In-process means per instance, so a serverless deployment resets it on cold
 * start and scales it out. It is a speed bump against a casual flood, not a
 * defence against a determined one; making it exact needs a shared store such
 * as Redis or Upstash, which this project deliberately does not have.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const BUCKET_WINDOW_MS = 60_000;

export interface RateLimit {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Reads the client address from the headers a proxy sets. */
function clientKey(req: { headers: Headers }, identity: CallerIdentity | null): string {
  if (identity) return `uid:${identity.uid}`;
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
  return `ip:${address}`;
}

export function checkRateLimit(
  req: { headers: Headers },
  identity: CallerIdentity | null,
  max: number
): RateLimit {
  const now = Date.now();
  const key = clientKey(req, identity);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + BUCKET_WINDOW_MS });
    // Drop expired buckets occasionally so the map cannot grow without bound
    // on a long-lived instance.
    if (buckets.size > 5000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
      }
    }
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: max - bucket.count, retryAfterSeconds: 0 };
}
/** Whether the administrator has configured anything that needs an identity. */
export function identityControlsActive(config: AppConfig, cap: number): boolean {
  return config.bannedUids.length > 0 || cap > 0;
}

/**
 * Decides whether a caller may spend quota.
 *
 * The important case is an *unidentified* one. Every identity-dependent check
 * below is written as `if (identity && ...)`, which means a caller who simply
 * omits the Authorization header has no identity, skips every check, and is
 * waved through — turning the ban list and the daily caps into decoration
 * removable with a single header. So once the administrator has configured
 * either one, a caller that cannot be identified is refused instead. They may
 * retry, but they cannot proceed anonymously.
 */
export function identityGate(
  identity: CallerIdentity | null,
  config: AppConfig,
  cap: number
): { allowed: boolean; error?: string } {
  if (!identityControlsActive(config, cap)) return { allowed: true };
  if (!identity) {
    return {
      allowed: false,
      error: "Mino needs to identify this device before it can answer. Reload the page and try again.",
    };
  }
  if (config.bannedUids.includes(identity.uid)) {
    return { allowed: false, error: "This device is not allowed to use Mino." };
  }
  return { allowed: true };
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
