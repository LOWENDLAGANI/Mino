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
  grantRecord,
  grantedSpanDays,
  isActive,
  nextExpiry,
  normalizeNote,
  parseSubscription,
  parseSubscriptionView,
  renewalNote,
  shouldCelebrate,
  subscriptionDetails,
  subscriptionHeadline,
  type Subscription,
} from "../lib/subscriptionState";
import {
  BUYER_DURATION_IDS,
  DAY_MS,
  DURATIONS,
  MAX_DAYS,
  describeDuration,
  normalizeDays,
  presetFor,
} from "../lib/durations";
import {
  FEATURE_MIN_PLAN,
  isModeUnlocked,
  isUnlocked,
  lockNoticeFor,
  resolveMode,
} from "../lib/paywallState";
import { FEATURES, PLANS, planById, planTerm, type PlanId, type TermId } from "../lib/plans";

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

/**
 * A day in milliseconds, written out here rather than imported.
 *
 * Every date assertion in this file is built from *this* literal, never from
 * the module's own constant. That is not pedantry: the product shipped a
 * `DAY_MS` with a factor of sixty in it, every subscription came out sixty
 * times too long, and the whole suite passed — because each test compared the
 * code's arithmetic against the same wrong constant it was testing. A test that
 * shares its subject's assumption cannot catch the subject being wrong.
 */
const MS_DAY = 86_400_000;
const date = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

const GRANTED: Subscription = {
  plan: "lunar",
  grantedAt: NOW,
  expiresAt: NOW + 30 * MS_DAY,
  days: 30,
  note: "",
  announcementId: 1,
};

console.log("\nsubscriptions");

test("a grant is stored as one record with everything the dialog prints", () => {
  const record = grantRecord({
    plan: "mini",
    days: 90,
    now: NOW,
    note: "  DuitNow   ref 8842  ",
    previous: null,
  });
  assert.equal(record.plan, "mini");
  assert.equal(record.days, 90);
  assert.equal(record.grantedAt, NOW);
  assert.equal(record.expiresAt, NOW + 90 * MS_DAY);
  assert.equal(record.note, "DuitNow ref 8842");
  assert.equal(record.announcementId, 1);
});

test("a day is a day, and not a minute", () => {
  // This is the assertion that was missing when a fourth `* 60` turned DAY_MS
  // into a minute. A month of 30 days was running 1800.
  assert.equal(DAY_MS, 86_400_000, "DAY_MS is milliseconds in one day");
  assert.equal(DAY_MS, MS_DAY);
  assert.equal(DAY_MS / MS_DAY, 1);
  // And the whole point of it: a month is thirty days, a year is three hundred
  // and sixty-five, measured the same way the product measures them.
  assert.equal(30 * DAY_MS, 2_592_000_000);
  assert.equal(365 * DAY_MS, 31_536_000_000);
});

test("a grant of N days ends exactly N days later", () => {
  // Anchored on literals, so it fails the moment the constant drifts.
  for (const days of [1, 7, 30, 45, 90, 365]) {
    const record = grantRecord({ plan: "mini", days, now: NOW, previous: null });
    assert.equal(record.expiresAt - NOW, days * MS_DAY, `${days} days`);
  }
});

test("every span is a length of days, inside the bound the record enforces", () => {
  for (const option of DURATIONS) {
    assert.ok(option.days >= 1 && option.days <= MAX_DAYS, `${option.label} is grantable`);
  }
  assert.equal(normalizeDays(0), 1, "no grant is ever zero days");
  assert.equal(normalizeDays(-3), 1);
  assert.equal(normalizeDays(1.4), 1);
  assert.equal(normalizeDays(99_999), MAX_DAYS, "a stray digit cannot buy a century");
  assert.equal(normalizeDays("45"), 45);
});

test("a length nobody has a name for is still grantable, and is counted in days", () => {
  // The console lets an owner type any number of days, so the receipt must be
  // able to say what it actually is. "45 days" is exact; "3 months and 15
  // days" would be calendar arithmetic nobody agreed to.
  assert.equal(describeDuration(45), "45 days");
  assert.equal(describeDuration(1), "a day");
  assert.equal(describeDuration(3), "3 days");
  assert.equal(describeDuration(21), "3 weeks");
  assert.equal(describeDuration(30), "a month");
  assert.equal(describeDuration(90), "3 months");
  assert.equal(describeDuration(365), "a year");
  assert.equal(describeDuration(730), "2 years");
  assert.equal(describeDuration(400), "1 year and 1 month");
  assert.equal(presetFor(30)?.id, "month");
  assert.equal(presetFor(45), null);
});

test("a record written before durations existed keeps the time that was paid for", () => {
  // These are real subscriptions sitting in the database right now, carrying
  // `months`. Reading them as thirty-day months is what they were granted as;
  // dropping the field would silently end a paid plan.
  const legacy = parseSubscription({
    plan: "mini",
    grantedAt: NOW,
    expiresAt: NOW + 90 * MS_DAY,
    months: 3,
    announcementId: 2,
  });
  assert.equal(legacy?.days, 90);
  assert.equal(parseSubscription({ ...GRANTED, days: 0, months: 2 })?.days, 60, "days wins when present");
});

test("a payment reference is trimmed and capped rather than truncated mid-word", () => {
  assert.equal(normalizeNote("  rm  10 \n from ain  "), "rm 10 from ain");
  assert.equal(normalizeNote("x".repeat(400)).length, 120);
  assert.equal(normalizeNote(undefined), "");
});

test("a renewal adds to the time already paid for instead of replacing it", () => {
  // Re-granting the same tier a week before it runs out must not cost the buyer
  // the week they already bought.
  const renewal = grantRecord({ plan: "lunar", days: 30, now: NOW + 7 * MS_DAY, previous: GRANTED });
  assert.equal(renewal.expiresAt, GRANTED.expiresAt + 30 * MS_DAY);
});

test("a single day is a real length, not a rounding of a month", () => {
  const record = grantRecord({ plan: "mini", days: 1, now: NOW, previous: null });
  assert.equal(record.expiresAt, NOW + MS_DAY);
});

test("switching tier starts from today, because there is no proration to invent", () => {
  // Carrying Mini's remaining days into a Lunar charge would be a discount
  // nobody agreed to, so an upgrade begins now.
  const upgrade = grantRecord({
    plan: "lunar",
    days: 30,
    now: NOW + 7 * MS_DAY,
    previous: { ...GRANTED, plan: "mini" },
  });
  assert.equal(upgrade.expiresAt, NOW + 7 * MS_DAY + 30 * MS_DAY);
});

test("an expired plan renewed starts from the renewal, not from last month", () => {
  const lapsed: Subscription = { ...GRANTED, expiresAt: NOW - 1 };
  assert.equal(nextExpiry(lapsed, "lunar", 30, NOW), NOW + 30 * MS_DAY);
});

test("each grant announces itself once and only once", () => {
  const first = grantRecord({ plan: "mini", days: 30, now: NOW, previous: null });
  const second = grantRecord({ plan: "lunar", days: 30, now: NOW + 1, previous: first });
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
  const parsed = parseSubscription({ ...GRANTED, expiresAt: NOW - 10 * MS_DAY });
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
    grantedAt: NOW + 30 * MS_DAY,
    expiresAt: NOW + 60 * MS_DAY,
    ack: { announcementId: 1 },
  });
  assert.equal(shouldCelebrate(renewed, { now: NOW + 30 * MS_DAY })?.announcementId, 2);
  // And an old local acknowledgement is not allowed to swallow a new one.
  assert.equal(shouldCelebrate(renewed, { local: 1, now: NOW + 30 * MS_DAY })?.announcementId, 2);
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
  assert.equal(byLabel.get("Paid for"), "a month");
  assert.equal(byLabel.get("Price"), "RM 15");
  assert.equal(byLabel.get("Active until"), date(GRANTED.expiresAt));
  assert.equal(byLabel.get("Payment reference"), "DuitNow ref 8842");
});

test("the receipt quotes the price for the length bought, not the monthly headline", () => {
  // Somebody who bought a year has to be told they bought a year, at the year's
  // price. Printing RM 15 next to "a year" would be a different number than the
  // one they paid, and it would be the buyer's word against the owner's.
  // A yearly record has to be a *year* in both the field and the dates. Stamping
  // `days: 365` onto a record that ends in thirty days is exactly the kind of
  // disagreement this fix exists to refuse, so it is refused.
  const yearly = subscriptionDetails(
    { ...GRANTED, days: 365, grantedAt: NOW, expiresAt: NOW + 365 * MS_DAY },
    date
  );
  assert.equal(yearly.find((row) => row.label === "Price")?.value, "RM 150");
  assert.equal(yearly.find((row) => row.label === "Paid for")?.value, "a year");

  const mismatched = subscriptionDetails({ ...GRANTED, days: 365 }, date);
  assert.equal(
    mismatched.find((row) => row.label === "Paid for")?.value,
    "a month",
    "the span between the dates wins over the field that claims otherwise"
  );
});

test("a renewed plan is described by the time it really has, not by the last grant", () => {
  // The bug this exists for. Granting to somebody whose plan is still running
  // *adds* to the end date they already had, so the record carries `days: 30`
  // and an expiry 1800 days out. Printing "a month" next to "1800 days left"
  // was two contradictory numbers for one subscription on the same screen.
  const stacked: Subscription = { ...GRANTED, days: 30, grantedAt: NOW, expiresAt: NOW + 1800 * MS_DAY };
  assert.equal(grantedSpanDays(stacked), 1800);
  const rows = subscriptionDetails(stacked, date);
  assert.equal(rows.find((row) => row.label === "Paid for")?.value, "4 years and 11 months");

  // No price is printed for a span that is not on the price list: RM 15 beside
  // "5 years" is a number nobody charged.
  assert.equal(
    rows.find((row) => row.label === "Price"),
    undefined,
    "a length nobody was sold must not be given a price"
  );

  // And when the record is internally consistent, nothing changes.
  assert.equal(grantedSpanDays(GRANTED), 30);
});

test("a record whose dates are nonsense falls back to what was granted", () => {
  // An expiry at or before the start is not a very long plan; it is a broken
  // one, and it must not be reported as "10 years".
  const broken: Subscription = { ...GRANTED, days: 30, grantedAt: NOW, expiresAt: NOW };
  assert.equal(grantedSpanDays(broken), 30);
});

test("a grant with no reference does not print an empty row", () => {
  const rows = subscriptionDetails(GRANTED, date).map((row) => row.label);
  assert.ok(!rows.includes("Payment reference"));
  assert.equal(rows.length, 5, "five rows when there is no reference, six with one");
});

test("the price quoted in the dialog is the plan's own price", () => {
  for (const plan of PLANS) {
    const rows = subscriptionDetails({ ...GRANTED, plan: plan.id }, date);
    const price = rows.find((row) => row.label === "Price")?.value ?? "";
    assert.equal(price, plan.ringgit === 10 ? "RM 10" : "RM 15");
    assert.equal(subscriptionHeadline({ ...GRANTED, plan: plan.id }), `${plan.name} · active`);
    assert.match(renewalNote({ ...GRANTED, plan: plan.id }, date), new RegExp(plan.name === "Mino Lunar" ? "RM 15" : "RM 10"));
  }
  assert.equal(planById("lunar").short, "Lunar");
});

console.log("\nwhat the pricing page promises");

test("every row of the comparison table is a thing Mino actually does", () => {
  // The failure this exists to prevent: "Agent mode with deep research" sat in
  // the feature table for a commit, and nothing in the codebase could have
  // answered to it. It was priced, sold and shown to buyers as a feature.
  const gated = new Set(Object.keys(FEATURE_MIN_PLAN));
  for (const row of FEATURES) {
    if (row.feature === null) continue;
    assert.ok(gated.has(row.feature), `${row.label} is gated but the paywall has never heard of it`);
  }
  const listed = new Set(FEATURES.map((row) => row.feature).filter(Boolean) as string[]);
  for (const id of gated) {
    assert.ok(listed.has(id), `${id} is priced as a paid capability but nobody can see it on the table`);
  }
});

test("nothing is sold as locked unless it is actually locked", () => {
  // A row marked paid is a promise. Where the difference is not yet enforced,
  // it says so here rather than letting the page imply otherwise.
  for (const row of FEATURES) {
    const paid = row.free ? false : row.mini;
    assert.ok(row.enforced || !paid, `${row.label} is sold as paid but is not enforced`);
  }
  // And the one row that carries the whole reason Lunar costs more is enforced.
  assert.equal(
    FEATURES.find((row) => row.feature === "azure")?.enforced,
    true,
    "Mino Azure is the tier's reason to exist; it has to actually be locked"
  );
});

test("a plan never claims something the free tier already has", () => {
  for (const row of FEATURES) {
    assert.ok(!(row.free && !row.mini), `${row.label}: free has it but Mini does not`);
    assert.ok(!(row.free && !row.lunar), `${row.label}: free has it but Lunar does not`);
    assert.ok(!(row.mini && !row.lunar), `${row.label}: Mini has it but Lunar does not`);
  }
});

console.log("\nthe paywall");

test("Mino Azure is Lunar's, and nothing cheaper opens it", () => {
  assert.equal(FEATURE_MIN_PLAN.azure, "lunar");
  assert.equal(isUnlocked("azure", null), false, "free does not get Azure");
  assert.equal(isUnlocked("azure", "mini"), false, "Mini does not get Azure either");
  assert.equal(isUnlocked("azure", "lunar"), true);
});

test("each tier is strictly better than the one below it", () => {
  // The whole reason a plan costs anything. Mini must be worth buying over free,
  // and Lunar worth buying over Mini, or somebody is paying for nothing.
  const ids = Object.keys(FEATURE_MIN_PLAN) as Array<keyof typeof FEATURE_MIN_PLAN>;
  const rank = (planId: PlanId | null) => ids.filter((id) => isUnlocked(id, planId)).length;

  assert.ok(rank(null) < rank("mini"), "Mini unlocks something free does not");
  assert.ok(rank("mini") < rank("lunar"), "Lunar unlocks something Mini does not");
  // Specifically: Mini opens reasoning and images, and Lunar opens Azure on top.
  assert.equal(isUnlocked("reasoning", "mini"), true);
  assert.equal(isUnlocked("images", "mini"), true);
  assert.equal(isUnlocked("azure", "mini"), false);
  assert.equal(isUnlocked("azure", "lunar"), true);
  assert.equal(isUnlocked("reasoning", null), false);
});

test("a locked mode says what it would take, rather than disappearing", () => {
  // The mode that needs Azure is the one people press to reach it.
  assert.equal(isModeUnlocked("self", "mini"), false);
  assert.equal(isModeUnlocked("self", "lunar"), true);
  assert.equal(isModeUnlocked("auto", null), true, "the everyday modes are never taken away");
  assert.equal(isModeUnlocked("code", null), true);

  const onNothing = lockNoticeFor("azure", null);
  assert.equal(onNothing?.planName, "Mino Lunar");
  assert.equal(onNothing?.price, "RM 15/mo");
  assert.match(onNothing!.title, /not on the free tier/);
  assert.match(onNothing!.body, /Mino Lunar/);

  // Somebody already paying the cheaper tier is told it is an upgrade, and is
  // not asked to buy the thing they already have.
  const onMini = lockNoticeFor("azure", "mini");
  assert.match(onMini!.title, /Mino Lunar/);
  assert.match(onMini!.body, /Mino Mini/);
  assert.match(onMini!.body, /carries over/, "the time already paid for is kept");
  assert.equal(lockNoticeFor("azure", "lunar"), null, "no notice to somebody who has it");
});

test("a lapsed plan leaves the user somewhere they can still write", () => {
  const available = ["auto", "code", "self"] as const;
  assert.equal(resolveMode("self", available, null), "auto", "Azure is not left selected on the free tier");
  assert.equal(resolveMode("self", available, "mini"), "auto");
  assert.equal(resolveMode("self", available, "lunar"), "self");
  // And never moves somebody *into* a locked mode.
  assert.equal(resolveMode("code", available, null), "code");
  assert.equal(resolveMode("code", available, "mini"), "code");
});

console.log("\ndurations and pricing");

test("every plan is sold at every length a buyer may choose", () => {
  for (const plan of PLANS) {
    for (const id of BUYER_DURATION_IDS) {
      const term = planTerm(plan, id);
      assert.ok(term.days >= 1, `${plan.short} sells ${id}`);
      assert.ok(term.ringgit > 0, `${plan.short} ${id} has a price`);
    }
    // A plan that cannot sell a month cannot honour a renewal either.
    assert.equal(planTerm(plan, "month").ringgit, plan.ringgit, `${plan.short} month is its headline price`);
  }
});

test("buying longer costs more than buying shorter, on both plans", () => {
  for (const plan of PLANS) {
    const day = planTerm(plan, "day").ringgit;
    const month = planTerm(plan, "month").ringgit;
    const year = planTerm(plan, "year").ringgit;
    assert.ok(day < month, `${plan.short}: a day costs less than a month`);
    assert.ok(month < year, `${plan.short}: a month costs less than a year`);
    // And a year is better value than twelve months, which is the only reason
    // to buy one.
    assert.ok(year < month * 12, `${plan.short}: a year is cheaper than paying monthly`);
  }
});

test("a price nobody has set falls back rather than showing nothing", () => {
  const mini = planById("mini");
  assert.equal(planTerm(mini, "day").ringgit, 1);
  assert.equal(planTerm(mini, "year").ringgit, 100);
  const unknownTerm = "century" as unknown as TermId;
  assert.equal(planTerm(mini, unknownTerm).id, "month", "an unknown length is answered with the month");
  assert.equal(planById("lunar").ringgit, 15);
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
  assert.match(page, /onClick=\{\(\) => beginPurchase\(/, "the button goes through the gate");
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