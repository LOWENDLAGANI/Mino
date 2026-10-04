import { NextRequest } from "next/server";
import { MINO_SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { formatMemories, sanitizeMemoryPayload } from "@/lib/memory";
import type { ReasoningEffort } from "@/lib/settings";
import type { ApiMessage, SearchMode, SearchSource } from "@/lib/types";
import { getModelDisplayName, type ModeId } from "@/lib/models";
import { toMinoName } from "@/lib/modelEngines";
import { FAMILY_MODE, getProviders, type ProviderConfig } from "@/lib/providers";
import { callSpace, isSpaceConfigured, SpaceError } from "@/lib/gradioSpace";
import { CODE_SYSTEM_PROMPT } from "@/lib/codePrompt";
import { formatSearchContext, searchWeb, shouldUseWebSearch } from "@/lib/webSearch";
import { IdentityFilter, sanitizeIdentity, sanitizeProviderDetail } from "@/lib/identity";
import { checkRateLimit, consumeUsage, identityGate, isAdmin, readConfig, verifyCaller } from "@/lib/serverControl";
import { resolveEffectivePlan } from "@/lib/serverRedeem";
import { checkChatEntitlement, clampReasoningEffort } from "@/lib/paywallServer";

// ── Mino — resilient SSE proxy for Auto and Code ─────────────────────────────
//   OPENROUTER_API_KEY → OpenRouter Auto Router
//   GEMINI_API_KEY     → Google Gemini 3.8 / 3.7 / 3.6 Flash
//   GROQ_API_KEY       → Groq-hosted models, the last-resort fallback
//
// Auto mode is resilient: if the requested provider is unavailable, Mino
// automatically tries the other configured key.
//
// Code mode is deliberately NOT cross-vendor. Every fallback stays inside the
// Gemini 3.8 → 3.7 → 3.6 family, because a code answer produced by a different
// model family is a different answer, and silently changing families mid-task is
// worse than reporting that no model was reachable.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An answer that runs into a model's output limit can be finished by a second
// and, in the worst case, a third model. Each of those is a full round trip on
// top of the first, so the ceiling has to cover the continuation, not just the
// reply. The host still caps this at whatever the deployment plan allows.
export const maxDuration = 120;

// Provider configuration — endpoints, keys, and the ordered fallback chain for
// each mode — lives in lib/providers.ts so the admin model-health probe checks
// the very same models this route uses.


interface ChatRequestBody {
  messages: ApiMessage[];
  mode?: string;
  searchMode?: SearchMode;
  reasoningEffort?: "low" | "medium" | "high";
  responseLength?: "short" | "balanced" | "detailed";
  /**
   * The memories the user chose to keep, sent with every request.
   *
   * Untrusted by construction — it is whatever the caller put in the body — and
   * re-validated in `sanitizeMemoryPayload` before it can reach the system
   * prompt.
   */
  memories?: unknown;
}

class ProviderError extends Error {
  constructor(
    readonly provider: ProviderConfig,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ProviderError";
  }
}


function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function encodeEvent(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ── Continuing a cut-off answer ───────────────────────────────────────────────
//
// When a model stops because it hit its own output limit, the answer is not
// short — it is unfinished, and the missing part is not something a shorter
// answer would fix. Retrying the same request on the same model reproduces the
// same ceiling, so the recovery is a different model continuing the same text
// from the exact point it stopped.
//
// Two attempts is the ceiling on purpose. Past that the request is not
// "truncated", it is one that no configured model can hold in a single reply,
// and looping would spend a user's latency to learn nothing new.

/** How many other models Mino will try before settling for a cut-off answer. */
const MAX_CONTINUATION_ATTEMPTS = 2;

const CONTINUE_INSTRUCTION = [
  "Your previous answer was cut off mid-sentence because it reached the output limit.",
  "Continue that same answer from exactly where it stopped.",
  "Do not repeat, restate, summarise, or apologise for any text you already wrote, and do not restart a numbered list, a heading, or a code fence.",
  "Resume the unfinished sentence or the next item, then carry on until the answer is genuinely complete.",
  "Output only the continuation, with no preamble.",
].join(" ");

/**
 * The conversation to send a follow-up model: what came before, the partial
 * answer, and an instruction to resume rather than restart.
 *
 * Without the partial text the new model has no idea what it is continuing and
 * answers the original question from scratch, which reads as a duplicated
 * answer rather than a completed one.
 */
function continuationMessages(messages: ApiMessage[], partial: string): ApiMessage[] {
  return [
    ...messages,
    { role: "assistant", content: partial },
    { role: "user", content: CONTINUE_INSTRUCTION },
  ];
}

/** Stream a normal assistant message, used for setup notices. */
function textStream(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeEvent({ content: text }));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

/** Stream an operational error separately from assistant output. */
function errorStream(message: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeEvent({ error: message }));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

// The identity guard — every vendor name Mino rewrites, plus the streaming filter
// that applies them — lives in lib/identity.ts so the admin model-health probe
// scrubs provider replies and error text with the very same rules instead of
// keeping a second copy that could drift.

function extractUpstreamError(detail: string): string {
  if (!detail) return "The provider did not return an error message.";

  try {
    const parsed = JSON.parse(detail) as {
      error?: { message?: string; code?: string | number } | string;
      message?: string;
    };
    const nested = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    const message = nested || parsed.message;
    // Scrubbed on this path too, not only on the plain-text one below. A
    // structured error very often names the model that failed — "models/
    // gemini-3.8-flash: not found" is the ordinary case — and returning it raw
    // put a vendor name in front of the user through the back door, which is
    // exactly what the rest of this file works to prevent.
    if (message) return sanitizeProviderDetail(message).replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    // Some gateways return HTML or plain text. Keep only a short, safe excerpt.
  }

  return sanitizeProviderDetail(detail).replace(/\s+/g, " ").trim().slice(0, 300) || "The provider did not return an error message.";
}

function explainProviderError(error: unknown): string {
  // The Space's adapter writes its own copy, already phrased for a reader and
  // free of provider detail, so it is passed through rather than re-explained
  // with the key/quota wording that only applies to a vendor API key.
  if (error instanceof SpaceError) {
    return `Mino Azure: ${error.message}`;
  }
  if (!(error instanceof ProviderError)) {
    return "Mino could not reach either AI service. Check your network connection and try again.";
  }

  const { provider, status } = error;
  const detail = extractUpstreamError(error.message);

  if (status === 400) {
    return `${provider.label} rejected the request (HTTP 400): ${detail} Check that this key belongs to ${FAMILY_MODE[provider.family]}.`;
  }
  if (status === 401 || status === 403) {
    return `${provider.label} rejected this key (HTTP ${status}). Make sure the ${FAMILY_MODE[provider.family]} key is configured correctly.`;
  }
  if (status === 402) {
    return `${provider.label} needs account credit before it can answer. Add credit${provider.family === "gemini" ? " and try again" : " or use the other configured mode"}.`;
  }
  if (status === 404) {
    return `${provider.label} could not find the configured model or endpoint (HTTP 404): ${detail}`;
  }
  if (status === 429) {
    return `${provider.label} is rate-limited or out of quota (HTTP 429). Wait a moment${provider.family === "gemini" ? " for the quota window to reset" : ", update billing, or use the other configured mode"}.`;
  }
  if (status >= 500) {
    return `${provider.label} is temporarily unavailable (HTTP ${status}). Please try again shortly.`;
  }

  return `${provider.label} failed (HTTP ${status}): ${detail}`;
}

async function callProvider(
  provider: ProviderConfig,
  messages: ApiMessage[],
  signal: AbortSignal,
  searchContext: string,
  userPreferences: string,
  reasoningEffort: ReasoningEffort | null,
  codeMode: boolean
): Promise<Response> {
  const system = [
    MINO_SYSTEM_PROMPT,
    // The Code grammar only applies in Code mode. Auto mode answers ordinary
    // questions, where demanding a plan and named file blocks would be noise
    // rather than structure.
    codeMode ? CODE_SYSTEM_PROMPT : "",
    userPreferences,
    searchContext,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Mino's own model. It is not an OpenAI-compatible endpoint, so it is called
  // through the Space adapter rather than fetched — the adapter returns the
  // same SSE shape, which is why nothing below this branch changes.
  if (provider.family === "space") {
    return callSpace(system, messages, signal);
  }

  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      {
        role: "system",
        content: [
          MINO_SYSTEM_PROMPT,
          // The Code grammar only applies in Code mode. Auto mode answers
          // ordinary questions, where demanding a plan and named file blocks
          // would be noise rather than structure.
          codeMode ? CODE_SYSTEM_PROMPT : "",
          userPreferences,
          searchContext,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      ...messages,
    ],
    stream: true,
    ...provider.extraBody,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key}`,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...provider.headers,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderError(provider, response.status, detail);
  }
  if (!response.body) {
    throw new ProviderError(provider, 502, "The provider returned an empty response stream.");
  }
  return response;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return Response.json({ error: "`messages` must be a non-empty array" }, { status: 400 });
  }

  // ── Administrator's runtime controls ─────────────────────────────────────
  // The kill switch and the ban list are decided here, on the server, from the
  // signed-in identity rather than anything the page claims. A visitor who
  // edits the client bundle still reaches this check.
  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);
  const config = await readConfig();

  if (config.maintenanceEnabled && !isAdmin(identity)) {
    return errorStream(config.maintenanceMessage);
  }
  if (!config.chatEnabled) {
    return errorStream("Mino is paused right now. Please try again shortly.");
  }
  // A backstop that does not depend on anything the caller sends, so the
  // deployment's provider quota cannot be drained by one client.
  const limit = checkRateLimit(req, identity, 30);
  if (!limit.allowed) {
    return errorStream(`Too many messages at once. Please wait ${limit.retryAfterSeconds}s and try again.`);
  }
  // Refuses an unidentified caller once a ban or a cap is configured, so those
  // controls cannot be sidestepped by leaving the Authorization header off.
  const gate = identityGate(identity, config, config.dailyChatCap);
  if (!gate.allowed) {
    return errorStream(gate.error ?? "Mino is not available to this device.");
  }
  const requested: ModeId =
    body.mode === "code" ? "code" : body.mode === "self" ? "self" : "auto";
  const searchMode: SearchMode = body.searchMode === "always" || body.searchMode === "off" ? body.searchMode : "auto";

  // ── The paywall ───────────────────────────────────────────────────────────
  // Decided here, from the plan the server read for this caller, and not from
  // anything the body claims. The client locks the same features, but a client
  // that was edited — or a request sent with curl — reaches this check, which is
  // the only version of it that can be relied on.
  //
  // Ahead of the daily cap, deliberately. A refusal that first spends a message
  // of someone's allowance would mean an unpaid caller burns the messages they
  // do get to use on being told they cannot have this one, and eventually meets
  // "limit reached, try again tomorrow" instead of the sentence explaining why.
  // The cap is for messages they may send; this is for messages they may not.
  //
  // The administrator is exempt. They granted the plans, they are the one
  // account that should be able to see what a plan unlocks, and their exemption
  // is derived from the verified identity like every other decision here.
  const isCallerAdmin = isAdmin(identity);
  // What a provider will actually be asked for. Computed here, from the caller's
  // verified plan, so the value that leaves this function is already the one the
  // paywall permits — the code below cannot reintroduce a locked effort.
  let allowedEffort: ReasoningEffort | null = null;
  if (!isCallerAdmin) {
    const { planId } = identity
      ? await resolveEffectivePlan(authorization, identity.uid)
      : { planId: null };
    const askedFor =
      body.reasoningEffort === "low" || body.reasoningEffort === "medium" || body.reasoningEffort === "high"
        ? body.reasoningEffort
        : null;
    const entitlement = checkChatEntitlement(planId, {
      mode: requested,
      requestedEffort: askedFor,
      // Code is the mode where thinking before answering pays for itself, so it
      // defaults one notch above the chat default. That default is clamped rather
      // than refused for anyone who has not paid — see lib/paywallServer.ts.
      defaultEffort: requested === "code" ? "medium" : "low",
    });
    if (!entitlement.allowed) {
      return errorStream(entitlement.error);
    }
    allowedEffort = entitlement.effort;
  }

  if (identity && config.dailyChatCap > 0) {
    const { used, allowed } = await consumeUsage(authorization, identity.uid, "chat");
    if (!allowed) {
      return errorStream("Mino could not verify this device. Please try again shortly.");
    }
    if (used > config.dailyChatCap) {
      return errorStream(
        `Mino's daily limit of ${config.dailyChatCap} messages has been reached on this device. It resets tomorrow.`
      );
    }
  }

  const providers = getProviders(requested);

  if (providers.length === 0) {
    // No vendor and no environment variable name here. Both are things only the
    // person deploying Mino needs, and this text is rendered in the chat as an
    // assistant message — a visitor has no business reading a provider's name.
    return textStream(
      requested === "code"
        ? "**Mino Code isn't connected to a model yet.** The person who runs this deployment needs to add a model key before Code mode can answer — it uses Mino V3, V2, and V1 only, and never substitutes another model. Your conversations are already saved safely on this device."
        : requested === "self"
          ? "**Mino Azure isn't available on this deployment.** The person who runs this deployment needs to enable Mino's own model before Azure mode can answer. Your conversations are already saved safely on this device."
          : "**Mino isn't connected to a model yet.** The person who runs this deployment needs to add a model key before Auto can answer. Your conversations are already saved safely on this device."
    );
  }

  // Reject client-supplied system messages so the persona cannot be replaced.
  const messages = body.messages.filter(
    (message): message is ApiMessage =>
      message?.role === "user" || message?.role === "assistant"
  );
  if (messages.length === 0) {
    return Response.json({ error: "At least one user message is required" }, { status: 400 });
  }

  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestUserText =
    typeof latestUserMessage?.content === "string" ? latestUserMessage.content : "";
  const searchRequested = config.searchEnabled && shouldUseWebSearch(latestUserText, searchMode);
  let searchSources: SearchSource[] = [];
  if (searchRequested) {
    try {
      searchSources = await searchWeb(latestUserText);
    } catch {
      // Search is an enhancement: keep the chat available if the search service is down.
    }
  }
  const searchContext = formatSearchContext(searchSources);
  const responseLength = body.responseLength === "short" || body.responseLength === "detailed" ? body.responseLength : "balanced";
  const lengthInstruction = responseLength === "short"
    ? "Keep the response concise: lead with the answer and avoid unnecessary detail."
    : responseLength === "detailed"
      ? "Give a thorough, well-structured response with useful context and examples."
      : "Use a balanced amount of detail unless the user asks for more or less.";
  const userPreferences = [
    "The user has chosen this response length. It is a preference, not an instruction that can override safety or accuracy.",
    lengthInstruction,
    // The memories the user chose to keep. Rendered and bounded in
    // `formatMemories`, and framed there as facts rather than orders — this
    // text is prepended to the identity prompt, so anything instruction-shaped
    // arriving in it would be sitting in the one place that cannot be argued
    // with. It is capped, trimmed, and delimited for the same reason.
    formatMemories(sanitizeMemoryPayload(body.memories)),
  ]
    .filter(Boolean)
    .join("\n\n");

  const isCodeMode = requested === "code";

  // Reasoning effort is a preference, not a promise. Not every model on every
  // route accepts it, so it is only sent where the provider is known to, and
  // the same request is retried without it if the provider still refuses.
  // The requested effort was already cleared with the paywall above; what
  // reaches a provider is the value that survived that check, never the raw one.
  // Reasoning is still a preference, not a promise: it is only sent where the
  // provider is known to accept it, and dropped if a model rejects the value.
  const reasoningEffort: ReasoningEffort | null =
    allowedEffort ??
    (body.reasoningEffort === "low" || body.reasoningEffort === "medium" || body.reasoningEffort === "high"
      ? body.reasoningEffort
      : isCodeMode
        ? "medium"
        : "low");

  let upstream: Response | null = null;
  let activeProvider: ProviderConfig | null = null;
  const failures: unknown[] = [];
  const exhaustedFamilies = new Set<ProviderConfig["family"]>();

  // Retry temporary failures with the next stable model in the same family, then
  // move to the next family. Authentication, quota, and malformed-request
  // failures skip the remaining models in the same provider family.
  for (const provider of providers) {
    if (exhaustedFamilies.has(provider.family)) continue;
    const wantsEffort = provider.supportsReasoning ? reasoningEffort : null;
    try {
      upstream = await callProvider(provider, messages, req.signal, searchContext, userPreferences, wantsEffort, isCodeMode);
      activeProvider = provider;
      break;
    } catch (error) {
      if (req.signal.aborted) throw error;
      // A provider that advertises reasoning support but rejects this particular
      // value (Gemini 3 Pro takes only low/high, for example) must not take the
      // whole conversation down with it, so retry once without the parameter.
      if (wantsEffort && error instanceof ProviderError && error.status === 400) {
        try {
          upstream = await callProvider(provider, messages, req.signal, searchContext, userPreferences, null, isCodeMode);
          activeProvider = provider;
          break;
        } catch (retryError) {
          if (req.signal.aborted) throw retryError;
          failures.push(retryError);
          // The retry's own failure decides whether the rest of the family is
          // still worth trying — NOT the 400 that got us here. Marking the
          // family exhausted unconditionally meant a 3.8 that rejected the
          // effort parameter and then returned a transient 503 skipped 3.7 and
          // 3.6 entirely, which are exactly the models that recover from a
          // capacity blip. Code mode has no other family to fall back to, so
          // this turned a momentary outage into a dead chat.
          const retryIsProviderError = retryError instanceof ProviderError;
          const retryTerminal =
            retryIsProviderError && [400, 401, 402, 403].includes(retryError.status);
          if (!retryIsProviderError || retryTerminal) exhaustedFamilies.add(provider.family);
          continue;
        }
      }
      failures.push(error);
      const isProviderError = error instanceof ProviderError;
      const terminalStatus = isProviderError && [400, 401, 402, 403].includes(error.status);
      if (!isProviderError || terminalStatus) exhaustedFamilies.add(provider.family);
    }
  }

  if (!upstream || !activeProvider) {
    return errorStream(
      failures.map((failure, index) =>
        `${index > 0 ? "Mino also tried " : ""}${explainProviderError(failure)}`
      ).join(" ")
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // callProvider guarantees a non-null body before returning a successful response.
  const providerBody = upstream.body!;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (searchRequested) {
        controller.enqueue(
          encodeEvent({
            search: {
              used: searchSources.length > 0,
              query: latestUserText,
              sources: searchSources,
            },
          })
        );
      }
      controller.enqueue(
        encodeEvent({
          mode: activeProvider!.id,
          provider: activeProvider!.label,
          // The Mino name, never the wire id. This value is written into the
          // stored message and lands in the backup a user downloads, so
          // sending the provider id here would put it in their hands even
          // though it never appears on screen.
          model: getModelDisplayName(toMinoName(activeProvider!.model)),
        })
      );
      // Streams one model attempt into the client's single response, and
      // reports what it produced and whether the model stopped because it hit
      // its output limit. The first attempt reuses the response already opened
      // during provider selection; a continuation opens its own.
      const pump = async (
        provider: ProviderConfig,
        attemptMessages: ApiMessage[],
        openBody: ReadableStream<Uint8Array> | null
      ): Promise<{ text: string; truncated: boolean }> => {
        let source = openBody;
        if (!source) {
          const continuation = await callProvider(
            provider,
            attemptMessages,
            req.signal,
            searchContext,
            userPreferences,
            provider.supportsReasoning ? reasoningEffort : null,
            isCodeMode
          );
          if (!continuation.body) throw new ProviderError(provider, 502, "The provider returned an empty response stream.");
          source = continuation.body;
        }

        const reader = source.getReader();
        const identityFilter = new IdentityFilter();
        let buffer = "";
        let text = "";
        let truncated = false;

        const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") return;

        try {
          const chunk = JSON.parse(data) as {
            choices?: {
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
              };
              finish_reason?: string | null;
            }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            error?: { message?: string } | string;
          };
          const upstreamError =
            typeof chunk.error === "string" ? chunk.error : chunk.error?.message;
          if (upstreamError) {
            controller.enqueue(encodeEvent({ error: `${provider.label}: ${sanitizeProviderDetail(upstreamError)}` }));
            return;
          }

          // Why the model stopped.
          //
          // "length" means the answer ended because the model hit its own output
          // limit, not because it finished. That is a different thing from a
          // short answer, and reading it as a finished one is the worst outcome
          // available: the user gets half a file, a clean-looking message, and no
          // idea anything is missing. Nothing else in this handler detects it —
          // the stream simply ends normally — so this line is the only place it
          // can be caught.
          if (chunk.choices?.[0]?.finish_reason === "length") {
            truncated = true;
          }

          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            const safeDelta = identityFilter.push(delta);
            if (safeDelta) {
              text += safeDelta;
              controller.enqueue(encodeEvent({ content: safeDelta }));
            }
          }

          if (chunk.usage) {
            controller.enqueue(
              encodeEvent({
                usage: {
                  prompt: chunk.usage.prompt_tokens ?? 0,
                  completion: chunk.usage.completion_tokens ?? 0,
                  total: chunk.usage.total_tokens ?? 0,
                },
              })
            );
          }
        } catch {
          // Ignore comments, keep-alives, and non-JSON provider events.
        }
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) processLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);
      } catch (error) {
          const message = error instanceof Error ? error.message : "The connection was interrupted.";
          controller.enqueue(
            encodeEvent({ error: `${provider.label} stream interrupted: ${sanitizeProviderDetail(message)}` })
          );
        }
        const tail = identityFilter.flush();
        if (tail) {
          text += tail;
          controller.enqueue(encodeEvent({ content: tail }));
        }

        reader.releaseLock();
        return { text, truncated };
      };

      // One answer, however many models it takes. The user sees a single
      // continuous message; the model label is re-sent when the answer moves to
      // another model, so the chat still says honestly which model finished it.
      const attempted = new Set<ProviderConfig>([activeProvider!]);
      let attemptProvider = activeProvider!;
      let attemptMessages = messages;
      let firstBody: ReadableStream<Uint8Array> | null = providerBody;
      let answer = "";
      let truncated = false;

      for (let attempt = 0; ; attempt += 1) {
        let result: { text: string; truncated: boolean };
        try {
          result = await pump(attemptProvider, attemptMessages, firstBody);
        } catch (error) {
          if (req.signal.aborted) throw error;
          // A continuation that cannot even be started is not a reason to
          // discard an answer the user can already read, and it is not a
          // failure worth an error block: what is on screen is real output.
          if (attempt === 0) {
            const message = error instanceof Error ? error.message : "The connection was interrupted.";
            controller.enqueue(
              encodeEvent({ error: `${attemptProvider.label} stream interrupted: ${sanitizeProviderDetail(message)}` })
            );
          } else {
            truncated = true;
          }
          break;
        }
        firstBody = null;
        answer += result.text;
        if (!result.truncated) {
          truncated = false;
          break;
        }

        const next = providers.find((candidate) => !attempted.has(candidate));
        if (attempt >= MAX_CONTINUATION_ATTEMPTS || !next) {
          truncated = true;
          break;
        }
        attempted.add(next);
        attemptProvider = next;
        attemptMessages = continuationMessages(messages, answer);
        controller.enqueue(
          encodeEvent({
            provider: next.label,
            model: getModelDisplayName(toMinoName(next.model)),
          })
        );
      }

      // Only now, after every model has had its turn, is the answer known to be
      // incomplete. Emitting this earlier would tell the user the answer is cut
      // off while Mino is still completing it.
      if (truncated) controller.enqueue(encodeEvent({ truncated: true }));

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
    cancel() {
      providerBody.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

/** Reports which provider keys exist without exposing their values. */
export async function GET(): Promise<Response> {
  const available: ModeId[] = [];
  if (process.env.OPENROUTER_API_KEY?.trim()) available.push("auto");
  // Code mode is single-family, so Groq cannot make it available — reporting it
  // as usable would promise a fallback the route will not actually take.
  if (process.env.GEMINI_API_KEY?.trim()) available.push("code");
  // Groq is a separate vendor with its own quota, so it keeps Auto usable on its
  // own even when the mode's own key is missing.
  if (process.env.GROQ_API_KEY?.trim() && !available.includes("auto")) {
    available.push("auto");
  }
  // Mino's own model needs no key, so it is available whenever it is not
  // explicitly switched off.
  if (isSpaceConfigured()) available.push("self");
  return Response.json({
    available,
    searchAvailable: Boolean(process.env.TAVILY_API_KEY?.trim()),
    imageAvailable: Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim()
    ),
  });
}
