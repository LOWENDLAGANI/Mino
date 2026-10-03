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
import { get, ref, remove, set } from "firebase/database";
import { firebaseConfigured, getServices } from "./firebaseHistory";
import type { AppConfig } from "./appConfig";
import type { PlanId } from "./plans";
import {
  grantRecord,
  isActive,
  normalizeMonths,
  parseSubscription,
  type Subscription,
} from "./subscriptionState";

/**
 * The administrator is defined in exactly one place: the `ADMIN_UID` inside
 * `database.rules.json`. Nothing is hardcoded here.
 *
 * The prompt does not try to predict who the administrator is. It signs you in
 * and then attempts a real read, letting Firebase answer. That keeps the rules
 * the single source of truth, so they can never drift out of step with a copy
 * of the UID baked into the bundle.
 */
/**
 * Whether an error is the database refusing us.
 *
 * The Realtime Database rejects with `PERMISSION_DENIED`, but the shape of that
 * error has varied between SDK versions and a `name` is sometimes present
 * instead of a `code`, so the message is checked too. Getting this wrong is not
 * cosmetic: a refusal must be reported as "you are not the administrator" and
 * must never be shown as "cannot reach Firebase".
 */
function isPermissionDenied(cause: unknown): boolean {
  const error = cause as { code?: string; name?: string } | null;
  const code = error?.code ?? error?.name ?? "";
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return code === "PERMISSION_DENIED" || /permission[ _-]?denied/i.test(message);
}

export async function verifyAdminAccess(): Promise<boolean> {
  const current = await getServices();
  if (!current) throw notConfigured();
  try {
    // A small, cheap probe. Reading `admin/registry` succeeds only for the
    // administrator, and an empty registry is still a successful read.
    await get(ref(current.database, "admin/registry"));
    return true;
  } catch (cause: unknown) {
    if (isPermissionDenied(cause)) return false;
    throw cause;
  }
}

export interface AdminUser {
  uid: string;
  name: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  chats: number;
  messages: number;
  /** What they have paid for, or null when they are on the free tier. */
  subscription: AdminSubscription | null;
}

export interface AdminSubscription {
  plan: PlanId;
  grantedAt: number;
  expiresAt: number;
  months: number;
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
  return current;
}

/** Maps Firebase's permission failure onto a message worth showing. */
function rethrow(cause: unknown): never {
  if (isPermissionDenied(cause)) throw unauthorized();
  throw cause;
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
  const [registrySnapshot, usersSnapshot, subscriptionsSnapshot] = await Promise.all([
    get(ref(database, "admin/registry")),
    get(ref(database, "users")),
    // A deployment whose rules predate subscriptions refuses this read. That is
    // not a reason to fail the whole console, so it degrades to "nobody has a
    // plan" rather than to an empty visitor list.
    get(ref(database, "subscriptions")).catch(() => ({ val: () => null }) as never),
  ]).catch(rethrow);

  const names = (registrySnapshot.val() ?? {}) as Record<
    string,
    { name?: string; firstSeen?: number; lastSeen?: number }
  >;
  const chats = (usersSnapshot.val() ?? {}) as Record<string, { chats?: Record<string, unknown> }>;
  const plans = (subscriptionsSnapshot.val() ?? {}) as Record<string, unknown>;
  const now = Date.now();

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

    // Only what is still paid for. A lapsed grant is shown to the owner as free
    // rather than as an expired plan, because "Free" is the thing they can act on.
    const plan = parseSubscription(plans[uid]);
    const active = isActive(plan, now) ? (plan as Subscription) : null;

    return {
      uid,
      name: profile?.name ?? null,
      firstSeen: profile?.firstSeen ?? null,
      lastSeen: profile?.lastSeen ?? lastChatAt,
      chats: entries.length,
      messages,
      subscription: active
        ? {
            plan: active.plan,
            grantedAt: active.grantedAt,
            expiresAt: active.expiresAt,
            months: active.months,
          }
        : null,
    };
  });

  rows.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  return rows;
}

export async function listChats(uid: string): Promise<AdminChat[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `users/${uid}/chats`)).catch(rethrow);
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
  const snapshot = await get(ref(database, `users/${uid}/chats/${chatId}`)).catch(rethrow);
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

/** Removes one visitor's chats, their registry entry, and any plan they held. */
export async function wipeUser(uid: string): Promise<void> {
  const { database } = await requireAdmin();
  await Promise.all([
    remove(ref(database, `users/${uid}`)),
    remove(ref(database, `admin/registry/${uid}`)),
    remove(ref(database, `subscriptions/${uid}`)),
  ]).catch(rethrow);
}

/** Removes every logged chat, every visitor entry, and every subscription. */
export async function wipeAll(): Promise<void> {
  const { database } = await requireAdmin();
  await Promise.all([
    remove(ref(database, "users")),
    remove(ref(database, "admin/registry")),
    remove(ref(database, "subscriptions")),
  ]).catch(rethrow);
}

// ── Granting a plan ──────────────────────────────────────────────────────────
// This is the whole payment system. Buyers transfer by QR, the owner sees the
// money arrive, and the plan is handed over by hand from this screen. There is
// no webhook and no gateway, which means the grant is a decision somebody makes
// rather than an event a provider reports.
//
// It writes the same node the buyer's browser is already listening to, so the
// celebration appears on their open tab the moment this returns.

/** One visitor's current record, or null when they have never been granted one. */
export async function readSubscription(uid: string): Promise<Subscription | null> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  return parseSubscription(snapshot.val());
}

/**
 * Grants a plan to a visitor, extending it if they already have that one.
 *
 * `note` is the owner's own reference for the payment — whatever their banking
 * app showed — and it is shown to the buyer, which is what lets them match a
 * transfer to a purchase without being asked.
 *
 * Returns the record that was written so the console can show what actually
 * landed rather than what was asked for.
 */
export async function grantSubscription(
  uid: string,
  plan: PlanId,
  months = 1,
  note = ""
): Promise<Subscription> {
  const { database } = await requireAdmin();
  const previous = await readSubscription(uid);
  const record = grantRecord({ plan, months, now: Date.now(), note, previous });
  await set(ref(database, `subscriptions/${uid}`), {
    ...record,
    // The acknowledgement is kept rather than cleared. It is what stops a
    // grant the buyer has already seen from being announced twice, and this
    // grant's own id is one higher, so the new purchase is still announced.
    ack: { announcementId: previous?.announcementId ?? 0 },
  }).catch(rethrow);
  return record;
}

/** Takes a plan away, so the visitor is back on the free tier. */
export async function revokeSubscription(uid: string): Promise<void> {
  const { database } = await requireAdmin();
  await remove(ref(database, `subscriptions/${uid}`)).catch(rethrow);
}

/** Re-exported for the console, which shows the whole span rather than a month. */
export { normalizeMonths };

/**
 * Saves the runtime controls.
 *
 * The write goes through `/api/admin/config` rather than straight to the
 * database, because the server is what verifies that this browser is the
 * administrator. The rules would refuse a direct write from an anonymous
 * session anyway; routing it through the server also means the change is
 * enforced by the next request instead of waiting for this tab to refresh.
 */
export interface AdminUsage {
  uid: string;
  day: string;
  chat: number;
  image: number;
}

/**
 * Today's per-visitor counters.
 *
 * These are the numbers the daily caps are counted against, so showing them
 * doubles as proof that the caps are actually counting: a control that is
 * wired up wrong looks identical to a quiet day otherwise. The newest day's
 * entry per visitor is used, since old days are kept for history but are not
 * what is currently being enforced.
 */
export async function listUsage(): Promise<AdminUsage[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, "usage")).catch(rethrow);
  const value = (snapshot.val() ?? {}) as Record<
    string,
    Record<string, { chat?: number; image?: number }>
  >;
  const today = new Date().toISOString().slice(0, 10);
  const rows: AdminUsage[] = [];
  for (const [uid, days] of Object.entries(value)) {
    const entry = days?.[today];
    rows.push({ uid, day: today, chat: entry?.chat ?? 0, image: entry?.image ?? 0 });
  }
  rows.sort((a, b) => b.chat + b.image - (a.chat + a.image));
  return rows;
}

/** Ends the administrator's session. */
export async function endAdminSession(): Promise<void> {
  await signOutAdmin();
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  const current = await requireAdmin();
  const user = current.auth.currentUser;
  // Force a fresh token. A cached one can still describe the anonymous session
  // that existed before the Google sign-in, which the server would correctly
  // reject as "not the administrator" even though this browser has since
  // signed in.
  const token = await user?.getIdToken(true);
  if (!token) {
    throw new Error("Your session has expired. Sign in with Google again, then reopen the console.");
  }

  const response = await fetch("/api/admin/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Could not save controls (HTTP ${response.status})`);
  }
}
