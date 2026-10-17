"use client";

import { useParams } from "next/navigation";
import Markdown from "@/components/Markdown";
import { BackButton, NoteBadge, NoteByline, useNotes } from "@/components/NotesFeed";
import MaintenanceGate from "@/components/MaintenanceGate";
import { findNote, formatNoteDate } from "@/lib/notes";

// ── One note, in full ───────────────────────────────────────────────────────
// Read from the same config subscription as the list rather than fetched by id,
// so an unpublished note disappears from here too instead of lingering at a
// URL somebody kept.

export default function NotePage() {
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { notes, loading } = useNotes();

  const note = findNote(notes, id ?? null);

  return (
    <MaintenanceGate>
      <main className="min-h-dvh bg-[#0b1310] px-5 pb-12 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-8">
        <div className="mx-auto w-full max-w-2xl">
          <BackButton href="/notes" />

          {loading ? (
            <p className="mt-6 text-[13px] text-white/30">Loading…</p>
          ) : !note ? (
            <>
              <h1 className="mt-7 text-[clamp(1.5rem,6vw,2rem)] font-semibold tracking-tight">
                Note not found
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-white/40">
                This note may have been unpublished by the developer.
              </p>
            </>
          ) : (
            <article className="animate-enter">
              <h1 className="mt-7 text-[clamp(1.7rem,6.5vw,2.5rem)] font-semibold leading-[1.1] tracking-tight">
                {note.title}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <NoteBadge note={note} />
                <NoteByline note={note} />
              </div>

              {/* Markdown, so links and lists render like the screenshot. The
                  wrapper reuses the chat's typography instead of restyling. */}
              <div className="prose-chat mt-5 text-[clamp(0.95rem,3.4vw,1.05rem)] leading-relaxed">
                <Markdown content={note.body || note.summary} />
              </div>

              <p className="mt-8 border-t border-white/[0.05] pt-4 text-[12px] text-white/25">
                Published {formatNoteDate(note.publishedAt)}
              </p>
            </article>
          )}
        </div>
      </main>
    </MaintenanceGate>
  );
}