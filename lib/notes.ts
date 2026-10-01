// ── News from the developers ────────────────────────────────────────────────
// Notes are stored in the administrator's runtime config, so publishing one is
// a config write and nothing else. Everything here is pure except the two
// `localStorage` helpers, which keep the "show me this once" bookkeeping
// isolated and easy to test around.

export type NoteBadgeTone = "important" | "info" | "success" | "neutral";

export interface DevNote {
  /** Stable identity. A new note gets a new id, which is what makes the
   *  once-only prompt fire again for a note published later. */
  id: string;
  title: string;
  /** One or two lines shown on the card and in the prompt. */
  summary: string;
  /** Full body. Markdown, so links and lists work like the screenshot. */
  body: string;
  /** Optional pill above the title. Empty hides it. */
  badge: string;
  badgeTone: NoteBadgeTone;
  /** Shown next to the date, e.g. "mino_dev · 25 Sep". */
  author: string;
  /** Free-form so the administrator can write "25 Sep" or "yesterday". */
  dateLabel: string;
  published: boolean;
  publishedAt: number;
}

export const NOTE_BADGE_TONES: NoteBadgeTone[] = ["important", "info", "success", "neutral"];

export const BADGE_TONE_CLASS: Record<NoteBadgeTone, string> = {
  important: "bg-red-500/85 text-white",
  info: "bg-[#3b5bdb] text-white",
  success: "bg-emerald-500/85 text-white",
  neutral: "bg-white/[0.14] text-white/85",
};

export const EMPTY_NOTE: DevNote = {
  id: "",
  title: "",
  summary: "",
  body: "",
  badge: "",
  badgeTone: "important",
  author: "",
  dateLabel: "",
  published: false,
  publishedAt: 0,
};

/** Bounds, so one oversized note cannot fill the database or the screen. */
const LIMITS = { title: 120, summary: 240, body: 6000, badge: 24, author: 60, dateLabel: 40 };
const MAX_NOTES = 40;

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const tone = (value: unknown): NoteBadgeTone =>
  NOTE_BADGE_TONES.includes(value as NoteBadgeTone) ? (value as NoteBadgeTone) : "neutral";

/** Drops anything without a title or an id — a note with neither cannot be
 *  linked to or marked as seen, so it would be unreachable. */
export function normalizeNotes(raw: unknown): DevNote[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const notes: DevNote[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const id = text(value.id, 64);
    const title = text(value.title, LIMITS.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    notes.push({
      id,
      title,
      summary: text(value.summary, LIMITS.summary),
      body: text(value.body, LIMITS.body),
      badge: text(value.badge, LIMITS.badge),
      badgeTone: tone(value.badgeTone),
      author: text(value.author, LIMITS.author),
      dateLabel: text(value.dateLabel, LIMITS.dateLabel),
      published: value.published === true,
      publishedAt: typeof value.publishedAt === "number" ? value.publishedAt : 0,
    });
    if (notes.length >= MAX_NOTES) break;
  }
  // Newest first, so a freshly published note leads the list.
  return notes.sort((a, b) => b.publishedAt - a.publishedAt);
}

export function publishedNotes(notes: DevNote[]): DevNote[] {
  return notes.filter((note) => note.published);
}

export function findNote(notes: DevNote[], id: string | null): DevNote | null {
  if (!id) return null;
  return notes.find((note) => note.id === id) ?? null;
}

/** Notes published since this reader last looked. */
export function unseenNotes(notes: DevNote[], seen: readonly string[]): DevNote[] {
  const known = new Set(seen);
  return publishedNotes(notes).filter((note) => !known.has(note.id));
}

/**
 * Adds a note, or replaces the one with the same id.
 *
 * Both editing and publishing go through here. Replacing by mapping over the
 * list only works for a note already in it, so a first-time publish would
 * otherwise write the old list back unchanged and the note would vanish.
 */
export function upsertNote(notes: DevNote[], note: DevNote): DevNote[] {
  return notes.some((entry) => entry.id === note.id)
    ? notes.map((entry) => (entry.id === note.id ? note : entry))
    : [note, ...notes];
}

export function newNoteId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `note-${Date.now().toString(36)}-${random}`;
}

/** "25 Sep 2026" from a timestamp; empty when the note has no date. */
export function formatNoteDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Once-only bookkeeping ───────────────────────────────────────────────────

const SEEN_KEY = "mino:notes-seen";
/** Bounded, because a reader who never clears storage should not grow it
 *  without limit as notes come and go. */
const MAX_SEEN = 60;

/**
 * Ids already shown. Storage can be unavailable (private mode, blocked
 * cookies), and then the reader sees the prompt again — annoying, never
 * broken — so every failure path returns an empty list rather than throwing.
 */
export function readSeenNotes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/** Marks notes as shown. Called the moment the prompt opens, not when it is
 *  dismissed, so a refresh mid-read does not pop it open again. */
export function markNotesSeen(ids: readonly string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return;
  try {
    const merged = Array.from(new Set([...readSeenNotes(), ...ids])).slice(-MAX_SEEN);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
  } catch {
    // Nothing to do: the note simply shows again next visit.
  }
}