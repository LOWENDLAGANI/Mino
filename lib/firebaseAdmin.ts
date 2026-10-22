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

import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";
import { getServices } from "./firebaseHistory";
import {
  databaseRequest,
  notConfigured,
  unauthorized,
  userSession,
  withTimeout,
  type DatabaseSession,
} from "./firebaseRest";
import { dewBalanceFrom, roundDew } from "./dew";
import type { AppConfig } from "./appConfig";
import {
  isValidCode,
  normalizeCode,
  parseRedeemCode,
  type RedeemCode,
} from "./redeemState";

const VERIFY_TIMEOUT_MS = 10_000;

/**
 * Whether the account signed in right now is the administrator.
 *
 * `false` is an answer: Firebase refused the read, so this account is not the
 * administrator. A browser with *nobody* signed in is that same answer, not a
 * failure — the gate needs it to put up the Google button, and reporting it as
 * an error is what used to turn "signed out" into a dead end with no way to
 * sign back in. Only a failure to *ask* (an unreachable database, an auth state
 * that never settles) is thrown, so the gate can say what actually went wrong.
 *
 * The question is asked over REST instead of through the database socket for
 * one reason: a socket read on a handle bound to a host that does not exist
 * never settles at all, so "refused", "no such database" and "unreachable"
 * were indistinguishable and the gate waited on all three. An HTTP request
 * reports a status for each. The rules judge it exactly as they judge the
 * socket, because the `?auth=` token is the account's own.
 */
export async function verifyAdminAccess(): Promise<boolean> {
  const current = await getServices();
  if (!current) throw notConfigured();

  const restored = current.auth.currentUser
    ? Promise.resolve(current.auth.currentUser)
    : current.auth.authStateReady().then(() => current.auth.currentUser);
  const user = await withTimeout(restored, VERIFY_TIMEOUT_MS);
  if (!user) return false;

  const session = userSession(current.databaseUrl, user, VERIFY_TIMEOUT_MS);

  // The token this browser already holds: asking for one without a forced
  // refresh keeps a slow or blocked token endpoint off the path that decides
  // whether the console opens at all. A refusal is retried once on a fresh
  // token inside `databaseRequest`, and an unknown address or an unreachable
  // host comes back as an error that names itself.
  try {
    await databaseRequest(session, "admin/registry", { timeoutMs: VERIFY_TIMEOUT_MS });
    return true;
  } catch (cause: unknown) {
    // The rules refusing this account is the answer the gate draws the Google
    // button for, not a failure worth reporting.
    if ((cause as { code?: string })?.code === "app/permission-denied") return false;
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

async function requireAdmin() {
  const current = await getServices();
  if (!current) throw notConfigured();
  return current;
}

/**
 * The session every console request is made with.
 *
 * Its address is the one the database was actually bound to (see
 * lib/databaseUrl.ts), so an address that had to be repaired is repaired here
 * as well rather than only for the gate.
 */
async function adminSession(): Promise<DatabaseSession> {
  const current = await requireAdmin();
  const user = current.auth.currentUser;
  if (!user) throw unauthorized();
  return userSession(current.databaseUrl, user);
}

/** Signs in with Google, returning the resulting UID. */
export async function signInAsAdmin(): Promise<string> {
  const current = await getServices();
  if (!current) throw notConfigured();
  try {
    const credential = await signInWithPopup(current.auth, new GoogleAuthProvider());
    return credential.user.uid;
  } catch (cause: unknown) {
    // A popup the browser refused (extension, embedded window, strict pop-up
    // setting) is a failure of the *method*, not of the account. Fall back to
    // the full-page redirect — the browser leaves and comes back signed in, and
    // re-opening the gate then verifies the rules against the real account. If
    // the redirect itself is refused (an unauthorised domain, for instance),
    // that error propagates, because it is the one a visitor can act on.
    if ((cause as { code?: string })?.code === "auth/popup-blocked") {
      await signInWithRedirect(current.auth, new GoogleAuthProvider());
      // Reached only when the redirect did not navigate. Say what is true
      // rather than reporting the popup failure twice.
      throw new Error("Sign-in switched to a full-page redirect. Completing it…");
    }
    throw cause;
  }
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
  const session = await adminSession();
  const [registry, users] = await Promise.all([
    databaseRequest<Record<string, { name?: string; firstSeen?: number; lastSeen?: number }>>(
      session,
      "admin/registry"
    ),
    databaseRequest<Record<string, { chats?: Record<string, unknown> }>>(session, "users"),
  ]);

  const names = registry ?? {};
  const chats = users ?? {};

  // Everyone who has been here at all, not only everyone who has talked.
  const uids = new Set([...Object.keys(names), ...Object.keys(chats)]);

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
  const value =
    (await databaseRequest<
      Record<string, { id?: string; title?: string; createdAt?: number; updatedAt?: number }>
    >(await adminSession(), `users/${uid}/chats`)) ?? {};
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
  const chat = await databaseRequest<{
    title?: string;
    messages?: Record<
      string,
      { role?: string; content?: string; model?: string; createdAt?: number; error?: string }
    >;
  }>(await adminSession(), `users/${uid}/chats/${chatId}`);
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
  await databaseRequest(await adminSession(), `users/${uid}`, { method: "DELETE" });
}

export async function wipeAll(): Promise<void> {
  const session = await adminSession();
  await databaseRequest(session, "users", { method: "DELETE" });
  await databaseRequest(session, "admin/registry", { method: "DELETE" });
}

// ── Dew top-ups ────────────────────────────────────────────────────────────
// A manual sale with a buyer standing in front of you needs a direct transfer:
// the codes screen hands over a word, but when someone has paid and you have
// their visitor id, the honest thing is to credit their wallet from here.
//
// The credit is written under a TOPUP-… key in their credits map — the same
// derived shape the server-side deduction reads — and the rules pin every
// dimension of it: only the named administrator address may write a credit
// with a chosen amount, and no amount over 100,000 is accepted. Nothing here
// decides access; the browser writes with the admin's own verified token
// and Firebase refuses anything else.

/** A direct credit of Dew, and the balance the visitor holds afterwards. */
export interface DewGrant {
  uid: string;
  dew: number;
  balance: number;
}

/** One visitor's Dew, derived the same way the server derives it. */
export async function readDewBalance(uid: string): Promise<number> {
  const wallet = await databaseRequest<{ credits?: Record<string, number>; spent?: number }>(
    await adminSession(),
    `dew/${uid}`
  );
  return dewBalanceFrom(wallet ?? null);
}

/**
 * Every visitor's Dew balance, keyed by uid, read from the wallet node.
 *
 * One read covers the whole list, so the People screen can show a balance on
 * every row without a request per person.
 */
export async function readDewBalances(): Promise<Record<string, number>> {
  const value =
    (await databaseRequest<
      Record<string, { credits?: Record<string, number>; spent?: number } | null>
    >(await adminSession(), "dew")) ?? {};
  const balances: Record<string, number> = {};
  for (const [uid, node] of Object.entries(value)) {
    balances[uid] = dewBalanceFrom(node ?? null);
  }
  return balances;
}

/**
 * Credits Dew straight to a visitor's wallet.
 *
 * The credit keys on a TOPUP timestamp so a repeat grant adds rather than
 * replaces — a 100-Dew grant issued twice is 200 Dew, not a rewrite of the
 * first — while the rules still pin that only the administrator address can
 * write a credit of a chosen amount.
 */
export async function grantDew(
  uid: string,
  dew: number
): Promise<DewGrant> {
  const session = await adminSession();
  const visitor = uid.replace(/[^A-Za-z0-9]/g, "");
  if (!visitor) throw new Error("Enter the visitor id first.");

  const amount = roundDew(dew);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    throw new Error("A top-up needs a positive amount of at most 100,000 Dew.");
  }

  // Timestamp plus a short random tail, so two grants issued in the same
  // millisecond add up rather than silently overwrite each other.
  const key = `TOPUP-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await databaseRequest(session, `dew/${visitor}/credits/${key}`, { method: "PUT", body: amount });
  const balance = await readDewBalance(visitor);
  return { uid: visitor, dew: amount, balance };
}

// ── Redeem codes ─────────────────────────────────────────────────────────────
// A word the owner picks, carrying a Dew amount, that a buyer types to claim it.
// This exists because a manual top-up needs a name: "I've sent you 100 Dew" has
// to be handed over somehow, and a code is a thing that survives a phone call, a
// screenshot, and a lost message in a way a figure does not.
//
// Codes are the owner's, not the buyer's: the amount lives in the code, never
// in the claim. See lib/serverRedeem.ts.

/** Writes a new code, replacing any that already had the same word. */
export async function createRedeemCode(input: {
  code: string;
  /** The Dew amount the code grants. */
  dew: number;
  note?: string;
}): Promise<RedeemCode> {
  const session = await adminSession();
  const code = normalizeCode(input.code);
  if (!isValidCode(code)) throw new Error("A code needs at least 4 letters or numbers.");

  const note = String(input.note ?? "").trim().slice(0, 120);
  const createdAt = Date.now();

  if (typeof input.dew !== "number" || !Number.isFinite(input.dew) || input.dew <= 0 || input.dew > 100_000) {
    throw new Error("A code needs a positive Dew amount of at most 100,000.");
  }
  const record: RedeemCode = {
    code,
    dew: Math.round(input.dew * 1000) / 1000,
    active: true,
    createdAt,
    note,
  };
  await databaseRequest(session, `codes/${code}`, { method: "PUT", body: record });
  return record;
}

/** Every code the owner has made, newest first. */
export async function listRedeemCodes(): Promise<RedeemCode[]> {
  const value = (await databaseRequest<Record<string, unknown>>(await adminSession(), "codes")) ?? {};
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
  const session = await adminSession();
  const word = normalizeCode(code);
  const existing = parseRedeemCode(await databaseRequest<unknown>(session, `codes/${word}`));
  if (!existing) throw new Error("That code no longer exists.");
  await databaseRequest(session, `codes/${word}`, { method: "PUT", body: { ...existing, active } });
}

/** Deletes a code entirely. */
export async function deleteRedeemCode(code: string): Promise<void> {
  await databaseRequest(await adminSession(), `codes/${normalizeCode(code)}`, { method: "DELETE" });
}

/** Saves the runtime controls. */
export interface AdminUsage {
  uid: string;
  day: string;
  chat: number;
  image: number;
}

export async function listUsage(): Promise<AdminUsage[]> {
  const value =
    (await databaseRequest<Record<string, Record<string, { chat?: number; image?: number }>>>(
      await adminSession(),
      "usage"
    )) ?? {};
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
  const value =
    (await databaseRequest<
      Record<string, Record<string, { chat?: number; image?: number; auto?: number; code?: number; self?: number }>>
    >(await adminSession(), "usage")) ?? {};
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
  // `fresh` because a controls write must not race the identity that signed in
  // a moment ago: the rules read the token, and the one this browser still holds
  // may belong to another account.
  await databaseRequest(await adminSession(), "config", { method: "PUT", body: config, fresh: true });
}

export interface AdminAuditEntry {
  id: string;
  at: number;
  action: "createCode" | "deleteCode" | "toggleCode" | "grantDew";
  /** The word the entry is about. */
  code?: string;
  /** The Dew the code carried, when it carried any. */
  dew?: number;
  /** For a toggle: the state the code was switched to. */
  active?: boolean;
  /** The uid the action acted on. */
  uid?: string;
  note?: string;
}

export async function appendAdminAudit(
  entry: Omit<AdminAuditEntry, "id">
): Promise<AdminAuditEntry> {
  // A POST lets the database allocate the key, which is what `push` used to do.
  const created = await databaseRequest<{ name?: string }>(await adminSession(), "admin/audit", {
    method: "POST",
    body: entry,
  });
  const key = created?.name;
  if (!key) throw new Error("Could not allocate a history entry");
  return { ...entry, id: key };
}

/** Newest first, capped: the console shows the recent ledger, not all of it. */
export async function listAdminAudit(limit = 50): Promise<AdminAuditEntry[]> {
  const value =
    (await databaseRequest<Record<string, Omit<AdminAuditEntry, "id">>>(
      await adminSession(),
      "admin/audit"
    )) ?? {};
  return Object.entries(value)
    .map(([id, entry]) => ({ ...entry, id }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, limit);
}
