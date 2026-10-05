// ── Temporary chat — the thread that is never written down ──────────────────
// A temporary chat behaves exactly like a real one while you are having it, and
// leaves no trace when you close it. That is a promise about *storage*, not
// about the interface, so it is kept here as pure logic with no dependency on
// Dexie or Firebase: if this module cannot reach the database, nothing built on
// it can either, and the promise cannot rot as the send path grows around it.
//
// The interface deliberately mirrors the few `lib/db.ts` helpers the thread
// needs, so the chat page can hold either one behind the same calls.

import type { ChatMessage } from "./types";
import { uid } from "./db";

export type MessageInput = Omit<ChatMessage, "id" | "createdAt">;

export class TempThread {
  private rows: ChatMessage[] = [];
  private lastAt = 0;

  /** Every message in the thread, oldest first. */
  list(): ChatMessage[] {
    return [...this.rows];
  }

  get(id: string): ChatMessage | undefined {
    return this.rows.find((message) => message.id === id);
  }

  /** Returns the stored message so the caller can address it by id, exactly
      as `addMessage` does for a chat that is being kept.

      The clock is nudged forward when two messages would land in the same
      millisecond, because editing and regenerating both cut the thread by time
      and two messages sharing a timestamp makes that cut ambiguous: a retry
      could delete the question it was asked, or keep the answer it replaced. */
  append(input: MessageInput): ChatMessage {
    const now = Math.max(Date.now(), this.lastAt + 1);
    this.lastAt = now;
    const message: ChatMessage = { ...input, id: uid(), createdAt: now, updatedAt: now };
    this.rows = [...this.rows, message];
    return message;
  }

  patch(id: string, changes: Partial<ChatMessage>): void {
    this.rows = this.rows.map((message) =>
      message.id === id ? { ...message, ...changes, updatedAt: Date.now() } : message
    );
  }

  drop(id: string): void {
    this.rows = this.rows.filter((message) => message.id !== id);
  }

  /** Editing a message and regenerating an answer both throw away everything
      that came after it, which is why both need a cut by time rather than a
      cut by one id. */
  dropFrom(id: string, inclusive: boolean): void {
    const target = this.get(id);
    if (!target) return;
    this.rows = this.rows.filter((message) =>
      inclusive ? message.createdAt < target.createdAt : message.createdAt <= target.createdAt
    );
  }

  clear(): void {
    this.rows = [];
    this.lastAt = 0;
  }
}
