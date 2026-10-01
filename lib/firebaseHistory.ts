import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getDatabase,
  get,
  ref,
  remove,
  set,
  type Database,
} from "firebase/database";
import { db } from "./db";
import { parseRemoteChat, planChatMerge } from "./chatSync";
import { firstSeen } from "./visitorName";
import type { Chat, ChatMessage, Memory } from "./types";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.databaseURL && config.projectId && config.appId
);

/**
 * A handle on Firebase, deliberately holding no user of its own.
 *
 * The user used to be read once and cached here. That is wrong the moment the
 * signed-in identity changes — which is exactly what linking a Google account
 * does — and it fails quietly rather than loudly: a stale User keeps returning a
 * token for an identity that is no longer current, so chat logs land under an id
 * nobody is signed in as any more. The account is read live instead, and
 * `ensureUser` restores the anonymous sign-in when there is nobody at all.
 */
type FirebaseServices = {
  auth: Auth;
  database: Database;
  /** Whoever is signed in right now, or null between a sign-out and a sign-in. */
  user: User | null;
  /** The signed-in user, signing in anonymously first if the browser has none. */
  ensureUser: () => Promise<User>;
};

let services: FirebaseServices | null = null;

export async function getServices(): Promise<FirebaseServices | null> {
  if (!firebaseConfigured || typeof window === "undefined") return null;
  if (services) return services;
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  const restoredUser = auth.currentUser ?? (await auth.authStateReady());
  const user = restoredUser ?? (await signInAnonymously(auth)).user;
  services = {
    auth,
    database: getDatabase(app),
    get user() {
      return auth.currentUser;
    },
    ensureUser: async () => {
      const current = auth.currentUser;
      if (current) return current;
      return (await signInAnonymously(auth)).user;
    },
  };
  return services;
}

function chatRef(database: Database, uid: string, chatId: string) {
  return ref(database, `users/${uid}/chats/${chatId}`);
}

/**
 * The signed-in visitor's Firebase ID token, for calls to the server routes.
 *
 * The server verifies this and takes the identity from the token itself, which
 * is what makes the ban list and the daily caps meaningful: a modified client
 * can drop the header, but it cannot present a token for a different device.
 * Returns null when Firebase is not configured, in which case the server simply
 * treats the caller as unidentified and the controls that need an identity do
 * not apply.
 */
export async function authHeader(): Promise<Record<string, string>> {
  try {
    const current = await getServices();
    if (!current) return {};
    const token = await (await current.ensureUser()).getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

function serializableChat(chat: Chat) {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    pinned: Boolean(chat.pinned),
  };
}

function serializableMessage(message: ChatMessage) {
  // Images and document contents stay in Dexie; only text history is logged.
  return JSON.parse(JSON.stringify({
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    content: message.content,
    model: message.model,
    searchQuery: message.searchQuery,
    sources: message.sources,
    usage: message.usage,
    error: message.error,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt ?? message.createdAt,
  })) as Record<string, unknown>;
}

/**
 * Logs the current local chats to the signed-in user's RTDB namespace.
 *
 * This is the push half of the two-way sync. The pull half is
 * `loadChatsFromAccount` below, which is what actually makes a phone's history
 * appear on a computer signed in with the same account — logging alone only
 * ever left the chats where they were written.
 */
export async function syncFirebaseHistory(): Promise<{ synced: boolean; reason?: string }> {
  const localChats = await db.chats.toArray();
  // A chat this device has deliberately deleted must not be re-uploaded, or the
  // next pull would hand it straight back.
  const deleted = deletedChatIds();
  const uploadable = localChats.filter((chat) => !deleted.has(chat.id));
  if (uploadable.length === 0) return { synced: true, reason: "no-local-history" };
  const current = await getServices();
  if (!current) return { synced: false, reason: "not-configured" };
  const user = await current.ensureUser();

  for (const chat of uploadable) {
    const messages = await db.messages.where("chatId").equals(chat.id).sortBy("createdAt");
    const nextMessages: Record<string, Record<string, unknown>> = {};
    for (const message of messages) nextMessages[message.id] = serializableMessage(message);
    await set(chatRef(current.database, user.uid, chat.id), {
      ...serializableChat(chat),
      messages: nextMessages,
    });
  }
  return { synced: true };
}

// ── Chat history sync ───────────────────────────────────────────────────────
//
// History is no longer write-only. It was, and that is why signing in on a
// second browser showed the chats you had just asked to follow you: the data
// was being written correctly all along and then deliberately never read
// back. Logging without reading is fine for an audit trail and useless for a
// product that promises "your chats follow you to any browser".
//
// Merging is a union, never a replace. Two browsers can each hold chats the
// other has never seen, and a replace would silently delete one of them. Where
// the same message exists on both sides the newer `updatedAt` wins, which is
// the honest answer for two devices editing one thread.

// A pull must never resurrect something this device deleted, so deletions are
// recorded here and honoured on the way in. Kept in localStorage rather than
// Dexie because it must survive the very database it is guarding.
const DELETED_KEY = "mino:deleted-chats";

function deletedChatIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DELETED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function markChatDeleted(chatId: string): void {
  try {
    const ids = deletedChatIds();
    ids.add(chatId);
    // Bounded so the list cannot grow without limit on a long-lived device.
    const trimmed = [...ids].slice(-500);
    window.localStorage.setItem(DELETED_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable: the delete is still local and still correct.
  }
}





/**
 * Brings the account's chats into this browser.
 *
 * A union rather than a replace: anything already here is kept, and only chats
 * and messages this device has never seen are added. Messages present on both
 * sides take the newer copy, but never lose the attachments this browser holds
 * — images and documents were never uploaded, so the local copy stays the only
 * one that has them.
 *
 * Returns null on any failure, including a deployment whose rules have not been
 * republished yet, so the caller keeps what it has instead of emptying itself.
 */
export async function loadChatsFromAccount(): Promise<{ chats: number; messages: number } | null> {
  const current = await getServices();
  if (!current) return null;
  const user = await current.ensureUser();

  let remote: Record<string, unknown> | null;
  try {
    const snapshot = await get(ref(current.database, `users/${user.uid}/chats`));
    remote = (snapshot.val() as Record<string, unknown> | null) ?? null;
  } catch {
    // No read rule published yet, or offline. Nothing is changed locally.
    return null;
  }
  if (!remote) return { chats: 0, messages: 0 };

  const deleted = deletedChatIds();
  let chatsAdded = 0;
  let messagesAdded = 0;

  for (const value of Object.values(remote)) {
    const parsed = parseRemoteChat(value);
    if (!parsed || deleted.has(parsed.chat.id)) continue;

    const localChat = await db.chats.get(parsed.chat.id);
    const localMessages = localChat
      ? await db.messages.where("chatId").equals(parsed.chat.id).sortBy("createdAt")
      : [];
    const merge = planChatMerge(parsed, localChat, localMessages);

    // A chat and its messages go in together: a chat whose messages failed to
    // write would open as an empty thread, which reads as data loss.
    await db.transaction("rw", db.chats, db.messages, async () => {
      if (merge.addChat) {
        await db.chats.add(merge.chat);
        chatsAdded += 1;
      } else if (merge.chatUpdate) {
        await db.chats.update(merge.chat.id, merge.chatUpdate);
      }
      if (merge.addMessages.length > 0) await db.messages.bulkAdd(merge.addMessages);
      messagesAdded += merge.addMessages.length;
      for (const update of merge.updateMessages) {
        await db.messages.update(update.id, update.changes);
      }
    });
  }

  return { chats: chatsAdded, messages: messagesAdded };
}

/** Removes one chat from the account, so deleting here deletes everywhere. */
export async function syncChatDelete(chatId: string): Promise<void> {
  const current = await getServices();
  if (!current) return;
  try {
    await remove(chatRef(current.database, (await current.ensureUser()).uid, chatId));
  } catch {
    // The local delete stands; the remote copy is cleaned up on a later write.
  }
}

/**
 * Wipes the account's chat history when this device wipes its own.
 *
 * This is the one place a bulk delete happens remotely, and it is only reached
 * from the sidebar's "clear all data", which already destroys everything this
 * browser holds without asking the account's opinion. Leaving the copy behind
 * would make the next sign-in restore everything someone had just erased.
 */
export async function syncChatWipe(): Promise<void> {
  const current = await getServices();
  if (!current) return;
  const uid = (await current.ensureUser()).uid;
  try {
    const snapshot = await get(ref(current.database, `users/${uid}/chats`));
    const value = snapshot.val() as Record<string, unknown> | null;
    const ids = value ? Object.keys(value) : [];
    // Recorded before the network call, so an interrupted wipe still cannot
    // bring the chats back on the next pull.
    for (const id of ids) markChatDeleted(id);
    if (ids.length > 0) await remove(ref(current.database, `users/${uid}/chats`));
  } catch {
    // Nothing to do — see syncChatDelete.
  }
}



// ── Memory sync ─────────────────────────────────────────────────────────────
// Memories are readable back by their owner, and so is chat history above. They
// differ in what they carry: a handful of short sentences about the person who
// wrote them, rather than their conversations.
//
// The payload is a handful of short sentences about the person who wrote them.
// That is a meaningfully different privacy posture from chat text, and the
// rules separate the two by granting this node its own owner-only read.
//
// Sync is last-write-wins per id, which is the honest model here. Memories are
// written rarely and one at a time, so concurrent edits of the same id are not
// a real case, and merging them would need more machinery than the situation
// earns.

function memoryRef(database: Database, uid: string) {
  return ref(database, `users/${uid}/memory`);
}

function serializableMemory(memory: Memory) {
  return {
    id: memory.id,
    text: memory.text,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

function parseMemories(value: unknown): Memory[] {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>)
    .map((entry) => {
      const candidate = entry as Partial<Memory>;
      if (typeof candidate?.text !== "string" || typeof candidate?.id !== "string") return null;
      return {
        id: candidate.id,
        text: candidate.text,
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
      } satisfies Memory;
    })
    .filter((entry): entry is Memory => entry !== null);
}

/** Pushes one memory to the account, so it follows the user to another device. */
export async function syncMemoryUp(memory: Memory): Promise<void> {
  const current = await getServices();
  if (!current) return;
  try {
    await set(ref(current.database, `users/${(await current.ensureUser()).uid}/memory/${memory.id}`), serializableMemory(memory));
  } catch {
    // Rules not republished, or offline. The local memory still stands — this
    // is a convenience, never the source of truth.
  }
}

export async function syncMemoryDelete(id: string): Promise<void> {
  const current = await getServices();
  if (!current) return;
  try {
    await remove(ref(current.database, `users/${(await current.ensureUser()).uid}/memory/${id}`));
  } catch {
    // Nothing to do — see syncMemoryUp.
  }
}

/**
 * Adopts memories written on another browser.
 *
 * Returns null on any failure, including a deployment whose rules have not been
 * republished yet, so the caller keeps whatever this device already has rather
 * than showing an empty memory list. Adding a memory is a union rather than a
 * replace: memories this browser has that the other does not are kept, since
 * nothing here says they were removed.
 */
export async function loadMemoriesFromAccount(): Promise<Memory[] | null> {
  const current = await getServices();
  if (!current) return null;
  try {
    const snapshot = await get(memoryRef(current.database, (await current.ensureUser()).uid));
    return parseMemories(snapshot.val());
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the admin PIN verifier from Realtime Database.
 *
 * This is the one read Mino performs. Chat history itself is never read back —
 * see syncFirebaseHistory above. Only a signed-in anonymous visitor can call it,
 * and it returns a SHA-256 digest rather than the PIN, so the database never
 * holds or discloses the secret itself.
 *
 * Throws a coded error rather than returning null when Firebase is unusable, so
 * callers can tell "no PIN yet" apart from "Firebase is broken".
 */
export interface VisitorProfile {
  name: string;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Stores the display name a visitor chose, under their own anonymous id.
 *
 * Only the name and two timestamps are written — never message content, which
 * stays in the write-only `users/$uid/chats` namespace.
 *
 * This must never read first. The rules grant a visitor `.write` on their own
 * registry node but no `.read` anywhere, so a read here is refused by Firebase
 * and the write behind it would never run. `firstSeen` therefore comes from
 * this browser instead of from the database.
 */
export async function syncVisitorProfile(name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return;
  const current = await getServices();
  if (!current) return;

  await set(ref(current.database, `admin/registry/${(await current.ensureUser()).uid}`), {
    name: trimmed,
    firstSeen: firstSeen(),
    lastSeen: Date.now(),
  } satisfies VisitorProfile);
}

/**
 * Lists every visitor that has given Mino a name.
 *
 * This is names and timestamps only. It is the one place Mino reads back from
 * the database, and it deliberately excludes the logged chat text.
 */
export async function fetchVisitorRegistry(): Promise<Array<VisitorProfile & { uid: string }>> {
  const current = await getServices();
  if (!current) return [];
  const snapshot = await get(ref(current.database, "admin/registry"));
  const value = snapshot.val() as Record<string, VisitorProfile> | null;
  if (!value) return [];
  return Object.entries(value)
    .map(([uid, profile]) => ({ uid, ...profile }))
    .filter((entry) => typeof entry.name === "string" && typeof entry.lastSeen === "number")
    .sort((a, b) => b.lastSeen - a.lastSeen);
}
