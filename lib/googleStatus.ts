"use client";

// ── The browser's view of the Google connection ──────────────────────────────
// Settings asks /api/google/status with the caller's Firebase token and renders
// from that. Nothing here ever touches a token: the cookie is httpOnly and the
// browser cannot read it even by accident.

import { authHeader } from "./firebaseHistory";

export interface GoogleStatus {
  available: boolean;
  connected: boolean;
  email: string;
  mapsAvailable: boolean;
  /**
   * Whether the signed-in account carries a Google credential. False for an
   * anonymous guest — the panel uses this to show "sign in with Google"
   * instead of "connect", because the Google tools are a signed-up-account
   * feature.
   */
  googleLinked: boolean;
}

const IDLE: GoogleStatus = { available: false, connected: false, email: "", mapsAvailable: false, googleLinked: false };

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  try {
    const response = await fetch("/api/google/status", {
      headers: await authHeader(),
      cache: "no-store",
    });
    if (!response.ok) return IDLE;
    const payload = (await response.json()) as Partial<GoogleStatus>;
    return {
      available: payload.available === true,
      connected: payload.connected === true,
      email: typeof payload.email === "string" ? payload.email : "",
      mapsAvailable: payload.mapsAvailable === true,
      googleLinked: payload.googleLinked === true,
    };
  } catch {
    return IDLE;
  }
}

/**
 * Starts the consent flow. The redirect back lands on the same page with a
 * `#google-connected` or `#google-error=…` fragment, which Settings reads to
 * show the result — a fragment rather than a query parameter so the code and
 * state never land in a server log or a referrer.
 */
export function startGoogleConnect(): void {
  window.location.href = "/api/google/auth";
}

/**
 * Signs the visitor's anonymous account in with Google (or binds it, when the
 * browser holds a guest session — the same upgrade Settings already offers).
 * Returns whether the account now carries a Google credential.
 */
export async function signInWithGoogleAccount(name?: string): Promise<boolean> {
  try {
    const { bindGoogleAccount } = await import("./account");
    const result = await bindGoogleAccount(name);
    return result.outcome === "linked" || result.outcome === "adopted";
  } catch {
    return false;
  }
}

export async function disconnectGoogle(): Promise<boolean> {
  try {
    const response = await fetch("/api/google/disconnect", {
      method: "POST",
      headers: await authHeader(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
