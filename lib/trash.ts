// ── Trash ────────────────────────────────────────────────────────────────────
// A deleted chat is recoverable for thirty days on this device. Deletion still
// happens immediately everywhere the reader can see — the chat leaves the list
// and the account sync records the deletion — but the rows are parked here
// first, because an accidental tap on a long conversation is exactly the kind
// of loss a local-first product should be able to undo.
//
// The trash is device-local and never synced: the account holds the deletion,
// not the deleted thing, so restoring here cannot resurrect a chat on a phone
// that also deleted it.

import { db } from "./db";
import type { ChatMessage } from "./types";

export interface TrashEntry {
  /** The chat's original id, which is what a restore puts back. */
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  folder?: string;
  messages: ChatMessage[];
  deletedAt: number;
}

export const TRASH_RETENTION_MS = 30 * 86_400_000;

export function isTrashExpired(
  entry: { deletedAt: number },
  now: number,
  retentionMs: number = TRASH_RETENTION_MS
): boolean {
  return now - entry.deletedAt > retentionMs;
}

/** Parks a chat and its messages in the trash, removing them from the live DB. */
export async function moveChatToTrash(chatId: string): Promise<void> {
  const chat = await db.chats.get(chatId);
  if (!chat) return;
  const messages = await db.messages.where("chatId").equals(chatId).toArray();
  const entry: TrashEntry = {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    pinned: chat.pinned,
    folder: chat.folder,
    messages,
    deletedAt: Date.now(),
  };
  await db.transaction("rw", db.chats, db.messages, db.trash, async () => {
    await db.messages.where("chatId").equals(chatId).delete();
    await db.chats.delete(chatId);
    await db.trash.put(entry);
  });
}

/** Puts a trashed chat back with its messages. */
export async function restoreFromTrash(entryId: string): Promise<void> {
  const entry = await db.trash.get(entryId);
  if (!entry) return;
  await db.transaction("rw", db.chats, db.messages, db.trash, async () => {
    await db.chats.put({
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      // Restored as the most recent edit, so it surfaces at the top rather
      // than being buried under conversations that were never touched.
      updatedAt: Date.now(),
      pinned: entry.pinned,
      folder: entry.folder,
    });
    await db.messages.bulkPut(entry.messages);
    await db.trash.delete(entryId);
  });
}

export async function deleteForever(entryId: string): Promise<void> {
  await db.trash.delete(entryId);
}

/** Drops entries past retention. Runs on app start; returns how many went. */
export async function purgeTrash(now = Date.now()): Promise<number> {
  const expired = await db.trash.filter((entry) => isTrashExpired(entry, now)).toArray();
  if (expired.length > 0) await db.trash.bulkDelete(expired.map((entry) => entry.id));
  return expired.length;
}
