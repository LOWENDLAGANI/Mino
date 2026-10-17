"use client";

import { NoteCard, NotesShell, useNotes } from "@/components/NotesFeed";
import MaintenanceGate from "@/components/MaintenanceGate";

// ── News from the developers ────────────────────────────────────────────────
// The full list. The prompt is the doorway; this is where someone goes when
// they want to read everything, including notes published before they arrived.

export default function NotesPage() {
  const { notes, title, loading } = useNotes();

  return (
    <MaintenanceGate>
      <NotesShell title={title || "News From Developers"}>
        {loading ? (
          <p className="mt-6 text-[14px] text-white/35">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="mt-6 text-[15px] text-white/40">Nothing published yet. Check back soon.</p>
        ) : (
          <>
            {/* Category header — the count is derived, never typed in. */}
            <section className="mt-10 flex items-center gap-4 rounded-xl bg-[#1b3a2a]/90 p-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-white/85">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="4" y="5" width="16" height="16" rx="2.5" />
                  <path d="M4 9.5h16M8 3.5V6M16 3.5V6M8 13.5h4M8 17h7" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[clamp(1rem,4vw,1.3rem)] font-semibold tracking-[-0.01em] text-white">
                  New Announcements
                </h2>
                <p className="mt-0.5 text-[13px] text-white/60">
                  {notes.length === 1 ? "1 article" : `${notes.length} articles`}
                </p>
              </div>
            </section>

            <div className="mt-5 space-y-3">
              {notes.map((note) => (
                <NoteCard key={note.id} note={note} href={`/notes/${note.id}`} />
              ))}
            </div>
          </>
        )}
      </NotesShell>
    </MaintenanceGate>
  );
}