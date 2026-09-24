import { NextRequest } from "next/server";
import { MINO_SYSTEM_PROMPT } from "@/lib/db";
import type { ApiMessage } from "@/lib/types";

// ── Mino — SSE streaming proxy to OpenRouter ────────────────────────────────
// The API key never leaves the server: it is read from Vercel environment
// variables (process.env.OPENROUTER_API_KEY) inside this Route Handler.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface ChatRequestBody {
  messages: ApiMessage[];
  model: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "OPENROUTER_API_KEY is not configured on the server. Set it in Vercel environment variables (or .env.local for local dev)." },
      { status: 500 }
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return Response.json({ error: "`messages` must be a non-empty array" }, { status: 400 });
  }

  // Strict persona reinforcement: the Mino system prompt is ALWAYS prepended,
  // on every single completion request, regardless of client payload.
  const payload = {
    model: typeof body.model === "string" && body.model ? body.model : "anthropic/claude-3.5-sonnet",
    messages: [{ role: "system", content: MINO_SYSTEM_PROMPT }, ...body.messages],
    stream: true,
  };

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mino-ai.vercel.app",
        "X-Title": "Mino",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return Response.json({ error: "Could not reach OpenRouter" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = `OpenRouter error (${upstream.status})`;
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } };
      if (parsed?.error?.message) message = parsed.error.message;
    } catch {
      if (detail) message = detail.slice(0, 300);
    }
    return Response.json({ error: message }, { status: upstream.status || 502 });
  }

  // Relay the upstream SSE stream to the client verbatim, normalizing each
  // OpenAI-style chunk into a simple `data:` text/event-stream.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
                choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
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
              const finish = chunk.choices?.[0]?.finish_reason;
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
              if (finish && !delta) {
                // nothing to forward; keep the stream lean
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
