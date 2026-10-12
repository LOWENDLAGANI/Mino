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
- Keep the user's subject name in the paragraph, written exactly as they wrote it. The image model recognises well-known characters by name, so dropping the name is the one thing that must never happen.
- If the request names an existing character, celebrity, or figure, describe their well-known appearance faithfully (hair colour, build, clothing, era). Never substitute a different character.
- If you do not know who they are, keep the name and describe a generic figure of that broad type. A recognisable attempt at the right kind of subject beats an invented stranger.
- Add concrete physical detail: age range, face, hair, skin, clothing, materials, expression, pose.
- Add setting, lighting (e.g. soft window light, warm rim light, neon), and mood.
- Name an art style and medium (e.g. cinematic digital painting, 35mm film photo, anime cel).
- Expand a short phrase. If the user already gave a rich description, refine it without changing the subject.
- Write flowing prose. Never begin with a heading or a label such as "Faithful appearance:" or "Description:".
- Finish the whole sentence. Never stop mid-thought.
- No preamble, no explanation, no lists, no quotation marks around the name, no markdown.
- Output ONLY the final paragraph as a single string.`;

/**
 * Filler words people wrap a request in ("generate me a picture of X",
 * "draw X", "make an image of X"). Stripped before the subject is recovered.
 */
const REQUEST_NOISE = /^\s*(?:please\s+)?(?:can you\s+)?(?:generate|create|make|draw|paint|render|give|show)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:painting|drawing|artwork|portrait|picture|image|render|art)?\s*(?:of|with|showing)?\s*/i;

/**
 * The subject the user actually asked for, with the request wrapper removed.
 * Returns the whole request when it is too short or too long to be worth
 * isolating, since a mangled fragment is worse than the original text.
 */
function subjectOf(request: string): string {
  const stripped = request.replace(REQUEST_NOISE, "").trim().replace(/[.!?]+$/, "");
  if (stripped.length < 3 || stripped.length > 60) return "";
  return stripped;
}

/**
 * Guarantees the subject survives Stage 1.
 *
 * The instruction asks the model to keep the name, but instructions are not
 * guarantees, and a rewrite that quietly drops it costs more than it gains:
 * FLUX still recognises "Satoru Gojo" by name, so losing the name is what turns
 * a request for a known character into a plausible stranger. When the optimized
 * paragraph no longer contains the subject, it is prepended.
 */
function ensureSubject(original: string, optimized: string): string {
  const subject = subjectOf(original);
  if (!subject) return optimized;
  if (optimized.toLowerCase().includes(subject.toLowerCase())) return optimized;
  const merged = `${subject}, ${optimized}`;
  return merged.length > MAX_PROMPT_LENGTH ? optimized.slice(0, MAX_PROMPT_LENGTH) : merged;
}

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

/**
 * Phrases that mean the model declined rather than produced a prompt. A refusal
 * is prose, so it clears the length check and would otherwise be sent to the
 * image model as if it were a description.
 */
const REFUSAL = /^(?:i\s+(?:can(?:'|no)?t|am\s+unable|cannot|won't|do\s+not)\b|sorry[,!]|i'?m\s+not\s+able|as\s+an\s+ai\b)/i;

/**
 * A description that stops on a comma or a dangling conjunction was cut off.
 * Not every provider reports finish_reason, so this catches the same failure
 * from the output's shape. Deliberately narrow: FLUX prompts legitimately end
 * without a full stop, so only an unmistakable dangling fragment is rejected.
 */
const TRUNCATED_TAIL = /[,;]\s*$|\b(?:and|or|with|but|the|a|an|of|in|on|at|to)\s*$/i;

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
      if (optimized) {
        const prompt = ensureSubject(original, optimized);
        // The final string is what FLUX actually receives, and nothing else in
        // the system shows it. Without this, a wrong result is only diagnosable
        // by looking at the picture and guessing what the model was told.
        if (process.env.NODE_ENV === "development") console.log(`[promptOptimizer] ${provider.label} in="${original}" out="${prompt}"`);
        return { prompt, optimized: true, provider: provider.label };
      }
    } catch {
      // Try the next provider; a missing text key must not fail the image.
    }
  }
  if (process.env.NODE_ENV === "development") console.log(`[promptOptimizer] passthrough (no text model) prompt="${original}"`);
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
        // Large on purpose. Reasoning models (Gemini Flash) draw their thinking
        // tokens from this same budget, so a limit sized for the paragraph
        // alone leaves the model deliberating when it should be writing. That
        // produced fragments like "White hair, dark" — a truncated prompt
        // reaches FLUX missing everything the model meant to say.
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string") return null;
    // Cut off mid-sentence, whatever the reason. A fragment is worse than the
    // caller's own prompt: it reads as a complete description to the image
    // model, so the missing half becomes invented detail. Better to try the
    // next provider, or fall through to the unoptimized prompt.
    if (choice?.finish_reason === "length") return null;

    const cleaned = cleanOutput(text).slice(0, MAX_PROMPT_LENGTH);
    // A refusal, an empty rewrite, or a degenerate echo of the input is not an
    // improvement, so keep the caller's own words.
    if (cleaned.length < 20 || cleaned.toLowerCase() === prompt.toLowerCase()) return null;
    if (REFUSAL.test(cleaned)) return null;
    if (TRUNCATED_TAIL.test(cleaned)) return null;
    return cleaned;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
