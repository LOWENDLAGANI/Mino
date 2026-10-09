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
import { get, push, ref, remove, set } from "firebase/database";
import { firebaseConfigured, getServices } from "./firebaseHistory";
import type { AppConfig } from "./appConfig";
import type { PlanId } from "./plans";
import { normalizeDays } from "./durations";
import {
  isValidCode,
  normalizeCode,
  parseRedeemCode,
  type RedeemCode,
} from "./redeemState";
import { grantRecord, isActive, parseSubscription, type Subscription } from "./subscriptionState";
import {
  type PauseState,
  type AdminSubscriptionDetail,
  detailFromRaw,
} from "./adminSubscription";
import { parsePauseState as parsePauseStateLocal } from "./subscriptionState";

/** Maps Firebase's permission failure onto a message worth showing. */
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
  days: number;
  /** Whether the access is currently paused. */
  paused: boolean;
  /** When the current pause ends, or 0. */
  pausedUntil: number;
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

/** Signs in with Google, returning the resulting UID. */
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
    get(ref(database, "subscriptions")).catch(() => ({ val: () => null }) as never),
  ]).catch(rethrow);

  const names = (registrySnapshot.val() ?? {}) as Record<
    string,
    { name?: string; firstSeen?: number; lastSeen?: number }
  >;
  const chats = (usersSnapshot.val() ?? {}) as Record<string, { chats?: Record<string, unknown> }>;
  const plans = (subscriptionsSnapshot.val() ?? {}) as Record<string, unknown>;
  const now = Date.now();

  // Everyone who has been here at all, not only everyone who has talked.
  const uids = new Set([...Object.keys(names), ...Object.keys(chats), ...Object.keys(plans)]);

  const rows = [...uids].map((uid) => {
    const profile = names[uid];
    const entries = Object.values(chats[uid]?.chats ?? {});
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
    const raw = plans[uid];
    const parsed = parseSubscription(raw);
    const active = isActive(parsed, now) ? parsed : null;
    const pause = raw ? parsePauseStateLocal((raw as Record<string, unknown>).pause ?? null) : null;
    const pausedUntil = pause ? pause.pausedAt + (now - pause.setAt) : 0;
    const paused = Boolean(pause && pausedUntil > now);

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
            days: active.days,
            paused,
            pausedUntil,
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

export async function wipeUser(uid: string): Promise<void> {
  const { database } = await requireAdmin();
  await remove(ref(database, `users/${uid}`)).catch(rethrow);
  await remove(ref(database, `subscriptions/${uid}`)).catch(rethrow);
}

export async function wipeAll(): Promise<void> {
  const { database } = await requireAdmin();
  await remove(ref(database, "users")).catch(rethrow);
  await remove(ref(database, "subscriptions")).catch(rethrow);
  await remove(ref(database, "admin/registry")).catch(rethrow);
}

export async function readSubscription(uid: string): Promise<Subscription | null> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  return parseSubscription(snapshot.val());
}

/** Reads the full detail the console shows for one visitor's plan. */
export async function readSubscriptionDetail(uid: string): Promise<AdminSubscriptionDetail> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  return detailFromRaw(uid, snapshot.val());
}

/** Reads the raw records the list/search view needs, newest first. */
export async function listSubscriptionDetails(
  uids: string[]
): Promise<AdminSubscriptionDetail[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, "subscriptions")).catch(rethrow);
  const raw = (snapshot.val() ?? {}) as Record<string, unknown>;
  return uids
    .map((uid) => detailFromRaw(uid, raw[uid]))
    .sort((a, b) => (b.subscription?.expiresAt ?? 0) - (a.subscription?.expiresAt ?? 0));
}

/** Grants a plan to a visitor, extending it if they already have that one. */
export async function grantSubscription(
  uid: string,
  plan: PlanId,
  days = 30,
  note = ""
): Promise<Subscription> {
  const { database } = await requireAdmin();
  const previous = await readSubscription(uid);
  const record = grantRecord({ plan, days: normalizeDays(days), now: Date.now(), note, previous });
  await set(ref(database, `subscriptions/${uid}`), record).catch(rethrow);
  return record;
}

/** Takes a plan away, so the visitor is back on the free tier. */
export async function revokeSubscription(uid: string): Promise<void> {
  const { database } = await requireAdmin();
  await remove(ref(database, `subscriptions/${uid}`)).catch(rethrow);
}

/** Pauses a visitor's access without spending the time they paid for. */
export async function pauseSubscription(
  uid: string,
  reason: string,
  setBy: string
): Promise<boolean> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  const existing = parseSubscription(snapshot.val());
  if (!existing) return false;

  const currentPause = snapshot.val() ? parsePauseStateLocal((snapshot.val() as Record<string, unknown>).pause ?? null) : null;
  const now = Date.now();
  const previousPausedAt = currentPause?.pausedAt ?? 0;

  // If already paused, extend the pause from its current end rather than from
  // the original pausedAt, so an owner can re-pause a plan that is already on
  // hold without losing the remaining time they had set aside.
  const effectivePausedAt = previousPausedAt > 0
    ? previousPausedAt + (now - currentPause!.setAt)
    : now;

  const pause: PauseState = {
    pausedAt: effectivePausedAt,
    setAt: now,
    setBy: setBy.slice(0, 120),
    reason: reason.slice(0, 200),
  };

  await set(ref(database, `subscriptions/${uid}`), { ...existing, pause }).catch(rethrow);
  return true;
}

/** Resumes a paused subscription, preserving the remaining time. */
export async function resumeSubscription(uid: string): Promise<boolean> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  const raw = snapshot.val();
  if (!raw || typeof raw !== "object") return false;

  const existing = parseSubscription(raw);
  if (!existing) return false;

  const currentPause = parsePauseStateLocal((raw as Record<string, unknown>).pause ?? null);
  if (!currentPause) return true; // not paused, nothing to resume

  const now = Date.now();
  const remainingAtPause = existing.expiresAt - currentPause.pausedAt;
  const newExpiresAt = currentPause.pausedAt + Math.max(0, remainingAtPause) + (now - currentPause.pausedAt);

  const resumed: Subscription = { ...existing, expiresAt: newExpiresAt };

  await set(ref(database, `subscriptions/${uid}`), resumed).catch(rethrow);
  return true;
}

/** Searches subscriptions by name or uid substring. */
export async function searchSubscriptions(query: string): Promise<AdminSubscriptionDetail[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, "subscriptions")).catch(rethrow);
  const raw = (snapshot.val() ?? {}) as Record<string, unknown>;
  const q = query.trim().toLowerCase();
  if (!q) {
    return Object.entries(raw)
      .map(([uid, value]) => detailFromRaw(uid, value))
      .sort((a, b) => (b.subscription?.expiresAt ?? 0) - (a.subscription?.expiresAt ?? 0));
  }

  const matches: AdminSubscriptionDetail[] = [];
  for (const [uid, value] of Object.entries(raw)) {
    const detail = detailFromRaw(uid, value);
    if (!detail.subscription) continue;
    if (uid.toLowerCase().includes(q)) {
      matches.push(detail);
      continue;
    }
  }
  return matches;
}

// ── Redeem codes ─────────────────────────────────────────────────────────────
// A word the owner picks, carrying a plan and a length, that a buyer types to
// claim it. This exists because a manual grant needs a name: "your Mini is paid
// for" has to be handed over somehow, and a code is a thing that survives a
// phone call, a screenshot, and a lost message in a way a date does not.
//
// Codes are the owner's, not the buyer's: the plan and the days live in the
// code, never in the claim. See lib/serverRedeem.ts.

/** Writes a new code, replacing any that already had the same word. */
export async function createRedeemCode(input: {
  code: string;
  plan: PlanId;
  days: number;
  note?: string;
}): Promise<RedeemCode> {
  const { database } = await requireAdmin();
  const code = normalizeCode(input.code);
  if (!isValidCode(code)) throw new Error("A code needs at least 4 letters or numbers.");

  const record: RedeemCode = {
    code,
    plan: input.plan,
    days: normalizeDays(input.days),
    active: true,
    createdAt: Date.now(),
    note: String(input.note ?? "").trim().slice(0, 120),
  };
  await set(ref(database, `codes/${code}`), record).catch(rethrow);
  return record;
}

/** Every code the owner has made, newest first. */
export async function listRedeemCodes(): Promise<RedeemCode[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, "codes")).catch(rethrow);
  const value = (snapshot.val() ?? {}) as Record<string, unknown>;
  return Object.values(value)
    .map(parseRedeemCode)
    .filter((code): code is RedeemCode => code !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Switches a code on or off.
 *
 * Switching off is the urgent one: a word that has been posted publicly and is
 * being resold can be stopped here immediately. A code that has already been
 * claimed also stops being worth anything, because the server re-checks `active`
 * on every request rather than trusting the claim to have been made while it was
 * on. That is the reason a terminated code takes effect for people who already
 * used it, not only for people who have not got round to it yet.
 */
export async function setRedeemCodeActive(code: string, active: boolean): Promise<void> {
  const { database } = await requireAdmin();
  const word = normalizeCode(code);
  const snapshot = await get(ref(database, `codes/${word}`)).catch(rethrow);
  const existing = parseRedeemCode(snapshot.val());
  if (!existing) throw new Error("That code no longer exists.");
  await set(ref(database, `codes/${word}`), { ...existing, active }).catch(rethrow);
}

/** Deletes a code entirely. */
export async function deleteRedeemCode(code: string): Promise<void> {
  const { database } = await requireAdmin();
  await remove(ref(database, `codes/${normalizeCode(code)}`)).catch(rethrow);
}

/** Saves the runtime controls. */
export interface AdminUsage {
  uid: string;
  day: string;
  chat: number;
  image: number;
}

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

// ── Usage history ────────────────────────────────────────────────────────────
export interface UsageHistoryDay {
  day: string;
  uids: string[];
  chat: number;
  image: number;
  auto: number;
  code: number;
  self: number;
}

export async function listUsageHistory(limitDays = 60): Promise<UsageHistoryDay[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, "usage")).catch(rethrow);
  const value = (snapshot.val() ?? {}) as Record<
    string,
    Record<string, { chat?: number; image?: number; auto?: number; code?: number; self?: number }>
  >;
  const byDay = new Map<string, UsageHistoryDay>();
  for (const [uid, days] of Object.entries(value)) {
    for (const [day, entry] of Object.entries(days ?? {})) {
      let row = byDay.get(day);
      if (!row) {
        row = { day, uids: [], chat: 0, image: 0, auto: 0, code: 0, self: 0 };
        byDay.set(day, row);
      }
      row.uids.push(uid);
      row.chat += entry?.chat ?? 0;
      row.image += entry?.image ?? 0;
      row.auto += entry?.auto ?? 0;
      row.code += entry?.code ?? 0;
      row.self += entry?.self ?? 0;
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-limitDays);
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  const current = await requireAdmin();
  const user = current.auth.currentUser;
  await user?.getIdToken(true);
  await set(ref(current.database, "config"), config).catch(rethrow);
}

export interface AdminAuditEntry {
  id: string;
  at: number;
  action: "grant" | "revoke" | "pause" | "resume" | "createCode" | "deleteCode" | "toggleCode";
  uid?: string;
  name?: string | null;
  plan?: PlanId;
  days?: number;
  expiresAt?: number;
  note?: string;
}

export async function appendAdminAudit(
  entry: Omit<AdminAuditEntry, "id">
): Promise<AdminAuditEntry> {
  const { database } = await requireAdmin();
  const key = push(ref(database, "admin/audit")).key;
  if (!key) throw new Error("Could not allocate a history entry");
  await set(ref(database, `admin/audit/${key}`), entry).catch(rethrow);
  return { ...entry, id: key };
}

/** Newest first, capped: the console shows the recent ledger, not all of it. */
export async function listAdminAudit(limit = 50): Promise<AdminAuditEntry[]> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, "admin/audit")).catch(rethrow);
  const value = (snapshot.val() ?? {}) as Record<string, Omit<AdminAuditEntry, "id">>;
  return Object.entries(value)
    .map(([id, entry]) => ({ ...entry, id }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, limit);
}
