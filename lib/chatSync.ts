// ── How two devices' chat histories are reconciled ───────────────────────────
// Pure logic only. Nothing here touches Firebase or IndexedDB, so the rules
// that decide what a sync keeps, drops, and overwrites can be tested without a
// browser or a network.
//
// The whole point of this file is that a sync is a **union**. Mino writes chat
// history to the account so it follows the person to another browser, and it
// was failing at exactly that: the data was written correctly and then never
// read back. Fixing that by replacing local history with remote history would
// have been worse than the bug — a phone and a computer each hold conversations
// the other has never seen, and last-one-wins would delete one of them on every
// visit. So every merge here adds what is missing and overwrites only what is
// demonstrably newer.

import type { Chat, ChatMessage } from "./types";

/** A chat as it comes back from the account, parsed and validated. */
export interface RemoteChat {
  chat: Chat;
  messages: ChatMessage[];
}

/**
 * Parses one node of `users/$uid/chats` into a chat and its messages.
 *
 * Everything read off the network is untrusted, so every field is checked
 * rather than cast. A node missing its id, or a message with a role the
 * interface cannot render, is dropped instead of being written into the local
 * database — a malformed entry must not be able to break the chat list.
 */
export function parseRemoteChat(value: unknown): RemoteChat | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as {
    id?: unknown;
    title?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    pinned?: unknown;
    messages?: unknown;
  };
  if (typeof entry.id !== "string" || !entry.id) return null;

  const chat: Chat = {
    id: entry.id,
    title: typeof entry.title === "string" ? entry.title : "New chat",
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
    pinned: Boolean(entry.pinned),
  };

  const messages: ChatMessage[] = [];
  if (entry.messages && typeof entry.messages === "object") {
    for (const raw of Object.values(entry.messages as Record<string, unknown>)) {
      const message = raw as Partial<ChatMessage> | null;
      if (!message || typeof message.id !== "string") continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      messages.push({
        id: message.id,
        chatId: chat.id,
        role: message.role,
        content: typeof message.content === "string" ? message.content : "",
        model: typeof message.model === "string" ? message.model : undefined,
        searchQuery: typeof message.searchQuery === "string" ? message.searchQuery : undefined,
        sources: Array.isArray(message.sources) ? message.sources : undefined,
        usage: message.usage,
        error: typeof message.error === "string" ? message.error : undefined,
        truncated: Boolean(message.truncated),
        createdAt: typeof message.createdAt === "number" ? message.createdAt : 0,
        updatedAt: typeof message.updatedAt === "number" ? message.updatedAt : undefined,
      });
    }
  }

  return { chat, messages };
}

function timeOf(record: { createdAt: number; updatedAt?: number }): number {
  return record.updatedAt ?? record.createdAt;
}

/**
 * Decides what to do with one remote chat.
 *
 * Returns null when the remote copy has nothing to add, which is the common
 * case: most chats on an account are already here, untouched, after a sync that
 * wrote them up from this same browser.
 */
export interface ChatMerge {
  chat: Chat;
  /** Set when the chat itself needs creating. */
  addChat: boolean;
  /** Set when the remote chat is newer and its title or pin should be adopted. */
  chatUpdate: Partial<Chat> | null;
  /** Messages this browser has never seen. */
  addMessages: ChatMessage[];
  /** Messages present on both sides where the remote copy is newer. */
  updateMessages: Array<{ id: string; changes: Partial<ChatMessage> }>;
}

export function planChatMerge(remote: RemoteChat, localChat: Chat | undefined, localMessages: ChatMessage[]): ChatMerge {
  const localById = new Map(localMessages.map((message) => [message.id, message]));

  const addMessages: ChatMessage[] = [];
  const updateMessages: Array<{ id: string; changes: Partial<ChatMessage> }> = [];

  for (const message of remote.messages) {
    const local = localById.get(message.id);
    if (!local) {
      addMessages.push(message);
      continue;
    }
    if (timeOf(message) <= timeOf(local)) continue;

    // Only the fields that are ever synced are listed. Images, documents and
    // generated images were never uploaded, so the local copy is the only one
    // that has them and it keeps them by not being overwritten here.
    updateMessages.push({
      id: message.id,
      changes: {
        content: message.content,
        model: message.model,
        searchQuery: message.searchQuery,
        sources: message.sources,
        usage: message.usage,
        error: message.error,
        truncated: message.truncated,
        updatedAt: timeOf(message),
      },
    });
  }

  if (!localChat) {
    return { chat: remote.chat, addChat: true, chatUpdate: null, addMessages, updateMessages };
  }

  const chatUpdate =
    remote.chat.updatedAt > (localChat.updatedAt ?? 0)
      ? {
          title: remote.chat.title,
          updatedAt: remote.chat.updatedAt,
          // A pin made on either device is a pin. Unpinning is the one change
          // that needs the newer side to win, and the timestamp is what decides.
          pinned: remote.chat.pinned,
        }
      : null;

  return { chat: localChat, addChat: false, chatUpdate, addMessages, updateMessages };
}