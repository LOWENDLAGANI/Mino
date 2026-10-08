// ── POST /api/google/disconnect — revoke and forget ──────────────────────────
//
// The refresh token is revoked at Google, so consent genuinely ends, and the
// cookie is cleared. Nothing is stored server-side, so there is nothing else
// to delete.

import { NextRequest } from "next/server";
import { clearTokenCookie, decryptBlob, readTokenCookie, revokeToken } from "@/lib/googleAuth";
import { verifyCaller } from "@/lib/serverControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const identity = await verifyCaller(req.headers.get("authorization"));
  if (!identity) return Response.json({ error: "Not signed in." }, { status: 401 });

  const blob = decryptBlob(readTokenCookie(req.headers));
  if (blob && blob.uid === identity.uid && blob.refreshToken) {
    await revokeToken(blob.refreshToken);
  }
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", clearTokenCookie());
  return response;
}
