// ── Google OAuth for Mino's Google tools (server only) ───────────────────────
//
// A separate consent from the Firebase "Link a Google account" flow. That flow
// grants identity only; these scopes (Calendar, Tasks, Sheets, Docs) let Mino
// read and write the user's own Google data on their explicit request in chat.
//
// Design constraints, in the spirit of the rest of Mino:
// - No new database. The token set lives in an AES-256-GCM encrypted, httpOnly
//   cookie on the browser that consented. It is bound to the caller's verified
//   Firebase uid, so a copied cookie from another browser cannot act for them.
// - No secret ever reaches the client. The cookie payload is opaque ciphertext.
// - The deployment stays fully usable when Google is not configured: every
//   helper here degrades to "not available" and the chat never mentions it.

import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
// The encryption key is any secret string; it is hashed to a 32-byte AES key.
// A 32-byte hex value from `openssl rand -hex 32` is the recommended value.
// Read lazily rather than captured at module load: serverless environments can
// (re)inject environment variables between cold starts, and a captured value
// would keep encrypting with a key the environment no longer names.

export const GOOGLE_REDIRECT_PATH = "/api/google/callback";

// Write scopes: the user asked for read AND write. Maps needs no OAuth at all
// (see lib/googleTools.ts) and Drive is required to create and find Sheets and
// Docs, whose own APIs cannot list or create files.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];

const TOKEN_COOKIE = "mino_google";
const STATE_COOKIE = "mino_google_state";
// Refresh tokens are long-lived; the cookie may sit for weeks. The state cookie
// only has to survive the redirect through Google's consent screen.
const TOKEN_MAX_AGE = 60 * 60 * 24 * 120;
const STATE_MAX_AGE = 600;

/** Whether the deployment has everything the Google tools need. */
export function googleConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && encryptionKeyRaw());
}

function encryptionKeyRaw(): string {
  return process.env.GOOGLE_ENCRYPTION_KEY?.trim() ?? "";
}

/** Whether the deployment has a Maps key. Maps works keyless for links only. */
export function mapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
}

function aesKey(): Buffer {
  return createHash("sha256").update(encryptionKeyRaw()).digest();
}

// ── The encrypted token blob ─────────────────────────────────────────────────

export interface GoogleTokenBlob {
  /** The Firebase uid this consent belongs to. Enforced on every use. */
  uid: string;
  email: string;
  scope: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which accessToken must be refreshed. */
  expiresAt: number;
}

function seal(plain: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64url");
}

function unseal(sealed: string): Buffer | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", aesKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Wrong key, truncated value, or tampering — all read as "not signed in".
    return null;
  }
}

export function encryptBlob(blob: GoogleTokenBlob): string {
  return seal(Buffer.from(JSON.stringify(blob), "utf8"));
}

export function decryptBlob(value: string | undefined): GoogleTokenBlob | null {
  if (!value) return null;
  const plain = unseal(value);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain.toString("utf8")) as Partial<GoogleTokenBlob>;
    if (typeof parsed.uid !== "string" || typeof parsed.accessToken !== "string") return null;
    return {
      uid: parsed.uid,
      email: typeof parsed.email === "string" ? parsed.email : "",
      scope: typeof parsed.scope === "string" ? parsed.scope : "",
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

export function tokenCookie(value: string): string {
  return `${TOKEN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TOKEN_MAX_AGE}`;
}

export function clearTokenCookie(): string {
  return `${TOKEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readTokenCookie(cookies: Headers): string | undefined {
  const header = cookies.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === TOKEN_COOKIE) return rest.join("=");
  }
  return undefined;
}

// ── The signed OAuth state ───────────────────────────────────────────────────
//
// CSRF protection for the redirect dance. The value carries the uid of the
// account that pressed Connect, HMAC-signed, so the callback cannot be tricked
// into storing a stranger's consent — or an attacker's own consent — against
// another account.

function signState(value: string): string {
  const mac = createHmac("sha256", aesKey()).update(value).digest("base64url");
  return `${value}.${mac}`;
}

function verifyState(signed: string | undefined): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const expected = signState(value);
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

export function createStateCookie(uid: string): string {
  const value = `${uid}.${randomBytes(16).toString("hex")}`;
  return `${STATE_COOKIE}=${signState(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_MAX_AGE}`;
}

export function readStateCookie(cookies: Headers): { uid: string; nonce: string } | null {
  const header = cookies.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== STATE_COOKIE) continue;
    const value = verifyState(rest.join("="));
    if (!value) return null;
    const dot = value.indexOf(".");
    if (dot <= 0) return null;
    return { uid: value.slice(0, dot), nonce: value.slice(dot + 1) };
  }
  return null;
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ── The consent URL and the token endpoints ──────────────────────────────────

export function redirectUri(origin: string): string {
  return (process.env.GOOGLE_REDIRECT_URI?.trim() || `${origin}${GOOGLE_REDIRECT_PATH}`);
}

export function buildConsentUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // `consent` is what guarantees a refresh token on every grant; without it
    // Google can return a consent with no offline token, and there is nothing
    // to refresh when the hour-old access token dies.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(form: Record<string, string>): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || `token endpoint returned HTTP ${response.status}`);
  }
  return payload;
}

export async function exchangeCode(code: string, origin: string): Promise<GoogleTokenResponse> {
  return tokenRequest({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
  });
}

export async function revokeToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

// ── A usable access token, refreshed on demand ───────────────────────────────

export interface GoogleSession {
  blob: GoogleTokenBlob;
  /** Set when the token was refreshed and the cookie must be re-set. */
  refreshedCookie: string | null;
}

/**
 * Reads the caller's Google session and refreshes it when it has expired.
 *
 * The uid check is the whole security model for the cookie: consent given in
 * this browser is only usable by the same Firebase account, verified on every
 * request through the same `verifyCaller` the other routes use. Callers gate
 * on `identity.googleLinked` before reaching here, so a session also implies
 * a Google-signed account. Returns null whenever anything is missing — the
 * caller treats that as "not connected".
 */
export function readGoogleSession(cookies: Headers, uid: string): GoogleSession | null {
  const blob = decryptBlob(readTokenCookie(cookies));
  if (!blob || blob.uid !== uid || !blob.accessToken) return null;
  return { blob, refreshedCookie: null };
}

export async function ensureFreshSession(session: GoogleSession): Promise<GoogleSession> {
  const { blob } = session;
  // Refresh a minute early so an in-flight request does not race the expiry.
  if (blob.expiresAt - Date.now() > 60_000 || !blob.refreshToken) return session;
  const refreshed = await refreshAccessToken(blob.refreshToken);
  if (!refreshed.access_token) return session;
  const next: GoogleTokenBlob = {
    ...blob,
    accessToken: refreshed.access_token,
    // Google only returns a refresh token on some grants; keep the old one.
    refreshToken: refreshed.refresh_token || blob.refreshToken,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
  };
  return { blob: next, refreshedCookie: tokenCookie(encryptBlob(next)) };
}

/**
 * The email claim from an id_token issued by the token endpoint.
 *
 * The token arrived directly from Google over TLS in exchange for a secret the
 * server alone holds, so it is trusted as transported and only decoded, never
 * verified against Google's JWKS — the keys to fetch would themselves come
 * from the network, adding a failure mode for no added assurance here. The
 * email is display-only: it names the account in Settings, and nothing
 * authorizes against it.
 */
export function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}
