import { NextRequest } from "next/server";
import { listModelTargets, probeModel } from "@/lib/modelHealth";
import { requireAdmin } from "@/lib/serverControl";

// ── Administrator-only model health checks ──────────────────────────────────
// Lists the models this deployment can reach, and answers "is this one up right
// now?" for one of them at a time.
//
// Both operations are gated on the same proof every other admin route uses: a
// verified caller whose address is the one named in `database.rules.json`. The
// check itself is deliberately not counted against the chat limits — an
// administrator verifying a model has not sent a message to anyone, and must
// not be able to lock themselves out of their own console by testing it.
//
// A probe costs a real request, so this route adds its own small per-caller
// limit: a single button that can be held down is an unbounded drain on the
// deployment's quota.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One check every few seconds is plenty for a person watching a status dot. */
const PROBE_MIN_INTERVAL_MS = 4_000;

const lastProbeAt = new Map<string, number>();

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req.headers);
  if (!admin.allowed) return Response.json({ error: admin.error }, { status: admin.status });

  return Response.json({ models: listModelTargets() });
}

export async function POST(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req.headers);
  if (!admin.allowed) return Response.json({ error: admin.error }, { status: admin.status });

  let id: unknown;
  try {
    ({ id } = (await req.json()) as { id?: unknown });
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof id !== "string" || !/^[0-9a-f]{6,64}$/.test(id)) {
    // The id is a hash of a wire model, so anything else is not one of ours and
    // is refused before it reaches a provider.
    return Response.json({ error: "Unknown model." }, { status: 400 });
  }

  const key = `${req.headers.get("authorization") ?? ""}:${id}`;
  const previous = lastProbeAt.get(key) ?? 0;
  const since = Date.now() - previous;
  if (since < PROBE_MIN_INTERVAL_MS) {
    return Response.json(
      { error: "Just checked — wait a moment before checking again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((PROBE_MIN_INTERVAL_MS - since) / 1000)) } }
    );
  }
  lastProbeAt.set(key, Date.now());

  const result = await probeModel(id, req.signal);
  return Response.json({ result });
}
