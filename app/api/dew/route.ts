import { NextRequest } from "next/server";
import { verifyCaller, isAdmin, checkRateLimit } from "@/lib/serverControl";
import { ensureTrialGrant } from "@/lib/serverDew";
import { resolveDew } from "@/lib/serverRedeem";
import { LOW_BALANCE_THRESHOLD, outOfDewMessage } from "@/lib/dew";

// ── Dew balance, read and ensured on demand ──────────────────────────────────
//
// The browser could read its own `dew/{uid}` directly, but the server-money
// questions are worth one authoritative answer: this route derives the
// balance exactly the way the enforcement modules do, so the chip on screen
// and the pre-flight check can never disagree.
//
//   GET  → the balance.
//   POST → ensures the trial credit exists (exactly once, rules-pinned at
//          25), then answers the balance either way.
//
// Both require a verified identity. A caller who cannot be identified has no
// balance and is told so with 401 rather than with a number.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DewResponse {
  balance: number;
  spent: number;
  low: boolean;
}

async function respond(authorization: string | null, uid: string): Promise<Response> {
  const state = await resolveDew(authorization, uid);
  return Response.json(
    {
      balance: state.balance,
      spent: state.spent,
      low: state.balance < LOW_BALANCE_THRESHOLD,
    } satisfies DewResponse,
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);
  if (!identity) {
    return Response.json({ error: "Sign in to see your Dew balance." }, { status: 401 });
  }
  const limit = await checkRateLimit(req, identity, 60, "dew");
  if (!limit.allowed) {
    return Response.json({ error: "Too many balance checks. Try again shortly." }, { status: 429 });
  }
  return respond(authorization, identity.uid);
}

export async function POST(req: NextRequest): Promise<Response> {
  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);
  if (!identity) {
    return Response.json({ error: "Sign in to claim your welcome Dew." }, { status: 401 });
  }
  const limit = await checkRateLimit(req, identity, 10, "dew");
  if (!limit.allowed) {
    return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const result = await ensureTrialGrant(authorization, identity.uid);
  if (!result.ok && !isAdmin(identity)) {
    return Response.json({ error: outOfDewMessage(), detail: "trial-unavailable" }, { status: 503 });
  }
  return respond(authorization, identity.uid);
}
