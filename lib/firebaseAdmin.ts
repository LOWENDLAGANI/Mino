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
import {
  grantRecord,
  isActive,
  parseSubscription,
  resumeExpiry,
  type PauseState,
  type Subscription,
} from "./subscriptionState";

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
  /** Whether the owner has this plan on hold. */
  paused: boolean;
  /** When the hold began, or 0 when running. */
  pausedAt: number;
  /** The owner's reason for the hold, when one was given. */
  pauseReason: string;
  /**
   * Time genuinely left: frozen at the pause instant while held, counting down
   * from now while running. This is the number the console shows, because it is
   * the number continuing will actually give back.
   */
  remainingMs: number;
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

    // What is still paid for — plus anything on hold, however long the hold has
    // lasted. A paused plan whose original end date has passed must stay on this
    // list: its remaining time is frozen, not spent, and hiding it would leave
    // the owner with no way to continue it. A lapsed grant with no hold is shown
    // as free, because "Free" is the thing they can act on.
    const raw = plans[uid];
    const parsed = parseSubscription(raw);
    const hold = parsed?.pause ?? null;
    const visible = parsed && (hold || isActive(parsed, now)) ? parsed : null;
    const paused = Boolean(hold);

    return {
      uid,
      name: profile?.name ?? null,
      firstSeen: profile?.firstSeen ?? null,
      lastSeen: profile?.lastSeen ?? lastChatAt,
      chats: entries.length,
      messages,
      subscription: visible
        ? {
            plan: visible.plan,
            grantedAt: visible.grantedAt,
            expiresAt: visible.expiresAt,
            days: visible.days,
            paused,
            pausedAt: hold?.pausedAt ?? 0,
            pauseReason: hold?.reason ?? "",
            remainingMs: hold
              ? Math.max(0, visible.expiresAt - hold.pausedAt)
              : Math.max(0, visible.expiresAt - now),
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

/**
 * Grants a plan to a visitor, extending it if they already have that one.
 *
 * Refused while a hold is on: granting stacks onto `expiresAt`, and a held
 * record's `expiresAt` is a frozen date, so the two would disagree about how
 * much time the buyer actually has. Continuing first costs one click and keeps
 * every number true.
 *
 * The buyer's acknowledgement node is carried across verbatim. A grant earns a
 * fresh celebration because its `announcementId` is one higher — not because
 * the record of what they had already seen was thrown away.
 */
export async function grantSubscription(
  uid: string,
  plan: PlanId,
  days = 30,
  note = ""
): Promise<Subscription> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  const raw = snapshot.val();
  const previous = parseSubscription(raw);
  if (previous?.pause) {
    throw new Error("That plan is paused. Continue it before granting more time.");
  }
  const record = grantRecord({ plan, days: normalizeDays(days), now: Date.now(), note, previous });
  const ack = raw && typeof raw === "object" ? (raw as Record<string, unknown>).ack : null;
  await set(ref(database, `subscriptions/${uid}`), {
    ...record,
    ...(ack && typeof ack === "object" ? { ack } : {}),
  }).catch(rethrow);
  return record;
}

/** Takes a plan away, so the visitor is back on the free tier. */
export async function revokeSubscription(uid: string): Promise<void> {
  const { database } = await requireAdmin();
  await remove(ref(database, `subscriptions/${uid}`)).catch(rethrow);
}

/**
 * Puts a visitor's plan on hold without spending a single day of it.
 *
 * The hold is a `pause` child on the record — `expiresAt` is not touched, so
 * nothing about the stored plan changes except that it is now held. Re-pausing
 * an already-held plan is a no-op that keeps the original `pausedAt`: moving
 * that instant would silently shrink the remaining time the hold is protecting.
 * Pausing a plan that has already run out is refused, because there is no time
 * left to hold.
 *
 * Returns the record now on hold, or null when there was nothing to pause.
 */
export async function pauseSubscription(
  uid: string,
  reason: string
): Promise<Subscription | null> {
  const { database, auth } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  const raw = snapshot.val();
  const existing = parseSubscription(raw);
  if (!existing) return null;
  if (existing.pause) return existing;
  if (!isActive(existing, Date.now())) return null;

  const actor = auth.currentUser?.email || auth.currentUser?.displayName || "admin";
  const pause: PauseState = {
    pausedAt: Date.now(),
    setAt: Date.now(),
    setBy: actor.slice(0, 120),
    reason: String(reason ?? "").slice(0, 200),
  };
  const ack = raw && typeof raw === "object" ? (raw as Record<string, unknown>).ack : null;
  const record: Subscription = { ...existing, pause };
  await set(ref(database, `subscriptions/${uid}`), {
    ...record,
    ...(ack && typeof ack === "object" ? { ack } : {}),
  }).catch(rethrow);
  return record;
}

/**
 * Continues a held plan, giving back exactly the time the hold protected.
 *
 * `resumeExpiry` shifts the end date by the length of the hold alone
 * (`expiresAt + (now - pausedAt)`), so a buyer with 12 days held who continues
 * three weeks later still has 12 days from that moment — never a fresh term,
 * and never earlier than the days they paid for. The hold child is dropped and
 * the acknowledgement node is carried across, so continuing cannot re-trigger
 * a celebration the buyer has already dismissed.
 *
 * Returns the record as it now stands, or null when nothing was on hold.
 */
export async function resumeSubscription(uid: string): Promise<Subscription | null> {
  const { database } = await requireAdmin();
  const snapshot = await get(ref(database, `subscriptions/${uid}`)).catch(rethrow);
  const raw = snapshot.val();
  const existing = parseSubscription(raw);
  if (!existing?.pause) return null;

  const record: Subscription = {
    ...existing,
    expiresAt: resumeExpiry(existing, existing.pause, Date.now()),
  };
  delete record.pause;

  const ack = raw && typeof raw === "object" ? (raw as Record<string, unknown>).ack : null;
  await set(ref(database, `subscriptions/${uid}`), {
    ...record,
    ...(ack && typeof ack === "object" ? { ack } : {}),
  }).catch(rethrow);
  return record;
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
