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
            <p className="mt-6 text-[14px] text-white/35">Loading…</p>
          ) : !note ? (
            <>
              <h1 className="mt-8 text-[clamp(1.6rem,6.5vw,2.2rem)] font-semibold tracking-tight">
                Note not found
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-white/45">
                This note may have been unpublished by the developer.
              </p>
            </>
          ) : (
            <article className="animate-rise">
              <h1 className="mt-8 text-[clamp(1.9rem,7.5vw,2.9rem)] font-semibold leading-[1.1] tracking-tight">
                {note.title}
              </h1>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <NoteBadge note={note} />
                <NoteByline note={note} />
              </div>

              {/* Markdown, so links and lists render like the screenshot. The
                  wrapper reuses the chat's typography instead of restyling. */}
              <div className="prose-chat mt-7 text-[clamp(0.98rem,3.6vw,1.1rem)] leading-relaxed">
                <Markdown content={note.body || note.summary} />
              </div>

              <p className="mt-10 border-t border-white/[0.07] pt-5 text-[13px] text-white/25">
                Published {formatNoteDate(note.publishedAt)}
              </p>
            </article>
          )}
        </div>
      </main>
    </MaintenanceGate>
  );
}