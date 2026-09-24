import { NextRequest } from "next/server";
import { MINO_SYSTEM_PROMPT } from "@/lib/db";
import type { ApiMessage } from "@/lib/types";
import { getMode, type ModeId } from "@/lib/models";

// ── Mino — SSE streaming proxy with two key slots ────────────────────────────
//   OPENROUTER_API_KEY → "auto" mode (universal OpenAI-compatible router)
//   GEMINI_API_KEY     → "dev"  mode (Google Gemini, OpenAI-compatible endpoint)
//
// Resilience rules:
//   • If the requested mode's key is missing, silently fall back to the other.
//   • If NO key is configured at all, the site still works: the API returns a
//     normal SSE stream containing a friendly setup notice (never a 500 page).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ProviderConfig {
  url: string;
  key: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

interface ChatRequestBody {
  messages: ApiMessage[];
  mode?: string;
}

function resolveProvider(requested: ModeId): { provider: ProviderConfig | null; activeMode: ModeId | null } {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Preferred provider for each mode.
  if (requested === "dev" && geminiKey) {
    return {
      activeMode: "dev",
      provider: {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: geminiKey,
        model: "gemini-2.0-flash",
      },
    };
  }
  if (requested === "auto" && openrouterKey) {
    return {
      activeMode: "auto",
      provider: {
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: openrouterKey,
        model: "openrouter/auto",
        extraHeaders: {
          "HTTP-Referer": "https://mino-ai.vercel.app",
          "X-Title": "Mino",
        },
      },
    };
  }

  // Fallbacks — a missing key should never break the chat.
  if (requested === "dev" && openrouterKey) {
    return {
      activeMode: "auto",
      provider: {
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: openrouterKey,
        model: "openrouter/auto",
        extraHeaders: {
          "HTTP-Referer": "https://mino-ai.vercel.app",
          "X-Title": "Mino",
        },
      },
    };
  }
  if (requested === "auto" && geminiKey) {
    return {
      activeMode: "dev",
      provider: {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: geminiKey,
        model: "gemini-2.0-flash",
      },
    };
  }

  return { provider: null, activeMode: null };
}

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

/** Stream a single plain-text message as a normal-looking SSE reply. */
function textStream(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders() });
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
  const { provider, activeMode } = resolveProvider(requested);

  // No keys at all → graceful in-chat notice instead of a broken site.
  if (!provider || !activeMode) {
    return textStream(
      "**Mino isn't connected to a model yet.**\n\nThe owner needs to add one of these keys in the deployment environment (e.g. Vercel → Settings → Environment Variables):\n\n- `OPENROUTER_API_KEY` — powers **Auto** mode\n- `GEMINI_API_KEY` — powers **Dev** mode\n\nOnce a key is added, everything works instantly — no code changes needed. Your conversations are already saved safely on this device."
    );
  }

  // Strict persona reinforcement on every request.
  const payload = {
    model: provider.model,
    messages: [{ role: "system", content: MINO_SYSTEM_PROMPT }, ...body.messages],
    stream: true,
  };

  let upstream: Response;
  try {
    upstream = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
        ...provider.extraHeaders,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return textStream(
      "**Mino couldn't reach the AI service.** Check the network connection and try again in a moment."
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = "";
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } | string };
      if (typeof parsed?.error === "string") message = parsed.error;
      else if (parsed?.error?.message) message = parsed.error.message;
    } catch {
      if (detail) message = detail.slice(0, 300);
    }
    // Auth/quota problems → friendly notice; the site stays usable.
    if (upstream.status === 401 || upstream.status === 403) {
      return textStream(
        "**The API key for this mode is invalid or lacks access.** The owner can update it in the deployment environment. Your other mode may still work — try switching in the header."
      );
    }
    if (upstream.status === 429) {
      return textStream(
        "**Rate limit reached.** Give it a moment and try again, or switch modes in the header."
      );
    }
    return textStream(
      `**Mino hit an error talking to the model**${message ? `: ${message}` : "."} Try again, or switch modes in the header.`
    );
  }

  // Relay upstream SSE, normalized. Announce the active mode first so the UI
  // can show which slot actually served the request (e.g. after a fallback).
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ mode: activeMode })}\n\n`));

      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            try {
              const chunk = JSON.parse(data) as {
                choices?: { delta?: { content?: string } }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                error?: { message?: string };
              };
              if (chunk.error?.message) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ error: chunk.error.message })}\n\n`)
                );
                continue;
              }
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
              }
              if (chunk.usage) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      usage: {
                        prompt: chunk.usage.prompt_tokens ?? 0,
                        completion: chunk.usage.completion_tokens ?? 0,
                        total: chunk.usage.total_tokens ?? 0,
                      },
                    })}\n\n`
                  )
                );
              }
            } catch {
              // ignore malformed chunk lines
            }
          }
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`));
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        reader.releaseLock();
      }
    },
    cancel() {
      upstream.body?.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

// ── GET: config probe so the UI knows which modes are available ─────────────
export async function GET(): Promise<Response> {
  const available: ModeId[] = [];
  if (process.env.OPENROUTER_API_KEY) available.push("auto");
  if (process.env.GEMINI_API_KEY) available.push("dev");
  return Response.json({ available });
}
