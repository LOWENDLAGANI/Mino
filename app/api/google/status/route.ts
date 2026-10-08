// ── GET /api/google/status — what Settings shows ─────────────────────────────
//
// Reports connection state and which capabilities exist, without ever sending
// a token, a scope string's details, or an email anywhere the user did not put
// one. The masked email is the last three characters before the domain —
// enough for a user to recognize which account they connected.

import { NextRequest } from "next/server";
import { decryptBlob, googleConfigured, mapsConfigured, readTokenCookie } from "@/lib/googleAuth";
import { verifyCaller } from "@/lib/serverControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "…";
  const local = email.slice(0, at);
  const visible = local.slice(-3);
  return `…${visible}@${email.slice(at + 1)}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const configured = googleConfigured();
  const identity = await verifyCaller(req.headers.get("authorization"));
  if (!configured || !identity) {
    return Response.json({ available: configured, connected: false, email: "", mapsAvailable: mapsConfigured() });
  }
  const blob = decryptBlob(readTokenCookie(req.headers));
  const connected = Boolean(blob && blob.uid === identity.uid && blob.accessToken);
  return Response.json({
    available: true,
    connected,
    email: connected && blob ? maskEmail(blob.email) : "",
    mapsAvailable: mapsConfigured(),
  });
}
