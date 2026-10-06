// ── Branching replies ────────────────────────────────────────────────────────
// Pure helpers for a message that has more than one answer.
//
// A retry or an edit used to throw the old answer away — the row was deleted
// and a new one appended — which is fine when there was only one answer worth
// having and wasteful the moment somebody wants to compare. So the previous
// answer stays on the message as a variant instead of being deleted, and the
// thread shows whichever one is selected.
//
// The shape is deliberately boring:
//
//   * `content` is always the live answer — the newest one, the one streaming
//     writes land in, and the one search, export and the model's own history
//     read when nothing is being viewed. A variant never replaces it, so a
//     viewer that knows nothing about variants still sees the real answer.
//   * `variants` holds the older answers, newest previous first.
//   * `variantIndex` says which one is on screen. Absent or 0 means the live
//     answer; k (k ≥ 1) means `variants[k - 1]`.
//
// Switching what you are looking at therefore changes only a pointer. Nothing
// is written to `content`, so simply browsing back through answers cannot
// corrupt the transcript or leak an old answer into a new send.

import type { ChatMessage } from "./types";

/** How many previous answers one message keeps. Older ones fall off the end. */
export const MAX_VARIANTS = 8;

/** The text on screen for this message: the viewed variant, or the live one. */
export function displayedContent(message: ChatMessage): string {
  const index = message.variantIndex;
  if (index === null || index === undefined || index < 1) return message.content;
  const variant = message.variants?.[index - 1];
  return typeof variant === "string" ? variant : message.content;
}

/** How many answers this message can show, live one included. */
export function variantCount(message: ChatMessage): number {
  return (message.variants?.length ?? 0) + 1;
}

/** Which of them is on screen: 0 is the live answer, k is `variants[k - 1]`. */
export function variantPosition(message: ChatMessage): number {
  return message.variantIndex ?? 0;
}

/**
 * The variant list that results from retiring the current live answer.
 *
 * The live text moves to the front of the older stack — it is the answer being
 * branched away from, so it is the one the reader will want to come back to —
 * and empty text is dropped rather than stored as an answer with nothing in it.
 */
export function retireCurrentAnswer(message: ChatMessage): string[] {
  return [message.content, ...(message.variants ?? [])]
    .filter((text) => typeof text === "string" && text.length > 0)
    .slice(0, MAX_VARIANTS);
}
