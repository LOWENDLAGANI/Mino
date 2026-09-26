// ── Mino mode catalog ────────────────────────────────────────────────────────
// Two modes, each backed by its own server-side API key:
//   auto — universal OpenAI-compatible router (OpenRouter "openrouter/auto"),
//          which picks the best model for every request automatically
//   dev  — Mino 3.8, tuned for code & technical work

export type ModeId = "auto" | "dev";

export interface ModeOption {
  id: ModeId;
  name: string;
  tagline: string;
  description: string;
  /** Server-side env var that enables this mode */
  envVar: string;
  /** Underlying default model (informational, shown in UI) */
  engine: string;
}

export const MINO_MODES: ModeOption[] = [
  {
    id: "auto",
    name: "Auto",
    tagline: "Best model, chosen for you",
    description: "Routes every message to the strongest available model",
    envVar: "OPENROUTER_API_KEY",
    engine: "openrouter/auto",
  },
  {
    id: "dev",
    name: "Dev",
    tagline: "Tuned for code & technical work",
    description: "Mino 3.8, tuned for code and technical work",
    envVar: "GEMINI_API_KEY",
    engine: "gemini-3.8-flash",
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
