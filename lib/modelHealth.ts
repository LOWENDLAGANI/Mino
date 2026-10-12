// ── Mino model health checks (server only) ───────────────────────────────────
// Asks one configured model to return a fixed test message, so an administrator
// can see, per model, whether it is reachable and actually answering — rather
// than inferring it from a chat that fell over.
//
// Two rules shape everything here:
//
//   1. No provider name, wire model id, endpoint, or key may leave this module.
//      The admin panel is browser code, so what it receives is an opaque id and
//      a Mino name. The id is a hash of the wire model, which is stable across
//      restarts (so a stored id still resolves after a deploy) and carries
//      nothing readable.
//   2. A probe is a real request, so it is a real cost. The prompt is tiny, the
//      reply is capped, and the whole call is bounded by a timeout, because a
//      hanging model must report as offline rather than leave the button
//      spinning forever.

import { createHash } from "node:crypto";
import { getModelDisplayName } from "./models";
import { toMinoName } from "./modelEngines";
import { getProviders, type ProviderConfig } from "./providers";
import { probeSpace } from "./gradioSpace";
import { mentionsProvider, sanitizeIdentity } from "./identity";

export type ModelRole = "auto" | "version" | "backup";

export interface ModelTarget {
  /** Opaque, stable handle the panel sends back to run a check. */
  id: string;
  /** The Mino name. Never a provider name, never a wire model id. */
  name: string;
  role: ModelRole;
}

export interface ProbeResult extends ModelTarget {
  ok: boolean;
  /** Round-trip time in milliseconds, measured around the provider call. */
  ms: number;
  /** The model's own words, scrubbed, so a human can confirm it really replied. */
  reply: string;
  /** Why the check failed, in Mino's language. Empty when it succeeded. */
  error: string;
}

/** The exact words a model is asked to return, so replies are comparable. */
export const PROBE_PROMPT = "Reply with exactly this and nothing else: Mino online";

/** How long a single model may take before it is treated as unreachable. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * Enough room for the test message and a model's reasoning.
 *
 * A tight cap is actively harmful here: a reasoning model spends part of the
 * budget thinking before it writes anything, so a 64-token cap made healthy
 * models return an empty answer and look broken. It must still be a cap — the
 * check is a fixed question with a fixed answer, and nothing should be able to
 * turn it into a long generation.
 */
const PROBE_MAX_TOKENS = 512;

/** What each status actually means, in the words an administrator acts on. */
const STATUS_REASON: Record<number, string> = {
  400: "The request was rejected as invalid.",
  401: "The key was refused.",
  402: "The account is out of credit.",
  403: "The key is not allowed to use this model.",
  404: "The provider no longer offers this model.",
  408: "The provider took too long.",
  429: "Rate limited or out of quota.",
  500: "The provider reported an internal error.",
  502: "The provider could not be reached.",
  503: "The model has no capacity right now.",
  504: "The provider timed out.",
};

/**
 * The provider's own error sentence, if it is worth showing.
 *
 * A raw provider body is machine output: JSON, escaped quotes, stack-trace
 * tails, and documentation URLs. Pasting that into a status panel makes the
 * panel unreadable and buries the one fact that matters. A short plain sentence
 * that names no provider is kept, because "check your plan and billing" is
 * exactly the kind of thing that saves a trip to the provider's dashboard.
 */
export function providerDetail(body: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const nested = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    message = nested || parsed.message || "";
  } catch {
    message = body;
  }

  const cleaned = message
    // A documentation URL adds nothing here and survives scrubbing as a broken
    // half-URL, so it is removed rather than rewritten.
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`"'{}[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || mentionsProvider(cleaned)) return "";
  // Only the first sentence. A provider error trails a paragraph of advice
  // about where to read more, and a status line is not a place for it.
  const first = cleaned.split(/(?<=[.!?])\s/)[0] ?? cleaned;
  const trimmed = first.replace(/[.\s]+$/, "");
  return trimmed.length > 160 ? "" : trimmed;
}

/**
 * One sentence saying why a check failed.
 *
 * The status leads, because the status is what the administrator's next step
 * hangs off, and the provider's own wording is appended only when it adds
 * something the status does not already say.
 */
export function describeFailure(status: number, body: string): string {
  const reason = STATUS_REASON[status] ?? "The request failed.";
  const detail = providerDetail(body);
  return detail ? `${reason} ${detail}.` : `${reason} (HTTP ${status})`;
}

/**
 * A short, stable, non-reversible handle for one wire model.
 *
 * A hash rather than the model id itself: the id is what must never reach a
 * browser, and an index into an array would move the moment a key is added or
 * removed, so a result shown against the wrong row would be worse than none.
 */
export function modelTargetId(model: string): string {
  return createHash("sha256").update(model).digest("hex").slice(0, 12);
}

/** Every model this deployment can currently reach, in the order it prefers them. */
export function listModelTargets(): ModelTarget[] {
  const targets: ModelTarget[] = [];
  let backups = 0;
  for (const provider of getProviders("auto")) {
    if (provider.family === "groq") {
      // The last-resort models all present to users as plain "Mino", so a list
      // of identical names would be unreadable and untestable one by one. They
      // are numbered in the order the chat route would fall back through them.
      backups += 1;
      targets.push({ id: modelTargetId(provider.model), name: `Mino Backup ${backups}`, role: "backup" });
      continue;
    }
    if (provider.family === "space") {
      targets.push({ id: modelTargetId(provider.model), name: "Mino Azure", role: "backup" });
      continue;
    }
    targets.push({
      id: modelTargetId(provider.model),
      name: getModelDisplayName(toMinoName(provider.model)),
      role: provider.family === "openrouter" ? "auto" : "version",
    });
  }
  return targets;
}

/** Resolves an opaque id back to the provider that serves it, or null. */
function findProvider(id: string): ProviderConfig | null {
  // Both mode lists are searched so an id from either resolves. In practice
  // "auto" is a superset of "code", but a model being reachable from only one
  // mode is exactly the sort of thing this panel exists to reveal.
  for (const mode of ["auto", "code", "self"] as const) {
    const match = getProviders(mode).find((provider) => modelTargetId(provider.model) === id);
    if (match) return match;
  }
  return null;
}

/** The name shown next to a row, for a model the panel knows how to name. */
function nameFor(provider: ProviderConfig, backups: Map<string, number>): ModelTarget {
  if (provider.family === "groq") {
    const index = (backups.get(provider.family) ?? 0) + 1;
    backups.set(provider.family, index);
    return { id: modelTargetId(provider.model), name: `Mino Backup ${index}`, role: "backup" };
  }
  if (provider.family === "space") {
    return { id: modelTargetId(provider.model), name: "Mino Azure", role: "backup" };
  }
  return {
    id: modelTargetId(provider.model),
    name: getModelDisplayName(toMinoName(provider.model)),
    role: provider.family === "openrouter" ? "auto" : "version",
  };
}

/**
 * Asks one model for the test message and reports what came back.
 *
 * Never throws: an unreachable model is a result, not an exception, because the
 * panel's job is to render the failure rather than propagate it.
 */
export async function probeModel(id: string, signal?: AbortSignal): Promise<ProbeResult> {
  const provider = findProvider(id);
  if (!provider) {
    return {
      id,
      name: "Mino",
      role: "version",
      ok: false,
      ms: 0,
      reply: "",
      error: "That model is not configured on this deployment.",
    };
  }

  const target = nameFor(provider, new Map());
  const startedAt = Date.now();
  // A model that never answers must still be reported, so the request is
  // bounded independently of whether the browser is still waiting.
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // `stream_options` only has meaning on a streamed response, and some providers
  // reject it outright on a non-streamed one, so it is dropped here rather than
  // making this check fail for a reason that has nothing to do with the model.
  const { stream_options: _streamOptions, ...extraBody } = provider.extraBody ?? {};

  try {
    // Mino's own model is not an OpenAI-compatible endpoint, so it is probed
    // through the Space adapter instead of being fetched. The adapter returns
    // the same SSE shape, so the parsing below is unchanged.
    if (provider.family === "space") {
      const reply = sanitizeIdentity((await probeSpace(abort)).trim());
      return reply
        ? { ...target, ok: true, ms: Date.now() - startedAt, reply: reply.slice(0, 120), error: "" }
        : { ...target, ok: false, ms: Date.now() - startedAt, reply: "", error: "Mino Azure returned an empty answer." };
    }

    const response = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
        ...provider.headers,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          // A minimal system prompt keeps the reply to the test message. The
          // full Mino persona is not used: this checks the plumbing, not the
          // product, and a persona that insists on a preamble would make every
          // model look like it failed.
          { role: "system", content: "You are running a connectivity check. Follow the instruction exactly." },
          { role: "user", content: PROBE_PROMPT },
        ],
        stream: false,
        max_tokens: PROBE_MAX_TOKENS,
        ...extraBody,
      }),
      signal: abort,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ...target,
        ok: false,
        ms: Date.now() - startedAt,
        reply: "",
        error: describeFailure(response.status, detail),
      };
    }

    const payload = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
    } | null;
    const choice = payload?.choices?.[0];
    const reply = sanitizeIdentity((choice?.message?.content ?? "").trim());

    if (!reply) {
      // An empty answer has two very different causes, and they point at
      // different places. One is a model that spent the whole budget thinking
      // and never got to the answer; the other is a model that simply replied
      // with nothing. Reporting them the same way sends the administrator
      // looking in the wrong place entirely.
      const ranOut = choice?.finish_reason === "length";
      return {
        ...target,
        ok: false,
        ms: Date.now() - startedAt,
        reply: "",
        error: ranOut
          ? "It used the whole answer budget thinking, and returned nothing."
          : "It answered with no text.",
      };
    }

    return {
      ...target,
      ok: true,
      ms: Date.now() - startedAt,
      reply,
      error: "",
      // A reply to a fixed two-word question is either the answer or nothing,
      // so there is nothing here to flag as cut short. Reporting a complete
      // reply as "stopped at the length limit" trains an administrator to
      // ignore the flag that matters in the chat.
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // A timeout is the common case and deserves its own words: "offline" and
    // "took too long" lead the administrator to different places.
    const timedOut = timeout.aborted;
    return {
      ...target,
      ok: false,
      ms: Date.now() - startedAt,
      reply: "",
      error: timedOut
        ? `No answer within ${Math.round(PROBE_TIMEOUT_MS / 1000)}s.`
        : `Could not be reached: ${providerDetail(message) || "the connection failed."}`,
    };
  }
}
