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

function makeCode(over: Partial<RedeemCode> = {}): RedeemCode {
  return {
    code: "MINO-LUNAR",
    plan: "lunar",
    days: 30,
    active: true,
    createdAt: NOW - 1000,
    maxUses: 0,
    used: 0,
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
  maxUses: 5,
  used: 2,
  note: "  paid by Ana  ",
});
assert.ok(parsed, "a well-formed code parses");
assert.equal(parsed.plan, "mini");
assert.equal(parsed.code, "MINO-MINI", "the stored word is normalized");
assert.equal(parsed.note, "paid by Ana", "a note is trimmed");
assert.equal(parsed.maxUses, 5);
assert.equal(parsed.used, 2);

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

const spent = checkRedeemable(makeCode({ maxUses: 1, used: 1 }), NOW);
assert.equal(spent.ok, false);
assert.equal(spent.ok === false && spent.reason, "used-up");

// Both conditions at once reports the one the owner actually did something
// about — they switched it off — rather than the incidental one.
const both = checkRedeemable(makeCode({ active: false, maxUses: 1, used: 1 }), NOW);
assert.equal(both.ok === false && both.reason, "terminated");

const unknown = checkRedeemable(null, NOW);
assert.equal(unknown.ok, false, "an unknown word is not a code");
assert.equal(unknown.ok === false && unknown.reason, "unknown");

// Unlimited means unlimited. A code meant as a giveaway must not quietly stop at
// one person, and `maxUses: 0` is what says that.
const unlimited = makeCode({ maxUses: 0, used: 99 });
assert.equal(checkRedeemable(unlimited, NOW).ok, true, "no limit is no limit");

// A code does not expire on its own. Its whole lifetime is the owner's switch,
// and inventing a deadline would invalidate a word mid-handover.
assert.equal(checkRedeemable(makeCode(), NOW + 10 * 365 * DAY_MS).ok, true, "a code does not quietly expire");

// Every refusal carries a sentence worth showing rather than a bare reason.
for (const code of [null, makeCode({ active: false }), makeCode({ maxUses: 1, used: 1 })]) {
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

// ── Combining a claim with a paid grant ──────────────────────────────────────

// The higher tier wins whatever its end date. This is the most damaging thing
// the resolver could get wrong: somebody redeeming Lunar while holding Mini must
// not land back on Mini because Mini happens to run longer, because that is
// paying more and receiving less.
const best = bestPlan([
  { plan: "mini", days: 0, expiresAt: NOW + 400 * DAY_MS },
  { plan: "lunar", days: 30, expiresAt: NOW + 30 * DAY_MS },
]);
assert.equal(best?.plan, "lunar", "the dearer tier wins on tier, not on time left");
assert.equal(planRank(best!.plan), 2);

// Same tier: the one running longer is the better one, which is what makes a
// renewal add to a buyer rather than replace what they had.
const sameTier = bestPlan([
  { plan: "mini", days: 0, expiresAt: NOW + 10 * DAY_MS },
  { plan: "mini", days: 30, expiresAt: NOW + 40 * DAY_MS },
]);
assert.equal(sameTier?.expiresAt, NOW + 40 * DAY_MS, "the same tier takes the later end date");

assert.equal(bestPlan([]), null, "nothing claimed and nothing granted is free");
assert.equal(bestPlan([{ plan: "mini", days: 0, expiresAt: 0 }]), null, "an expiry in the past is not access");
assert.equal(
  bestPlan([{ plan: "mini", days: 0, expiresAt: Number.NaN }]),
  null,
  "an unreadable expiry is not access"
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
assert.equal(codeRules[".read"], false, "the codes cannot be listed — only fetched by name");

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
const claimWrite = claimSource.slice(claimSource.indexOf("await set(ref("));
assert.ok(
  claimWrite.includes("code,") && claimWrite.includes("claimedAt:"),
  "the client writes the word and the time"
);
assert.ok(!/plan:|days:|expiresAt:/.test(claimWrite), "and nothing that would decide what it is worth");

console.log("redeem: all checks passed");