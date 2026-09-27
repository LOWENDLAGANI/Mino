// ── Mino Stage 1 — prompt optimization ──────────────────────────────────────
// Raw user text ("a girl named Mino") is a poor input for FLUX, which responds
// to descriptive language. This module turns that text into a single
// descriptive paragraph before it ever reaches the image model.
//
// It is a *best effort* stage, never a hard dependency: if no text model is
// configured, or the call fails or is slow, the original prompt is passed
// through unchanged so image generation keeps working.

/** Cloudflare FLUX truncates around this; keep the optimized text well inside it. */
const MAX_PROMPT_LENGTH = 400;

/** Stage 1 must be fast. Past this budget the original prompt wins. */
const OPTIMIZER_TIMEOUT_MS = 6000;

const SYSTEM_INSTRUCTION = `You are a prompt optimizer for a text-to-image model.

Rewrite the user's request as ONE descriptive paragraph for an image generator.

Rules:
- Add concrete physical detail: age range, face, hair, skin, clothing, materials, expression, pose.
- Add setting, lighting (e.g. soft window light, warm rim light, neon), and mood.
- Name an art style and medium (e.g. cinematic digital painting, 35mm film photo, anime cel).
- Keep the user's own subject, name, and intent. Do not replace or restate the name in quotes.
- Expand a bare name or short phrase. If the user already gave a rich description, refine it without changing the subject.
- No preamble, no explanation, no lists, no quotation marks, no markdown.
- Output ONLY the final paragraph as a single string.`;

interface OptimizerProvider {
  label: string;
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
}

interface OptimizerResult {
  prompt: string;
  optimized: boolean;
  provider?: string;
}

/**
 * Providers in preference order: the fastest text models the deployment
 * already has keys for. All three speak the OpenAI chat-completions shape, so
 * one call shape covers them.
 */
function optimizerProviders(): OptimizerProvider[] {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();

  const providers: OptimizerProvider[] = [];
  if (groqKey) {
    // Small, fast, cheap — the right model for a one-paragraph rewrite.
    providers.push({
      label: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKey,
      model: "llama-3.3-70b-versatile",
    });
  }
  if (geminiKey) {
    providers.push({
      label: "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: geminiKey,
      model: "gemini-3.6-flash",
    });
  }
  if (openrouterKey) {
    providers.push({
      label: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouterKey,
      model: "openai/gpt-oss-20b",
      headers: { "HTTP-Referer": "https://mino-ai.vercel.app", "X-Title": "Mino" },
    });
  }
  return providers;
}

/** Strips the wrappers models add despite instructions, and normalises whitespace. */
function cleanOutput(text: string): string {
  let out = text.trim();
  // A model that ignored the "output only the string" rule usually wraps the
  // paragraph in quotes or a code fence; unwrap rather than ship the noise.
  const fence = out.match(/^```(?:text|plain)?\s*([\s\S]*?)\s*```$/);
  if (fence) out = fence[1].trim();
  out = out.replace(/^["'`]+/, "").replace(/["'`]+$/, "");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Turns a short user request into a descriptive image prompt.
 * Always resolves: the input prompt is returned when optimization is not
 * possible, so callers never need a try/catch.
 */
export async function optimizePrompt(input: string, signal?: AbortSignal): Promise<OptimizerResult> {
  const original = input.replace(/\s+/g, " ").trim();
  if (!original) return { prompt: input, optimized: false };

  for (const provider of optimizerProviders()) {
    try {
      const optimized = await callOptimizer(provider, original, signal);
      if (optimized) return { prompt: optimized, optimized: true, provider: provider.label };
    } catch {
      // Try the next provider; a missing text key must not fail the image.
    }
  }
  return { prompt: original.slice(0, MAX_PROMPT_LENGTH), optimized: false };
}

async function callOptimizer(
  provider: OptimizerProvider,
  prompt: string,
  signal?: AbortSignal
): Promise<string | null> {
  // Combine the caller's signal with a hard budget, so one slow provider can
  // never delay the image request indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPTIMIZER_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

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
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: prompt },
        ],
        // Non-streaming: Stage 1 needs the finished string, not tokens.
        stream: false,
        temperature: 0.7,
        max_tokens: 220,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;

    const cleaned = cleanOutput(text).slice(0, MAX_PROMPT_LENGTH);
    // A refusal, an empty rewrite, or a degenerate echo of the input is not an
    // improvement, so keep the caller's own words.
    if (cleaned.length < 20 || cleaned.toLowerCase() === prompt.toLowerCase()) return null;
    return cleaned;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
