// ── Mino model catalog (vision-capable OpenRouter models) ───────────────────

export interface ModelOption {
  id: string;
  name: string;
  vendor: string;
  description: string;
}

export const MINO_MODELS: ModelOption[] = [
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    vendor: "Anthropic",
    description: "Balanced flagship — great at code & reasoning",
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    vendor: "OpenAI",
    description: "Fast multimodal all-rounder",
  },
  {
    id: "google/gemini-2.0-flash-001",
    name: "Gemini 2.0 Flash",
    vendor: "Google",
    description: "Very fast, huge context window",
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    vendor: "DeepSeek",
    description: "Deep step-by-step reasoning",
  },
];

export const DEFAULT_MODEL_ID = MINO_MODELS[0].id;

export function getModel(id: string): ModelOption {
  return MINO_MODELS.find((m) => m.id === id) ?? MINO_MODELS[0];
}

/** Rough client-side token estimate (~4 chars per token) for the live meter. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
