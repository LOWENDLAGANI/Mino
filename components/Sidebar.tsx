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
import { useEffect, useRef, useState, type ReactNode } from "react";
import MinoMark from "@/components/MinoMark";

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

function UtilityIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-white/55">
      {children}
    </span>
  );
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
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState("");

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
          className="fixed inset-0 z-30 bg-black/65 md:hidden"
          style={{ backdropFilter: "blur(5px)" }}
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`hairline-r fixed inset-y-0 left-0 z-40 flex w-[292px] shrink-0 flex-col bg-[#050506] transition-transform duration-300 ease-out md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="safe-top flex items-center justify-between px-5 pb-5 pt-6">
          <button onClick={onNewChat} className="flex items-center gap-3 text-left" aria-label="Start a new Mino chat">
            <MinoMark className="h-10 w-10" />
            <span>
              <span className="block text-[25px] font-semibold leading-none tracking-[-0.045em] text-white">Mino</span>
              <span className="mt-1 block text-[11px] text-white/35">by Minetallest</span>
            </span>
          </button>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white md:hidden"
            aria-label="Close menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="px-4">
          <button
            onClick={onNewChat}
            className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.075] px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-white/[0.11]"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.5 8.5 0 0 1-3.6-.8L4 20l1.5-3.7A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" />
              <path d="M12 8v7M8.5 11.5h7" />
            </svg>
            New chat
          </button>
        </div>

        <nav className="mt-5 space-y-1 px-4" aria-label="Mino utilities">
          <button className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[14px] text-white/60 transition-colors hover:bg-white/[0.05] hover:text-white" onClick={() => setShowSearch((value) => !value)}>
            <UtilityIcon>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4 4" />
              </svg>
            </UtilityIcon>
            Search chats
          </button>
          <button className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[14px] text-white/60 transition-colors hover:bg-white/[0.05] hover:text-white" onClick={() => fileInputRef.current?.click()}>
            <UtilityIcon>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v15H7.5A2.5 2.5 0 0 0 5 20.5v-15Z" /><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H20M9 7h6M9 10h6" />
              </svg>
            </UtilityIcon>
            Library
          </button>
        </nav>

        {showSearch && (
          <div className="px-4 pt-4">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your chats"
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-[#8b7cf6]/50"
            />
          </div>
        )}

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-4">
          <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/30">Recent</div>
          <ul className="space-y-1">
            {chats?.filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase())).map((chat) => {
              const active = chat.id === activeChatId;
              return (
                <li key={chat.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectChat(chat.id)}
                    onKeyDown={(e) => e.key === "Enter" && onSelectChat(chat.id)}
                    className={`group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-3 transition-colors ${active ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] text-white/75">{chat.title}</span>
                    <span className={`shrink-0 text-[10px] text-white/25 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                      {timeAgo(chat.updatedAt)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteChat(chat.id);
                        if (active) onNewChat();
                      }}
                      className="hidden shrink-0 rounded p-1 text-white/35 hover:text-red-300 group-hover:block"
                      aria-label={`Delete ${chat.title}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {chats?.filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase())).length === 0 && (
            <p className="px-2 py-2 text-[12px] leading-relaxed text-white/30">{search ? "No matching chats." : "Your conversations will appear here."}</p>
          )}
        </div>

        <div className="border-t border-white/[0.07] px-4 pb-4 pt-3">
          {notice && <div className="mb-2 rounded-xl bg-white/[0.07] px-3 py-2 text-[11px] text-white/65 animate-rise">{notice}</div>}
          <div className="flex items-center gap-1">
            <button onClick={handleExport} className="flex flex-1 items-center justify-center rounded-lg px-2 py-2 text-[11px] text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white">Export</button>
            <button onClick={() => fileInputRef.current?.click()} className="flex flex-1 items-center justify-center rounded-lg px-2 py-2 text-[11px] text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white">Import</button>
            <button onClick={handleClearAll} className={`flex flex-1 items-center justify-center rounded-lg px-2 py-2 text-[11px] transition-colors ${confirmClear ? "bg-red-500/15 text-red-300" : "text-white/45 hover:bg-white/[0.06] hover:text-red-300"}`}>
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
          <div className="mt-4 flex items-center gap-2.5 border-t border-white/[0.06] pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#b7f4ff] via-[#8c84ff] to-[#4640b6] text-[11px] font-bold text-black">M</div>
            <span className="min-w-0 flex-1 truncate text-[12px] text-white/55">Minetallest Mc</span>
            <span className="text-[11px] text-white/25">local only</span>
          </div>
        </div>
      </aside>
    </>
  );
}
