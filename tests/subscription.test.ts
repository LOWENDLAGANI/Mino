// ── Mino — tests for subscriptions ───────────────────────────────────────────
//
// Payment happens by QR transfer and is confirmed by hand, so every rule in
// here is about a grant that somebody decided on: what it says, when it runs
// out, and whether the person who paid is told exactly once. The quiet failures
// are the expensive ones — a plan that never expires, a renewal that swallows
// the time already paid for, a celebration that reappears every visit, or a
// dialog dismissed by a tap meant for the page behind it.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MONTH_MS,
  MONTHS_OFFERED,
  grantRecord,
  isActive,
  nextExpiry,
  normalizeMonths,
  normalizeNote,
  parseSubscription,
  parseSubscriptionView,
  renewalNote,
  shouldCelebrate,
  subscriptionDetails,
  subscriptionHeadline,
  type Subscription,
} from "../lib/subscriptionState";
import { PLANS, planById } from "../lib/plans";

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

function code(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const NOW = 1_700_000_000_000;
const date = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

const GRANTED: Subscription = {
  plan: "lunar",
  grantedAt: NOW,
  expiresAt: NOW + MONTH_MS,
  months: 1,
  note: "",
  announcementId: 1,
};

console.log("\nsubscriptions");

test("a grant is stored as one record with everything the dialog prints", () => {
  const record = grantRecord({
    plan: "mini",
    months: 3,
    now: NOW,
    note: "  DuitNow   ref 8842  ",
    previous: null,
  });
  assert.equal(record.plan, "mini");
  assert.equal(record.months, 3);
  assert.equal(record.grantedAt, NOW);
  assert.equal(record.expiresAt, NOW + 3 * MONTH_MS);
  assert.equal(record.note, "DuitNow ref 8842");
  assert.equal(record.announcementId, 1);
});

test("every offered span is inside the limit the record enforces", () => {
  for (const span of MONTHS_OFFERED) {
    assert.ok(span >= 1 && span <= 12, `${span} months is offerable`);
  }
  assert.equal(normalizeMonths(0), 1, "no grant is ever zero months");
  assert.equal(normalizeMonths(-3), 1);
  assert.equal(normalizeMonths(1.9), 1);
  assert.equal(normalizeMonths(99), 12, "a typo cannot buy nine years");
  assert.equal(normalizeMonths("2"), 2);
});

test("a payment reference is trimmed and capped rather than truncated mid-word", () => {
  assert.equal(normalizeNote("  rm  10 \n from ain  "), "rm 10 from ain");
  assert.equal(normalizeNote("x".repeat(400)).length, 120);
  assert.equal(normalizeNote(undefined), "");
});

test("a renewal adds to the time already paid for instead of replacing it", () => {
  // Re-granting the same tier a week before it runs out must not cost the buyer
  // the week they already bought.
  const renewal = grantRecord({ plan: "lunar", months: 1, now: NOW + 7 * 86_400_000, previous: GRANTED });
  assert.equal(renewal.expiresAt, GRANTED.expiresAt + MONTH_MS);
});

test("switching tier starts from today, because there is no proration to invent", () => {
  // Carrying Mini's remaining days into a Lunar charge would be a discount
  // nobody agreed to, so an upgrade begins now.
  const upgrade = grantRecord({
    plan: "lunar",
    months: 1,
    now: NOW + 7 * 86_400_000,
    previous: { ...GRANTED, plan: "mini" },
  });
  assert.equal(upgrade.expiresAt, NOW + 7 * 86_400_000 + MONTH_MS);
});

test("an expired plan renewed starts from the renewal, not from last month", () => {
  const lapsed: Subscription = { ...GRANTED, expiresAt: NOW - 1 };
  assert.equal(nextExpiry(lapsed, "lunar", 1, NOW), NOW + MONTH_MS);
});

test("each grant announces itself once and only once", () => {
  const first = grantRecord({ plan: "mini", months: 1, now: NOW, previous: null });
  const second = grantRecord({ plan: "lunar", months: 1, now: NOW + 1, previous: first });
  assert.equal(first.announcementId, 1);
  assert.equal(second.announcementId, 2);
  assert.ok(second.announcementId > first.announcementId, "a renewal is worth announcing again");
});

test("a record that is not a plan is treated as no plan at all", () => {
  // Better to say "nothing bought" than to show somebody a tier with no end
  // date, which the interface would read as unlimited access.
  assert.equal(parseSubscription(null), null);
  assert.equal(parseSubscription("lunar"), null);
  assert.equal(parseSubscription({ plan: "gigachad" }), null);
  assert.equal(parseSubscription({ plan: "mini" }), null);
  assert.equal(parseSubscription({ plan: "mini", grantedAt: 0, expiresAt: NOW, announcementId: 1 }), null);
  assert.equal(parseSubscription({ plan: "mini", grantedAt: NOW, expiresAt: NOW, announcementId: 0 }), null);
  assert.deepEqual(parseSubscription(GRANTED), GRANTED);
});

test("a record whose end date precedes its start is repaired, not trusted", () => {
  const parsed = parseSubscription({ ...GRANTED, expiresAt: NOW - 10 * MONTH_MS });
  assert.equal(parsed?.expiresAt, NOW, "a backwards expiry reads as ending immediately, not as forever");
});

test("a plan that has run out is no plan", () => {
  assert.equal(isActive(GRANTED, NOW), true);
  assert.equal(isActive(GRANTED, GRANTED.expiresAt), false, "the last millisecond is still paid for, the next is not");
  assert.equal(isActive({ ...GRANTED, expiresAt: NOW - 1 }, NOW), false);
  assert.equal(isActive(null, NOW), false);
});

test("the dialog appears for an unseen grant, live or on a later visit", () => {
  const view = parseSubscriptionView({ ...GRANTED, ack: { announcementId: 0 } });
  assert.equal(shouldCelebrate(view, { now: NOW })?.announcementId, 1);
  // The same record on a browser with nothing in local storage — a first visit
  // after the grant — is owed the dialog just the same.
  assert.equal(shouldCelebrate(parseSubscriptionView(GRANTED), { now: NOW })?.announcementId, 1);
});

test("after the button is pressed it does not come back", () => {
  const acknowledged = parseSubscriptionView({ ...GRANTED, ack: { announcementId: 1 } });
  // Acknowledged in the database, as the button does it.
  assert.equal(shouldCelebrate(acknowledged, { now: NOW }), null);
  // Acknowledged only in this browser, as a device whose ack write could not
  // land still has it. Either one is enough to keep the dialog closed.
  assert.equal(shouldCelebrate(parseSubscriptionView(GRANTED), { local: 1, now: NOW }), null);
  assert.equal(shouldCelebrate(parseSubscriptionView(GRANTED), { local: 5, now: NOW }), null);
  // Nothing at all, and nothing bought.
  assert.equal(shouldCelebrate(null, { now: NOW }), null);
  assert.equal(shouldCelebrate(parseSubscriptionView(null), { now: NOW }), null);
});

test("an expired grant is not celebrated on the next visit", () => {
  const lapsed = parseSubscriptionView({ ...GRANTED, expiresAt: NOW - 1, ack: { announcementId: 0 } });
  assert.equal(shouldCelebrate(lapsed, { now: NOW }), null, "there is nothing to announce about a plan that has ended");
});

test("a later grant still gets through after the first was acknowledged", () => {
  const renewed = parseSubscriptionView({
    ...GRANTED,
    announcementId: 2,
    grantedAt: NOW + MONTH_MS,
    expiresAt: NOW + 2 * MONTH_MS,
    ack: { announcementId: 1 },
  });
  assert.equal(shouldCelebrate(renewed, { now: NOW + MONTH_MS })?.announcementId, 2);
  // And an old local acknowledgement is not allowed to swallow a new one.
  assert.equal(shouldCelebrate(renewed, { local: 1, now: NOW + MONTH_MS })?.announcementId, 2);
});

test("a local acknowledgement beats a stale database copy, and vice versa", () => {
  const view = parseSubscriptionView({ ...GRANTED, announcementId: 3, ack: { announcementId: 0 } });
  assert.equal(shouldCelebrate(view, { local: 2, now: NOW })?.announcementId, 3);
  const newer = parseSubscriptionView({ ...GRANTED, announcementId: 3, ack: { announcementId: 4 } });
  assert.equal(shouldCelebrate(newer, { now: NOW }), null);
});

test("the dialog shows every detail the buyer needs to match the transfer", () => {
  const rows = subscriptionDetails(
    { ...GRANTED, note: "DuitNow ref 8842" },
    date
  );
  const byLabel = new Map(rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel.get("Plan"), "Mino Lunar");
  assert.equal(byLabel.get("Price"), "RM 15 / month");
  assert.equal(byLabel.get("Paid for"), "1 month");
  assert.equal(byLabel.get("Active until"), date(GRANTED.expiresAt));
  assert.equal(byLabel.get("Payment reference"), "DuitNow ref 8842");
});

test("a grant with no reference does not print an empty row", () => {
  const rows = subscriptionDetails(GRANTED, date).map((row) => row.label);
  assert.ok(!rows.includes("Payment reference"));
  assert.equal(rows.length, 5);
});

test("the price quoted in the dialog is the plan's own price", () => {
  for (const plan of PLANS) {
    const rows = subscriptionDetails({ ...GRANTED, plan: plan.id }, date);
    const price = rows.find((row) => row.label === "Price")?.value ?? "";
    assert.equal(price, `${plan.ringgit === 10 ? "RM 10" : "RM 15"} / month`);
    assert.equal(subscriptionHeadline({ ...GRANTED, plan: plan.id }), `${plan.name} · active`);
    assert.match(renewalNote({ ...GRANTED, plan: plan.id }, date), new RegExp(plan.name === "Mino Lunar" ? "RM 15" : "RM 10"));
  }
  assert.equal(planById("lunar").short, "Lunar");
});

console.log("\nsubscription wiring");

test("the console lists somebody who has never sent a message", () => {
  // This is the person the grant is *for*: they opened /plus, scanned the QR,
  // transferred, and left. They have a registry entry from the moment they gave
  // their name and no entry under `users/` at all until a chat is logged, so a
  // list built from chats alone hides them and there is nothing to press.
  const source = code("lib/firebaseAdmin.ts");
  assert.match(source, /Object\.keys\(names\)/, "the registry is a source of people");
  assert.match(
    source,
    /new Set\(\[\.\.\.Object\.keys\(names\),\s*\.\.\.Object\.keys\(chats\)/,
    "the people list is the union of everyone named, everything chatted, and every plan"
  );
  const panel = code("components/AdminPanel.tsx");
  assert.match(panel, /Plan/, "there is a button that opens the grant form");
  assert.match(panel, /setGrantingUid\(/, "pressing it opens that visitor's grant form");
  assert.match(panel, /Find a name to grant/, "and they can be found by name");
});

test("the payment QR cannot be reached without an account", () => {
  // A transfer from a browser that never signs in could not be granted to
  // anyone, because the owner would have no way to tell whose money it was.
  const page = code("app/plus/page.tsx");
  assert.match(page, /watchAccount/, "the page knows whether this browser is signed in");
  assert.match(
    page,
    /if \(signedIn\) setPaying\(wanted\);\s*else setGating\(wanted\);/,
    "the QR opens for a signed-in browser and only a gate opens for one that is not"
  );
  assert.match(page, /<SubscribeGate/, "the gate is what stands in the way");
  // The buyer's own button must never reach the QR directly, or the gate would
  // be something that could be skipped rather than something that holds.
  assert.match(page, /onClick=\{\(\) => beginPurchase\(plan\)\}/, "the button goes through the gate");
  assert.ok(
    !/onClick=\{\(\) => setPaying/.test(page),
    "nothing on the page opens the payment QR without going through the gate"
  );
  // Binding rather than signing in: the UID must not move, or the grant would
  // land on an identity the buyer is no longer using.
  assert.match(code("components/SubscribeGate.tsx"), /bindGoogleAccount\(/);
});

test("a plan lives outside `users`, which the buyer can write", () => {
  // This is the reason the whole design sits where it does. The rules grant a
  // visitor `.write` on their own `users/$uid` for chat logging, and a
  // Realtime Database grant cannot be revoked by a deeper rule. A subscription
  // stored under there would therefore be writable by the person it is meant to
  // describe — i.e. grantable to themselves.
  const rules = JSON.parse(code("database.rules.json")) as {
    rules: Record<string, Record<string, Record<string, unknown>>>;
  };
  const users = rules.rules.users.$uid;
  assert.equal(users[".write"], "auth != null && auth.uid === $uid");
  assert.equal(
    (users as Record<string, unknown>).subscription,
    undefined,
    "users/$uid must hold no subscription node"
  );
  assert.ok(rules.rules.subscriptions, "subscriptions is its own top-level tree");
});

test("the buyer can read their own plan and cannot write it", () => {
  const rules = JSON.parse(code("database.rules.json")) as {
    rules: {
      subscriptions: {
        ".read": string;
        ".write": string;
        $uid: { ".read": string; ".write"?: string; ack?: { ".write": string } };
      };
    };
  };
  const sub = rules.rules.subscriptions;
  assert.equal(
    sub.$uid[".read"],
    "auth != null && auth.uid === $uid",
    "the buyer reads exactly one plan, their own"
  );
  assert.equal(
    sub.$uid[".write"],
    undefined,
    "no write grant anywhere on the plan itself, or a visitor could grant themselves Lunar"
  );
  assert.ok(
    !/auth\.uid\s*===\s*\$uid/.test(sub[".write"]),
    "the owner-write rule must not appear above the uid level"
  );
  assert.equal(
    sub.$uid.ack?.[".write"],
    "auth != null && auth.uid === $uid",
    "the buyer may record that they have seen the announcement, and nothing else"
  );
});

test("the console reads and writes plans, and every plan it can write is a real tier", () => {
  const validate = (
    JSON.parse(code("database.rules.json")) as {
      rules: { subscriptions: { $uid: { ".validate": string } } };
    }
  ).rules.subscriptions.$uid[".validate"];
  for (const plan of PLANS) {
    assert.ok(validate.includes(`'${plan.id}'`), `${plan.id} can be granted`);
  }
  assert.ok(!validate.includes("gigachad"));
  const admin = code("lib/firebaseAdmin.ts");
  assert.match(admin, /export async function grantSubscription/);
  assert.match(admin, /export async function revokeSubscription/);
  assert.match(admin, /set\(ref\(database, `subscriptions\/\$\{uid\}`\)/);
  // A wipe that left a subscription behind would hand a plan back to someone
  // whose data was just deleted.
  assert.match(admin, /remove\(ref\(database, "subscriptions"\)\)/);
});

test("the grant the console writes is the record the buyer's dialog reads", () => {
  // The two ends are only connected if they agree on the node and on the id
  // that makes the announcement one-shot. Asserted against both sources rather
  // than a shared constant, because a rename on one side is exactly the
  // regression that would silently stop the celebration from ever appearing.
  assert.match(code("lib/firebaseAdmin.ts"), /grantRecord\(\{/);
  assert.match(code("lib/subscription.ts"), /`subscriptions\/\$\{uid\}`/);
  assert.match(code("lib/subscription.ts"), /\/ack`/, "the acknowledgement is written under the plan's own node");
  assert.match(code("lib/subscription.ts"), /announcementId/);
});

test("the dialog is bound to the live identity, not to a uid read once", () => {
  // Binding a Google account can move the subscription to a different UID. A
  // listener pinned to the UID read at startup would then report nothing for
  // the rest of the session, and a buyer who had just paid would be told
  // nothing at all.
  const source = code("lib/subscription.ts");
  assert.match(source, /onIdTokenChanged/, "the listener follows the signed-in identity");
  assert.match(source, /onValue\(/, "the read is a realtime subscription, not a one-shot get");
});

test("the celebration is closed by its button and by nothing else", () => {
  // One `onClick` in the file, and it is the button. No Escape key, no backdrop
  // handler: this is the one screen somebody has to read, and an accidental tap
  // is how someone misses that their money landed.
  const source = code("components/SubscriptionCelebration.tsx");
  assert.match(source, /onClick=\{onClose\}/, "the button closes the dialog");
  const handlers = source.match(/onClick/g) ?? [];
  assert.equal(handlers.length, 1, `expected exactly one onClick, found ${handlers.length}`);
  // Asserted on the mechanism rather than the word, so the test measures what
  // could actually dismiss it rather than what a comment happens to say.
  assert.ok(
    !/addEventListener\(\s*["']key/.test(source),
    "no keyboard shortcut dismisses the celebration"
  );
  assert.ok(!/onPointerDown|onMouseDown/.test(source), "no press-through to dismiss");
  // The wiring passes the dialog a subscription and a way out, and nothing that
  // could dismiss it from the outside.
  assert.match(source, /<SubscriptionDialog subscription=\{celebration\} onClose=\{close\} \/>/);
});

test("the dialog is mounted once, above every page", () => {
  // A purchase is not tied to a screen, so it must not be mounted inside one
  // page: someone on the pricing page has to be told as much as someone in a chat.
  const layout = code("app/layout.tsx");
  assert.match(layout, /<SubscriptionCelebration \/>/);
  const pages = ["app/page.tsx", "app/plus/page.tsx"];
  for (const page of pages) {
    assert.ok(!code(page).includes("SubscriptionCelebration"), `${page} does not mount it`);
  }
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);