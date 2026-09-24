import { NextRequest } from "next/server";
import { MINO_SYSTEM_PROMPT } from "@/lib/db";
import type { ApiMessage } from "@/lib/types";
import { getMode, type ModeId } from "@/lib/models";

// ── Mino — resilient SSE proxy for Auto and Dev ─────────────────────────────
//   OPENROUTER_API_KEY → OpenRouter Auto Router
//   GEMINI_API_KEY     → Google Gemini 3.8 Flash
//
// If the requested provider is unavailable, Mino automatically tries the other
// configured key. This keeps a single model outage, quota issue, or temporarily
// unavailable endpoint from breaking the chat.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ProviderConfig {
  id: ModeId;
  label: string;
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

interface ChatRequestBody {
  messages: ApiMessage[];
  mode?: string;
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

function getProviders(requested: ModeId): ProviderConfig[] {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();

  const openrouter: ProviderConfig | null = openrouterKey
    ? {
        id: "auto",
        label: "OpenRouter Auto",
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: openrouterKey,
        model: getMode("auto").engine,
        headers: {
          "HTTP-Referer": "https://mino-ai.vercel.app",
          "X-Title": "Mino",
        },
        extraBody: {
          provider: { allow_fallbacks: true },
          stream_options: { include_usage: true },
        },
      }
    : null;

  const gemini: ProviderConfig | null = geminiKey
    ? {
        id: "dev",
        label: "Gemini 3.8 Flash",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: geminiKey,
        model: getMode("dev").engine,
        // Google documents low reasoning for the OpenAI-compatible Gemini 3 API.
        // It reduces latency while preserving the model's coding capability.
        extraBody: { reasoning_effort: "low" },
      }
    : null;

  if (requested === "dev") {
    return [gemini, openrouter].filter((provider): provider is ProviderConfig => provider !== null);
  }
  return [openrouter, gemini].filter((provider): provider is ProviderConfig => provider !== null);
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

function extractUpstreamError(detail: string): string {
  if (!detail) return "The provider did not return an error message.";

  try {
    const parsed = JSON.parse(detail) as {
      error?: { message?: string; code?: string | number } | string;
      message?: string;
    };
    const nested = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    const message = nested || parsed.message;
    if (message) return message.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    // Some gateways return HTML or plain text. Keep only a short, safe excerpt.
  }

  return detail.replace(/\s+/g, " ").trim().slice(0, 300) || "The provider did not return an error message.";
}

function explainProviderError(error: unknown): string {
  if (!(error instanceof ProviderError)) {
    return "Mino could not reach either AI service. Check your network connection and try again.";
  }

  const { provider, status } = error;
  const detail = extractUpstreamError(error.message);

  if (status === 400) {
    return `${provider.label} rejected the request (HTTP 400): ${detail} Check that the key belongs to ${provider.label === "Gemini 3.8 Flash" ? "Google AI Studio" : "OpenRouter"}.`;
  }
  if (status === 401 || status === 403) {
    return `${provider.label} rejected this key (HTTP ${status}). Make sure ${provider.label === "Gemini 3.8 Flash" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"} contains a valid key for this provider.`;
  }
  if (status === 402) {
    return `${provider.label} needs account credit before it can answer. Add credit or use the other configured mode.`;
  }
  if (status === 404) {
    return `${provider.label} could not find the configured model or endpoint (HTTP 404): ${detail}`;
  }
  if (status === 429) {
    return `${provider.label} is rate-limited or out of quota (HTTP 429). Wait a moment, update billing, or use the other configured mode.`;
  }
  if (status >= 500) {
    return `${provider.label} is temporarily unavailable (HTTP ${status}). Please try again shortly.`;
  }

  return `${provider.label} failed (HTTP ${status}): ${detail}`;
}

async function callProvider(
  provider: ProviderConfig,
  messages: ApiMessage[],
  signal: AbortSignal
): Promise<Response> {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key}`,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...provider.headers,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "system", content: MINO_SYSTEM_PROMPT }, ...messages],
      stream: true,
      ...provider.extraBody,
    }),
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

  const requested: ModeId = body.mode === "dev" ? "dev" : "auto";
  const providers = getProviders(requested);

  if (providers.length === 0) {
    return textStream(
      "**Mino isn't connected to a model yet.** Add `OPENROUTER_API_KEY` for Auto or `GEMINI_API_KEY` for Dev in the Vercel deployment environment. Your conversations are already saved safely on this device."
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

  let upstream: Response | null = null;
  let activeProvider: ProviderConfig | null = null;
  const failures: unknown[] = [];

  // Retry with the other configured provider on network errors and pre-stream
  // HTTP failures. The first response body that succeeds is streamed untouched.
  for (const provider of providers) {
    try {
      upstream = await callProvider(provider, messages, req.signal);
      activeProvider = provider;
      break;
    } catch (error) {
      if (req.signal.aborted) throw error;
      failures.push(error);
    }
  }

  if (!upstream || !activeProvider) {
    const first = explainProviderError(failures[0]);
    if (failures.length > 1) {
      return errorStream(
        `${first} Mino also tried the other configured provider: ${explainProviderError(failures[1])}`
      );
    }
    return errorStream(first);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // callProvider guarantees a non-null body before returning a successful response.
  const providerBody = upstream.body!;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encodeEvent({ mode: activeProvider!.id, provider: activeProvider!.label }));
      const reader = providerBody.getReader();
      let buffer = "";

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
            }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            error?: { message?: string } | string;
          };
          const upstreamError =
            typeof chunk.error === "string" ? chunk.error : chunk.error?.message;
          if (upstreamError) {
            controller.enqueue(encodeEvent({ error: `${activeProvider!.label}: ${upstreamError}` }));
            return;
          }

          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encodeEvent({ content: delta }));

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
          encodeEvent({ error: `${activeProvider!.label} stream interrupted: ${message}` })
        );
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        reader.releaseLock();
        controller.close();
      }
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
  if (process.env.GEMINI_API_KEY?.trim()) available.push("dev");
  return Response.json({ available });
}
