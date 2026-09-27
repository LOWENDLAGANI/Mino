// ── Mino mode catalog ────────────────────────────────────────────────────────
// This module is imported by client components, so it deliberately contains no
// provider name, no API key name, and no wire model id. Those live in
// lib/modelEngines.ts, which is server-only.
//
// The split is not tidiness. A vendor's model id reaching the browser is not a
// cosmetic problem: it is written into every stored message, included in the
// backup file a user downloads, and readable in the page source. The product's
// identity stance is that Mino is Mino, and a name that reaches a user's
// downloads is a name the user can see.

export type ModeId = "auto" | "code";

export interface ModeOption {
  id: ModeId;
  name: string;
  /** The label shown everywhere this mode's model is named to the user. */
  display: string;
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
    display: "Mino Auto",
    separateSession: false,
    blurb: "Best available model",
  },
  {
    id: "code",
    name: "Code",
    display: "Code",
    separateSession: true,
    blurb: "Mino V3 · V2 · V1 only",
  },
];

export const DEFAULT_MODE_ID: ModeId = "auto";

/** Engine label used for messages produced by the image model. */
export const IMAGE_ENGINE = "mino-canvas";

export const IMAGE_ENGINE_NAME = "Mino Canvas";

export function getMode(id: string): ModeOption {
  return MINO_MODES.find((m) => m.id === id) ?? MINO_MODES[0];
}

/** A name Mino is willing to show. Anything else is not a Mino name. */
const MINO_NAME = /^Mino(?: Auto| Canvas| V\d+)?$/;

/**
 * Normalises whatever a message carries into a name safe to show.
 *
 * Messages store the Mino name rather than a provider id, so this is normally a
 * pass-through. It is still a filter rather than an echo, because a message
 * written by an older version of the app — or restored from a backup made
 * before the rename — can carry a provider id, and the one thing that must never
 * happen is rendering that to a user. An unrecognised value becomes plain
 * "Mino": correct, if less specific.
 */
export function getModelDisplayName(model?: string): string {
  if (!model) return "Mino";
  return MINO_NAME.test(model) ? model : "Mino";
}
