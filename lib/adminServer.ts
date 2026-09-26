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

export async function verifyPinServer(pin: string): Promise<{ ok: true } | { ok: false; reason: "locked" | "invalid" | "not-set-up" }> {
  if (throttleReason() === "locked") return { ok: false, reason: "locked" };

  const stored = (await adminDatabase().ref("admin/pinHash").get()).val();
  if (typeof stored !== "string" || stored.length !== 64) {
    return { ok: false, reason: "not-set-up" };
  }

  if (!safeEqual(sha256Hex(pin.trim()), String(stored).toLowerCase())) {
    attempts.push(Date.now());
    return { ok: false, reason: "invalid" };
  }

  attempts.length = 0;
  return { ok: true };
}
