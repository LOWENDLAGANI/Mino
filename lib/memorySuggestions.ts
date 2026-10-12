import { MEMORY_COUNT_LIMIT, normalizeMemoryText } from "./memory";
import type { Memory } from "./types";

// ── Mino memory suggestions ──────────────────────────────────────────────────
//
// Capture used to be manual only, which made it reliable and forgetful: Mino
// could only ever remember what the user thought to tell it. Every other
// assistant in this category reads the conversation and decides what to keep —
// and that is genuinely more useful, because most people never type "remember
// this" and simply expect an assistant that already knows them.
//
// So the model is asked to propose, and the user still decides. The split is
// deliberate and it is the whole design: a model is good at noticing "this
// person said they are shipping a Next.js app in March" and bad at knowing
// whether they meant it. Automatic capture earns its usefulness by being
// offered, not by being applied. Every suggestion here is a chip the user taps,
// and dismissing the offer stops it for good rather than for one turn.
//
// This file holds the pure parts — parsing, gating, persistence — so the rules
// can be tested without a network or a browser. The model call lives in
// `lib/memoryExtractor.ts`, server-side, and the fetch lives below.

/** How many suggestions one answer can produce. Three is a choice the user can read. */
export const MEMORY_SUGGESTION_LIMIT = 3;

/**
 * The shortest message worth reading for a fact.
 *
 * A suggestion needs a sentence the user actually wrote, not a greeting or a
 * link. Below this the model has nothing to extract and would only be guessing,
 * which is the failure mode this feature exists to avoid.
 */
const MIN_SOURCE_LENGTH = 24;
const MIN_SOURCE_WORDS = 5;

/**
 * Storage key for the user's answer to the offer.
 *
 * Two states, deliberately, not a list of dismissed items: either Mino keeps
 * suggesting or it never does. Someone who dismisses the banner has said they
 * do not want this, and asking again next message would be the nagging version
 * of the same pattern.
 */
const SETTING_KEY = "mino:memory-suggest";
const DISMISSED_KEY = "mino:memory-suggest-off";

/** Whether Mino may offer memory suggestions at all. On by default. */
export function loadSuggestionEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(SETTING_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSuggestionEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SETTING_KEY, enabled ? "on" : "off");
    if (enabled) localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // A browser refusing storage loses the preference, not the feature.
  }
}

/** Whether the user has turned suggestions off for good. */
export function suggestionsDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissSuggestions(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Nothing to do — the offer simply returns next turn.
  }
}

/**
 * Whether this exchange is worth asking about.
 *
 * The list is full, the user turned it off, or the user dismissed it already:
 * all three mean stay quiet. A short message means there is nothing to extract.
 * The answer is deliberately not consulted — a fact the user stated and Mino
 * never repeated is still a fact, and reading the reply for eligibility would
 * only add a way to miss it.
 */
export function shouldSuggest(input: {
  userText: string;
  memories: Memory[];
  enabled: boolean;
  dismissed: boolean;
}): boolean {
  if (!input.enabled || input.dismissed) return false;
  if (input.memories.length >= MEMORY_COUNT_LIMIT) return false;
  const text = input.userText.replace(/\s+/g, " ").trim();
  if (text.length < MIN_SOURCE_LENGTH) return false;
  return text.split(/\s+/).length >= MIN_SOURCE_WORDS;
}

/**
 * Reads suggestions out of whatever the model returned.
 *
 * Models follow "output a JSON array" closely enough to be worth trusting and
 * not closely enough to rely on, so the shapes are peeled off in order of how
 * much they are trusted: real JSON first, then JSON hidden in a code fence, then
 * one item per line. A model that ignored the format entirely still produces
 * something the user can read rather than nothing.
 *
 * Everything then goes through `normalizeMemoryText`, which is the same guard
 * that protects the system prompt — a suggestion is only ever offered, but a
 * suggestion that slips through is stored by the same path as a typed one.
 */
export function parseSuggestions(raw: string, existing: Memory[]): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];

  let items: string[] = [];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  for (const candidate of [fenced?.[1], raw]) {
    if (!candidate) continue;
    items = itemsFromJson(candidate);
    if (items.length) break;
  }
  if (items.length === 0) items = itemsFromLines(raw);

  const known = new Set(existing.map((memory) => memory.text.toLowerCase()));
  const out: string[] = [];
  for (const item of items) {
    const text = normalizeMemoryText(item);
    if (!text) continue;
    // Same duplicate rule as `addMemory`, applied before the user is asked, so
    // the banner never offers something the list already says.
    const key = text.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    out.push(text);
    if (out.length >= MEMORY_SUGGESTION_LIMIT) break;
  }
  return out;
}

function itemsFromJson(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry : typeof entry === "object" && entry ? String((entry as { text?: unknown }).text ?? "") : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function itemsFromLines(raw: string): string[] {
  const marked = raw.split("\n").map((line) => {
    const text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    return { text, marked: /^[\s]*(?:[-*•]|\d+[.)])\s+/.test(line) };
  });
  const lines = marked.filter((entry) => entry.text.length > 0);
  // Any marked line means a real list exists, and the list is what was asked
  // for — the unmarked line above it is the model introducing the list ("Here
  // are two things"), which is not a fact about the user.
  const hasMarker = lines.some((entry) => entry.marked);
  if (hasMarker) return lines.filter((entry) => entry.marked).map((entry) => entry.text);
  // With no list at all, a single bare line is a model talking rather than a
  // list it forgot to mark up: "I think I understand what you're asking" is
  // prose, and offering it as a fact about the user is the failure this whole
  // feature has to avoid. Two or more lines are taken on trust, since a
  // paragraph broken across lines is a list in every practical sense.
  if (lines.length === 1) return [];
  return lines.map((entry) => entry.text);
}

export interface SuggestionRequest {
  userText: string;
  answer: string;
  memories: Memory[];
  authorization?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Asks the server which facts this exchange contains.
 *
 * Never throws. A missing key, a failed call, or a model that returns prose
 * instead of JSON all resolve to no suggestions, because the alternative is
 * surfacing an error about a feature the user did not ask for, in a product
 * whose whole pitch is answering questions.
 */
export async function requestMemorySuggestions(input: SuggestionRequest): Promise<string[]> {
  try {
    const response = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(input.authorization ?? {}) },
      body: JSON.stringify({
        userText: input.userText,
        answer: input.answer,
        memories: input.memories,
      }),
      signal: input.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { suggestions?: unknown };
    if (!Array.isArray(payload.suggestions)) return [];
    return parseSuggestions(
      payload.suggestions.map((entry) => (typeof entry === "string" ? entry : "")).join("\n"),
      input.memories
    );
  } catch {
    return [];
  }
}