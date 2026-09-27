// ── Mino — tests for the visitor's account ───────────────────────────────────
//
// The rules pinned here are the ones whose failure is quiet. A guest shown as
// linked keeps a name they never asked to change; a name from the account
// quietly overwriting one just typed on this device is worse; and a bind path
// that could reach the administrator's console would be a hole in the product
// rather than a bug in it.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountExplanation,
  accountHeadline,
  describeAccount,
  describeLinkError,
  greetingName,
  isDismissed,
  NAME_MAX,
  normalizeName,
  resolveName,
} from "../lib/accountState";

let failures = 0;
let passes = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passes += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

const GUEST = { configured: true, signedIn: true, isAnonymous: true };

console.log("\naccount state");

test("a deployment with no Firebase has no account to offer", () => {
  const view = describeAccount({ configured: false, signedIn: false });
  assert.equal(view.status, "unconfigured");
  assert.equal(view.canBind, false);
  assert.equal(view.isLinked, false);
});

test("a deployment that cannot be reached is not the same as one that is absent", () => {
  const view = describeAccount({ configured: true, reachable: false, signedIn: false });
  assert.equal(view.status, "unreachable");
  assert.equal(view.canBind, false);
});

test("an anonymous visitor is a guest who can still bind", () => {
  const view = describeAccount(GUEST);
  assert.equal(view.status, "guest");
  assert.equal(view.canBind, true);
  assert.equal(view.email, null);
});

test("nobody signed in yet is a guest, not an error", () => {
  const view = describeAccount({ configured: true, signedIn: false });
  assert.equal(view.status, "guest");
  assert.equal(view.canBind, true);
});

test("a Google account is linked and cannot be bound twice", () => {
  const view = describeAccount({
    configured: true,
    signedIn: true,
    isAnonymous: false,
    email: "someone@example.com",
    name: "Someone",
  });
  assert.equal(view.status, "linked");
  assert.equal(view.isLinked, true);
  assert.equal(view.canBind, false);
  assert.equal(view.email, "someone@example.com");
  assert.equal(view.name, "Someone");
});

test("a linked account is identified by anonymity, not by having an email", () => {
  // An anonymous account never has an address, and a Google account always does,
  // but the flag is the thing that actually says which kind of account this is.
  const view = describeAccount({
    configured: true,
    signedIn: true,
    isAnonymous: true,
    email: "leftover@example.com",
  });
  assert.equal(view.status, "guest");
  assert.equal(view.isLinked, false);
});

console.log("\nthe name a person is greeted by");

test("a name typed on this device is never replaced", () => {
  assert.equal(resolveName("Rani", "Old Name"), null);
});

test("an empty local name adopts the account's", () => {
  assert.equal(resolveName("", "Rani"), "Rani");
});

test("whitespace is not a name", () => {
  assert.equal(resolveName("   ", "Rani"), "Rani");
});

test("an account with no name adopts nothing", () => {
  assert.equal(resolveName("", null), null);
  assert.equal(resolveName("", "   "), null);
});

test("Google's name is the last resort, never an override", () => {
  // A name the person typed on this device outranks a name they chose for a
  // different site, and the account's own name outranks both. This function only
  // ever fills a gap, so a gap that is not there is left alone.
  assert.equal(greetingName("Rani", "Chosen", "Google Name"), null);
  assert.equal(greetingName("", "Chosen", "Google Name"), "Chosen");
  assert.equal(greetingName("", null, "Google Name"), "Google Name");
  assert.equal(greetingName("", null, null), null);
});

test("names are trimmed, collapsed and capped at the stored limit", () => {
  assert.equal(normalizeName("  Rani   Devi  "), "Rani Devi");
  assert.equal(normalizeName(null), "");
  assert.equal(normalizeName("a".repeat(200)).length, NAME_MAX);
  assert.equal(NAME_MAX, 40, "the database rules validate the same limit");
});

test("a name over the limit is cut where the rules would cut it", () => {
  // Anything longer is refused by the .validate rule on the profile node, so
  // what is shown has to be what is allowed to be stored.
  const long = normalizeName("b".repeat(60));
  assert.equal(long.length, 40);
});

console.log("\nwhat the settings row says");

test("a guest is told their name is only on this device", () => {
  const view = describeAccount(GUEST);
  assert.match(accountHeadline(view, "Rani"), /this device only/);
  assert.match(accountExplanation(view), /any browser/);
});

test("a linked account shows the address it is linked to", () => {
  const view = describeAccount({
    configured: true,
    signedIn: true,
    isAnonymous: false,
    email: "someone@example.com",
  });
  assert.match(accountHeadline(view, "Rani"), /someone@example\.com/);
  assert.match(accountExplanation(view), /Detaching/);
});

test("an unconfigured deployment explains itself instead of offering a dead button", () => {
  const view = describeAccount({ configured: false, signedIn: false });
  assert.match(accountExplanation(view), /keeps working without it/);
});

console.log("\nfailures worth reading");

test("closing the window is not a failure", () => {
  assert.equal(isDismissed({ code: "auth/popup-closed-by-user" }), true);
  assert.equal(isDismissed({ code: "auth/cancelled-popup-request" }), true);
  assert.equal(isDismissed({ code: "auth/network-request-failed" }), false);
});

test("a disabled sign-in method is reported as the fixable thing it is", () => {
  assert.match(describeLinkError({ code: "auth/operation-not-allowed" }), /turn on Google/);
});

test("an account that already exists says so rather than failing cryptically", () => {
  assert.match(
    describeLinkError({ code: "auth/credential-already-in-use" }),
    /already linked to Mino/
  );
  assert.match(
    describeLinkError({ code: "auth/account-exists-with-different-credential" }),
    /already has a Mino history/
  );
});

test("an unrecognised failure keeps its own message", () => {
  assert.equal(
    describeLinkError(new Error("something specific")),
    "something specific"
  );
});

console.log("\nthe account is not the administrator");

/**
 * Source with its comments removed.
 *
 * The separation being asserted here is a property of the code, not of the prose
 * around it: `lib/account.ts` explains at length why it stays away from the
 * console, and a test that matched those sentences would fail on the explanation
 * rather than on the behaviour. Stripping comments is what makes "does not import
 * the admin module" and "does not write the admin's node" the assertions they
 * look like.
 */
function code(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

test("nothing in the account path can read or write the admin's data", () => {
  // The binding code must stay away from the console entirely. Elevation is
  // decided by the database rules naming one address, so a bind path that so much
  // as read that namespace would be a second, client-side definition of who the
  // administrator is.
  const source = code("lib/account.ts");
  assert.ok(
    !/firebaseAdmin|verifyAdminAccess|signInAsAdmin|admin\/registry/.test(source),
    "lib/account.ts reaches into the administrator's namespace"
  );
});

test("the bind path grants access by identity, never by a flag it sets", () => {
  const source = code("lib/account.ts");
  // The only things written are the caller's own name and the chat log the
  // existing sync already writes. No client-side copy of the admin address, and
  // no way to mark an account as elevated.
  assert.ok(!/ADMIN_EMAIL|isAdmin|elevat/i.test(source), "lib/account.ts decides who is an admin");
  assert.ok(!/set\(ref\([^)]*config/.test(source), "lib/account.ts writes server config");
});

test("binding goes through linking, which is what keeps the chats where they are", () => {
  // Signing in with a new account would silently orphan everything already
  // logged under the anonymous id. What makes the upgrade safe is not that
  // `linkWithPopup` appears in the file — it is that it is handed the *existing*
  // user, because linking a credential to that account is what leaves the uid
  // alone. Asserting on the import instead of the call would pass on a build that
  // imported the function and never used it, which is the exact regression worth
  // catching here.
  const source = code("lib/account.ts");
  assert.match(
    source,
    /linkWithPopup\(\s*existing\b/,
    "the guest path no longer links the credential onto the account already in use"
  );
  // A plain sign-in stays, but only as the recovery for an account that already
  // exists elsewhere — never as the way a guest gets an account.
  assert.match(source, /isAlreadyInUse\(code\)/, "the recovery is gated on the account existing");
  const linkAt = source.indexOf("linkWithPopup(existing");
  const signInAt = source.indexOf("signInWithPopup(current.auth");
  assert.ok(signInAt > linkAt, "a fresh sign-in is only reached after the link is refused");
});

test("the visitor's profile is not the console's visitor list", () => {
  // Two different nodes on purpose. The console reads `admin/registry`, which a
  // visitor can write but never read; a name that has to follow someone to
  // another browser needs a node they *can* read, and reusing the console's
  // would mean loosening a rule the console depends on.
  const rules = readFileSync(join(process.cwd(), "database.rules.json"), "utf8");
  const parsed = JSON.parse(rules) as {
    rules: {
      users: { $uid: { profile?: { ".read": string } } };
      admin: { registry: { $uid: { ".write": string; ".read"?: string } } };
    };
  };
  assert.equal(
    parsed.rules.users.$uid.profile?.[".read"],
    "auth != null && auth.uid === $uid",
    "the profile is readable only by the person it belongs to"
  );
  assert.equal(
    parsed.rules.admin.registry.$uid[".read"],
    undefined,
    "the console's visitor list must stay unreadable to visitors"
  );
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
