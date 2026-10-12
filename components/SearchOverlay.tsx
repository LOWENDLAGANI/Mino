"use client";

// ── Search overlay ───────────────────────────────────────────────────────────
// The command-palette search: one floating panel for chat titles and message
// text, opened from the sidebar icon or Ctrl/Cmd+K. It lives outside the
// sidebar list on purpose — a search box that pushes the chat list down is a
// search box that costs the space it needs to show results.

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db, searchMessages, type MessageSearchHit } from "@/lib/db";
import type { Chat } from "@/lib/types";

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
}

export default function SearchOverlay({ open, onClose, onSelectChat }: SearchOverlayProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const chats = useLiveQuery(
    () => (open ? db.chats.orderBy("updatedAt").reverse().toArray() : ([] as Chat[])),
    [open],
    [] as Chat[]
  );
  const hits = useLiveQuery(
    () => (open ? searchMessages(query) : ([] as MessageSearchHit[])),
    [open, query],
    [] as MessageSearchHit[]
  );

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const titleHits = needle
    ? chats.filter((chat) => chat.title.toLowerCase().includes(needle)).slice(0, 8)
    : [];
  const hasResults = titleHits.length > 0 || (hits?.length ?? 0) > 0;

  const choose = (chatId: string) => {
    onSelectChat(chatId);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70" style={{ backdropFilter: "blur(6px)" }} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Search chats and messages"
        className="animate-pop relative flex max-h-[70dvh] w-full max-w-lg flex-col overflow-hidden rounded-[22px] border border-white/[0.1] bg-[#141f1a] shadow-2xl shadow-black/80"
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.07] px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="shrink-0 text-white/40" aria-hidden>
            <circle cx="10.8" cy="10.8" r="6.3" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            placeholder="Search chats and messages…"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/30"
            aria-label="Search query"
          />
          <kbd className="hidden shrink-0 rounded-md border border-white/[0.09] bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-white/35 sm:block">
            Esc
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {needle.length < 2 ? (
            <p className="px-3 py-4 text-[12px] leading-relaxed text-white/35">
              Type at least two letters. Everything here stays on this device — message text is
              never sent anywhere to be searched.
            </p>
          ) : !hasResults ? (
            <p className="px-3 py-4 text-[12px] leading-relaxed text-white/35">
              No matching chats or messages.
            </p>
          ) : (
            <>
              {titleHits.length > 0 && (
                <>
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
                    Chats
                  </div>
                  <ul>
                    {titleHits.map((chat) => (
                      <li key={chat.id}>
                        <button
                          type="button"
                          onClick={() => choose(chat.id)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{chat.title}</span>
                          <span className="shrink-0 text-[10px] text-white/30">
                            {new Date(chat.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {(hits?.length ?? 0) > 0 && (
                <>
                  <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
                    Messages
                  </div>
                  <ul>
                    {hits?.map((hit) => (
                      <li key={hit.messageId}>
                        <button
                          type="button"
                          onClick={() => choose(hit.chatId)}
                          className="block w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
                        >
                          <span className="block truncate text-[12px] text-white/75">{hit.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-white/35">{hit.snippet}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
