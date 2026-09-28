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
import { sanitizeIdentity, sanitizeProviderDetail } from "./identity";

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
  /** Set when the model answered but stopped at its own output limit. */
  truncated: boolean;
}

/** The exact words a model is asked to return, so replies are comparable. */
export const PROBE_PROMPT = "Reply with exactly this and nothing else: Mino online";

/** How long a single model may take before it is treated as unreachable. */
const PROBE_TIMEOUT_MS = 20_000;

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
  for (const mode of ["auto", "code"] as const) {
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
      truncated: false,
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
        max_tokens: 64,
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
        error: `Rejected the request (HTTP ${response.status})${detail ? `: ${sanitizeProviderDetail(detail.slice(0, 200))}` : "."}`,
        truncated: false,
      };
    }

    const payload = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
    } | null;
    const choice = payload?.choices?.[0];
    const reply = sanitizeIdentity((choice?.message?.content ?? "").trim());

    if (!reply) {
      return {
        ...target,
        ok: false,
        ms: Date.now() - startedAt,
        reply: "",
        error: "Answered with no text.",
        truncated: false,
      };
    }

    return {
      ...target,
      ok: true,
      ms: Date.now() - startedAt,
      reply,
      error: "",
      truncated: choice?.finish_reason === "length",
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
        : `Could not be reached: ${sanitizeProviderDetail(message)}`,
      truncated: false,
    };
  }
}
