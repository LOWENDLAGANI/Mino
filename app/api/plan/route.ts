import { NextRequest } from "next/server";
import { resolveEffectivePlan } from "@/lib/serverRedeem";
import { isAdmin, verifyCaller } from "@/lib/serverControl";

// ── What this caller has, as the server sees it ──────────────────────────────
// The page needs to show a plan the same way the routes enforce it. Those used
// to disagree: enforcement read a claimed code, while the interface read only
// `subscriptions/{uid}` — which a claim never writes. A buyer who had just been
// told "code accepted" was then shown Free, and reasonably concluded the code
// had not worked.
//
// So the answer comes from one place. This endpoint asks the same resolver the
// routes ask, with the same verified token, and the page shows whatever it says.
// If the two ever disagree again it will be visible here rather than as a
// support message from somebody who has just paid.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);

  // An unidentified caller has no plan, and is told so rather than being sent
  // away to sign in: the free tier is a real answer and the page renders it.
  const plan = identity
    ? await resolveEffectivePlan(authorization, identity.uid)
    : { planId: null, expiresAt: 0 };

  return Response.json({
    planId: plan.planId,
    expiresAt: plan.expiresAt,
    // So the page can tell "you have nothing" from "we could not check", which
    // are different things to show somebody who has just typed a code.
    checked: Boolean(identity),
    isAdmin: isAdmin(identity),
  });
}