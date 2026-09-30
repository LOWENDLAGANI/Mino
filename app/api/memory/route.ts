import { NextRequest } from "next/server";
import { extractMemories } from "@/lib/memoryExtractor";
import { parseSuggestions } from "@/lib/memorySuggestions";
import type { Memory } from "@/lib/types";
import { checkRateLimit, identityGate, isAdmin, readConfig, verifyCaller } from "@/lib/serverControl";

// ── Mino — memory suggestions ────────────────────────────────────────────────
// One question after an answer has already been delivered: does this exchange
// contain something worth remembering? Nothing is stored here. The route
// proposes, the user accepts, and the browser writes through the same guarded
// path a typed memory takes — so a suggestion can never become a memory the
// user did not approve, and this endpoint has no write side at all.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The caller waits on this in the background, but it should still be brief.
export const maxDuration = 20;

interface SuggestRequestBody {
  userText?: unknown;
  answer?: unknown;
  memories?: unknown;
}

/** Long enough to carry a real paragraph, short enough to bound the cost. */
const MAX_USER_TEXT = 4000;

export async function POST(req: NextRequest): Promise<Response> {
  let body: SuggestRequestBody;
  try {
    body = (await req.json()) as SuggestRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userText = typeof body.userText === "string" ? body.userText.trim().slice(0, MAX_USER_TEXT) : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (userText.length < 12 || !answer) {
    return Response.json({ suggestions: [] });
  }

  // The same administrator controls as chat. Memory is not a side door into a
  // deployment that has been paused, so it honours the kill switch and the
  // maintenance notice rather than only the rate limit.
  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);
  const config = await readConfig();

  if (config.maintenanceEnabled && !isAdmin(identity)) {
    return Response.json({ suggestions: [] });
  }
  if (!config.chatEnabled) {
    return Response.json({ suggestions: [] });
  }
  // A separate bucket from chat on purpose. Sharing one means every suggestion
  // request silently spends a message's allowance and a heavy user starts
  // seeing "too many messages at once" for reasons that have nothing to do with
  // how many messages they sent.
  const limit = checkRateLimit(req, identity, 20, "memory");
  if (!limit.allowed) {
    return Response.json({ suggestions: [] });
  }
  const gate = identityGate(identity, config, 0);
  if (!gate.allowed) {
    return Response.json({ suggestions: [] });
  }

  const existing = Array.isArray(body.memories) ? (body.memories as Memory[]) : [];

  try {
    const raw = await extractMemories({ userText, answer, signal: req.signal });
    // Parsed here as well as in the browser: this is the untrusted edge, and
    // the text is going to sit in the system prompt on every later request, so
    // the guard runs before it is ever handed out.
    const suggestions = parseSuggestions(raw, existing);
    return Response.json({ suggestions });
  } catch {
    // No model, no quota, no route. The absence of suggestions is the correct
    // answer to every one of those, and an error here would interrupt a
    // conversation the user already finished.
    return Response.json({ suggestions: [] });
  }
}