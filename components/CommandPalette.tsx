"use client";

import { MINO_MODES, type ModeId } from "@/lib/models";
import { availableChecks, runCheck, type CheckId } from "@/lib/verification";
import { useEffect, useMemo, useRef, useState } from "react";

// ── Mino — the command palette ───────────────────────────────────────────────
//
// A coding session is driven by reaching for the same handful of actions over
// and over. Leaving each of them behind a click that has to be found first is
// what makes an app feel like a website instead of a tool, so the common ones
// live behind one palette and one shortcut.

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  group: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  mode: ModeId;
  onModeChange: (mode: ModeId) => void;
  onNewChat: () => void;
  onNewCodeSession: () => void;
  onToggleNotes: () => void;
  onToggleFiles: () => void;
  onOpenSettings: () => void;
  onRunCheck: (check: CheckId) => void;
  checks: CheckId[];
  /** Shown in the Files entry so the user knows what is behind it. */
  fileCount: number;
}

export default function CommandPalette({
  open,
  onClose,
  mode,
  onModeChange,
  onNewChat,
  onNewCodeSession,
  onToggleNotes,
  onToggleFiles,
  onOpenSettings,
  onRunCheck,
  checks,
  fileCount,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      {
        id: "new-chat",
        title: "New chat",
        hint: "Start a fresh conversation",
        group: "Session",
        run: onNewChat,
      },
      {
        id: "new-code",
        title: "New code session",
        hint: "Mino 3.8 · 3.7 · 3.6 only",
        group: "Session",
        run: onNewCodeSession,
      },
      {
        id: "notes",
        title: "Project notes",
        hint: "Context that applies to this whole session",
        group: "Session",
        run: onToggleNotes,
      },
      {
        id: "files",
        title: "Working files",
        hint: fileCount > 0 ? `${fileCount} ${fileCount === 1 ? "file" : "files"} in this session` : "Show the session's file list",
        group: "Session",
        run: onToggleFiles,
      },
      {
        id: "settings",
        title: "Settings",
        hint: "Search, length, reasoning, appearance",
        group: "Mino",
        run: onOpenSettings,
      },
      ...checks.map<PaletteCommand>((check) => ({
        id: `check-${check}`,
        title: `Run ${check}`,
        hint: "Real output from the project",
        group: "Verify",
        run: () => onRunCheck(check),
      })),
    ];

    for (const modeOption of MINO_MODES) {
      list.push({
        id: `mode-${modeOption.id}`,
        title: `Switch to ${modeOption.name}`,
        hint: modeOption.blurb,
        group: "Mode",
        run: () => onModeChange(modeOption.id),
      });
    }

    return list;
  }, [checks, fileCount, onModeChange, onNewChat, onNewCodeSession, onOpenSettings, onRunCheck, onToggleFiles, onToggleNotes]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.title.toLowerCase().includes(needle) ||
        command.hint?.toLowerCase().includes(needle) ||
        command.group.toLowerCase().includes(needle)
    );
  }, [commands, query]);

  // Group labels repeat when filtering, so they are collected per run rather
  // than tracked as a mutable set.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return filtered.map((command) => {
      const showGroup = !seen.has(command.group);
      seen.add(command.group);
      return { command, showGroup };
    });
  }, [filtered]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCursor(0);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  if (!open) return null;

  const choose = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    // Run after the close so the palette is not re-rendered mid-action.
    window.setTimeout(command.run, 0);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-3 pt-[8vh] backdrop-blur-sm sm:px-4 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="animate-rise flex max-h-[84dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0c0c0f]/98 shadow-2xl shadow-black/70"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((value) => Math.min(value + 1, filtered.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(filtered[cursor]);
          }
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands…"
          // 16px rather than 14px: anything smaller makes iOS Safari zoom the
          // viewport on focus, which is the classic mobile-dialog bug.
          className="w-full shrink-0 border-b border-white/[0.07] bg-transparent px-4 py-3 text-[16px] text-white/90 outline-none placeholder:text-white/25 sm:text-[14px]"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <p className="px-3 py-4 text-center text-[12px] text-white/30">No command matches “{query}”.</p>
          )}

          {rows.map(({ command, showGroup }, index) => {
            const active = index === cursor;
            const isCurrentMode = command.id === `mode-${mode}`;
            return (
              <div key={command.id}>
                {showGroup && (
                  <div className="px-2.5 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/25">
                    {command.group}
                  </div>
                )}
                <button
                  type="button"
                  data-index={index}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(command)}
                  className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                    active ? "bg-white/[0.08]" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13.5px] text-white/90">
                      {command.title}
                      {isCurrentMode && (
                        <span className="rounded-full bg-[#9ee7ff]/15 px-1.5 py-0.5 text-[9px] font-medium text-[#9ee7ff]">
                          current
                        </span>
                      )}
                    </span>
                    {command.hint && (
                      <span className="mt-0.5 block truncate text-[11px] text-white/35">{command.hint}</span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-white/[0.06] px-4 py-2 text-[10px] text-white/25">
          {/* The keyboard hints are meaningless without a keyboard, so they are
              desktop-only; a touch user taps the row directly. */}
          <span className="hidden sm:inline">↑↓ navigate</span>
          <span className="hidden sm:inline">↵ run</span>
          <span className="hidden sm:inline">esc close</span>
          <span className="sm:hidden">Tap to run</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Wires ⌘K / Ctrl-K globally.
 *
 * Bound on the window rather than a focused element so the palette is reachable
 * from anywhere, including from inside the composer, and suppressed only while
 * the user is typing into a field where a bare "k" would be text.
 */
export function useCommandPaletteHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

/** Probes which checks the deployment can actually run. */
export function useAvailableChecks(): CheckId[] {
  const [checks, setChecks] = useState<CheckId[]>([]);
  useEffect(() => {
    let active = true;
    void availableChecks().then((result) => {
      if (active) setChecks(result);
    });
    return () => {
      active = false;
    };
  }, []);
  return checks;
}

/** Runs a check and reports the outcome through a callback. */
export function useRunCheck(onResult: (result: Awaited<ReturnType<typeof runCheck>>) => void) {
  const [running, setRunning] = useState<CheckId | null>(null);

  const run = async (check: CheckId) => {
    if (running) return;
    setRunning(check);
    try {
      onResult(await runCheck(check));
    } catch {
      onResult({
        check,
        passed: false,
        at: Date.now(),
        output: "The check could not be started.",
      });
    } finally {
      setRunning(null);
    }
  };

  return { run, running };
}
