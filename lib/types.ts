// ── Mino shared types ────────────────────────────────────────────────────────

export type Role = "user" | "assistant" | "system";
export type SearchMode = "auto" | "always" | "off";

export interface SearchSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface ImageAttachment {
  /** base64 data URL (image/jpeg after client-side compression) */
  url: string;
  name: string;
  size: number;
}

/** An image produced by the image model, stored locally like any attachment. */
export interface GeneratedImage {
  /** base64 data URL of the generated image */
  url: string;
  /** the prompt that produced it */
  prompt: string;
  mime: string;
  model: string;
  createdAt: number;
}

export interface DocumentAttachment {
  /** Plain text extracted from a supported text/code file. */
  name: string;
  size: number;
  text: string;
  truncated?: boolean;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: Role;
  content: string;
  images?: ImageAttachment[];
  /** set when the message was produced by the image model rather than chat */
  generatedImages?: GeneratedImage[];
  documents?: DocumentAttachment[];
  model?: string;
  searchQuery?: string;
  sources?: SearchSource[];
  /** tokens billed for this completion, when reported by the API */
  usage?: { prompt: number; completion: number; total: number };
  /**
   * The model stopped because it reached its output limit, so the answer is
   * incomplete. This is not the same as a short answer and must not be shown as
   * one — a truncated file looks exactly like a finished one until you say so.
   */
  truncated?: boolean;
  error?: string;
  /**
   * Earlier versions of this answer, newest previous first.
   *
   * A retry or an edit used to delete the answer it replaced. It now keeps it:
   * the answer being replaced is the one the new answer is judged against, and
   * throwing it away means the comparison can never be made. `content` still
   * holds the live answer — see lib/variants.ts for the whole rule.
   */
  variants?: string[];
  /** Which answer is on screen: absent or 0 is the live one, k is variants[k - 1]. */
  variantIndex?: number;
  createdAt: number;
  updatedAt?: number;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Folder this chat sits under in the sidebar, or nothing for unfiled. */
  folder?: string;
}

/** A user-named folder for chats. Local to this browser, like the sidebar. */
export interface ChatFolder {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * One thing Mino is told to remember between conversations.
 *
 * Deliberately a flat list of short sentences rather than a document store or
 * a vector index. The whole list is injected into every request, so it is read
 * constantly and must be cheap to reason about — and when an answer comes back
 * wrong, being able to read the entire memory in one glance is what makes the
 * cause findable. A retrieval system would hide the very thing beingdebugged.
 *
 * Capture is manual. Nothing here is written by a model on its own initiative:
 * a fact Mino decided to remember is a fact nobody reviewed, and a wrong one
 * is worse than none because it is confidently applied forever.
 */
export interface Memory {
  id: string;
  /** One sentence, in the user's own words. */
  text: string;
  createdAt: number;
  updatedAt: number;
}

/** Multimodal content shape sent to a provider's OpenAI-compatible endpoint. */
export type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ApiMessage {
  role: Role;
  content: string | ApiContentPart[];
}
