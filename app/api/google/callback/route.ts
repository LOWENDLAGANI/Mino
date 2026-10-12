// ── GET /api/google/callback — finish the consent ────────────────────────────
//
// Google redirects here with the code and the state. The state is verified
// against the HMAC the auth route set, exchanged for tokens, and the encrypted
// token blob is stored in the browser's cookie — never in any database.

import { NextRequest, NextResponse } from "next/server";
import {
  clearStateCookie,
  emailFromIdToken,
  encryptBlob,
  exchangeCode,
  googleConfigured,
  readStateCookie,
  tokenCookie,
  type GoogleTokenBlob,
} from "@/lib/googleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bounce(origin: string, ok: boolean, message?: string): Response {
  const url = new URL(origin);
  url.hash = ok ? "google-connected" : `google-error=${encodeURIComponent(message ?? "unknown")}`;
  const response = NextResponse.redirect(url.toString());
  response.headers.append("Set-Cookie", clearStateCookie());
  return response;
}

export async function GET(req: NextRequest): Promise<Response> {
  const origin = req.nextUrl.origin;
  if (!googleConfigured()) return bounce(origin, false, "Google tools are not configured on this deployment.");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");
  if (oauthError) {
    // "access_denied" is the ordinary case: the user closed the consent screen.
    return bounce(origin, false, oauthError === "access_denied" ? "Google consent was cancelled." : oauthError);
  }
  if (!code) return bounce(origin, false, "Google did not return an authorization code.");

  const savedState = readStateCookie(req.headers);
  if (!savedState) return bounce(origin, false, "The sign-in session expired. Try connecting again.");
  if (!state || state !== savedState.uid) {
    // The state's uid is what the token blob is bound to. A mismatch means the
    // consent that came back belongs to someone else, or the flow was replayed.
    return bounce(origin, false, "Google sign-in could not be matched to this account.");
  }

  try {
    const tokens = await exchangeCode(code, origin);
    if (!tokens.access_token) {
      return bounce(origin, false, "Google did not return an access token.");
    }
    const blob: GoogleTokenBlob = {
      uid: savedState.uid,
      email: emailFromIdToken(tokens.id_token),
      scope: tokens.scope ?? "",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
    const response = bounce(origin, true);
    response.headers.append("Set-Cookie", tokenCookie(encryptBlob(blob)));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "token exchange failed";
    return bounce(origin, false, message);
  }
}
