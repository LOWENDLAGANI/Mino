// ── Mino provider configuration (server only) ────────────────────────────────
// The one place an endpoint, a key and a wire model id are assembled, so the
// chat route and the admin model-health probe talk to exactly the same models
// with the same settings. Nothing here may be imported by a client component:
// these strings carry provider names and, via `key`, credentials.

import type { ModeId } from "./models";
import { AUTO_ENGINE, CODE_ENGINE, CODE_FALLBACKS, toMinoName } from "./modelEngines";

export type ProviderFamily = "openrouter" | "gemini" | "groq";

export interface ProviderConfig {
  id: ModeId;
  family: ProviderFamily;
  label: string;
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  /**
   * Whether this exact model honours `reasoning_effort`. It is not a property
   * of the vendor — Groq serves both a reasoning model (GPT-OSS) and a plain
   * one (Llama) behind the same API — so it is tracked per configuration.
   */
  supportsReasoning: boolean;
}

/** Which Mino mode a provider family belongs to, for user-facing error copy. */
export const FAMILY_MODE: Record<ProviderFamily, string> = {
  openrouter: "Mino Auto",
  gemini: "Mino Code",
  groq: "the Mino fallback",
};

export function getProviders(requested: ModeId): ProviderConfig[] {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();

  const openrouter: ProviderConfig | null = openrouterKey
    ? {
        id: "auto",
        family: "openrouter",
        label: "Mino Auto",
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: openrouterKey,
        model: AUTO_ENGINE,
        supportsReasoning: true,
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

  // Mino V3 is the preferred stable model, but the provider can return a
  // temporary 503 while a model has no serving capacity. V2 and V1 are also
  // stable and remain available as immediate fallbacks without leaving the Code
  // mode family. The wire names are provider detail and never reach the user.
  const geminiModels = [CODE_ENGINE, ...CODE_FALLBACKS];
  const gemini: ProviderConfig[] = geminiKey
    ? geminiModels.map((model) => ({
        id: "code" as const,
        family: "gemini" as const,
        label: toMinoName(model),
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: geminiKey,
        model,
        supportsReasoning: true,
      }))
    : [];

  // Last resort. Groq is a separate vendor with its own quota, so when every
  // other model is down, rate-limited, or out of capacity the chat still
  // answers instead of erroring out.
  //
  // Every entry is a comparable-tier model rather than a progressively weaker
  // one: the point of a last line of defence is that the answer is still worth
  // reading. GPT-OSS 120B and Llama 3.3 70B are Groq's strongest production
  // text models, and GPT-OSS 20B is a cheaper third rather than a 8B model
  // that would visibly downgrade the conversation. Only GPT-OSS honours
  // reasoning_effort.
  const groqModels: Array<{ model: string; supportsReasoning: boolean }> = [
    { model: "openai/gpt-oss-120b", supportsReasoning: true },
    { model: "llama-3.3-70b-versatile", supportsReasoning: false },
    { model: "openai/gpt-oss-20b", supportsReasoning: true },
  ];
  const groq: ProviderConfig[] = groqKey
    ? groqModels.map(({ model, supportsReasoning }) => ({
        id: requested,
        family: "groq" as const,
        label: "Mino",
        url: "https://api.groq.com/openai/v1/chat/completions",
        key: groqKey,
        model,
        supportsReasoning,
        extraBody: { stream_options: { include_usage: true } },
      }))
    : [];

  // Code mode never leaves the Mino family. OpenRouter and Groq are excluded
  // from its fallback chain entirely, so an outage produces a clear error
  // instead of code written by a model the user did not ask for.
  if (requested === "code") return [...gemini];
  return [...(openrouter ? [openrouter] : []), ...gemini, ...groq];
}
