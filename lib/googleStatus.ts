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
}

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  try {
    const response = await fetch("/api/google/status", {
      headers: await authHeader(),
      cache: "no-store",
    });
    if (!response.ok) return { available: false, connected: false, email: "", mapsAvailable: false };
    return (await response.json()) as GoogleStatus;
  } catch {
    return { available: false, connected: false, email: "", mapsAvailable: false };
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
