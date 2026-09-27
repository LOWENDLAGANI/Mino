import { db } from "./db";
import { diffLines, toHunks } from "./diff";
import type { CodeFile } from "./types";

// ── Mino — the file workspace for a Code session ─────────────────────────────
//
// A coding session is not a list of messages. The unit of continuity is the
// file: a user asks for a change, reviews the diff, rejects one hunk, and three
// turns later asks for something else in the same file. If the only record were
// the transcript, the rejected hunk would come back on the next turn as if it
// had been accepted, and the model would be reasoning about code the user never
// took.
//
// So the workspace is DERIVED, never stored separately. Each assistant message
// records the file it proposed plus the per-hunk decisions made while reviewing
// it. The current contents of a file are that message's proposal with its
// rejected hunks removed, walking forward through the session. There is exactly
// one source of truth, and a reload reproduces it.

export interface WorkspaceFile {
  path: string;
  language: string;
  /** The contents currently in the workspace — the accepted state. */
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** A proposal paired with the workspace state it was reviewed against. */
export interface PendingFile {
  path: string;
  language: string;
  /** What the assistant proposed. */
  proposed: string;
  /** The workspace version this was diffed against; null for a new file. */
  base: string | null;
  /** Per-hunk decision, stored on the message. Unset means accepted. */
  decisions: Record<string, boolean>;
  messageId: string;
}

/**
 * Applies per-hunk decisions to a proposal.
 *
 * A rejected hunk contributes its original lines and drops its new ones, so the
 * result is a real file rather than a record that a change was declined.
 */
export function resolveFile(proposed: string, base: string | null, decisions: Record<string, boolean>): string {
  const lines = diffLines(base ?? "", proposed);
  const hunks = toHunks(lines);
  if (hunks.length === 0) return proposed;

  const rejected = new Set(
    hunks.filter((hunk) => decisions[hunk.id] === false).map((hunk) => hunk.id)
  );
  if (rejected.size === 0) return proposed;

  // Walk the diff once, tracking which hunk each line belongs to, and emit the
  // new text. The grouping is the same one `toHunks` produced, so the hunk a
  // toggle refers to and the hunk applied here can never drift apart.
  let hunkIndex = 0;
  let inHunk = false;
  let dropping = false;
  const out: string[] = [];

  for (const line of lines) {
    if (line.kind === "context") {
      inHunk = false;
      dropping = false;
      out.push(line.text);
      continue;
    }
    if (!inHunk) {
      hunkIndex += 1;
      inHunk = true;
      dropping = decisions[`hunk-${hunkIndex}`] === false;
    }
    if (dropping) {
      // A removed line survives a rejection; an added one does not. That is
      // exactly what "undo this edit" means.
      if (line.kind === "remove") out.push(line.text);
      continue;
    }
    if (line.kind !== "remove") out.push(line.text);
  }

  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

/** Rebuilds the accepted state of every file touched in a session. */
export async function listWorkspace(chatId: string): Promise<WorkspaceFile[]> {
  const messages = await db.messages.where("chatId").equals(chatId).sortBy("createdAt");
  const files = new Map<string, WorkspaceFile>();

  for (const message of messages) {
    for (const file of message.files ?? []) {
      const existing = files.get(file.path);
      // The base is the previous accepted state, so consecutive proposals to the
      // same file diff against what the user actually kept.
      const base = existing?.content ?? null;
      const content = resolveFile(file.content, base, file.decisions ?? {});
      files.set(file.path, {
        path: file.path,
        language: file.language,
        content,
        createdAt: existing?.createdAt ?? message.createdAt,
        updatedAt: message.createdAt,
      });
    }
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Pairs each proposal with the workspace state it was reviewed against. */
export function buildPending(
  messageId: string,
  proposals: CodeFile[],
  workspace: WorkspaceFile[]
): PendingFile[] {
  return proposals.map((proposal) => ({
    path: proposal.path,
    language: proposal.language,
    proposed: proposal.content,
    base: workspace.find((file) => file.path === proposal.path)?.content ?? null,
    decisions: proposal.decisions ?? {},
    messageId,
  }));
}

/**
 * The part of a session that carries files, in transcript order.
 *
 * This is the minimum `derivePending` needs, kept separate so the rule that
 * matters — what each proposal is diffed against — can be tested without a
 * database.
 */
export interface FileBearingMessage {
  id: string;
  createdAt: number;
  files?: CodeFile[];
}

/**
 * Rebuilds the review state for a session from its stored messages.
 *
 * `pendingByMessage` lives in React state, so it starts empty on every reload.
 * Without this, a session reloaded later shows the prose but no diffs — the
 * files are in the database and the review UI simply is not there, which looks
 * like the review was never offered.
 *
 * The base for each proposal is the accepted state immediately BEFORE that
 * message, which means walking the transcript forwards and carrying the
 * resolved state along. Diffing against the FINAL state instead would show
 * every file as unchanged, because the final state already contains the very
 * proposal being diffed.
 */
export function derivePending(messages: FileBearingMessage[]): Record<string, PendingFile[]> {
  const out: Record<string, PendingFile[]> = {};
  // The running accepted state, advanced message by message.
  const current = new Map<string, WorkspaceFile>();

  for (const message of messages) {
    const files = message.files;
    if (!files || files.length === 0) continue;

    // Snapshot the base BEFORE this message's files are folded in.
    out[message.id] = buildPending(message.id, files, [...current.values()]);

    for (const file of files) {
      const base = current.get(file.path)?.content ?? null;
      current.set(file.path, {
        path: file.path,
        language: file.language,
        content: resolveFile(file.content, base, file.decisions ?? {}),
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      });
    }
  }

  return out;
}

export async function loadPending(chatId: string): Promise<Record<string, PendingFile[]>> {
  const messages = await db.messages.where("chatId").equals(chatId).sortBy("createdAt");
  return derivePending(messages);
}

/**
 * Records a decision on the message itself.
 *
 * Persisting rather than holding in component state is what makes a rejection
 * survive a reload: the workspace is derived from these decisions, so a decision
 * kept only in React would vanish and the rejected hunk would silently return.
 */
export async function persistDecision(
  messageId: string,
  path: string,
  hunkId: string,
  accepted: boolean
): Promise<void> {
  const message = await db.messages.get(messageId);
  if (!message?.files) return;
  await db.messages.update(messageId, {
    files: message.files.map((file) =>
      file.path === path
        ? { ...file, decisions: { ...(file.decisions ?? {}), [hunkId]: accepted } }
        : file
    ),
  });
}

/** The context block describing the current accepted state of attached files. */
export function workspaceAttachment(files: WorkspaceFile[], paths: string[]): string {
  const chosen = files.filter((file) => paths.includes(file.path));
  if (chosen.length === 0) return "";
  return [
    "The user is working on these files. This is their current, accepted state — hunks they rejected are not in it, so edit from this rather than from an earlier proposal:",
    ...chosen.map((file) => `\`\`\`${file.language} ${file.path}\n${file.content}\n\`\`\``),
  ].join("\n\n");
}
