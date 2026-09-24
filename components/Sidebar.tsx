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
import { useEffect, useRef, useState } from "react";

// ── Sidebar: chat history, backup/restore — quiet and minimal ────────────────

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

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
      setNotice("Backup saved to your downloads");
    } catch {
      setNotice("Export failed");
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const payload = JSON.parse(await file.text()) as BackupPayload;
      const { chats: nChats, messages: nMessages } = await importBackup(payload);
      setNotice(`Imported ${nChats} chats · ${nMessages} messages`);
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
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          style={{ backdropFilter: "blur(2px)" }}
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`hairline-r fixed inset-y-0 left-0 z-40 flex w-[270px] shrink-0 flex-col bg-raised transition-transform duration-200 ease-out md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="safe-top flex items-center gap-2.5 px-4 pb-2 pt-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-canvas">
            M
          </div>
          <div className="flex-1 leading-tight">
            <div className="text-[13px] font-semibold tracking-tight text-text-hi">Mino</div>
            <div className="text-[10px] text-text-low">by Minetallest</div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-low hover:bg-hover hover:text-text-mid md:hidden"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* New chat */}
        <div className="px-3 pb-2 pt-1">
          <button
            onClick={onNewChat}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-mid transition-colors hover:bg-hover hover:text-text-hi"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New chat
          </button>
        </div>

        {/* History */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {(chats?.length ?? 0) > 0 && (
            <div className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-text-low">
              Recents
            </div>
          )}
          <ul className="space-y-px">
            {chats?.map((chat) => {
              const active = chat.id === activeChatId;
              return (
                <li key={chat.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectChat(chat.id)}
                    onKeyDown={(e) => e.key === "Enter" && onSelectChat(chat.id)}
                    className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                      active ? "bg-hover" : "hover:bg-hover/60"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${active ? "text-text-hi" : "text-text-body"}`}>
                        {chat.title}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[10px] text-text-low transition-opacity ${active ? "" : "group-hover:opacity-0"}`}>
                      {timeAgo(chat.updatedAt)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteChat(chat.id);
                        if (active) onNewChat();
                      }}
                      className="hidden shrink-0 rounded p-0.5 text-text-low hover:text-red-400 group-hover:block"
                      aria-label={`Delete ${chat.title}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {chats?.length === 0 && (
            <p className="px-2.5 pt-3 text-[12px] leading-relaxed text-text-low">
              No conversations yet. Everything stays on this device.
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="hairline-t p-3">
          {notice && (
            <div className="mb-2 rounded-md bg-hover px-2.5 py-1.5 text-[11px] text-text-mid animate-rise">
              {notice}
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={handleExport}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-text-mid transition-colors hover:bg-hover hover:text-text-hi"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              Export
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-text-mid transition-colors hover:bg-hover hover:text-text-hi"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              Import
            </button>
            <button
              onClick={handleClearAll}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                confirmClear
                  ? "bg-red-500/15 text-red-400"
                  : "text-text-mid hover:bg-hover hover:text-red-400"
              }`}
            >
              {confirmClear ? "Confirm?" : "Clear"}
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
          <p className="mt-2 text-center text-[10px] text-text-low">
            Stored locally in your browser
          </p>
        </div>
      </aside>
    </>
  );
}
