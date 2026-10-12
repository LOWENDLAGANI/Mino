"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { subscribeAppConfig, type AppConfig } from "@/lib/appConfig";
import { BADGE_TONE_CLASS, formatNoteDate, publishedNotes, type DevNote } from "@/lib/notes";

// ── Shared pieces of the notes screens ──────────────────────────────────────
// The list, the detail page and the prompt all read the same subscription, so
// they never disagree with each other and none of them owns the data.

/** Live notes from the administrator's config, newest first. */
export function useNotes(): { notes: DevNote[]; title: string; loading: boolean } {
  const [notes, setNotes] = useState<DevNote[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      subscribeAppConfig((config: AppConfig) => {
        setNotes(publishedNotes(config.notes));
        setTitle(config.notesTitle);
        setLoading(false);
      }),
    [],
  );

  return { notes, title, loading };
}

/** Clamps to whole words so the card never ends mid-word. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function NoteBadge({ note }: { note: DevNote }) {
  if (!note.badge) return null;
  return (
    <span
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-[15px] font-semibold ${BADGE_TONE_CLASS[note.badgeTone]}`}
    >
      {note.badge}
    </span>
  );
}

/** Author · date, either of which may be blank. */
export function NoteByline({ note }: { note: DevNote }) {
  const parts = [note.author, note.dateLabel || formatNoteDate(note.publishedAt)].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className="min-w-0 truncate rounded-full bg-white/[0.09] px-3.5 py-1.5 text-[14px] text-white/70">
      {parts.join(" · ")}
    </span>
  );
}

export function BackButton({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label="Back"
      className="lift inline-flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 12H4M11 5l-7 7 7 7" />
      </svg>
    </Link>
  );
}

/** The card from the screenshot: badge and byline above a clamped summary. */
export function NoteCard({ note, href }: { note: DevNote; href: string }) {
  const summary = clamp(note.summary || note.body, 150);
  return (
    <article className="rounded-[26px] bg-white/[0.055] p-5 transition-colors hover:bg-white/[0.075]">
      <div className="flex flex-wrap items-center gap-2">
        <NoteBadge note={note} />
        <NoteByline note={note} />
      </div>

      <h3 className="mt-5 text-[clamp(1.15rem,4.4vw,1.5rem)] font-semibold leading-tight tracking-[-0.01em] text-white">
        <Link href={href} className="transition-opacity hover:opacity-80">
          {note.title}
        </Link>
      </h3>

      {summary && (
        <p className="mt-3 text-[clamp(0.95rem,3.6vw,1.15rem)] leading-relaxed text-white/60">
          {summary}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <Link
          href={href}
          className="lift rounded-full bg-white/[0.12] px-6 py-2.5 text-[15px] font-medium text-white/85 transition-colors hover:bg-white/[0.2]"
        >
          more
        </Link>
      </div>
    </article>
  );
}

/** Heading, back arrow, and the page shell both screens share. */
export function NotesShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[#0b1310] px-5 pb-12 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <BackButton />
          {action}
        </div>
        <h1 className="mt-8 text-[clamp(1.9rem,7.5vw,2.9rem)] font-semibold leading-[1.1] tracking-tight">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}