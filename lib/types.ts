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
  /**
   * The response with the file blocks removed, for rendering as prose.
   *
   * Stored rather than recomputed so a file is shown once — as a reviewable
   * diff — instead of twice, as both a code block and that diff.
   */
  prose?: string;
  /**
   * Files the assistant proposed in this message, parsed out of fenced blocks
   * whose info string names a path. Empty for an ordinary chat message.
   */
  files?: CodeFile[];
  /**
   * The reasoning steps the assistant declared before answering, in order.
   * Rendered as a timeline so a long generation has visible progress.
   */
  steps?: CodeStep[];
  /**
   * Output of a verification run the user asked for, fed back on the next turn.
   */
  verification?: VerificationResult;
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
  /**
   * "code" for a session started from Mino Code, "chat" for anything else.
   * The sidebar groups by this so a working session reads differently from a
   * conversation.
   */
  kind?: SessionKind;
  /**
   * Free-form project context that applies to the whole session — stack,
   * conventions, paths, constraints. Sent with every request in this chat, so
   * the model does not have to be re-told the same constraints each turn.
   */
  notes?: string;
}

export type SessionKind = "chat" | "code";

/** A file the assistant proposed, extracted from a named fenced code block. */
export interface CodeFile {
  /** Repo-relative path, taken verbatim from the fence info string. */
  path: string;
  language: string;
  /** Full proposed contents. */
  content: string;
  /** Line count, for the file list. */
  lines: number;
  /**
   * Per-hunk decisions the user made while reviewing, keyed by hunk id.
   *
   * Stored on the message rather than in component state so a rejection
   * survives a reload. Unset means accepted, which is why a proposal can be
   * taken as-is without touching a toggle.
   */
  decisions?: Record<string, boolean>;
}

export type StepStatus = "done" | "active" | "failed";

/** One declared reasoning step, shown as progress rather than prose. */
export interface CodeStep {
  label: string;
  status: StepStatus;
}

export interface VerificationResult {
  /** The check that ran, e.g. "typecheck". */
  check: string;
  passed: boolean;
  /** Trimmed combined output, already safe to display. */
  output: string;
  at: number;
}

/** Shape sent to OpenRouter (OpenAI-compatible multimodal content). */
export type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ApiMessage {
  role: Role;
  content: string | ApiContentPart[];
}
