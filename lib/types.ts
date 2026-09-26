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
  error?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

/** Shape sent to OpenRouter (OpenAI-compatible multimodal content). */
export type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ApiMessage {
  role: Role;
  content: string | ApiContentPart[];
}
