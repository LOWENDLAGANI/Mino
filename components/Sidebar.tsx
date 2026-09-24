"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  deleteChat,
  clearAllData,
  exportBackup,
  importBackup,
  type BackupPayload,
} from "@/lib/db";
import type { Chat } from "@/lib/types";
import { formatBytes } from "@/lib/imageUtils";
import { useEffect, useRef, useState } from "react";

// ── Sidebar: IndexedDB-backed chat history, backup/restore, danger zone ──────

interface SidebarProps {
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  open: boolean;
  onClose: () => void;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Sidebar({ activeChatId, onSelectChat, onNewChat, open, onClose }: SidebarProps) {
  const chats = useLiveQuery(
    () => db.chats.orderBy("updatedAt").reverse().toArray(),
    [],
    [] as Chat[]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleExport = async () => {
    try {
      const backup = await exportBackup();
      downloadJson(`mino-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
      setNotice("Backup downloaded ✓");
    } catch {
      setNotice("Export failed");
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;
      const { chats: nChats, messages: nMessages } = await importBackup(payload);
      setNotice(`Imported ${nChats} chats · ${nMessages} messages ✓`);
    } catch (err) {
      setNotice(err instanceof Error ? `Import failed: ${err.message}` : "Import failed");
    }
  };

  const handleClearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    await clearAllData();
    setConfirmClear(false);
    setNotice("All data cleared");
    onNewChat();
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-ink-700 bg-ink-900 transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-950/50">
            M
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold tracking-wide text-zinc-100">Mino</div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">by Minetallest</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-ink-700 hover:text-zinc-300 md:hidden"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        {/* New chat */}
        <div className="px-3">
          <button
            onClick={onNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-ink-500 hover:bg-ink-700"
          >
            <span className="text-lg leading-none text-indigo-400">+</span> New chat
          </button>
        </div>

        {/* History */}
        <div className="mt-4 flex-1 overflow-y-auto px-2 pb-2">
          <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            History {chats.length > 0 && `· ${chats.length}`}
          </div>
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-xs leading-relaxed text-zinc-600">
              No conversations yet. Everything is stored locally in your browser — no account needed.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectChat(chat.id)}
                    onKeyDown={(e) => e.key === "Enter" && onSelectChat(chat.id)}
                    className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      chat.id === activeChatId
                        ? "bg-ink-700 text-zinc-100"
                        : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        chat.id === activeChatId ? "bg-indigo-400" : "bg-zinc-700 group-hover:bg-zinc-500"
                      }`}
                    />
                    <span className="flex-1 truncate">{chat.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteChat(chat.id);
                        if (chat.id === activeChatId) onNewChat();
                      }}
                      className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                      aria-label={`Delete chat: ${chat.title}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Data management */}
        <div className="border-t border-ink-700 p-3">
          {notice && (
            <div className="mb-2 rounded-md border border-indigo-900/60 bg-indigo-950/40 px-2.5 py-1.5 text-xs text-indigo-300 animate-fade-in-up">
              {notice}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="flex-1 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-ink-700"
            >
              Export
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-ink-700"
            >
              Import
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={handleClearAll}
            className={`mt-2 w-full rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              confirmClear
                ? "bg-red-600 text-white hover:bg-red-500"
                : "border border-ink-600 bg-ink-800 text-zinc-500 hover:border-red-900 hover:text-red-400"
            }`}
          >
            {confirmClear ? "Click again to confirm — delete everything" : "Clear all data"}
          </button>
          <p className="mt-2 text-center text-[10px] leading-relaxed text-zinc-600">
            Chats are stored in IndexedDB ({formatBytes(0) === "0 B" ? "locally" : "locally"}) — never uploaded.
          </p>
        </div>
      </aside>
    </>
  );
}
