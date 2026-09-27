"use client";

import { diffLines, diffStats, shortPath, toHunks } from "@/lib/diff";
import { resolveFile, type PendingFile } from "@/lib/workspace";
import { useMemo, useState } from "react";

// ── Mino — per-file review, one hunk at a time ──────────────────────────────
//
// A whole-file accept/reject is not review. The reason a diff view exists is so
// a person can disagree with a model about four lines while agreeing about the
// other sixty, so every hunk carries its own toggle and the resulting file is
// recomputed from those decisions rather than stored as a note.

interface FileReviewCardProps {
  file: PendingFile;
  onDecisionChange: (path: string, hunkId: string, accepted: boolean) => void;
  onCopy: (path: string, content: string) => void;
  /** True while this file's decisions are the ones being sent on the next turn. */
  attached: boolean;
  onToggleAttach: (path: string) => void;
}

export function FileReviewCard({ file, onDecisionChange, onCopy, attached, onToggleAttach }: FileReviewCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const hunks = useMemo(() => toHunks(diffLines(file.base ?? "", file.proposed)), [file]);
  const stats = useMemo(() => diffStats(hunks), [hunks]);
  const resolved = useMemo(
    () => resolveFile(file.proposed, file.base, file.decisions),
    [file]
  );

  const rejectedCount = hunks.filter((hunk) => file.decisions[hunk.id] === false).length;
  const rejectedLines = hunks
    .filter((hunk) => file.decisions[hunk.id] === false)
    .reduce((total, hunk) => total + hunk.lines.filter((line) => line.kind === "add").length, 0);

  // The visible slice keeps a long file scannable; "show all" is one click away
  // rather than a hidden truncation.
  const VISIBLE = 3;
  const visibleHunks = showAll ? hunks : hunks.slice(0, VISIBLE);

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-black/25">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-white/[0.06] bg-white/[0.03] px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-white/35 transition-transform ${expanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="truncate font-mono text-[12px] text-white/85" title={file.path}>
            {shortPath(file.path)}
          </span>
        </button>

        {file.base === null && (
          <span className="rounded-full bg-emerald-400/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-emerald-300/80">
            new
          </span>
        )}

        <span className="font-mono text-[11px] text-emerald-300/70">+{stats.added}</span>
        <span className="font-mono text-[11px] text-red-300/70">−{stats.removed}</span>

        {/* Attaching and copying are the two things a phone user does most, so
            they are sized to a real thumb target rather than a desktop hover
            affordance. */}
        <button
          type="button"
          onClick={() => onToggleAttach(file.path)}
          className={`min-h-[32px] rounded-full border px-3 text-[11px] font-medium transition-colors ${
            attached
              ? "border-[#9ee7ff]/30 bg-[#9ee7ff]/10 text-[#9ee7ff]"
              : "border-white/10 text-white/55 hover:bg-white/[0.06] hover:text-white/75"
          }`}
          title="Send this file with your next message"
        >
          {attached ? "Attached" : "Attach"}
        </button>

        <button
          type="button"
          onClick={() => onCopy(file.path, resolved)}
          className="min-h-[32px] rounded-full border border-white/10 px-3 text-[11px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/75"
        >
          Copy
        </button>
      </header>

      {expanded && (
        <div className="divide-y divide-white/[0.05]">
          {hunks.length === 0 && (
            <p className="px-3 py-2.5 text-[11px] text-white/35">
              No change to this file — the contents already match the workspace.
            </p>
          )}

          {visibleHunks.map((hunk) => {
            const accepted = file.decisions[hunk.id] !== false;
            return (
              <div key={hunk.id}>
                <div className="flex items-center gap-2 bg-white/[0.02] px-3 py-1">
                  <span className="font-mono text-[10px] text-white/25">{hunk.header}</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => onDecisionChange(file.path, hunk.id, !accepted)}
                    className={`min-h-[30px] rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                      accepted
                        ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300/80 hover:bg-emerald-400/15"
                        : "border-red-400/25 bg-red-400/[0.08] text-red-300/80 hover:bg-red-400/15"
                    }`}
                  >
                    {accepted ? "Accepted" : "Rejected"}
                  </button>
                </div>

                {/* On a phone the two gutter columns cost 72px of a ~360px
                    screen, which is a fifth of the width spent on digits. One
                    column is kept and the +/- marker carries the meaning, which
                    is the part a reviewer actually reads.

                    `min-w-0` on the row is load-bearing: a flex child defaults to
                    `min-width: auto`, so without it a long code line refuses to
                    shrink and pushes the whole card — and the page — wider than
                    the screen, defeating the horizontal scroll entirely. */}
                <pre className="overflow-x-auto font-mono text-[11.5px] leading-[1.55]">
                  {hunk.lines.map((line, index) => {
                    const inRejectedHunk = !accepted;
                    const tone = line.kind === "add"
                      ? inRejectedHunk
                        ? "bg-red-400/[0.05] text-red-200/45 line-through decoration-red-400/30"
                        : "bg-emerald-400/[0.08] text-emerald-100/90"
                      : line.kind === "remove"
                        ? inRejectedHunk
                          ? "bg-white/[0.03] text-white/40"
                          : "bg-red-400/[0.07] text-red-200/55 line-through decoration-red-400/25"
                        : "text-white/45";
                    const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " ";
                    return (
                      <div key={index} className={`flex min-w-max ${tone}`}>
                        <span className="hidden w-9 shrink-0 select-none pr-2 text-right text-[10px] text-white/20 sm:block">
                          {line.oldLine ?? ""}
                        </span>
                        <span className="hidden w-9 shrink-0 select-none pr-2 text-right text-[10px] text-white/20 sm:block">
                          {line.newLine ?? ""}
                        </span>
                        <span className="w-9 shrink-0 select-none pr-2 text-right text-[10px] text-white/20 sm:hidden">
                          {line.newLine ?? line.oldLine ?? ""}
                        </span>
                        <span className="w-4 shrink-0 select-none text-center text-white/25">{marker}</span>
                        <span className="whitespace-pre pr-3">{line.text || " "}</span>
                      </div>
                    );
                  })}
                </pre>
              </div>
            );
          })}

          {hunks.length > VISIBLE && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full px-3 py-2 text-left text-[11px] text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/70"
            >
              Show {hunks.length - VISIBLE} more hunks
            </button>
          )}

          {rejectedCount > 0 && (
            <p className="bg-amber-400/[0.04] px-3 py-2 text-[11px] leading-relaxed text-amber-200/70">
              {rejectedCount} {rejectedCount === 1 ? "hunk" : "hunks"} rejected
              {rejectedLines > 0 ? ` · ${rejectedLines} added ${rejectedLines === 1 ? "line" : "lines"} left out` : ""}.{" "}
              Mino will be told about this file in its accepted form only.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
