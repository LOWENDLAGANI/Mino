// ── Mino shared types ────────────────────────────────────────────────────────

export type Role = "user" | "assistant" | "system";

export interface ImageAttachment {
  /** base64 data URL (image/jpeg after client-side compression) */
  url: string;
  name: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: Role;
  content: string;
  images?: ImageAttachment[];
  model?: string;
  /** tokens billed for this completion, when reported by the API */
  usage?: { prompt: number; completion: number; total: number };
  error?: string;
  createdAt: number;
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
