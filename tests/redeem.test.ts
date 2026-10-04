// ── Mino — tests for redeem codes ────────────────────────────────────────────
//
// A code is a word the owner chooses that carries a plan and a length. The
// dangerous failure is not that a code stops working — that is a support
// message. It is that a code works for the wrong person, or that somebody
// reaches a plan they were never given. So most of what follows is about the
// claim carrying nothing but a name, and about termination actually terminating.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODE_MAX,
  bestPlan,
  checkRedeemable,
  isValidCode,
  normalizeCode,
  parseRedeemCode,
  redeemValue,
  type RedeemCode,
} from "../lib/redeemState";
import { DAY_MS, describeDuration, normalizeDays } from "../lib/durations";
import { planRank } from "../lib/plans";

const NOW = 1_700_000_000_000;

/**
 * A file with its comments stripped.
 *
 * The assertions below look for what code must and must not contain, and a
 * comment *discussing* those things would otherwise fail them — the wrong way
 * round, since explaining why a claim carries no plan is not the same as a claim
 * carrying a plan.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/[ \t]+$/gm, "");
}

function makeCode(over: Partial<RedeemCode> = {}): RedeemCode {
  return {
    code: "MINO-LUNAR",
    plan: "lunar",
    days: 30,
    active: true,
    createdAt: NOW - 1000,
    note: "",
    ...over,
  };
}

// ── The word ─────────────────────────────────────────────────────────────────

// The owner picks it; this only decides how it is written down. Two words that
// differ only in case or spacing must not become two codes a buyer can be given
// by mistake.
assert.equal(normalizeCode("mino-lunar"), "MINO-LUNAR");
assert.equal(normalizeCode("MINO LUNAR"), "MINOLUNAR");
assert.equal(normalizeCode("  mino_lunar  "), "MINOLUNAR");
assert.equal(normalizeCode("m1n0-2026"), "M1N0-2026");
assert.equal(normalizeCode("🚀"), "", "punctuation cannot survive into a code");
assert.ok(normalizeCode("A".repeat(200)).length <= CODE_MAX, "a code is bounded, not unbounded");

// A very short code is one guess away from everybody's, so it is refused before
// it is ever written rather than afterwards.
assert.equal(isValidCode("AB"), false, "two characters is not a code");
assert.equal(isValidCode("MINO"), true);
assert.equal(isValidCode(""), false);
assert.equal(isValidCode("   "), false);

// ── Reading what is stored ───────────────────────────────────────────────────

const parsed = parseRedeemCode({
  code: "mino-mini",
  plan: "mini",
  days: 30,
  active: true,
  createdAt: NOW,
  note: "  paid by Ana  ",
});
assert.ok(parsed, "a well-formed code parses");
assert.equal(parsed.plan, "mini");
assert.equal(parsed.code, "MINO-MINI", "the stored word is normalized");
assert.equal(parsed.note, "paid by Ana", "a note is trimmed");

// Anything malformed is no code at all, never a half-filled one. A code missing
// its plan or its length cannot honestly be redeemed, and filling in the blanks
// is how somebody ends up with a tier nobody meant to sell them.
assert.equal(parseRedeemCode(null), null);
assert.equal(parseRedeemCode({ code: "MINO", days: 30, active: true, createdAt: NOW }), null, "no plan");
assert.equal(parseRedeemCode({ code: "MINO", plan: "gold", days: 30, active: true, createdAt: NOW }), null, "no such tier");
assert.equal(parseRedeemCode({ code: "MINO", plan: "mini", active: true, createdAt: NOW }), null, "no length");
assert.equal(parseRedeemCode({ code: "AB", plan: "mini", days: 30, active: true, createdAt: NOW }), null, "too short");
assert.equal(parseRedeemCode({ code: "MINO", plan: "mini", days: 30, active: true }), null, "no creation time");

// A missing `active` means created. Defaulting the other way would silently kill
// every code whose field went missing.
assert.equal(parseRedeemCode({ code: "MINO", plan: "mini", days: 30, createdAt: NOW })?.active, true);
assert.equal(parseRedeemCode({ ...makeCode(), active: false })?.active, false, "off stays off");

// The length a code grants is bounded by the same ceiling a grant is, so a typo
// in the console cannot mint a decade.
const wild = parseRedeemCode({ code: "MINO", plan: "lunar", days: 999_999, active: true, createdAt: NOW });
assert.ok(wild, "an absurd length still parses");
assert.equal(wild.days, normalizeDays(999_999), "and is clamped rather than refused");
assert.equal(wild.days, 3650);

// ── Terminating ──────────────────────────────────────────────────────────────

assert.equal(checkRedeemable(makeCode(), NOW).ok, true, "a live code redeems");

const off = checkRedeemable(makeCode({ active: false }), NOW);
assert.equal(off.ok, false);
assert.equal(off.ok === false && off.reason, "terminated", "an off code says so");

// There is no use count, and that is a decision rather than an omission.
// Counting redemptions needs a write to `codes/`, which the rules reserve for
// the owner, and this deployment has no service account to do it another way. A
// counter stuck at zero under a console that printed "0/1 used" would be a
// control that looks real and does nothing — the same dishonesty as selling a
// feature that does not exist. The owner's switch is what bounds a word.
const counted = makeCode() as RedeemCode & { maxUses?: number; used?: number };
assert.equal(counted.maxUses, undefined, "a code carries no use limit");
assert.equal(counted.used, undefined, "and no use count to display");

const unknown = checkRedeemable(null, NOW);
assert.equal(unknown.ok, false, "an unknown word is not a code");
assert.equal(unknown.ok === false && unknown.reason, "unknown");

// Unlimited is the only behaviour: a code meant as a giveaway must not quietly
// stop at one person.
assert.equal(checkRedeemable(makeCode(), NOW).ok, true, "a code is redeemable by anybody who holds it");

// A code does not expire on its own. Its whole lifetime is the owner's switch,
// and inventing a deadline would invalidate a word mid-handover.
assert.equal(checkRedeemable(makeCode(), NOW + 10 * 365 * DAY_MS).ok, true, "a code does not quietly expire");

// Every refusal carries a sentence worth showing rather than a bare reason.
for (const code of [null, makeCode({ active: false })]) {
  const status = checkRedeemable(code, NOW);
  assert.ok(
    status.ok === false && status.message.length > 10,
    "a refusal must explain itself"
  );
}

// ── What a code is worth ─────────────────────────────────────────────────────

const value = redeemValue(makeCode({ plan: "mini", days: 30 }), NOW);
assert.equal(value.plan, "mini");
assert.equal(value.days, 30);
assert.equal(value.expiresAt, NOW + 30 * DAY_MS);
assert.equal(describeDuration(value.days), "a month", "and it describes as what was sold");

// A code is worth a fixed window measured from when it was CLAIMED. Measuring
// from "now" on every request made the expiry slide forward forever, so one
// unused word was perpetually a full term away — unlimited time from a single
// code. The instant passed in is the only thing that decides the end date, so a
// caller has no way to move it.
const CLAIMED_AT = NOW - 20 * DAY_MS;
const anchored = redeemValue(makeCode({ plan: "mini", days: 30 }), CLAIMED_AT);
assert.equal(
  anchored.expiresAt,
  CLAIMED_AT + 30 * DAY_MS,
  "the window runs from the claim, not from the moment it is checked"
);
assert.equal(
  redeemValue(makeCode({ plan: "mini", days: 30 }), CLAIMED_AT).expiresAt,
  anchored.expiresAt,
  "asking again must not move the end date"
);
// Ten days after the claim, ten days of it remain — not another thirty.
const tenDaysLater = CLAIMED_AT + 10 * DAY_MS;
assert.equal(
  anchored.expiresAt - tenDaysLater,
  20 * DAY_MS,
  "time is consumed, not renewed, by waiting"
);

// ── Combining a claim with a paid grant ──────────────────────────────────────

// The higher tier wins whatever its end date. This is the most damaging thing
// the resolver could get wrong: somebody redeeming Lunar while holding Mini must
// not land back on Mini because Mini happens to run longer, because that is
// paying more and receiving less.
const best = bestPlan(
  [
    { plan: "mini", days: 0, expiresAt: NOW + 400 * DAY_MS },
    { plan: "lunar", days: 30, expiresAt: NOW + 30 * DAY_MS },
  ],
  NOW
);
assert.equal(best?.plan, "lunar", "the dearer tier wins on tier, not on time left");
assert.equal(planRank(best!.plan), 2);

// Same tier: the one running longer is the better one, which is what makes a
// renewal add to a buyer rather than replace what they had.
const sameTier = bestPlan(
  [
    { plan: "mini", days: 0, expiresAt: NOW + 10 * DAY_MS },
    { plan: "mini", days: 30, expiresAt: NOW + 40 * DAY_MS },
  ],
  NOW
);
assert.equal(sameTier?.expiresAt, NOW + 40 * DAY_MS, "the same tier takes the later end date");

assert.equal(bestPlan([], NOW), null, "nothing claimed and nothing granted is free");
assert.equal(
  bestPlan([{ plan: "mini", days: 0, expiresAt: 0 }], NOW),
  null,
  "a missing expiry is not access"
);
assert.equal(
  bestPlan([{ plan: "mini", days: 0, expiresAt: Number.NaN }], NOW),
  null,
  "an unreadable expiry is not access"
);

// A lapsed code is the interesting case, and it is the one that goes wrong
// quietly. Because a redemption is measured from when it was CLAIMED, an old
// claim carries an end date that is in the past but still a positive number —
// so a check for "positive" alone would happily hand out a plan whose time ran
// out months ago, for ever.
assert.equal(
  bestPlan([{ plan: "mini", days: 30, expiresAt: NOW - DAY_MS }], NOW),
  null,
  "a code whose time has run out grants nothing, however recent the claim was"
);
assert.equal(
  bestPlan(
    [
      { plan: "lunar", days: 30, expiresAt: NOW - DAY_MS },
      { plan: "mini", days: 0, expiresAt: NOW + 10 * DAY_MS },
    ],
    NOW
  )?.plan,
  "mini",
  "an expired Lunar code must not outrank a live Mini one"
);
// The instant it stops counting is the end date itself, not the day after.
assert.equal(
  bestPlan([{ plan: "mini", days: 30, expiresAt: NOW }], NOW),
  null,
  "access ends at the end date"
);
assert.equal(
  bestPlan([{ plan: "mini", days: 30, expiresAt: NOW + 1 }], NOW)?.plan,
  "mini",
  "and lasts right up to it"
);

// ── A claim carries no plan ──────────────────────────────────────────────────
//
// The single property the whole feature rests on. If the claim could say what
// it is worth, then whoever can write a claim could write themselves a plan.

const rules = JSON.parse(readFileSync(join(process.cwd(), "database.rules.json"), "utf8")).rules;
const claimValidate = rules.redeems.$uid.$code[".validate"];

// The claim's payload is fixed and small. `plan` and `days` are not in it.
const claimValidateSource = String(claimValidate);
assert.ok(
  claimValidateSource.includes("['code','claimedAt']"),
  "the claim may only carry the code name and a time"
);
assert.ok(!claimValidateSource.includes("'plan'"), "a claim must not be able to carry a plan");
assert.ok(!claimValidateSource.includes("'days'"), "a claim must not be able to carry a length");
assert.ok(!claimValidateSource.includes("expiresAt"), "a claim must not be able to carry an end date");

// Termination is refused at the moment of writing, so a modified client cannot
// claim against a code the owner has switched off.
assert.ok(
  /root\.child\('codes'\)\.child\(\$code\)\.child\('active'\)\.val\(\) === true/.test(claimValidateSource),
  "the claim refuses the write unless the code is still switched on"
);

// The owner keeps exclusive control of the codes themselves.
const codeRules = rules.codes;
assert.equal(codeRules.$code[".read"], "auth != null", "a code is readable only when you know its name");
assert.equal(
  codeRules[".write"],
  "auth != null && auth.token.email == 'myrealmetvreal@gmail.com'",
  "only the owner may create, change or switch off a code"
);
// The owner must still be able to LIST them — the console reads the whole tree.
// Refusing the parent read while granting the per-code one broke the console's
// own code list, and the refusal surfaced as "This account is not the Mino
// administrator", which sent the owner looking at their account rather than at
// the rule that was wrong.
assert.equal(
  codeRules[".read"],
  "auth != null && auth.token.email == 'myrealmetvreal@gmail.com'",
  "only the owner may list every code; a visitor can still fetch one by name"
);

// A claim is written once. `claimedAt` is compared against what is already
// there, so re-typing a code cannot move the moment it was claimed — which is
// what turned one word into unlimited time.
const claimRules = rules.redeems.$uid.$code[".validate"];
assert.ok(
  /!data\.exists\(\) \|\| data\.child\('claimedAt'\)\.val\(\) === newData\.child\('claimedAt'\)\.val\(\)/.test(
    claimRules
  ),
  "a claim's timestamp must be immutable, or redeeming resets the clock"
);

// `subscriptions/` must stay closed to visitors, or the claim is pointless: a
// user who can write their own plan does not need a code at all.
assert.equal(
  rules.subscriptions.$uid[".write"],
  undefined,
  "no visitor may write their own subscription record"
);
assert.equal(rules.subscriptions.$uid.ack[".write"], "auth != null && auth.uid === $uid");

// The client helper writes the claim and nothing else.
const claimSource = readFileSync(join(process.cwd(), "lib", "redeem.ts"), "utf8");
const claimWrite = claimSource.slice(claimSource.indexOf("await set(claimRef"));
assert.ok(
  claimWrite.includes("code,") && claimWrite.includes("claimedAt:"),
  "the client writes the word and the time"
);
assert.ok(!/plan:|days:|expiresAt:/.test(claimWrite), "and nothing that would decide what it is worth");

// An already-claimed code is reported as already claimed, not as an error. The
// plan is already theirs, and calling a working code "wrong" is the fastest way
// to make somebody ask for a replacement they do not need.
assert.ok(
  claimSource.includes("alreadyClaimed"),
  "re-using a code must be reported as success, with the reason"
);
assert.ok(
  /existing\.val\(\)\?\.claimedAt/.test(claimSource) || /Number\(existing\.val\(\)/.test(claimSource),
  "the client must read the claim before writing it, so it does not reset the clock"
);

// The server must anchor a redemption to the claim's own timestamp. Passing the
// current instant instead is what produced unlimited time.
const resolver = code(join(process.cwd(), "lib", "serverRedeem.ts"));
assert.ok(
  /redeemValue\(\s*status\.code,\s*claim\.claimedAt\s*\)/.test(resolver),
  "a redemption must be measured from when it was claimed"
);
assert.ok(
  !/redeemValue\(\s*status\.code,\s*now\s*\)/.test(resolver),
  "and never from the moment the request happened to arrive"
);

// The page has to learn about a claimed code. It used to watch only
// `subscriptions/`, which a claim never writes, so the buyer was told their code
// worked and then shown Free — the exact report this fixes.
const planRoute = code(join(process.cwd(), "app", "api", "plan", "route.ts"));
assert.ok(
  planRoute.includes("resolveEffectivePlan("),
  "the plan endpoint must use the same resolver the paywall enforces with"
);
const hook = code(join(process.cwd(), "lib", "useSubscription.ts"));
assert.ok(
  hook.includes("/api/plan"),
  "the interface must read the server's answer, not only the local record"
);
assert.ok(
  /announcementId: 0/.test(hook),
  "a synthesised record must not claim to be a new grant, or it would pop a celebration"
);

console.log("redeem: all checks passed");