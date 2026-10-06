"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSubscription } from "@/lib/useSubscription";
import {
  db,
  createFolder,
  deleteFolder,
  setChatFolder,
  clearAllData,
  exportBackup,
  importBackup,
  type BackupPayload,
} from "@/lib/db";
import { moveChatToTrash } from "@/lib/trash";
import type { Chat, ChatFolder } from "@/lib/types";
import { markChatDeleted, syncChatDelete, syncChatWipe } from "@/lib/firebaseHistory";
import { nameInitial } from "@/lib/visitorName";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import MinoMark from "@/components/MinoMark";
import SearchOverlay from "@/components/SearchOverlay";
import TrashOverlay from "@/components/TrashOverlay";
import GalleryOverlay from "@/components/GalleryOverlay";

interface SidebarProps {
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  temporary: boolean;
  onToggleTemporary: () => void;
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  displayName: string;
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

/**
 * One icon in the utility toolbar.
 *
 * Icons rather than labelled rows: this strip is the app's control surface the
 * way a browser tab strip is — always visible, never costing the chat list its
 * vertical space — and every one of them carries both an aria-label and a
 * title, so nothing here is learned by guessing.
 */
function ToolbarButton({
  label,
  onClick,
  badge,
  children,
}: {
  label: string;
  onClick: () => void;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative flex h-10 w-10 items-center justify-center rounded-xl text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white"
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="pointer-events-none absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#2f6b48] px-1 text-[8px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/**
 * One labelled row in a chat's hold menu.
 *
 * Icon *and* words, never an icon alone: the four symbols this replaces were
 * stacked at the edge of every row and misclicked precisely because they
 * carried no text. A menu that names each action needs no guessing, which is
 * the whole reason the features moved in here.
 */
function RowMenuButton({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.06] ${
        danger
          ? "text-red-300/75 hover:bg-red-500/[0.08] hover:text-red-200"
          : "text-white/70 hover:text-white"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-75">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

export default function Sidebar({
  activeChatId,
  onSelectChat,
  onNewChat,
  temporary,
  onToggleTemporary,
  open,
  onClose,
  onOpenSettings,
  displayName,
}: SidebarProps) {
  const chats = useLiveQuery(
    () => db.chats.orderBy("updatedAt").reverse().toArray(),
    [],
    [] as Chat[]
  );
  const folders = useLiveQuery(
    () => db.folders.orderBy("name").toArray(),
    [],
    [] as ChatFolder[]
  );
  // The two queues the toolbar badges read: how many chats are in the trash
  // and how many messages are waiting for their scheduled moment.
  const trashCount = useLiveQuery(() => db.trash.count(), [], 0);
  const scheduledCount = useLiveQuery(() => db.scheduled.count(), [], 0);

  // What this visitor has paid for. The promotion at the bottom of the sidebar
  // changes shape entirely once they have: selling Mino Lunar to somebody who
  // already has it is the kind of small dishonesty that makes a pricing page
  // stop being believed.
  const { subscription } = useSubscription();
  const hasLunar = subscription?.plan === "lunar";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  // Folders: which one the list is filtered to, whether the new-folder input
  // is open, whose "move to folder" menu is open, and the chat waiting for a
  // folder that is being created from inside that menu.
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [fileChatId, setFileChatId] = useState<string | null>(null);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  // The chat row's own menu: whose is open, and the hold gesture that opens
  // it. One labelled popup replaces four stacked icon buttons that crowded
  // each other at the edge of every row in this narrow rail.
  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<{ x: number; y: number } | null>(null);
  // Armed when a hold just opened the menu, so the tap that ends the hold
  // dismisses nothing and navigates nowhere — it only closes the menu.
  const heldRef = useRef(false);

  const clearHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartRef.current = null;
  };

  /** Arms the hold: 450ms without a slip opens this row's menu. */
  const startHold = (chatId: string, event: ReactPointerEvent) => {
    // The rename field lives inside the row; a hold there is typing.
    if ((event.target as HTMLElement).closest("input")) return;
    clearHold();
    heldRef.current = false;
    holdStartRef.current = { x: event.clientX, y: event.clientY };
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      heldRef.current = true;
      setFileChatId(null);
      setMenuChatId(chatId);
    }, 450);
  };

  /** A finger or cursor that drifted is scrolling, not holding. */
  const watchHold = (event: ReactPointerEvent) => {
    const start = holdStartRef.current;
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8) clearHold();
  };

  // Ctrl/Cmd+K opens search from anywhere in the app — the shortcut people
  // expect since every other tool they use has one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The hold menu behaves like any context menu: it closes when something
  // else is touched, and Escape always gets out of it.
  useEffect(() => {
    if (!menuChatId) return;
    const onDown = (event: Event) => {
      if (!(event.target as HTMLElement).closest("[data-row-menu]")) setMenuChatId(null);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuChatId(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuChatId]);

  // A hold in flight when the list unmounts must not leave a stray timer to
  // open a menu on something that is no longer on screen.
  useEffect(() => clearHold, []);

  const closeFolderComposer = () => {
    setCreatingFolder(false);
    setPendingChatId(null);
    setNewFolderName("");
  };

  const submitFolder = async () => {
    const folder = await createFolder(newFolderName);
    const waiting = pendingChatId;
    closeFolderComposer();
    if (!folder) return;
    // A folder created from a chat's menu exists to hold *that* chat, so the
    // move happens with the create — otherwise the folder appears and the
    // conversation is still sitting where it was.
    if (waiting) await setChatFolder(waiting, folder.id);
  };

  const fileInto = async (chatId: string, folderId: string | undefined) => {
    await setChatFolder(chatId, folderId);
    setFileChatId(null);
  };

  const removeFolder = async (id: string) => {
    await deleteFolder(id);
    if (folderFilter === id) setFolderFilter(null);
  };

  // One filter, applied once: folder first (cheap, indexed). Pinned chats
  // still float to the top of whatever survives it. Title search moved to the
  // overlay, so this list is never squeezed by a half-typed query.
  const visibleChats = (chats ?? [])
    .filter((chat) => !folderFilter || chat.folder === folderFilter)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

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
    // Recorded before the local wipe, so an interrupted delete cannot be undone by
    // the next sync handing the chat back.
    void syncChatWipe();
    await clearAllData();
    setConfirmClear(false);
    setNotice("All data cleared");
    onNewChat();
  };

  /** Deleting parks the chat in the trash first; the sync marker still goes
   *  down so the account does not hand it back on another device. */
  const handleDeleteChat = (chatId: string, active: boolean) => {
    markChatDeleted(chatId);
    void syncChatDelete(chatId);
    void moveChatToTrash(chatId);
    if (active) onNewChat();
  };

  const chooseChat = (chatId: string) => {
    setFileChatId(null);
    setMenuChatId(null);
    setSearchOpen(false);
    setTrashOpen(false);
    setGalleryOpen(false);
    onSelectChat(chatId);
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
        className={`hairline-r fixed inset-y-0 left-0 z-40 flex w-[292px] shrink-0 flex-col bg-[#080d0a] transition-transform duration-300 ease-out md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="safe-top flex items-center justify-between px-5 pb-4 pt-6">
          <button
            onClick={onNewChat}
            className="flex min-w-0 items-center gap-3 text-left"
            aria-label="Start a new Mino chat"
            title="Mino"
          >
            <MinoMark className="h-9 w-9 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-[23px] font-semibold leading-none tracking-[-0.045em] text-white">
                Mino
              </span>
              <span className="mt-1 block text-[10px] text-white/35">by Minetallest</span>
            </span>
          </button>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white md:hidden"
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
            data-tutorial="sidebar-new-chat"
            className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.075] px-4 py-3 text-[14px] font-medium text-white transition-colors hover:bg-white/[0.11]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.5 8.5 0 0 1-3.6-.8L4 20l1.5-3.7A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" />
              <path d="M12 8v7M8.5 11.5h7" />
            </svg>
            New chat
          </button>

          {/* Temporary chat. A whole conversation that is never written down —
              not to this device, not to the account — so it is a switch rather
              than a chat of its own in the list below. */}
          <button
            onClick={onToggleTemporary}
            aria-pressed={temporary}
            title={temporary ? "Leave temporary chat" : "Start a temporary chat that is not saved"}
            className={`mt-2 flex w-full items-center gap-3 rounded-2xl border px-4 py-2.5 text-[14px] font-medium transition-colors ${
              temporary
                ? "border-[#2f6b48]/40 bg-[#2f6b48]/[0.14] text-white"
                : "border-white/[0.07] bg-white/[0.03] text-white/70 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={temporary ? "text-[#a9d8bb]" : "text-white/50"}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span className="flex-1 text-left">Temporary chat</span>
            <span
              className={`shrink-0 text-[9px] font-semibold uppercase tracking-wide ${
                temporary ? "text-[#a9d8bb]" : "text-white/30"
              }`}
            >
              {temporary ? "On" : "Not saved"}
            </span>
          </button>
        </div>

        {/* The control strip: search, images, trash, library, settings. Icons
            only — these are the app's permanent controls, and labelled rows
            would eat the space the conversation list needs to breathe. */}
        <div
          className="mt-4 flex items-center justify-between px-4"
          role="toolbar"
          aria-label="Mino tools"
          data-tutorial="sidebar-utilities"
        >
          <ToolbarButton label="Search chats and messages (Ctrl+K)" onClick={() => setSearchOpen(true)}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="10.8" cy="10.8" r="6.3" />
              <path d="m16 16 4 4" />
            </svg>
          </ToolbarButton>
          <ToolbarButton label="Image gallery" onClick={() => setGalleryOpen(true)}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
              <circle cx="9" cy="10" r="1.5" />
              <path d="M20 15.5 15.5 11 6 19.5" />
            </svg>
          </ToolbarButton>
          <ToolbarButton label="Trash — restore deleted chats" onClick={() => setTrashOpen(true)} badge={trashCount}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12" />
              <path d="M10 11v5.5M14 11v5.5" />
            </svg>
          </ToolbarButton>
          <ToolbarButton label="Library — import a backup" onClick={() => fileInputRef.current?.click()}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v15H7.5A2.5 2.5 0 0 0 5 20.5v-15Z" />
              <path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H20M9 7h6M9 10h6" />
            </svg>
          </ToolbarButton>
          <ToolbarButton label="Settings" onClick={onOpenSettings}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.78-.32 1.6 1.6 0 0 0-.97 1.47V21a1.9 1.9 0 1 1-3.8 0v-.1A1.6 1.6 0 0 0 9.4 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3a1.9 1.9 0 1 1 0-3.8h.1A1.6 1.6 0 0 0 4.6 9.4a1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 .97-1.47V3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.78-.32l.05-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47.97H21a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.47.97Z" />
            </svg>
          </ToolbarButton>
        </div>

        <div className="mt-3 space-y-1 px-4">
          <a
            href="/plus"
            aria-label={hasLunar ? "Your Mino Lunar plan" : "Mino Lunar — upgrade"}
            className="group relative flex w-full items-center gap-2 overflow-hidden rounded-2xl border border-[#2f6b48]/30 bg-gradient-to-r from-[#2f6b48]/[0.14] via-[#a9d8bb]/[0.07] to-transparent px-2.5 py-2 text-[13px] font-medium text-white shadow-[0_0_26px_-10px_rgba(47,107,72,0.85)] transition-shadow hover:shadow-[0_0_34px_-8px_rgba(47,107,72,1)]"
          >
            {/* Slow sheen so the row reads as the live one without moving. */}
            <span
              aria-hidden
              className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-gradient-to-r from-transparent via-white/[0.14] to-transparent"
            />
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#2f6b48]/15 text-[#a9d8bb] shadow-[0_0_16px_-4px_rgba(47,107,72,0.9)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 18h16L14.4 8.6a1.4 1.4 0 0 0-2.4 0L9.6 12 6.8 6.6a1.2 1.2 0 0 0-2.2.5L4 18Z" />
                <path d="M4 18h16" />
              </svg>
            </span>
            <span className="relative flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate">Mino Lunar</span>
              {hasLunar ? (
                <span className="shrink-0 rounded-full bg-[#2f6b48]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#a9d8bb]">
                  ✓ Your plan
                </span>
              ) : (
                <span className="animate-breathe shrink-0 rounded-full bg-[#2f6b48]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#a9d8bb]">
                  {subscription?.plan === "mini" ? "Upgrade" : "New"}
                </span>
              )}
            </span>
          </a>
          <a
            href="/donate"
            className="group relative flex w-full items-center gap-2 overflow-hidden rounded-2xl border border-rose-300/20 bg-gradient-to-r from-rose-400/[0.13] via-rose-300/[0.06] to-transparent px-2.5 py-2 text-[13px] font-medium text-white shadow-[0_0_26px_-12px_rgba(251,113,133,0.9)] transition-shadow hover:shadow-[0_0_30px_-8px_rgba(251,113,133,1)]"
          >
            <span
              aria-hidden
              className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-gradient-to-r from-transparent via-white/[0.12] to-transparent"
            />
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-rose-400/15 text-rose-200 shadow-[0_0_16px_-4px_rgba(251,113,133,0.9)]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 20.7s-7.6-4.7-7.6-10A4.5 4.5 0 0 1 12 7.9a4.5 4.5 0 0 1 7.6 2.8c0 5.3-7.6 10-7.6 10Z" />
              </svg>
            </span>
            <span className="relative truncate">Support Mino</span>
          </a>
        </div>

        {(folders?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="group" aria-label="Chat folders">
            <button
              type="button"
              onClick={() => setFolderFilter(null)}
              aria-pressed={folderFilter === null}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                folderFilter === null
                  ? "border-[#2f6b48]/50 bg-[#2f6b48]/15 text-white"
                  : "border-white/[0.08] bg-white/[0.03] text-white/45 hover:text-white/80"
              }`}
            >
              All
            </button>
            {folders?.map((folder) => (
              <span
                key={folder.id}
                className={`flex items-center rounded-full border text-[11px] transition-colors ${
                  folderFilter === folder.id
                    ? "border-[#2f6b48]/50 bg-[#2f6b48]/15 text-white"
                    : "border-white/[0.08] bg-white/[0.03] text-white/45"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setFolderFilter(folderFilter === folder.id ? null : folder.id)}
                  aria-pressed={folderFilter === folder.id}
                  className="px-2.5 py-1 hover:text-white"
                >
                  {folder.name}
                </button>
                {folderFilter === folder.id && (
                  <button
                    type="button"
                    onClick={() => void removeFolder(folder.id)}
                    className="pr-1.5 text-white/35 transition-colors hover:text-red-300"
                    aria-label={`Remove the ${folder.name} folder`}
                    title="Remove the folder — its chats stay"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-4" data-tutorial="sidebar-recent">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <span className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-white/30">
              {folderFilter
                ? folders?.find((folder) => folder.id === folderFilter)?.name ?? "Recent"
                : "Recent"}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {scheduledCount > 0 && (
                <span
                  className="flex items-center gap-1 rounded-full bg-[#2f6b48]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#a9d8bb]"
                  title={`${scheduledCount} message${scheduledCount === 1 ? "" : "s"} waiting to be sent`}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  {scheduledCount}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setPendingChatId(null);
                  setNewFolderName("");
                  setCreatingFolder(true);
                }}
                className="text-[10px] text-white/30 transition-colors hover:text-white/70"
              >
                + Folder
              </button>
            </span>
          </div>

          {creatingFolder && (
            <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 animate-rise">
              <input
                autoFocus
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitFolder();
                  if (event.key === "Escape") closeFolderComposer();
                }}
                placeholder="Folder name"
                maxLength={32}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/30"
              />
              <button
                type="button"
                onClick={() => void submitFolder()}
                className="rounded-lg bg-[#2f6b48] px-2 py-1 text-[10px] font-semibold text-black"
              >
                Add
              </button>
              <button
                type="button"
                onClick={closeFolderComposer}
                className="text-[10px] text-white/40 transition-colors hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}

          <ul className="space-y-1">
            {visibleChats.map((chat, index) => {
              const active = chat.id === activeChatId;
              // The last rows open upward so the menu never leaves the rail.
              const menuFlip = index >= visibleChats.length - 2;
              return (
                <li key={chat.id} className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    title="Click to open · hold for options"
                    onClick={() => {
                      // A hold just opened the menu; the tap that ends it
                      // must not also navigate into the chat.
                      if (heldRef.current) {
                        heldRef.current = false;
                        return;
                      }
                      chooseChat(chat.id);
                    }}
                    onPointerDown={(event) => startHold(chat.id, event)}
                    onPointerUp={clearHold}
                    onPointerCancel={clearHold}
                    onPointerLeave={clearHold}
                    onPointerMove={watchHold}
                    onContextMenu={(event) => {
                      // Right-click opens the same menu a hold does.
                      event.preventDefault();
                      clearHold();
                      setFileChatId(null);
                      setMenuChatId(chat.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") chooseChat(chat.id);
                      // The keyboard's context-menu gesture opens the menu too.
                      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                        event.preventDefault();
                        setFileChatId(null);
                        setMenuChatId(chat.id);
                      }
                    }}
                    className={`group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 transition-colors ${active ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"}`}
                  >
                    {editingId === chat.id ? (
                      <input
                        autoFocus
                        value={draftTitle}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            const title = draftTitle.trim();
                            if (title) void db.chats.update(chat.id, { title, updatedAt: Date.now() });
                            setEditingId(null);
                          }
                          if (event.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => {
                          const title = draftTitle.trim();
                          if (title) void db.chats.update(chat.id, { title, updatedAt: Date.now() });
                          setEditingId(null);
                        }}
                        className="min-w-0 flex-1 rounded-md border border-[#3f7d5c]/40 bg-black/20 px-1.5 py-1 text-[13px] text-white outline-none"
                      />
                    ) : (
                      <>
                        {chat.pinned && <span className="shrink-0 text-[10px] text-[#a9d8bb]" title="Pinned">◆</span>}
                        <span className="min-w-0 flex-1 truncate text-[13px] text-white/75">{chat.title}</span>
                        <span className={`shrink-0 text-[10px] text-white/25 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                          {timeAgo(chat.updatedAt)}
                        </span>
                      </>
                    )}
                  </div>

                  {fileChatId === chat.id && (
                    <div className="absolute right-2 top-full z-30 mt-1 w-44 rounded-xl border border-white/10 bg-[#0f1713] p-1 shadow-2xl shadow-black/60 animate-rise">
                      <button
                        type="button"
                        onClick={() => void fileInto(chat.id, undefined)}
                        className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        No folder
                      </button>
                      {folders?.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => void fileInto(chat.id, folder.id)}
                          className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.06] ${
                            chat.folder === folder.id ? "text-[#a9d8bb]" : "text-white/60 hover:text-white"
                          }`}
                        >
                          {folder.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setFileChatId(null);
                          setPendingChatId(chat.id);
                          setNewFolderName("");
                          setCreatingFolder(true);
                        }}
                        className="mt-0.5 block w-full border-t border-white/[0.07] px-2.5 py-1.5 text-left text-[11px] text-white/45 transition-colors hover:text-white"
                      >
                        + New folder…
                      </button>
                    </div>
                  )}

                  {menuChatId === chat.id && (
                    <div
                      data-row-menu
                      role="menu"
                      aria-label={`Options for ${chat.title}`}
                      className={`animate-pop absolute left-2 z-40 w-48 rounded-2xl border border-white/[0.08] bg-[#141f1a]/[0.98] p-1.5 shadow-2xl shadow-black/80 backdrop-blur-xl ${
                        menuFlip ? "bottom-full mb-1" : "top-full mt-1"
                      }`}
                    >
                      <RowMenuButton
                        icon={
                          <svg width="13" height="13" viewBox="0 0 24 24" fill={chat.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />
                          </svg>
                        }
                        label={chat.pinned ? "Unpin chat" : "Pin chat"}
                        onClick={() => {
                          setMenuChatId(null);
                          void db.chats.update(chat.id, { pinned: !chat.pinned, updatedAt: Date.now() });
                        }}
                      />
                      <RowMenuButton
                        icon={
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17Z" />
                          </svg>
                        }
                        label="Move to folder"
                        onClick={() => {
                          setMenuChatId(null);
                          setFileChatId(chat.id);
                        }}
                      />
                      <RowMenuButton
                        icon={
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="m4 16-.8 4.8L8 20l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16Z" />
                            <path d="m13.5 6.5 4 4" />
                          </svg>
                        }
                        label="Rename chat"
                        onClick={() => {
                          setMenuChatId(null);
                          setEditingId(chat.id);
                          setDraftTitle(chat.title);
                        }}
                      />
                      <RowMenuButton
                        danger
                        icon={
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4.5h6V7" />
                          </svg>
                        }
                        label="Delete chat"
                        onClick={() => {
                          setMenuChatId(null);
                          handleDeleteChat(chat.id, active);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {visibleChats.length === 0 && (
            <p className="px-2 py-2 text-[12px] leading-relaxed text-white/30">
              {folderFilter
                ? "Nothing in this folder yet. Hold a chat to move it here."
                : "Your conversations will appear here."}
            </p>
          )}
        </div>

        <div className="border-t border-white/[0.07] px-4 pb-4 pt-3" data-tutorial="sidebar-data">
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
          <div className="mt-3 flex items-center gap-2.5 border-t border-white/[0.06] pt-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#c9e6d4] via-[#4a8a67] to-[#1f4a33] text-[11px] font-bold text-black">{nameInitial(displayName)}</div>
            <span className="min-w-0 flex-1 truncate text-[12px] text-white/55">{displayName || "Guest"}</span>
            <span className="flex shrink-0 items-center gap-1">
              <a href="/notes" className="rounded-lg px-1.5 py-1 text-[10px] text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white" title="News from the developers">News</a>
              <a href="/about" className="rounded-lg px-1.5 py-1 text-[10px] text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white" title="About Mino">About</a>
            </span>
          </div>
        </div>
      </aside>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onSelectChat={chooseChat} />
      <TrashOverlay
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onRestored={(chatId) => {
          setNotice("Chat restored");
          chooseChat(chatId);
        }}
      />
      <GalleryOverlay open={galleryOpen} onClose={() => setGalleryOpen(false)} onSelectChat={chooseChat} />
    </>
  );
}
