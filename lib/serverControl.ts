import { isBanActive, normalizeConfig, DEFAULT_CONFIG, type AppConfig, type BanRecord } from "./appConfig";

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
  /**
   * Whether the verified account carries a Google credential (a bound or
   * signed-up Google account) as opposed to an anonymous guest. Read from the
   * token itself, so a caller cannot claim it. The Google tools gate on this:
   * acting on someone's Calendar requires a real account, not a guest session.
   */
  googleLinked: boolean;
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
 * Verified identities, keyed by a hash of the token.
 *
 * Without this every request pays for a round trip to Google before it can do
 * anything at all — a chat message waits on an auth lookup it does not need,
 * because the same token arrives with the next message a second later. Five
 * minutes is the ceiling: long enough to remove the latency, short enough that
 * a revoked or newly-signed-in token is forgotten almost immediately. The
 * token itself is never stored as a key, only its hash, so a memory dump of
 * this process does not hand out usable credentials.
 */
const verified = new Map<string, { identity: CallerIdentity; at: number }>();
const VERIFY_CACHE_MS = 5 * 60_000;
const VERIFY_CACHE_MAX = 2000;

/** A short, non-reversible key for a token. Not a secret — just not the token. */
async function tokenKey(token: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // A runtime with no Web Crypto (some test harnesses) still has to work;
    // the token is only held for the duration of this process either way.
    return token;
  }
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

  // A repeat of a token seen in the last few minutes is answered locally. This
  // is the common case — one token covers a whole session — so it is checked
  // before any network call is made.
  const key = await tokenKey(token);
  const remembered = verified.get(key);
  if (remembered && Date.now() - remembered.at < VERIFY_CACHE_MS) {
    return remembered.identity;
  }

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
    users?: Array<{
      localId?: string;
      uid?: string;
      email?: string;
      providerUserInfo?: Array<{ providerId?: string }>;
    }>;
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
  // `providerUserInfo` lists every credential on the account; the anonymous
  // provider is implicit and never listed, so the presence of google.com here
  // is exactly the "signed up with Google" signal the Google tools need.
  const googleLinked = Array.isArray(user?.providerUserInfo)
    ? user.providerUserInfo.some((provider) => provider?.providerId === "google.com")
    : false;
  const identity: CallerIdentity = {
    uid,
    email: typeof user?.email === "string" ? user.email.toLowerCase() : "",
    googleLinked,
  };
  // Only a verified identity is cached. A failure is not, because the next
  // request with the same token deserves its own look — and because caching a
  // refusal would mean a token that becomes valid mid-session stays refused.
  if (verified.size >= VERIFY_CACHE_MAX) {
    const cutoff = Date.now() - VERIFY_CACHE_MS;
    for (const [entryKey, entry] of verified) {
      if (entry.at < cutoff) verified.delete(entryKey);
    }
    // Still full of live entries: drop the oldest rather than grow without
    // bound. A dropped entry is simply looked up again on its next request.
    if (verified.size >= VERIFY_CACHE_MAX) {
      const oldest = verified.keys().next().value;
      if (oldest !== undefined) verified.delete(oldest);
    }
  }
  verified.set(key, { identity, at: Date.now() });
  return identity;
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

export type AdminCheck = { allowed: true; identity: CallerIdentity } | { allowed: false; status: number; error: string };

/**
 * The one administrator gate, shared by every admin-only route.
 *
 * Each failure is answered with its own status and its own words, because the
 * console acts on them: a 401 means "sign in again", a 403 means "wrong
 * account", and a 503 means "this deployment has no administrator configured at
 * all" — three problems with three different fixes, which a single generic
 * refusal would flatten into one.
 */
export async function requireAdmin(headers: Headers): Promise<AdminCheck> {
  if (!adminEmail) {
    return {
      allowed: false,
      status: 503,
      error: "Set `MINO_ADMIN_EMAIL` in the deployment environment to match the address in the database rules.",
    };
  }

  const identity = await verifyCaller(headers.get("authorization"));
  if (!identity) {
    return {
      allowed: false,
      status: 401,
      error: "Your session could not be verified. Close the console, sign in with Google again, and retry.",
    };
  }
  if (!isAdmin(identity)) {
    return {
      allowed: false,
      status: 403,
      // Reached when the token is valid but carries no administrator address,
      // which is what an anonymous session looks like even after signing in.
      error: identity.email
        ? "This account is not the Mino administrator."
        : "This session is still anonymous. Sign in with Google inside the console before using the controls.",
    };
  }
  return { allowed: true, identity };
}

/**
 * Rate limiting, with a shared store when one is configured.
 *
 * This exists because the identity controls above can be switched off: with no
 * ban list and no cap configured, anyone can post to the routes and spend the
 * deployment's provider quota. Per-device caps are the wrong tool for that,
 * since the attacker controls the device, so there needs to be a backstop that
 * does not depend on anything they send.
 *
 * Two backends, chosen once at startup from the environment:
 *
 *   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set → a shared Redis
 *     counter, so the limit holds across cold starts and across every instance
 *     serving the deployment. This is the one that actually means "per minute".
 *   - neither set → an in-process Map, which is per instance and resets on cold
 *     start. It is a speed bump against a casual flood, not a defence against a
 *     determined one, and the code says so rather than pretending otherwise.
 *
 * The Redis path is optional on purpose: a deployment that has never heard of
 * Upstash must still run, and adding a required dependency for a limiter would
 * make the whole app fail to start over a control that is a backstop anyway.
 */
const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
/** Whether requests go to a shared store rather than this process alone. */
export const sharedRateLimit = Boolean(redisUrl && redisToken);

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

/**
 * One increment against the shared counter, or null when the store could not
 * be reached.
 *
 * Null is deliberately "no answer" rather than "allowed": the caller falls
 * back to the in-process bucket, so a Redis outage degrades the limiter to the
 * weaker backend instead of removing it entirely. Refusing every request
 * because the limiter's own dependency is down would turn a protection layer
 * into the single point of failure it was meant to protect against.
 */
async function redisIncrement(key: string): Promise<{ count: number; ttlMs: number } | null> {
  try {
    // INCR creates the counter; PEXPIRE only runs when it was just created, so
    // the window slides from the first request and never leaks a key.
    const response = await fetch(`${redisUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PTTL", key],
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Array<{ result?: number | string }>;
    const count = Number(payload?.[0]?.result);
    let ttlMs = Number(payload?.[1]?.result);
    if (!Number.isFinite(count)) return null;
    // A fresh key reports -2 from PTTL before its first expire is set. The
    // pipeline cannot branch, so the expire is issued by the caller when it
    // sees that, and this one attempt reports the full window.
    if (ttlMs < 0) {
      ttlMs = BUCKET_WINDOW_MS;
      void fetch(`${redisUrl}/pexpire/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${redisToken}` },
        body: String(BUCKET_WINDOW_MS),
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      }).catch(() => undefined);
    }
    return { count, ttlMs };
  } catch {
    return null;
  }
}

/** The in-process bucket, used on its own or when the shared store is quiet. */
function localIncrement(key: string, now: number): { count: number; ttlMs: number } {
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
    return { count: 1, ttlMs: BUCKET_WINDOW_MS };
  }
  bucket.count += 1;
  return { count: bucket.count, ttlMs: bucket.resetAt - now };
}

export async function checkRateLimit(
  req: { headers: Headers },
  identity: CallerIdentity | null,
  max: number,
  /**
   * Which budget this request spends.
   *
   * Chat and memory suggestions share a client but not a purpose, so they get
   * separate buckets. Sharing one would mean every suggestion request silently
   * costs a message of the user's allowance, and the limit would then be a
   * function of how often Mino noticed something — a number nobody can explain.
   */
  scope = "chat"
): Promise<RateLimit> {
  const now = Date.now();
  const key = `mino:rl:${clientKey(req, identity)}:${scope}`;
  const shared = sharedRateLimit ? await redisIncrement(key) : null;
  const { count, ttlMs } = shared ?? localIncrement(key, now);
  if (count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }
  return { allowed: true, remaining: max - count, retryAfterSeconds: 0 };
}
/** The bans still in force at `now`. Expired ones lift by themselves. */
export function activeBans(config: AppConfig, now = Date.now()): BanRecord[] {
  return config.bans.filter((ban) => isBanActive(ban, now));
}

/** Whether the administrator has configured anything that needs an identity. */
export function identityControlsActive(config: AppConfig, cap: number, now = Date.now()): boolean {
  // Only bans still in force count. A ban that expired months ago must not
  // keep forcing identification on every visitor who never had one.
  return activeBans(config, now).length > 0 || cap > 0;
}

/** Today's date as `2026-03-12`, in UTC, for the refusal a visitor reads. */
function formatBanDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The one sentence a banned visitor receives.
 *
 * It carries the reason and the end date when they exist, because a refusal
 * nobody can interpret is how a mistaken ban turns into a support problem: the
 * visitor should be able to read why this happened and whether it lifts. Both
 * are the administrator's own words, verbatim — nothing is invented here.
 */
export function banMessage(ban: BanRecord): string {
  const until = ban.expiresAt !== null ? ` until ${formatBanDate(ban.expiresAt)}` : "";
  const base = ban.expiresAt !== null
    ? `This device is blocked from Mino${until}.`
    : "This device is not allowed to use Mino.";
  const reason = ban.reason.trim().replace(/\.+$/, "");
  if (!reason) return base;
  return `${base} Reason: ${reason}. If you believe this is a mistake, contact the administrator.`;
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
  const now = Date.now();
  const bans = activeBans(config, now);
  if (bans.length === 0 && cap <= 0) return { allowed: true };
  // The administrator is exempt, like they are from maintenance mode. A ban
  // must never be able to lock the person who grants plans out of the product
  // they run — an accidental self-ban with no way back is exactly the kind of
  // lockout this control exists to prevent in others.
  if (identity && isAdmin(identity)) return { allowed: true };
  if (!identity) {
    return {
      allowed: false,
      error: "Mino needs to identify this device before it can answer. Reload the page and try again.",
    };
  }
  const ban = bans.find((entry) => entry.uid === identity.uid);
  if (ban) return { allowed: false, error: banMessage(ban) };
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
/** Which model mode a chat message used, recorded for the console's breakdown. */
export type UsageMode = "auto" | "code" | "self";

export type UsageCounters = Partial<Record<UsageKind | UsageMode, number>>;

/**
 * Reads today's counters for a visitor, then adds one and writes the result.
 *
 * The write is a read-modify-write, which two simultaneous requests can race
 * on. A cap can therefore be exceeded by a small margin under a burst. Closing
 * that gap needs a transaction the REST API cannot express, and the honest
 * trade is a cap that is approximate rather than a control that is exact.
 *
 * Chat messages also bump the mode counter, which is what the console's usage
 * breakdown reads. The whole record is rewritten rather than patched so a
 * single day is always one node with one shape.
 */
export async function consumeUsage(
  authorization: string | null,
  uid: string,
  kind: UsageKind,
  mode?: UsageMode
): Promise<{ used: number; allowed: boolean }> {
  const day = usageDay();
  const path = `usage/${uid}/${day}`;
  const current = await readUsage(authorization, path);
  const used = (current[kind] ?? 0) + 1;
  const next: UsageCounters = {
    ...current,
    chat: kind === "chat" ? used : current.chat ?? 0,
    image: kind === "image" ? used : current.image ?? 0,
  };
  if (kind === "chat" && mode) next[mode] = (next[mode] ?? 0) + 1;
  const written = await writeAsCaller(authorization, path, next);
  // A refused write means the caller is not who they claim; the caller's route
  // treats that as unauthenticated rather than silently trusting the counter.
  if (!written) return { used, allowed: false };
  return { used, allowed: true };
}

async function readUsage(authorization: string | null, path: string): Promise<UsageCounters> {
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
    const counters: UsageCounters = {};
    if (!value) return counters;
    for (const key of ["chat", "image", "auto", "code", "self"] as const) {
      if (typeof value[key] === "number" && value[key] >= 0) counters[key] = value[key];
    }
    return counters;
  } catch {
    return {};
  }
}
