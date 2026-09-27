// ── The visitor's account ────────────────────────────────────────────────────
// Linking a Google account to Mino, unlinking it, and carrying a name across
// browsers. This is the user's account and not the administrator's: nothing here
// can grant console access, and nothing here reads the console's data.
//
// The whole design rests on one Firebase behaviour. Signing a guest in with
// `linkWithPopup` attaches the Google credential to the *existing* anonymous
// account instead of creating a new one, so the UID does not change. That makes
// binding a migration rather than a copy: the chats already logged under that
// UID stay exactly where they are, and no chat is ever moved, duplicated, or
// re-uploaded. The same is true in the other direction — an account that already
// exists somewhere else is signed into rather than merged into, because merging
// two histories is the one operation here that could lose someone's words.
//
// Elevation is decided entirely by `database.rules.json`, which grants one named
// address. Signing in with Google grants a token and nothing else, so there is no
// path from this file to the admin console even for the person who owns it.

import {
  GoogleAuthProvider,
  linkWithPopup,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { get, ref, set, type Database } from "firebase/database";
import { firebaseConfigured, getServices } from "./firebaseHistory";
import { normalizeName, type AccountView } from "./accountState";

/** What a bind actually did, which the interface needs to describe it honestly. */
export type BindOutcome =
  /** The anonymous account gained a Google credential. The UID never changed. */
  | "linked"
  /**
   * That Google account already had a Mino history elsewhere, so Mino signed
   * into it instead. The UID changed, and the caller must re-sync local chats
   * onto it — see migrateChatsToCurrentAccount.
   */
  | "adopted"
  /** The person closed the window. Nothing happened and nothing is wrong. */
  | "dismissed";

export interface BindResult {
  outcome: BindOutcome;
  view: AccountView;
}

function viewOf(user: User | null): AccountView {
  return {
    status: user && !user.isAnonymous ? "linked" : "guest",
    email: user?.email ?? null,
    name: user?.displayName ?? null,
    isLinked: Boolean(user && !user.isAnonymous),
    canBind: !(user && !user.isAnonymous),
  };
}

/** Google configured for exactly one account per Firebase project. */
function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/**
 * The errors that mean "this Google account is already a Mino user".
 *
 * `linkWithPopup` refuses to attach a credential that another UID already holds.
 * That refusal is not a dead end — it is the signal that the account exists and
 * the right move is to sign into it, which is why both codes route to the same
 * place below.
 */
function isAlreadyInUse(code: string): boolean {
  return (
    code === "auth/credential-already-in-use" ||
    code === "auth/account-exists-with-different-credential"
  );
}

function codeOf(cause: unknown): string {
  return (cause as { code?: string } | null)?.code ?? "";
}

/**
 * Attaches a Google account to whoever is using Mino.
 *
 * A guest is upgraded in place and keeps their UID, so nothing they have written
 * moves. A browser whose Google account is already known to Mino signs into that
 * account instead, because a second copy of the same person's history would be
 * worse than none — the existing history is the real one.
 *
 * A browser that is somehow signed in as neither a guest nor a linked account
 * signs in normally, which is the ordinary path.
 */
export async function bindGoogleAccount(name?: string): Promise<BindResult> {
  const current = await getServices();
  if (!current) throw new Error("unconfigured");
  const existing = current.user ?? (await current.ensureUser());

  if (!existing.isAnonymous) {
    await saveAccountName(name ?? null);
    return { outcome: "linked", view: viewOf(current.user) };
  }

  try {
    const credential = await linkWithPopup(existing, googleProvider());
    await saveAccountName(name ?? null);
    return { outcome: "linked", view: viewOf(credential.user ?? current.user) };
  } catch (cause: unknown) {
    const code = codeOf(cause);
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return { outcome: "dismissed", view: viewOf(current.user) };
    }
    if (!isAlreadyInUse(code)) throw cause;

    // The account exists already. Sign into it and let the caller re-sync, so
    // the chats on this device land under the account that owns them.
    const credential = await signInWithPopup(current.auth, googleProvider());
    await saveAccountName(name ?? null);
    return { outcome: "adopted", view: viewOf(credential.user ?? current.user) };
  }
}

/**
 * Returns this device to a name on its own.
 *
 * Signing out and back in anonymously is deliberate. Firebase deletes an account
 * once it has no sign-in provider left for a while, so unlinking the only
 * provider would quietly throw the history away; detaching leaves the account
 * untouched and intact for the next browser that signs into it.
 */
export async function detachGoogleAccount(): Promise<AccountView> {
  const current = await getServices();
  if (!current) throw new Error("unconfigured");
  if (current.user && current.user.isAnonymous) return viewOf(current.user);
  await signOut(current.auth);
  await current.ensureUser();
  return viewOf(current.user);
}

/** Signs back into a Google account without touching the existing one first. */
export async function signInWithGoogle(name?: string): Promise<BindResult> {
  const current = await getServices();
  if (!current) throw new Error("unconfigured");
  const credential = await signInWithPopup(current.auth, googleProvider());
  await saveAccountName(name ?? null);
  return {
    outcome: credential.user.uid === current.user?.uid ? "linked" : "adopted",
    view: viewOf(credential.user ?? current.user),
  };
}

/**
 * Subscribes to the signed-in identity.
 *
 * `onIdTokenChanged` rather than `onAuthStateChanged`, because a link and a
 * refresh both arrive as a token change and this needs to notice the moment the
 * account is not the one it was.
 */
export function watchAccount(
  onChange: (view: AccountView) => void
): () => void {
  if (!firebaseConfigured || typeof window === "undefined") {
    onChange({
      status: "unconfigured",
      email: null,
      name: null,
      isLinked: false,
      canBind: false,
    });
    return () => {};
  }

  let unsubscribe: (() => void) | undefined;
  let cancelled = false;

  const report = (user: User | null) => {
    if (!cancelled) onChange(viewOf(user));
  };

  void getServices()
    .then(async (services) => {
      if (!services || cancelled) return;
      report(services.user);
      await services.auth.authStateReady();
      if (cancelled) return;
      unsubscribe = onIdTokenChanged(services.auth, report);
    })
    .catch(() => {
      if (!cancelled) {
        onChange({
          status: "unreachable",
          email: null,
          name: null,
          isLinked: false,
          canBind: false,
        });
      }
    });

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

// ── The name that follows the account ────────────────────────────────────────

/**
 * Where a name lives so it can follow a person to another browser.
 *
 * `admin/registry` already holds the name, but a visitor has no read access
 * there — the rules grant them a write and nothing more — so it cannot be the
 * place a name is read back from. This node is the visitor's own and is readable
 * by them alone. It sits beside `chats`, not inside it, so the console's
 * visitor list and its chat reader are untouched by anything written here.
 */
function profileRef(database: Database, uid: string) {
  return ref(database, `users/${uid}/profile`);
}

/**
 * Records the name against the account.
 *
 * Best effort by design. This write needs one extra rule published (a read on
 * `users/$uid/profile` for its owner), and a deployment that has not republished
 * yet should lose cross-browser names rather than fail to bind. The name itself
 * is already saved locally, so nothing is ever lost by the write failing.
 */
export async function saveAccountName(name: string | null | undefined): Promise<void> {
  const trimmed = normalizeName(name);
  if (!trimmed) return;
  const current = await getServices();
  if (!current) return;
  try {
    await set(profileRef(current.database, (await current.ensureUser()).uid), {
      name: trimmed,
    });
  } catch {
    // Rules not republished yet, or offline. The local name still stands.
  }
}

/**
 * Reads the name this account chose on another browser.
 *
 * Returns null on any failure — including a deployment whose rules have not been
 * republished — so the caller treats it as "no name to adopt" and keeps whatever
 * this browser already knows.
 */
export async function loadAccountName(): Promise<string | null> {
  const current = await getServices();
  if (!current) return null;
  try {
    const snapshot = await get(profileRef(current.database, (await current.ensureUser()).uid));
    const name = (snapshot.val() as { name?: unknown } | null)?.name;
    return typeof name === "string" ? normalizeName(name) || null : null;
  } catch {
    return null;
  }
}
