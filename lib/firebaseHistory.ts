import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import { db } from "./db";
import type { Chat, ChatMessage } from "./types";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId
);

let services: { auth: ReturnType<typeof getAuth>; firestore: ReturnType<typeof getFirestore>; user: User } | null = null;

async function getServices() {
  if (!firebaseConfigured || typeof window === "undefined") return null;
  if (services) return services;
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
  services = { auth, firestore: getFirestore(app), user };
  return services;
}

function chatDoc(uid: string, chatId: string) {
  return doc(collection(doc(doc(getFirestore(), "users"), uid), "chats"), chatId);
}

function messageCollection(uid: string, chatId: string) {
  return collection(chatDoc(uid, chatId), "messages");
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
  // Local image data URLs can exceed Firestore's 1 MiB document limit. They remain
  // available in Dexie and are intentionally not copied to the remote history.
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
  })) as Record<string, unknown>;
}

export async function syncFirebaseHistory(): Promise<{ synced: boolean; reason?: string }> {
  const current = await getServices();
  if (!current) return { synced: false, reason: "not-configured" };
  const uid = current.user.uid;
  const remoteChats = await getDocs(collection(doc(doc(current.firestore, "users"), uid), "chats"));
  const localChats = await db.chats.toArray();
  const localById = new Map(localChats.map((chat) => [chat.id, chat]));

  for (const snapshot of remoteChats.docs) {
    const data = snapshot.data() as Chat;
    const local = localById.get(snapshot.id);
    if (!local || data.updatedAt > local.updatedAt) {
      await db.chats.put({
        id: snapshot.id,
        title: data.title || "New chat",
        createdAt: data.createdAt || Date.now(),
        updatedAt: data.updatedAt || Date.now(),
        pinned: Boolean(data.pinned),
      });
      const remoteMessages = await getDocs(messageCollection(uid, snapshot.id));
      for (const messageSnapshot of remoteMessages.docs) {
        const message = messageSnapshot.data() as ChatMessage;
        if (!message?.id) continue;
        const localMessage = await db.messages.get(messageSnapshot.id);
        if (!localMessage || message.createdAt > localMessage.createdAt) {
          await db.messages.put({ ...message, images: undefined, documents: undefined });
        }
      }
    }
  }

  for (const chat of await db.chats.toArray()) {
    await setDoc(chatDoc(uid, chat.id), serializableChat(chat), { merge: true });
    const messages = await db.messages.where("chatId").equals(chat.id).sortBy("createdAt");
    const remoteMessages = await getDocs(messageCollection(uid, chat.id));
    const remoteIds = new Set(remoteMessages.docs.map((item) => item.id));
    const localIds = new Set(messages.map((message) => message.id));
    for (const id of remoteIds) {
      if (!localIds.has(id)) await deleteDoc(doc(messageCollection(uid, chat.id), id));
    }
    for (const message of messages) await setDoc(doc(messageCollection(uid, chat.id), message.id), serializableMessage(message));
  }
  return { synced: true };
}
