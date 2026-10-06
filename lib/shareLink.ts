// ── Share a conversation as a link ───────────────────────────────────────────
// The whole conversation travels inside the link itself, in the URL *fragment*
// (`/share#…`), and that choice is the feature:
//
//   * A fragment is never sent to any server, so sharing a chat does not put a
//     copy of it anywhere — no storage bucket, no new database node, no rules
//     to publish. This project deliberately holds no service account and lets
//     nobody read another visitor's chats; a link that uploads would break
//     both of those in the one place it touched.
//   * The reader needs no Mino and no sign-in, because there is nothing to
//     fetch: the page decodes what the URL already carries.
//
// The costs of that choice are handled rather than ignored:
//
//   * Long links get cut by chat apps, so the payload is gzipped before base64
//     and then given a hard length ceiling. When a conversation is too big, the
//     *oldest* messages drop first — a share is almost always about the recent
//     exchange — and the receiving page says so instead of quietly showing a
//     partial conversation as if it were whole.
//   * Anything the reader's browser cannot inflate falls back to storing the
//     text uncompressed (`r.` prefix vs `z.`), so an old browser still opens
//     the link rather than showing an error for a conversation it could read.
//
// CompressionStream is a browser API from 2020-era engines; there is no Node
// import here because this module is only ever called in the browser.

import type { ChatMessage } from "./types";
import { displayedContent } from "./variants";

/** One message on the wire. Roles are one letter and keys are bare: every byte
    is counted against the URL ceiling. */
export interface SharedMessage {
  r: "u" | "a";
  c: string;
}

export interface SharedChat {
  v: 1;
  /** The chat's title, so the receiving page has something to put in the tab. */
  t: string;
  m: SharedMessage[];
  /** Present when older messages were dropped to fit the link. */
  cut?: 1;
}

export interface BuiltShareLink {
  url: string;
  /** How many messages made it in. */
  included: number;
  /** How many there were to begin with. */
  total: number;
}

/** Chat apps and social platforms truncate around here; staying under keeps a
    shared link a working link instead of a dead one. */
const MAX_URL_LENGTH = 60_000;
/** One message alone can be 6 KB — long enough to show an answer, short
    enough that a single message cannot blow the whole budget. */
const MAX_MESSAGE_CHARS = 6_000;
const MAX_MESSAGES = 60;
/** Defensive ceiling on decode: a hand-edited fragment must not be able to
    hand the page an unbounded document to render. */
const MAX_DECODED_CHARS = 600_000;

/** The shareable text of a message: what the reader is looking at (including
    whichever variant is displayed), with attachments standing in as labels —
    a link carries text, and an image re-encoded into a URL is a link nobody
    can open. */
function shareableText(message: ChatMessage): string {
  const text = displayedContent(message).trim();
  if (text) return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
  if (message.generatedImages?.length) return `[image: ${message.generatedImages[0].prompt}]`;
  if (message.images?.length) return "[image]";
  if (message.documents?.length) return `[file: ${message.documents[0].name}]`;
  return "";
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: spreading a 60 KB buffer into a single fromCharCode call blows the
  // argument limit on some engines.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    if (typeof CompressionStream === "undefined") return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // No compression available: the `r.` encoding below still works, it is
    // simply a longer link.
    return null;
  }
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encode(payload: SharedChat): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await gzip(raw);
  if (compressed && compressed.length < raw.length) return `z.${toBase64Url(compressed)}`;
  return `r.${toBase64Url(raw)}`;
}

/**
 * Builds the shareable link for this thread.
 *
 * Selection runs newest-first under an estimated budget, then the encoded
 * result is measured for real and the oldest half is dropped repeatedly until
 * it fits — estimation first so the common case costs one compression, the
 * measurement second because an estimate that turns out wrong must still
 * produce a link that works.
 */
export async function buildShareLink(
  messages: ChatMessage[],
  title?: string
): Promise<BuiltShareLink> {
  const rows = messages
    .map((message) => ({
      role: message.role === "user" ? ("u" as const) : ("a" as const),
      text: shareableText(message),
    }))
    .filter((row) => row.text.length > 0)
    .slice(-MAX_MESSAGES);

  if (rows.length === 0) throw new Error("There is nothing to share yet");

  // The budget in characters: gzip on prose lands well under 1× and base64
  // adds a third, so 0.8 of the ceiling is a deliberately conservative guess
  // that the measurement below corrects if it is wrong.
  const budget = Math.floor(MAX_URL_LENGTH * 0.8);
  let picked: SharedMessage[] = [];
  let size = 96 + (title?.length ?? 0);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const cost = row.text.length + 32;
    if (size + cost > budget) {
      if (picked.length === 0) {
        // One message bigger than the whole budget: keep its head rather than
        // refuse to share at all.
        const room = Math.max(200, budget - size - 32);
        picked.push({ r: row.role, c: `${row.text.slice(0, room)}…` });
      }
      break;
    }
    picked.unshift({ r: row.role, c: row.text });
    size += cost;
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const payload: SharedChat = {
    v: 1,
    t: (title ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    m: picked,
  };
  if (picked.length < rows.length) payload.cut = 1;

  let encoded = await encode(payload);
  let attempts = 0;
  while (encoded.length > MAX_URL_LENGTH && payload.m.length > 1 && attempts < 8) {
    // The estimate was optimistic (unusually repetitive text, or a browser
    // whose compression is weak): keep the newest half and try again.
    payload.m = payload.m.slice(Math.floor(payload.m.length / 2));
    payload.cut = 1;
    encoded = await encode(payload);
    attempts += 1;
  }

  return {
    url: `${origin}/share#${encoded}`,
    included: payload.m.length,
    total: rows.length,
  };
}

/**
 * Reads a fragment back into a conversation, or null when it is not one.
 *
 * Every failure path returns null rather than throwing: the fragment arrives
 * from a URL that may have been truncated by a chat app, rewritten by a
 * messenger, or typed by hand, and the page's job is to say "this link is
 * broken" — not to crash while trying to be helpful.
 */
export async function parseShareLink(hash: string): Promise<SharedChat | null> {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const dot = raw.indexOf(".");
  if (dot <= 0 || raw.length > MAX_URL_LENGTH * 2) return null;

  try {
    const bytes = fromBase64Url(raw.slice(dot + 1));
    const kind = raw.slice(0, dot);
    let text: string;
    if (kind === "z") {
      text = new TextDecoder().decode(await gunzip(bytes));
    } else if (kind === "r") {
      text = new TextDecoder().decode(bytes);
    } else {
      return null;
    }

    const data = JSON.parse(text) as SharedChat;
    if (data?.v !== 1 || !Array.isArray(data.m)) return null;

    const messages = data.m
      .filter(
        (item): item is SharedMessage =>
          Boolean(item) && (item.r === "u" || item.r === "a") && typeof item.c === "string"
      )
      .slice(0, 400);
    if (messages.length === 0) return null;
    if (messages.reduce((sum, item) => sum + item.c.length, 0) > MAX_DECODED_CHARS) return null;

    return {
      v: 1,
      t: typeof data.t === "string" ? data.t.slice(0, 120) : "",
      m: messages,
      ...(data.cut ? { cut: 1 as const } : {}),
    };
  } catch {
    return null;
  }
}
