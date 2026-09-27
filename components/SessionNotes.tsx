"use client";

import { useEffect, useState } from "react";

// ── Mino — project notes for a Code session ──────────────────────────────────
//
// The failure this fixes: a long coding thread where the model forgets the
// stack, the naming convention, or the one constraint the user stated in
// message two, and has to be told again. Notes are written once and sent with
// every request in the session, which is the difference between a conversation
// and a working session.

interface SessionNotesProps {
  open: boolean;
  onClose: () => void;
  notes: string;
  onSave: (notes: string) => void;
}

const PLACEHOLDER = [
  "Next.js 15 App Router, React 19, TypeScript strict.",
  "Deps: use Dexie for local storage, never localStorage for data.",
  "Server keys live only in Route Handlers — never NEXT_PUBLIC_.",
  "Run `bun run typecheck` before telling me a change is done.",
].join("\n");

export default function SessionNotes({ open, onClose, notes, onSave }: SessionNotesProps) {
  const [draft, setDraft] = useState(notes);

  // Re-seed when the panel opens so an abandoned edit never silently persists.
  useEffect(() => {
    if (open) setDraft(notes);
  }, [open, notes]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        onSave(draft);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, onClose, onSave, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0"
      role="dialog"
      aria-modal="true"
      aria-label="Project notes"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* A sheet anchored to the bottom on a phone, so the keyboard that opens
          with this textarea does not cover the field being typed into. */}
      <div className="animate-rise flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0c0c0f]/98 shadow-2xl shadow-black/70 sm:max-h-[85dvh]">
        <header className="shrink-0 border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-[14px] font-medium text-white/90">Project notes</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-white/40">
            Sent with every message in this session, so Mino stops asking. Stack, conventions, paths,
            things it must not do.
          </p>
        </header>

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={PLACEHOLDER}
          rows={9}
          autoFocus
          // 16px on mobile so the on-screen keyboard does not zoom the page.
          className="min-h-[180px] w-full flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[16px] leading-[1.6] text-white/85 outline-none placeholder:text-white/20 sm:resize-y sm:text-[12.5px]"
        />

        <footer className="safe-bottom flex shrink-0 items-center gap-2 border-t border-white/[0.07] px-4 py-2.5">
          <span className="text-[10px] text-white/25">{draft.length} characters</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg px-3 text-[12px] text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/75"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="min-h-[40px] rounded-lg bg-[#6f5bea] px-4 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Save notes
          </button>
        </footer>
      </div>
    </div>
  );
}
