// ── Image gallery ────────────────────────────────────────────────────────────
// Every picture this device has produced or attached, newest first. It is a
// view over the message store rather than a table of its own: an image in Mino
// is always part of a conversation, and a gallery that kept its own copy would
// be a second place for the truth to drift out of step with the first.

import { db } from "./db";

export interface GalleryItem {
  messageId: string;
  chatId: string;
  /** Base64 data URL, exactly as the message stores it. */
  url: string;
  /** The prompt for a generated image, the filename for an attachment. */
  label: string;
  kind: "generated" | "attachment";
  createdAt: number;
}

const MESSAGE_SCAN_LIMIT = 4000;

export async function listGallery(limit = 240): Promise<GalleryItem[]> {
  const messages = await db.messages.orderBy("createdAt").reverse().limit(MESSAGE_SCAN_LIMIT).toArray();
  const items: GalleryItem[] = [];
  for (const message of messages) {
    for (const image of message.generatedImages ?? []) {
      items.push({
        messageId: message.id,
        chatId: message.chatId,
        url: image.url,
        label: image.prompt,
        kind: "generated",
        createdAt: image.createdAt,
      });
    }
    for (const image of message.images ?? []) {
      items.push({
        messageId: message.id,
        chatId: message.chatId,
        url: image.url,
        label: image.name,
        kind: "attachment",
        createdAt: message.createdAt,
      });
    }
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items.slice(0, limit);
}
