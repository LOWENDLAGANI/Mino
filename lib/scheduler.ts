// ── Scheduled messages ───────────────────────────────────────────────────────
// A message written now, sent later. The schedule is a row in Dexie and the
// sender is this browser's own open tab — there is no server queue, because
// this project has no background worker and pretending otherwise would mean a
// scheduled message silently never fires on a closed laptop. The composer says
// so through the chips: a schedule is a promise this tab keeps, and it fires
// the moment the app is open again after its time has passed.

import type { DocumentAttachment, ImageAttachment, SearchMode } from "./types";
import type { ModeId } from "./models";

export interface ScheduledMessage {
  id: string;
  /** The chat to send into; null means a new chat is created when it fires. */
  chatId: string | null;
  content: string;
  images?: ImageAttachment[];
  documents?: DocumentAttachment[];
  mode: ModeId;
  searchMode: SearchMode;
  /** Epoch ms. The message fires on the first tick at or after this moment. */
  sendAt: number;
  createdAt: number;
}

/** The quick picks in the composer's schedule menu, in the order shown. */
export const SCHEDULE_PRESETS: Array<{ label: string; offsetMs?: number; hour?: number }> = [
  { label: "In 5 minutes", offsetMs: 5 * 60_000 },
  { label: "In 30 minutes", offsetMs: 30 * 60_000 },
  { label: "In 1 hour", offsetMs: 60 * 60_000 },
  { label: "Tomorrow 9:00", hour: 9 },
];

export function isDue(item: { sendAt: number }, now: number): boolean {
  return item.sendAt <= now;
}

/** Oldest promise first, so a backlog fires in the order it was made. */
export function dueFirst(a: { sendAt: number }, b: { sendAt: number }): number {
  return a.sendAt - b.sendAt;
}

/** The next occurrence of a wall-clock hour, tomorrow if today's has passed. */
export function nextMorningAt(hour: number, now = Date.now()): number {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** One line for a chip: relative while it is near, absolute once it is not. */
export function formatScheduleTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  if (diff <= 0) return "due now";
  if (diff < 3_600_000) return `in ${Math.max(1, Math.round(diff / 60_000))}m`;
  const sameDay = new Date(ts).toDateString() === new Date(now).toDateString();
  if (sameDay) {
    return `today ${new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The composer's custom picker posts a datetime-local string; this is its floor. */
export function earliestSchedule(now = Date.now()): string {
  return new Date(now + 60_000).toISOString().slice(0, 16);
}
