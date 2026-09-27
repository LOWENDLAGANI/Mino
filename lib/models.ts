// ── Mino mode catalog ────────────────────────────────────────────────────────
// Two modes, each backed by its own server-side API key:
//   auto  — universal OpenAI-compatible router (OpenRouter "openrouter/auto"),
//           which picks the best model for every request automatically
//   code  — Mino 3.8 (Gemini 3.8 Flash), tuned for code & technical work.
//           Code mode is Gemini-only: every automatic fallback stays inside the
//           3.8 → 3.7 → 3.6 family, so generated code never silently drops to a
//           different model family. If no Gemini model is reachable the request
//           fails loudly instead of being answered by a weaker model.

export type ModeId = "auto" | "code";

export interface ModeOption {
  id: ModeId;
  name: string;
  /** Server-side env var that enables this mode */
  envVar: string;
  /** Underlying default model (informational, shown in UI) */
  engine: string;
  /**
   * When true, picking this mode always opens a fresh session rather than
   * continuing the current conversation under a different model.
   */
  separateSession: boolean;
  /** Short explanation shown in the mode menu */
  blurb: string;
}

export const MINO_MODES: ModeOption[] = [
  {
    id: "auto",
    name: "Auto",
    envVar: "OPENROUTER_API_KEY",
    engine: "openrouter/auto",
    separateSession: false,
    blurb: "Best available model",
  },
  {
    id: "code",
    name: "Code",
    envVar: "GEMINI_API_KEY",
    engine: "gemini-3.8-flash",
    separateSession: true,
    blurb: "Gemini 3.8 · 3.7 · 3.6 only",
  },
];

export const DEFAULT_MODE_ID: ModeId = "auto";

/** Engine label used for messages produced by the image model. */
export const IMAGE_ENGINE = "mino-canvas";

export const IMAGE_ENGINE_NAME = "Mino Canvas";

export function getMode(id: string): ModeOption {
  return MINO_MODES.find((m) => m.id === id) ?? MINO_MODES[0];
}

/** Maps internal provider model IDs to Mino-only names shown in the product UI. */
export function getModelDisplayName(model?: string): string {
  if (!model) return "Mino";
  if (model === "openrouter/auto") return "Mino Auto";
  if (model === IMAGE_ENGINE) return IMAGE_ENGINE_NAME;

  const version = model.match(/gemini-(\d+\.\d+)/)?.[1];
  return version ? `Mino ${version}` : "Mino";
}
