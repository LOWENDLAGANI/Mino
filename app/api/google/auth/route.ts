// ── GET /api/google/auth — start the Google consent ──────────────────────────
//
// Requires a verified caller whose account carries a Google credential. An
// anonymous guest is bounced back with #google-needs-signin rather than a
// consent screen — Google Workspace access is a signed-up-account feature,
// and the state cookie records whose consent this is, which a guest cannot
// meaningfully be.

import { NextRequest, NextResponse } from "next/server";
import { buildConsentUrl, createStateCookie, googleConfigured } from "@/lib/googleAuth";
import { verifyCaller } from "@/lib/serverControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  if (!googleConfigured()) {
    return Response.json(
      { error: "Google tools are not configured on this deployment." },
      { status: 503 }
    );
  }
  const identity = await verifyCaller(req.headers.get("authorization"));
  if (!identity) {
    return Response.json(
      { error: "Link a Google account in Settings first, then connect Google tools." },
      { status: 401 }
    );
  }
  if (!identity.googleLinked) {
    // Not an error to the client — the redirect back with this fragment is
    // what the Settings panel turns into "sign in with Google first".
    const back = NextResponse.redirect(new URL("/#google-needs-signin", req.nextUrl.origin));
    back.headers.set("Referrer-Policy", "no-referrer");
    return back;
  }

  const origin = req.nextUrl.origin;
  const state = identity.uid;
  const response = NextResponse.redirect(buildConsentUrl(origin, state));
  // Not `secure` on the auth route's own response would let the state leak on
  // plain HTTP; Vercel is always HTTPS, and localhost dev uses a browser that
  // accepts Secure cookies only on HTTPS — so this matches the callback's
  // behavior in both environments.
  response.headers.set("Set-Cookie", createStateCookie(identity.uid));
  // No referrer in the redirect target: the consent URL carries the state, and
  // the state is signed, so a referrer leak is harmless — but why leak at all.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
