import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { createHash, createPrivateKey, timingSafeEqual } from "node:crypto";

// ── Server-side admin access ─────────────────────────────────────────────────
// The admin console reads logged chats, so those reads deliberately do NOT go
// through the browser. Realtime Database rules cannot verify that someone knows
// the PIN — the comparison happens client-side, which means any rule that lets
// the browser read `users/...` would expose every conversation to every
// visitor. Instead the PIN is checked here, and this module talks to the
// database with the Admin SDK, which is not subject to those rules.
//
// Requires a Firebase service account in the deployment environment:
//   FIREBASE_ADMIN_PROJECT_ID
//   FIREBASE_ADMIN_CLIENT_EMAIL
//   FIREBASE_ADMIN_PRIVATE_KEY   (the private key, with real newlines)
// The browser-side PIN setup in lib/adminPin.ts keeps working unchanged; this is
// what makes the console's data actually private.

let app: App | null = null;

export function adminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
      process.env.FIREBASE_ADMIN_PRIVATE_KEY
  );
}

export interface PrivateKeyShape {
  present: boolean;
  /** Base64 characters in the body, excluding markers, whitespace and padding. */
  bodyLength: number;
  /** '=' padding characters that were stored (0 when a paste lost them). */
  paddingChars: number;
  /** True when the body contains only base64 characters. */
  base64Valid: boolean;
  /** First byte of the decoded DER, hex. A PKCS#8 key starts SEQUENCE (30). */
  derPrefix: string | null;
  /** Markers found — more than one means the key was pasted twice. */
  headerCount: number;
  describe: string;
}

/** PKCS#8 RSA-2048 keys are around 1600 base64 characters. Informational only. */
const TYPICAL_BODY_LENGTH = [1500, 1750];

/**
 * The base64 payload of a PEM block: markers, line breaks, escapes and padding
 * removed. This is the single definition of "the body" — diagnostics and the
 * rebuilder both use it, so a key can never measure one way and be rebuilt
 * another.
 */
function base64Body(raw: string): string {
  return extractBody(firstPemBlock(raw)).replace(/[^A-Za-z0-9+/]/g, "");
}

/**
 * A value pasted twice contains two complete PEM blocks. Take the first one
 * rather than concatenating both: the trailing copy is dead weight that
 * OpenSSL would decode straight past without complaint.
 */
function firstPemBlock(raw: string): string {
  return raw.match(/-----BEGIN [A-Z ]+-----([\s\S]*?)-----END [A-Z ]+-----/)?.[1] ?? raw;
}

function extractBody(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).trim();
  // Survive any level of escaping: drop real line breaks, then the escapes,
  // then any remaining backslashes from a double-escaped value.
  value = value.replace(/\r/g, "").replace(/\\r/g, "").replace(/\\n/g, "").replace(/\\/g, "");
  return value.replace(/-----[A-Z ]+-----/g, "");
}

/** Describes the key without revealing any of it. */
export function privateKeyShape(): PrivateKeyShape {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  const body = base64Body(raw);
  const headerCount = (raw.match(/-----BEGIN PRIVATE KEY-----/g) ?? []).length;

  const shape: PrivateKeyShape = {
    present: raw.trim().length > 0,
    bodyLength: body.length,
    paddingChars: (extractBody(firstPemBlock(raw)).match(/=+$/)?.[0].length ?? 0),
    base64Valid: body.length > 0,
    derPrefix: null,
    headerCount,
    describe: "",
  };

  if (!shape.present) {
    shape.describe = "FIREBASE_ADMIN_PRIVATE_KEY is empty";
    return shape;
  }
  if (headerCount === 0) {
    shape.describe = "the -----BEGIN PRIVATE KEY----- marker is missing — the whole key, markers included, must be pasted";
    return shape;
  }
  if (headerCount > 1) {
    shape.describe = `the key appears ${headerCount} times — it was pasted more than once into the variable`;
    return shape;
  }
  if (body.length === 0) {
    shape.describe = "nothing between the BEGIN and END markers";
    return shape;
  }
  try {
    shape.derPrefix = Buffer.from(body, "base64").subarray(0, 2).toString("hex");
  } catch {
    shape.derPrefix = null;
  }

  // Ground truth: try the same parse the Admin SDK will do, on the same rebuilt
  // PEM. A length that is not a multiple of 4 is NOT by itself an error — the
  // final base64 quantum is short precisely when the DER ends in 1 or 2 bytes —
  // so only the real parse decides whether the key is usable.
  try {
    createPrivateKey({ key: normalizePrivateKey(raw), format: "pem" });
    shape.describe = "well formed";
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
    shape.describe =
      body.length < TYPICAL_BODY_LENGTH[0] || body.length > TYPICAL_BODY_LENGTH[1]
        ? `the key does not parse and its body is ${body.length} characters, outside the usual 1500–1750 — it is truncated or doubled`
        : `the stored key is damaged: its body is ${body.length} base64 characters, but a service-account key is 1620–1628. Re-copy the private_key field from the JSON. (${detail})`;
  }
  return shape;
}

/**
 * Rebuilds a PEM private key from whatever survived the paste.
 *
 * Env var fields in deployment dashboards routinely mangle PEM blocks: line
 * breaks are dropped, the JSON-escaped `\n` form is stored literally, quotes
 * come along, or the value is pasted twice. Every one of those produces "Failed
 * to parse private key". The base64 body is unpacked — any non-base64
 * character discarded — and re-wrapped at the conventional 64 characters.
 *
 * The trailing `=` padding is load-bearing and must survive. A service-account
 * key is a DER structure whose length is not always a multiple of 3, so its
 * base64 body almost always ends in `==`; OpenSSL's PEM decoder rejects a body
 * whose last quantum is missing that padding, even though the key is otherwise
 * perfect. Padding is therefore re-derived from the body length rather than
 * stripped, which both preserves a padding that arrived intact and restores one
 * that a paste lost.
 */
export function normalizePrivateKey(raw: string): string {
  const body = base64Body(raw);
  if (body.length === 0) return "";
  const remainder = body.length % 4;
  const padding = remainder === 2 ? "==" : remainder === 3 ? "=" : "";
  const lines = (body + padding).match(/.{1,64}/g) ?? [];
  return `${["-----BEGIN PRIVATE KEY-----", ...lines, "-----END PRIVATE KEY-----\n"].join("\n")}`;
}

function getAdminApp(): App {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0]!;
    return app;
  }
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
      privateKey: normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY!),
    }),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
  return app;
}

export function adminDatabase() {
  return getDatabase(getAdminApp());
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

// A small in-process throttle. Serverless instances are ephemeral, so this only
// slows down a naive attacker rather than being a hard guarantee.
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 5 * 60_000;
const attempts: number[] = [];

function throttleReason(): "locked" | null {
  const cutoff = Date.now() - WINDOW_MS;
  while (attempts.length > 0 && attempts[0]! < cutoff) attempts.shift();
  return attempts.length >= MAX_ATTEMPTS ? "locked" : null;
}

export interface AdminDiagnostics {
  /** Host of the Realtime Database the server actually read from. */
  databaseHost: string;
  /** Whether a digest node exists there at all. */
  foundDigest: boolean;
  /** Length of the stored value, so a stray newline or truncation is visible. */
  storedLength: number;
  /** True when the caller's own read of the digest matched its own hash. */
  browserDigestMatched: boolean | null;
  /** Shape of the service-account private key, without revealing it. */
  privateKey?: string;
  privateKeyDetail?: PrivateKeyShape;
  /** The raw failure, when the database could not be read at all. */
  readError?: string;
}

/**
 * Verifies the caller against the stored digest.
 *
 * The browser sends the SHA-256 digest it computed rather than the PIN itself —
 * the digest is the secret either way, and receiving it lets the server report
 * whether the two sides are even looking at the same database, which is the
 * usual cause of a mismatch that looks impossible.
 */
export async function verifyPinServer(
  digestFromBrowser: string
): Promise<{ ok: true; diagnostics: AdminDiagnostics } | { ok: false; reason: "locked" | "invalid" | "not-set-up" | "database-error"; diagnostics: AdminDiagnostics }> {
  const diagnostics: AdminDiagnostics = {
    databaseHost: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "(not set)",
    foundDigest: false,
    storedLength: 0,
    browserDigestMatched: null,
    privateKey: privateKeyShape().describe,
    privateKeyDetail: privateKeyShape(),
  };

  if (throttleReason() === "locked") return { ok: false, reason: "locked", diagnostics };

  let stored: unknown;
  try {
    stored = (await adminDatabase().ref("admin/pinHash").get()).val();
  } catch (error) {
    diagnostics.readError = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "database-error", diagnostics };
  }

  if (typeof stored === "string") {
    diagnostics.foundDigest = true;
    diagnostics.storedLength = stored.length;
  }

  if (!diagnostics.foundDigest || diagnostics.storedLength !== 64) {
    return { ok: false, reason: "not-set-up", diagnostics };
  }

  if (!safeEqual(digestFromBrowser.trim().toLowerCase(), String(stored).toLowerCase())) {
    attempts.push(Date.now());
    return { ok: false, reason: "invalid", diagnostics };
  }

  attempts.length = 0;
  return { ok: true, diagnostics };
}
