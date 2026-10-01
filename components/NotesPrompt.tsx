"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NoteBadge, useNotes } from "@/components/NotesFeed";
import {
  formatNoteDate,
  markNotesSeen,
  readSeenNotes,
  unseenNotes,
  type DevNote,
} from "@/lib/notes";

// ── The once-only prompt ────────────────────────────────────────────────────
// A reader is shown a note once, the first time they arrive after it is
// published. Two details make it behave:
//
//  * Ids are marked seen the moment the sheet opens, not when it is dismissed.
//    Otherwise closing the tab and coming back would reopen it, which is the
//    behaviour this is meant to avoid.
//  * A note published later has a new id, so it surfaces to everyone again
//    without anybody having to reset anything.

/** A beat after load, so it never competes with the first paint of the chat. */
const OPEN_DELAY_MS = 1400;

function PromptBody({ note, onDismiss }: { note: DevNote; onDismiss: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <NoteBadge note={note} />
        <span className="min-w-0 truncate rounded-full bg-white/[0.09] px-3.5 py-1.5 text-[14px] text-white/70">
          {[note.author, note.dateLabel || formatNoteDate(note.publishedAt)]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.01em] text-white">
        {note.title}
      </h2>

      <div className="flex items-center justify-between gap-3 pt-1">
        <Link
          href="/notes"
          onClick={onDismiss}
          className="text-[13px] text-white/40 underline-offset-4 transition-colors hover:text-white/70 hover:underline"
        >
          View all
        </Link>
        <Link
          href={`/notes/${note.id}`}
          onClick={onDismiss}
          className="lift rounded-full bg-white/[0.12] px-5 py-2 text-[14px] font-medium text-white/85 transition-colors hover:bg-white/[0.2]"
        >
          Read
        </Link>
      </div>
    </div>
  );
}

export default function NotesPrompt() {
  const { notes } = useNotes();
  const [queue, setQueue] = useState<DevNote[]>([]);

  // One timer for the whole feature: after the delay, whatever is unread is
  // queued and marked in the same step, so two notes cannot both decide they
  // are the first thing to show.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fresh = unseenNotes(notes, readSeenNotes());
      if (fresh.length === 0) return;
      markNotesSeen(fresh.map((note) => note.id));
      setQueue(fresh);
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [notes]);

  const note = queue[0];
  if (!note) return null;

  const dismiss = () => setQueue((rest) => rest.slice(1));
  const remaining = queue.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="News from the developers"
      className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6"
    >
      {/* Dismissable by tapping away: the note is already marked seen, so
          this throws away nothing that would otherwise be lost. */}
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-[3px]"
      />

      <section className="animate-pop relative w-full max-w-md rounded-t-[26px] border border-white/[0.09] bg-[#15151a] p-5 shadow-2xl shadow-black/80 sm:rounded-[26px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/40">
            News from the developers
          </h1>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
            </svg>
          </button>
        </div>

        <PromptBody note={note} onDismiss={dismiss} />

        {remaining > 1 && (
          <p className="mt-3 text-center text-[11.5px] text-white/25">
            {remaining - 1} more waiting
          </p>
        )}
      </section>
    </div>
  );
}