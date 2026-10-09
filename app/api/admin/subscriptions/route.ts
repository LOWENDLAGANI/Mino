import { NextRequest } from "next/server";
import { readSubscriptionDetail, pauseSubscription, resumeSubscription, searchSubscriptions } from "@/lib/firebaseAdmin";
import { requireAdmin, serverControlsConfigured } from "@/lib/serverControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  if (!serverControlsConfigured) {
    return Response.json({ error: "Controls are not configured in this deployment." }, { status: 503 });
  }

  const admin = await requireAdmin(req.headers);
  if (!admin.allowed) {
    return Response.json({ error: admin.error }, { status: admin.status });
  }

  const searchParams = req.nextUrl.searchParams;
  const q = searchParams.get("q") ?? "";
  const uid = searchParams.get("uid") ?? "";

  if (uid) {
    const detail = await readSubscriptionDetail(uid);
    return Response.json(detail);
  }

  const details = uid
    ? [await readSubscriptionDetail(uid)]
    : await searchSubscriptions(q);
  return Response.json(details);
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!serverControlsConfigured) {
    return Response.json({ error: "Controls are not configured in this deployment." }, { status: 503 });
  }

  const admin = await requireAdmin(req.headers);
  if (!admin.allowed) {
    return Response.json({ error: admin.error }, { status: admin.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const uid = typeof body.uid === "string" && body.uid.trim() ? body.uid.trim() : "";
  if (!uid) {
    return Response.json({ error: "Missing uid" }, { status: 400 });
  }

  const action = body.action;
  if (action === "pause") {
    const reason = typeof body.reason === "string" ? body.reason : "";
    const ok = await pauseSubscription(uid, reason, admin.identity.email || "admin");
    if (!ok) {
      return Response.json({ error: "No active subscription to pause for that uid." }, { status: 404 });
    }
    return Response.json({ ok: true, uid });
  }

  if (action === "resume") {
    const ok = await resumeSubscription(uid);
    if (!ok) {
      return Response.json({ error: "That uid has no paused subscription to resume." }, { status: 404 });
    }
    return Response.json({ ok: true, uid });
  }

  return Response.json({ error: "Unknown action. Use pause or resume." }, { status: 400 });
}
