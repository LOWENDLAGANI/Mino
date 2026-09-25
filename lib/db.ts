import Dexie, { type Table } from "dexie";
import type { Chat, ChatMessage } from "./types";

// ── Mino — zero-login client-side persistence (IndexedDB via Dexie) ─────────

export const MINO_SYSTEM_PROMPT =
  "You are Mino, an advanced AI assistant operating on the Mino platform. " +
  "You were created and developed strictly by Minetallest. CRITICAL DIRECTIVES: " +
  "1. NEVER refer to yourself as ChatGPT, Claude, Assistant, or any underlying model name. " +
  "2. If asked about your identity, creator, or platform, ALWAYS state that you are 'Mino, created by Minetallest'. " +
  "3. Maintain a helpful, concise, and intelligent persona at all times without breaking character.";

export class MinoDB extends Dexie {
  chats!: Table<Chat, string>;
  messages!: Table<ChatMessage, string>;

  constructor() {
    super("mino-db");
    this.version(1).stores({
      chats: "id, updatedAt, pinned",
      messages: "id, chatId, createdAt",
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

export async function importBackup(payload: BackupPayload): Promise<{ chats: number; messages: number }> {
  if (payload?.app !== "mino" || !Array.isArray(payload.chats) || !Array.isArray(payload.messages)) {
    throw new Error("Invalid Mino backup file");
  }
  await db.transaction("rw", db.chats, db.messages, async () => {
    await db.chats.bulkPut(payload.chats);
    await db.messages.bulkPut(payload.messages);
  });
  return { chats: payload.chats.length, messages: payload.messages.length };
}

// ── Mode preference (persisted outside Dexie to survive before DB open) ─────

import type { ModeId } from "./models";

const MODE_KEY = "mino:selected-mode";

export function loadSelectedMode(): ModeId {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === "dev" ? "dev" : "auto";
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
