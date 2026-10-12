"use client";

// ── Trash overlay ────────────────────────────────────────────────────────────
// Deleted chats, restorable for thirty days on this device. The list is the
// honest shape of the feature: what was deleted, when, and two buttons —
// put it back, or make it permanent.

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { deleteForever, restoreFromTrash, TRASH_RETENTION_MS, type TrashEntry } from "@/lib/trash";

interface TrashOverlayProps {
  open: boolean;
  onClose: () => void;
  onRestored: (chatId: string) => void;
}

function daysLeft(entry: TrashEntry, now: number): number {
  const elapsed = now - entry.deletedAt;
  return Math.max(0, Math.ceil((TRASH_RETENTION_MS - elapsed) / 86_400_000));
}

export default function TrashOverlay({ open, onClose, onRestored }: TrashOverlayProps) {
  const entries = useLiveQuery(
    () => (open ? db.trash.orderBy("deletedAt").reverse().toArray() : ([] as TrashEntry[])),
    [open],
    [] as TrashEntry[]
  );
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) setConfirmId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center px-3 pb-3 sm:items-center sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70" style={{ backdropFilter: "blur(6px)" }} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Trash"
        className="animate-pop relative flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-[24px] border border-white/[0.1] bg-[#141f1a] shadow-2xl shadow-black/80"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">Trash</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Close trash"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {entries.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-white/35">
              The trash is empty. Deleted chats wait here for 30 days before they are gone for
              good.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{entry.title}</span>
                    <span className="shrink-0 text-[10px] text-white/30">
                      {daysLeft(entry, now)}d left
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-white/35">
                    {entry.messages.length} message{entry.messages.length === 1 ? "" : "s"} ·
                    deleted{" "}
                    {new Date(entry.deletedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void restoreFromTrash(entry.id).then(() => onRestored(entry.id));
                      }}
                      className="shrink-0 rounded-lg bg-[#2f6b48]/30 px-2.5 py-1 text-[10px] font-semibold text-[#c9e6d4] transition-colors hover:bg-[#2f6b48]/45"
                    >
                      Restore
                    </button>
                    {confirmId === entry.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteForever(entry.id);
                            setConfirmId(null);
                          }}
                          className="shrink-0 rounded-lg bg-red-500/25 px-2.5 py-1 text-[10px] font-semibold text-red-200 transition-colors hover:bg-red-500/40"
                        >
                          Delete forever?
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="shrink-0 text-[10px] text-white/40 transition-colors hover:text-white"
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(entry.id)}
                        className="shrink-0 text-[10px] text-white/35 transition-colors hover:text-red-300"
                      >
                        Delete forever
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-white/[0.06] px-5 py-3">
          <p className="text-[10px] leading-relaxed text-white/30">
            Kept on this device only. Restoring a chat here brings it back in this browser — not
            on a phone that also deleted it.
          </p>
        </footer>
      </section>
    </div>
  );
}
