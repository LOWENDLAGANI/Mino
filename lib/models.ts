// ── Mino mode catalog ────────────────────────────────────────────────────────
// Two modes, each backed by its own server-side API key:
//   auto — universal OpenAI-compatible router (OpenRouter "openrouter/auto"),
//          which picks the best model for every request automatically
//   dev  — Google Gemini, tuned for code & technical work

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
    description: "Powered by Google Gemini",
    envVar: "GEMINI_API_KEY",
    engine: "google/gemini-2.0-flash-001",
  },
];

export const DEFAULT_MODE_ID: ModeId = "auto";

export function getMode(id: string): ModeOption {
  return MINO_MODES.find((m) => m.id === id) ?? MINO_MODES[0];
}
