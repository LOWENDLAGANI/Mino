import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { createHash, timingSafeEqual } from "node:crypto";

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

function getAdminApp(): App {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0]!;
    return app;
  }
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n");
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
      privateKey,
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
): Promise<{ ok: true; diagnostics: AdminDiagnostics } | { ok: false; reason: "locked" | "invalid" | "not-set-up"; diagnostics: AdminDiagnostics }> {
  const database = adminDatabase();
  const diagnostics: AdminDiagnostics = {
    databaseHost: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "(not set)",
    foundDigest: false,
    storedLength: 0,
    browserDigestMatched: null,
  };

  if (throttleReason() === "locked") return { ok: false, reason: "locked", diagnostics };

  const stored = (await database.ref("admin/pinHash").get()).val();
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
