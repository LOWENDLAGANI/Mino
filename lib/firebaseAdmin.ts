// ── Admin access, enforced by the Realtime Database rules ────────────────────
// The console reads every visitor's logged chats and can wipe them. Previously
// that needed a service account, because the browser was not allowed to read
// chat data at all and only the Admin SDK — which ignores the rules — could.
//
// It no longer does. `database.rules.json` grants one specific Auth UID elevated
// read and write over `users/` and `admin/`, and nothing else. This module is
// just the client-side caller for those grants, so there is no project-wide
// credential in the deployment environment at all.
//
// The check in `isAdminUser` is cosmetic: it only decides which screen to show.
// Firebase evaluates the same condition on every read and write, so patching
// this file would gain an attacker nothing.

import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { get, ref, remove } from "firebase/database";
import { firebaseConfigured, getServices } from "./firebaseHistory";

/**
 * The Firebase Auth UID allowed to open the console.
 *
 * Set this to your own UID, and put the same value into the `ADMIN_UID`
 * placeholder in `database.rules.json`, then publish the rules.
 *
 * To find your UID: sign in through the admin prompt once, and the dialog shows
 * the UID to copy. It is also listed in the Firebase console under
 * Authentication → Users. An anonymous UID cannot be used — Firebase assigns
 * those at random, so they cannot be hardcoded.
 */
export const ADMIN_UID = "";

/** True once a UID has been filled in and published. */
export function adminConfigured(): boolean {
  return ADMIN_UID !== "";
}

export function isAdminUser(uid: string | null | undefined): boolean {
  return Boolean(ADMIN_UID) && uid === ADMIN_UID;
}

export interface AdminUser {
  uid: string;
  name: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  chats: number;
  messages: number;
}

export interface AdminChat {
  chatId: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdminMessage {
  role: "user" | "assistant";
  content: string;
  model: string | null;
  createdAt: number;
  error: string | null;
}

function notConfigured(): Error & { code?: string } {
  const error = new Error("Firebase is not configured") as Error & { code?: string };
  error.code = "app/not-configured";
  return error;
}

function unauthorized(): Error & { code?: string } {
  const error = new Error("This account is not the Mino administrator.") as Error & { code?: string };
  error.code = "app/permission-denied";
  return error;
}

async function requireAdmin() {
  const current = await getServices();
  if (!current) throw notConfigured();
  if (!isAdminUser(current.auth.currentUser?.uid)) throw unauthorized();
  return current;
}

/**
 * Signs in with Google, returning the resulting UID.
 *
 * The app already signs each visitor in anonymously. Signing in with a
 * credential while an anonymous user is present makes Firebase *link* the two
 * rather than replace the session, and it carries the anonymous user's data
 * over to the new UID. Chat logging therefore continues uninterrupted under the
 * same `users/{uid}` path.
 */
export async function signInAsAdmin(): Promise<string> {
  const current = await getServices();
  if (!current) throw notConfigured();
  const credential = await signInWithPopup(current.auth, new GoogleAuthProvider());
  return credential.user.uid;
}

/** Ends the admin session and returns the browser to an anonymous identity. */
export async function signOutAdmin(): Promise<void> {
  const current = await getServices();
  if (current) await signOut(current.auth);
}

/** The UID currently signed in, for the first-run setup hint. */
export async function currentUid(): Promise<string | null> {
  const current = await getServices();
  return current?.auth.currentUser?.uid ?? null;
}

export async function listUsers(): Promise<AdminUser[]> {
  const { database } = await requireAdmin();
  const [registrySnapshot, usersSnapshot] = await Promise.all([
    get(ref(database, "admin/registry")),
    get(ref(database, "users")),
  ]);

  const names = (registrySnapshot.val() ?? {}) as Record<
    string,
    { name?: string; firstSeen?: number; lastSeen?: number }
  >;
  const chats = (usersSnapshot.val() ?? {}) as Record<string, { chats?: Record<string, unknown> }>;

  const rows = Object.entries(chats).map(([uid, value]) => {
    const profile = names[uid];
    const entries = Object.values(value?.chats ?? {});
    let messages = 0;
    for (const chat of entries) {
      const stored = (chat as { messages?: Record<string, unknown> }).messages ?? {};
      messages += Object.keys(stored).length;
    }
    const lastChatAt = entries.reduce<number>((latest, chat) => {
      const updated = (chat as { updatedAt?: number }).updatedAt ?? 0;
      return updated > latest ? updated : latest;
    }, 0);

    return {
      uid,
      name: profile?.name ?? null,
      firstSeen: profile?.firstSeen ?? null,
      lastSeen: profile?.lastSeen ?? lastChatAt,
      chats: entries.length,
      messages,
    };
  });

  rows.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  return rows;
}

export async function listChats(uid: string): Promise<AdminChat[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `users/${uid}/chats`));
  const value = (snapshot.val() ?? {}) as Record<
    string,
    { id?: string; title?: string; createdAt?: number; updatedAt?: number }
  >;
  return Object.entries(value)
    .map(([chatId, chat]) => ({
      chatId,
      id: chat.id ?? chatId,
      title: chat.title ?? "Untitled",
      createdAt: Number(chat.createdAt ?? 0),
      updatedAt: Number(chat.updatedAt ?? chat.createdAt ?? 0),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(uid: string, chatId: string): Promise<{ title: string; messages: AdminMessage[] }> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `users/${uid}/chats/${chatId}`));
  const chat = snapshot.val() as
    | { title?: string; messages?: Record<string, { role?: string; content?: string; model?: string; createdAt?: number; error?: string }> }
    | null;
  if (!chat) throw new Error("Chat not found.");

  const messages = Object.values(chat.messages ?? {})
    .filter((message) => typeof message?.content === "string" && message.content !== "")
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content ?? "",
      model: message.model ?? null,
      createdAt: message.createdAt ?? 0,
      error: message.error ?? null,
    }));

  return { title: chat.title ?? "Untitled", messages };
}

/** Removes one visitor's chats and their registry entry. */
export async function wipeUser(uid: string): Promise<void> {
  const { database } = await requireAdmin();
  await Promise.all([
    remove(ref(database, `users/${uid}`)),
    remove(ref(database, `admin/registry/${uid}`)),
  ]);
}

/** Removes every logged chat and every visitor entry. */
export async function wipeAll(): Promise<void> {
  const { database } = await requireAdmin();
  await Promise.all([remove(ref(database, "users")), remove(ref(database, "admin/registry"))]);
}
