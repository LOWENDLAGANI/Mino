import Dexie, { type Table } from "dexie";
import type { Chat, ChatFolder, ChatMessage, Memory } from "./types";
import { displayedContent } from "./variants";

// ── Mino — zero-login client-side persistence (IndexedDB via Dexie) ─────────
//
// Client-side only. Anything the server keeps private — the identity system
// prompt, provider keys, wire model ids — lives in a separate module so it is
// never compiled into the page bundle. See lib/systemPrompt.ts.

export class MinoDB extends Dexie {
  chats!: Table<Chat, string>;
  messages!: Table<ChatMessage, string>;
  memories!: Table<Memory, string>;
  folders!: Table<ChatFolder, string>;

  constructor() {
    super("mino-db");
    this.version(1).stores({
      chats: "id, updatedAt, pinned",
      messages: "id, chatId, createdAt",
    });
    // Added in a later version rather than inside version 1. Dexie upgrades
    // existing databases from whatever version they were left at, so editing
    // the original declaration would not reach a browser that already has one.
    this.version(2).stores({
      chats: "id, updatedAt, pinned",
      messages: "id, chatId, createdAt",
      memories: "id, createdAt",
    });
    // Folders, and the index that lets the sidebar ask "everything in this
    // folder" of Dexie rather than of JavaScript. Declared as a new version
    // for the same reason as version 2: an existing browser has to be upgraded,
    // not re-declared.
    this.version(3).stores({
      chats: "id, updatedAt, pinned, folder",
      messages: "id, chatId, createdAt",
      memories: "id, createdAt",
      folders: "id, name",
    });
  }
}

export const db = new MinoDB();

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Chat operations ──────────────────────────────────────────────────────────

export async function createChat(title = "New chat"): Promise<Chat> {
  const now = Date.now();
  const chat: Chat = { id: uid(), title, createdAt: now, updatedAt: now };
  await db.chats.add(chat);
  return chat;
}

export async function touchChat(chatId: string): Promise<void> {
  await db.chats.update(chatId, { updatedAt: Date.now() });
}

/** Derive a short chat title from the first user message. */
export async function maybeAutoTitle(chatId: string, firstUserText: string): Promise<void> {
  const chat = await db.chats.get(chatId);
  if (!chat || chat.title !== "New chat") return;
  const clean = firstUserText.replace(/\s+/g, " ").trim();
  if (!clean) return;
  const title = clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
  await db.chats.update(chatId, { title, updatedAt: Date.now() });
}

export async function deleteChat(chatId: string): Promise<void> {
  await db.transaction("rw", db.chats, db.messages, async () => {
    await db.messages.where("chatId").equals(chatId).delete();
    await db.chats.delete(chatId);
  });
}

export async function clearAllData(): Promise<void> {
  await db.transaction("rw", db.chats, db.messages, async () => {
    await db.messages.clear();
    await db.chats.clear();
  });
}

// ── Message operations ───────────────────────────────────────────────────────

export async function addMessage(msg: Omit<ChatMessage, "id" | "createdAt">): Promise<ChatMessage> {
  const full: ChatMessage = { ...msg, id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
  await db.messages.add(full);
  await touchChat(full.chatId);
  return full;
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  await db.messages.update(id, { content, updatedAt: Date.now() });
}

export async function setMessageError(id: string, error: string): Promise<void> {
  await db.messages.update(id, { error, updatedAt: Date.now() });
}

export async function setMessageUsage(
  id: string,
  usage: { prompt: number; completion: number; total: number }
): Promise<void> {
  await db.messages.update(id, { usage, updatedAt: Date.now() });
}

// ── Backup / restore ─────────────────────────────────────────────────────────

export interface BackupPayload {
  app: "mino";
  version: 1;
  exportedAt: string;
  chats: Chat[];
  messages: ChatMessage[];
}

export async function exportBackup(): Promise<BackupPayload> {
  const [chats, messages] = await Promise.all([db.chats.toArray(), db.messages.toArray()]);
  return {
    app: "mino",
    version: 1,
    exportedAt: new Date().toISOString(),
    chats,
    messages,
  };
}

/** A restore is a whole-file replace, so a hostile or accidental huge file has a bound. */
const MAX_IMPORT_CHATS = 2000;
const MAX_IMPORT_MESSAGES = 50000;

export async function importBackup(payload: BackupPayload): Promise<{ chats: number; messages: number }> {
  if (payload?.app !== "mino" || !Array.isArray(payload.chats) || !Array.isArray(payload.messages)) {
    throw new Error("Invalid Mino backup file");
  }
  if (payload.chats.length > MAX_IMPORT_CHATS || payload.messages.length > MAX_IMPORT_MESSAGES) {
    throw new Error("That backup is too large to restore");
  }
  await db.transaction("rw", db.chats, db.messages, async () => {
    await db.chats.bulkPut(payload.chats);
    await db.messages.bulkPut(payload.messages);
  });
  return { chats: payload.chats.length, messages: payload.messages.length };
}

// ── Folders ───────────────────────────────────────────────────────────────────
// Sidebar organisation only. A folder is a name and an id — no nesting, no
// ordering table — because the question it answers is "which conversations are
// about work", and anything more than one level deep stops answering that.

const FOLDER_NAME_MAX = 32;

export async function createFolder(name: string): Promise<ChatFolder | null> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, FOLDER_NAME_MAX);
  if (!clean) return null;
  const existing = await db.folders
    .filter((folder) => folder.name.toLowerCase() === clean.toLowerCase())
    .first();
  if (existing) return existing;
  const folder: ChatFolder = { id: uid(), name: clean, createdAt: Date.now() };
  await db.folders.add(folder);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, FOLDER_NAME_MAX);
  if (!clean) return;
  await db.folders.update(id, { name: clean });
}

/**
 * Deletes a folder and files its chats back under nothing.
 *
 * The chats are kept. A folder is a label on conversations somebody wrote, and
 * deleting the label by accident must not be able to delete the writing — the
 * row of chats it held simply returns to the main list.
 */
export async function deleteFolder(id: string): Promise<void> {
  await db.transaction("rw", db.folders, db.chats, async () => {
    await db.folders.delete(id);
    await db.chats.where("folder").equals(id).modify({ folder: undefined });
  });
}

export async function setChatFolder(chatId: string, folderId: string | undefined): Promise<void> {
  // Deliberately not `touchChat`: filing a conversation is not conversation
  // activity, and it must not jump to the top of the list for it.
  await db.chats.update(chatId, { folder: folderId });
}

// ── Full-text search ─────────────────────────────────────────────────────────

export interface MessageSearchHit {
  chatId: string;
  messageId: string;
  title: string;
  /** The match with a little text either side, ready to render. */
  snippet: string;
  createdAt: number;
}

const SNIPPET_RADIUS = 46;
const SEARCH_LIMIT = 30;

function snippetFor(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text.slice(0, SNIPPET_RADIUS * 2).trim();
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + needle.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Finds messages whose text contains the query, newest first.
 *
 * IndexedDB has no full-text index, so this filters the whole message store —
 * which is fine precisely because the store is one person's own history on
 * their own device: tens of thousands of rows at the outside, scanned in
 * memory in a few milliseconds. The moment this ever became a server query it
 * would need an index, and it is deliberately not a server query: message text
 * never leaves the device to be searched.
 *
 * Answers the *displayed* variant, because a search that returns text you
 * cannot then find on screen is worse than no search at all.
 */
export async function searchMessages(query: string): Promise<MessageSearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const [chats, matches] = await Promise.all([
    db.chats.toArray(),
    db.messages
      .orderBy("createdAt")
      .reverse()
      .filter((message) => displayedContent(message).toLowerCase().includes(needle))
      .limit(SEARCH_LIMIT)
      .toArray(),
  ]);
  const titles = new Map(chats.map((chat) => [chat.id, chat.title]));

  return matches.map((message) => ({
    chatId: message.chatId,
    messageId: message.id,
    title: titles.get(message.chatId) ?? "Chat",
    snippet: snippetFor(displayedContent(message), needle),
    createdAt: message.createdAt,
  }));
}

// ── Mode preference (persisted outside Dexie to survive before DB open) ─────

import type { ModeId } from "./models";

const MODE_KEY = "mino:selected-mode";

export function loadSelectedMode(): ModeId {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    // "dev" is the pre-rename id of Code mode, so an existing browser that
    // selected it before the rename keeps its choice.
    return v === "code" || v === "dev" ? "code" : "auto";
  } catch {
    return "auto";
  }
}

export function saveSelectedMode(mode: ModeId): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // non-fatal: preference simply won't persist
  }
}
