import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, signInAnonymously, type User } from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  type Database,
} from "firebase/database";
import { db } from "./db";
import type { Chat, ChatMessage } from "./types";

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

type FirebaseServices = { auth: ReturnType<typeof getAuth>; database: Database; user: User };
let services: FirebaseServices | null = null;

async function getServices(): Promise<FirebaseServices | null> {
  if (!firebaseConfigured || typeof window === "undefined") return null;
  if (services) return services;
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  const restoredUser = auth.currentUser ?? await auth.authStateReady();
  const user = restoredUser ?? (await signInAnonymously(auth)).user;
  services = { auth, database: getDatabase(app), user };
  return services;
}

function chatRef(database: Database, uid: string, chatId: string) {
  return ref(database, `users/${uid}/chats/${chatId}`);
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
 * Logs the current local chats to the anonymous user's RTDB namespace.
 * This function intentionally performs no reads: Dexie is the only source used
 * to load previous chats back into the app.
 */
export async function syncFirebaseHistory(): Promise<{ synced: boolean; reason?: string }> {
  const current = await getServices();
  if (!current) return { synced: false, reason: "not-configured" };

  for (const chat of await db.chats.toArray()) {
    const messages = await db.messages.where("chatId").equals(chat.id).sortBy("createdAt");
    const nextMessages: Record<string, Record<string, unknown>> = {};
    for (const message of messages) nextMessages[message.id] = serializableMessage(message);
    await set(chatRef(current.database, current.user.uid, chat.id), {
      ...serializableChat(chat),
      messages: nextMessages,
    });
  }
  return { synced: true };
}
