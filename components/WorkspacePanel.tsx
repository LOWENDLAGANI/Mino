"use client";

import { languageFromPath } from "@/lib/diff";
import type { WorkspaceFile } from "@/lib/workspace";
import { useState } from "react";

// ── Mino — the session's working files ───────────────────────────────────────
//
// The transcript is a log; this is the state. It answers the question a coding
// session constantly asks — "what does this file look like now?" — without
// scrolling back through turns to find the last version that was kept.

interface WorkspacePanelProps {
  files: WorkspaceFile[];
  /** Paths the user has attached to the next message. */
  attached: string[];
  onToggleAttach: (path: string) => void;
  onCopy: (path: string, content: string) => void;
  onClose: () => void;
  open: boolean;
}

export default function WorkspacePanel({ files, attached, onToggleAttach, onCopy, onClose, open }: WorkspacePanelProps) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  if (!open) return null;

  const filtered = files.filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase()));
  const active = files.find((file) => file.path === viewing) ?? null;

  // On a phone this is a bottom sheet rather than a sidebar: a 340px column
  // beside the thread would leave the thread too narrow to read a diff, and a
  // sheet keeps the whole width for the code while still being dismissable with
  // a thumb. On a desktop it docks to the right as before.
  return (
    <>
      {/* Scrim only exists on mobile, where the sheet floats over the thread. */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="safe-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[78dvh] flex-col rounded-t-3xl border-t border-white/[0.09] bg-[#0a0a0c] shadow-2xl shadow-black/70 animate-rise md:static md:z-auto md:max-h-none md:w-[340px] md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:bg-black/20 md:shadow-none"
        role="dialog"
        aria-label="Working files"
      >
      <div
        className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 md:hidden"
        aria-hidden="true"
      />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
          Files · {files.length}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/80"
          aria-label="Close files"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      {files.length > 4 && (
        <div className="shrink-0 border-b border-white/[0.06] px-3 py-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter files"
            className="w-full rounded-lg border border-white/[0.07] bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/85 outline-none placeholder:text-white/25 focus:border-white/15"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-[11px] leading-relaxed text-white/30">
            No files yet. When Mino writes one, it appears here with a diff you can review hunk by hunk.
          </p>
        )}

        {filtered.map((file) => {
          const isAttached = attached.includes(file.path);
          const isViewing = viewing === file.path;
          return (
            <div key={file.path} className="border-b border-white/[0.05]">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setViewing(isViewing ? null : file.path)}
                  className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 text-left"
                  title={file.path}
                >
                  <span className="shrink-0 rounded bg-white/[0.06] px-1 font-mono text-[9px] uppercase text-white/40">
                    {languageFromPath(file.path).slice(0, 4)}
                  </span>
                  <span className="truncate font-mono text-[12px] text-white/75">{file.path}</span>
                  <span className="shrink-0 text-[10px] text-white/25">{file.content.split("\n").length}L</span>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleAttach(file.path)}
                  className={`min-h-[32px] shrink-0 rounded-full border px-2.5 text-[10px] font-medium transition-colors ${
                    isAttached
                      ? "border-[#9ee7ff]/30 bg-[#9ee7ff]/10 text-[#9ee7ff]"
                      : "border-white/10 text-white/40 hover:text-white/70"
                  }`}
                  title="Send with the next message"
                >
                  {isAttached ? "Attached" : "Attach"}
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(file.path, file.content)}
                  className="min-h-[32px] shrink-0 rounded-full border border-white/10 px-2.5 text-[10px] text-white/45 transition-colors hover:text-white/70"
                >
                  Copy
                </button>
              </div>

              {isViewing && (
                <pre className="max-h-64 overflow-auto border-t border-white/[0.05] bg-black/40 px-3 py-2 font-mono text-[11px] leading-[1.55] text-white/65">
                  {file.content}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {active && (
        <div className="sr-only" aria-live="polite">
          Viewing {active.path}
        </div>
      )}
      </aside>
    </>
  );
}
