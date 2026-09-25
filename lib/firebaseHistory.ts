import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, signInAnonymously, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  setDoc,
  type Firestore,
  type QueryDocumentSnapshot,
  type Unsubscribe,
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

type FirebaseServices = { auth: ReturnType<typeof getAuth>; firestore: Firestore; user: User };
let services: FirebaseServices | null = null;

async function getServices(): Promise<FirebaseServices | null> {
  if (!firebaseConfigured || typeof window === "undefined") return null;
  if (services) return services;
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  // authStateReady prevents a reload from creating a second anonymous user
  // before Firebase has restored the existing persisted identity.
  const restoredUser = auth.currentUser ?? await auth.authStateReady();
  const user = restoredUser ?? (await signInAnonymously(auth)).user;
  services = { auth, firestore: getFirestore(app), user };
  return services;
}

function chatsCollection(firestore: Firestore, uid: string) {
  return collection(doc(doc(firestore, "users"), uid), "chats");
}

function chatDoc(firestore: Firestore, uid: string, chatId: string) {
  return doc(chatsCollection(firestore, uid), chatId);
}

function messageCollection(firestore: Firestore, uid: string, chatId: string) {
  return collection(chatDoc(firestore, uid, chatId), "messages");
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
    updatedAt: message.updatedAt ?? message.createdAt,
  })) as Record<string, unknown>;
}

function remoteChatFromSnapshot(snapshot: QueryDocumentSnapshot): Chat {
  const data = snapshot.data() as Partial<Chat>;
  return {
    id: snapshot.id,
    title: data.title || "New chat",
    createdAt: data.createdAt || Date.now(),
    updatedAt: data.updatedAt || data.createdAt || Date.now(),
    pinned: Boolean(data.pinned),
  };
}

async function mergeRemoteMessage(chatId: string, snapshot: QueryDocumentSnapshot): Promise<void> {
  const remote = snapshot.data() as ChatMessage;
  if (!remote?.id) return;
  const local = await db.messages.get(snapshot.id);
  const remoteUpdatedAt = remote.updatedAt ?? remote.createdAt;
  const localUpdatedAt = local?.updatedAt ?? local?.createdAt ?? 0;
  if (!local || remoteUpdatedAt > localUpdatedAt) {
    await db.messages.put({ ...remote, id: snapshot.id, chatId, images: undefined, documents: undefined });
  }
}

async function mergeRemoteChat(snapshot: QueryDocumentSnapshot): Promise<void> {
  const remote = remoteChatFromSnapshot(snapshot);
  const local = await db.chats.get(remote.id);
  if (!local || remote.updatedAt > local.updatedAt) await db.chats.put(remote);
}

async function pushLocalHistory(uid: string, firestore: Firestore): Promise<void> {
  const localChats = await db.chats.toArray();
  const localIds = new Set(localChats.map((chat) => chat.id));
  const remoteChats = await getDocs(chatsCollection(firestore, uid));
  for (const remoteChat of remoteChats.docs) {
    if (localIds.has(remoteChat.id)) continue;
    const remoteMessages = await getDocs(messageCollection(firestore, uid, remoteChat.id));
    for (const message of remoteMessages.docs) {
      await deleteDoc(doc(messageCollection(firestore, uid, remoteChat.id), message.id));
    }
    await deleteDoc(chatDoc(firestore, uid, remoteChat.id));
  }
  for (const chat of localChats) {
    await setDoc(chatDoc(firestore, uid, chat.id), serializableChat(chat), { merge: true });
    const messages = await db.messages.where("chatId").equals(chat.id).sortBy("createdAt");
    const remoteMessages = await getDocs(messageCollection(firestore, uid, chat.id));
    const remoteIds = new Set(remoteMessages.docs.map((item) => item.id));
    const localIds = new Set(messages.map((message) => message.id));
    for (const id of remoteIds) {
      if (!localIds.has(id)) await deleteDoc(doc(messageCollection(firestore, uid, chat.id), id));
    }
    for (const message of messages) {
      await setDoc(doc(messageCollection(firestore, uid, chat.id), message.id), serializableMessage(message));
    }
  }
}

export async function syncFirebaseHistory(): Promise<{ synced: boolean; reason?: string }> {
  const current = await getServices();
  if (!current) return { synced: false, reason: "not-configured" };
  const remoteChats = await getDocs(chatsCollection(current.firestore, current.user.uid));
  for (const snapshot of remoteChats.docs) {
    await mergeRemoteChat(snapshot);
    const remoteMessages = await getDocs(messageCollection(current.firestore, current.user.uid, snapshot.id));
    for (const message of remoteMessages.docs) await mergeRemoteMessage(snapshot.id, message);
  }
  await pushLocalHistory(current.user.uid, current.firestore);
  return { synced: true };
}

/**
 * Keeps the local Dexie cache live with remote changes from the same anonymous
 * user. There is deliberately no opt-out switch: when Firebase is configured,
 * every chat is synchronized automatically under that user's UID.
 */
export function subscribeFirebaseHistory(onError?: () => void): Unsubscribe {
  let stopped = false;
  const unsubscribers: Unsubscribe[] = [];
  const messageUnsubscribers = new Map<string, Unsubscribe>();

  if (!firebaseConfigured || typeof window === "undefined") return () => undefined;

  void getServices().then((current) => {
    if (!current || stopped) return;
    const { firestore, user } = current;
    const watchChats = onSnapshot(
      chatsCollection(firestore, user.uid),
      (snapshot) => {
        for (const chatSnapshot of snapshot.docs) {
          void mergeRemoteChat(chatSnapshot).catch(() => onError?.());
          if (!messageUnsubscribers.has(chatSnapshot.id)) {
            const watchMessages = onSnapshot(
              messageCollection(firestore, user.uid, chatSnapshot.id),
              (messageSnapshot) => {
                for (const message of messageSnapshot.docs) {
                  void mergeRemoteMessage(chatSnapshot.id, message).catch(() => onError?.());
                }
              },
              () => onError?.()
            );
            messageUnsubscribers.set(chatSnapshot.id, watchMessages);
          }
        }
      },
      () => onError?.()
    );
    unsubscribers.push(watchChats);
  }).catch(() => onError?.());

  return () => {
    stopped = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
    for (const unsubscribe of messageUnsubscribers.values()) unsubscribe();
    messageUnsubscribers.clear();
  };
}
