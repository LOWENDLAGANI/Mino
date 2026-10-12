// ── Visitor account state ────────────────────────────────────────────────────
// Pure logic only. Nothing here imports Firebase, so the rules that decide what
// a visitor is shown — and what happens to their name when they bind — can be
// tested without a browser, a network, or a project.
//
// This is the user-facing account, and it is deliberately not the administrator's
// one. Binding a Google account grants exactly what the database rules grant
// `auth != null`, and nothing else: elevation is decided by `database.rules.json`
// naming one address, so there is no code path here by which signing in could
// reach the console. See the note on bindGoogleAccount in lib/account.ts.

/** What Mino knows about who is using it right now. */
export type AccountStatus =
  /** No NEXT_PUBLIC_FIREBASE_* values, so there is no account to have. */
  | "unconfigured"
  /** Firebase is configured but not answering, so the state is unknown. */
  | "unreachable"
  /** Signed in with no provider: a name and a local database, nothing portable. */
  | "guest"
  /** A Google account is attached to this identity. */
  | "linked";

export interface AccountView {
  status: AccountStatus;
  /** The address on the linked Google account, when there is one. */
  email: string | null;
  /**
   * The name Google holds for the account. It is the weakest of the three names
   * available — a name the person typed beats a name they chose on another site
   * — and it is the only one Mino never asked them for.
   */
  name: string | null;
  /** True when a Google account is attached. */
  isLinked: boolean;
  /**
   * True when the account can still be bound. A guest can always be upgraded; a
   * linked account is already what binding would produce.
   */
  canBind: boolean;
}

export interface AccountInput {
  configured: boolean;
  /** False when Firebase could not be reached at all. */
  reachable?: boolean;
  /** null when no one is signed in yet. */
  signedIn: boolean;
  isAnonymous?: boolean;
  email?: string | null;
  name?: string | null;
}

/**
 * Reduces what Firebase reports to the one thing the interface needs: is this
 * person a guest, or has an account?
 *
 * The distinction is drawn from `isAnonymous` rather than from whether an email
 * exists, because a Google account always has one and an anonymous account
 * never does, while "signed in but anonymous" is exactly the state a guest is
 * in and the one binding exists to change.
 */
export function describeAccount(input: AccountInput): AccountView {
  if (!input.configured) {
    return { status: "unconfigured", email: null, name: null, isLinked: false, canBind: false };
  }
  if (input.reachable === false) {
    return { status: "unreachable", email: null, name: null, isLinked: false, canBind: false };
  }
  if (!input.signedIn) {
    // Firebase is fine and simply has not signed anyone in yet. The app signs a
    // first-time visitor in anonymously, so this is brief and not an error.
    return { status: "guest", email: null, name: null, isLinked: false, canBind: true };
  }

  if (input.isAnonymous) {
    return { status: "guest", email: null, name: null, isLinked: false, canBind: true };
  }
  return {
    status: "linked",
    email: input.email ?? null,
    name: input.name ?? null,
    isLinked: true,
    canBind: false,
  };
}

/** One line describing the account, for the settings row. */
export function accountHeadline(view: AccountView, displayName: string): string {
  switch (view.status) {
    case "unconfigured":
      return "Accounts are not set up on this deployment";
    case "unreachable":
      return "Mino cannot reach the account service";
    case "linked":
      return view.email ?? "Linked to a Google account";
    case "guest":
    default:
      return displayName
        ? `${displayName} · on this device only`
        : "On this device only";
  }
}

/** The sentence under the settings row. */
export function accountExplanation(view: AccountView): string {
  switch (view.status) {
    case "unconfigured":
      return "Add the NEXT_PUBLIC_FIREBASE_* values and redeploy to turn this on. Everything else about Mino keeps working without it.";
    case "unreachable":
      return "Nothing has changed. Your chats and your name are still on this device — check the connection and try again in a moment.";
    case "linked":
      return "Your account and its chats follow you to any browser you sign in from. Detaching returns this device to a name on its own.";
    case "guest":
    default:
      return "Link a Google account and your chats follow you to any browser you sign in from. Your name stays the same either way, and you can still use Mino without an account.";
  }
}

/**
 * Firebase's error codes, turned into something worth reading on a phone.
 *
 * These are the failures that are actually reachable here, and each one has a
 * concrete cause the person can act on. Anything unrecognised keeps its own
 * message rather than being replaced with a guess.
 */
const LINK_ERRORS: Record<string, string> = {
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/cancelled-popup-request":
    "Another sign-in window is already open. Close it and try again.",
  "auth/operation-not-allowed":
    "Google sign-in is switched off. In Firebase → Authentication → Sign-in method, turn on Google.",
  "auth/unauthorized-domain":
    "This site is not authorised. In Firebase → Authentication → Settings → Authorized domains, add the address you are visiting from.",
  "auth/network-request-failed":
    "The request to Google never completed. Check your connection, and whether an extension is blocking googleapis.com.",
  "auth/popup-blocked":
    "The browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/credential-already-in-use":
    "That Google account is already linked to Mino on another browser. Sign in to it there instead — your existing chats are waiting.",
  "auth/account-exists-with-different-credential":
    "That Google account already has a Mino history. Sign in to it from the browser that has it, and your chats will come with you.",
  "auth/requires-recent-login":
    "For safety, sign in again before changing what is linked to this account.",
  "auth/user-disabled": "That account has been disabled.",
};

export function describeLinkError(cause: unknown): string {
  const error = cause as { code?: string; name?: string } | null;
  const code = error?.code ?? error?.name ?? "";
  if (LINK_ERRORS[code]) return LINK_ERRORS[code];
  return cause instanceof Error ? cause.message : String(cause ?? "Something went wrong.");
}

/** True when a failure is the person closing the window, which is not a problem. */
export function isDismissed(cause: unknown): boolean {
  const code = (cause as { code?: string })?.code ?? "";
  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

// ── The name ─────────────────────────────────────────────────────────────────

/** Matches the 40-character limit the database rules enforce on a stored name. */
export const NAME_MAX = 40;

export function normalizeName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
}

/**
 * Decides which name to show when the browser and the account disagree.
 *
 * A name typed on this device always wins. The account's copy exists so a person
 * signing in on a *new* browser is greeted by the name they already chose, and
 * silently replacing a name someone just corrected would be a worse bug than
 * showing a stale one.
 *
 * Returns null when there is nothing worth adopting, which the caller reads as
 * "leave the name alone".
 */
export function resolveName(
  localName: string,
  accountName: string | null | undefined
): string | null {
  const local = normalizeName(localName);
  if (local) return null;
  const remote = normalizeName(accountName);
  return remote ? remote : null;
}

/**
 * The name a returning person should be greeted with when they have an account
 * and no name on this device.
 *
 * Returns null when this browser already has a name. That is the whole contract:
 * this function is only ever called to fill a gap, and a gap that is not there
 * must not be filled over the top of an answer the person already gave.
 *
 * The Google display name is the last resort, and is used only when the account
 * holds no name either — it is the one value here that Mino did not ask the
 * person for, so it is the one least entitled to represent them.
 */
export function greetingName(
  localName: string,
  accountName: string | null | undefined,
  googleName: string | null | undefined
): string | null {
  if (normalizeName(localName)) return null;
  return resolveName("", accountName) ?? resolveName("", googleName);
}
