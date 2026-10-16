// ── Mino — tests for redeem codes ────────────────────────────────────────────
//
// A code is a word the owner chooses that carries an amount of Dew. The
// dangerous failure is not that a code stops working — that is a support
// message. It is that a code works for the wrong person, or that somebody
// reaches a balance they were never given. So most of what follows is about the
// claim carrying nothing but a name, and about termination actually terminating.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CODE_MAX,
  checkRedeemable,
  dewRedemptionValue,
  isValidCode,
  normalizeCode,
  parseRedeemCode,
  type RedeemCode,
} from "../lib/redeemState";

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

/**
 * A file with its comments stripped.
 *
 * The assertions below look for what code must and must not contain, and a
 * comment *discussing* those things would otherwise fail them — the wrong way
 * round, since explaining why a claim carries no amount is not the same as a
 * claim carrying one.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/[ \t]+$/gm, "");
}

function makeCode(over: Partial<RedeemCode> = {}): RedeemCode {
  return {
    code: "MINO-TOPUP",
    dew: 100,
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
assert.equal(normalizeCode("mino-topup"), "MINO-TOPUP");
assert.equal(normalizeCode("MINO TOPUP"), "MINOTOPUP");
assert.equal(normalizeCode("  mino_topup  "), "MINOTOPUP");
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
  code: "mino-topup",
  dew: 250,
  active: true,
  createdAt: NOW,
  note: "  paid by Ana  ",
});
assert.ok(parsed, "a well-formed code parses");
assert.equal(parsed.dew, 250);
assert.equal(parsed.code, "MINO-TOPUP", "the stored word is normalized");
assert.equal(parsed.note, "paid by Ana", "a note is trimmed");

// Anything malformed is no code at all, never a half-filled one. An amount that
// cannot be read must not turn into somebody's balance by defaulting to the
// nearest thing that still fits.
assert.equal(parseRedeemCode(null), null);
assert.equal(parseRedeemCode({ code: "MINO", active: true, createdAt: NOW }), null, "no amount");
assert.equal(
  parseRedeemCode({ code: "MINO", dew: "100", active: true, createdAt: NOW }),
  null,
  "a non-numeric amount is not an amount"
);
assert.equal(parseRedeemCode({ code: "AB", dew: 100, active: true, createdAt: NOW }), null, "too short");
assert.equal(parseRedeemCode({ code: "MINO", dew: 100, active: true }), null, "no creation time");

// A missing `active` means created, which is what every code written by the
// console carries. Defaulting the other way would silently kill every code
// whose field went missing.
assert.equal(parseRedeemCode({ code: "MINO", dew: 100, createdAt: NOW })?.active, true);
assert.equal(parseRedeemCode({ ...makeCode(), active: false })?.active, false, "off stays off");

// The amount is bounded by the same ceiling the rules validate on the write,
// so a typo in the console cannot mint a fortune.
assert.equal(parseRedeemCode({ code: "MINO", dew: 0, active: true, createdAt: NOW }), null, "zero is not a grant");
assert.equal(parseRedeemCode({ code: "MINO", dew: -5, active: true, createdAt: NOW }), null, "negative is refused");
assert.equal(
  parseRedeemCode({ code: "MINO", dew: 999_999, active: true, createdAt: NOW }),
  null,
  "over the ceiling is refused"
);
assert.equal(
  parseRedeemCode({ code: "MINO", dew: 100_000, active: true, createdAt: NOW })?.dew,
  100_000,
  "the ceiling itself passes"
);

// Money keeps three decimals, exactly like a balance.
assert.equal(parseRedeemCode({ code: "MINO", dew: 12.3456, active: true, createdAt: NOW })?.dew, 12.346);

// ── The subscription shape is gone ───────────────────────────────────────────
//
// These records still exist in old databases. They must resolve to nothing —
// not to a plan, not to a balance, and not to a code that half works.

const withPlanFields = parseRedeemCode({
  code: "WORD",
  dew: 50,
  plan: "lunar",
  days: 365,
  active: true,
  createdAt: NOW,
});
assert.ok(withPlanFields, "a Dew amount is what makes a record a code");
assert.equal(withPlanFields.dew, 50, "the amount is what it grants");
assert.equal("plan" in withPlanFields, false, "no plan field survives parsing");
assert.equal("days" in withPlanFields, false, "no length field survives parsing");

assert.equal(
  parseRedeemCode({ code: "WORD", plan: "mini", days: 3, active: true, createdAt: NOW }),
  null,
  "the legacy plan code is not a code any more"
);

// ── Terminating ──────────────────────────────────────────────────────────────

assert.equal(checkRedeemable(makeCode(), NOW).ok, true, "a live code redeems");

const off = checkRedeemable(makeCode({ active: false }), NOW);
assert.equal(off.ok, false);
assert.equal(off.ok === false && off.reason, "terminated", "an off code says so");

// There is no use count, and that is a decision rather than an omission.
// Counting redemptions needs a write to `codes/`, which the rules reserve for
// the owner, and this deployment has no service account to do it another way. A
// counter stuck at zero under a console that printed "0/1 used" would be a
// control that looks real and does nothing. The owner's switch is what bounds a
// word.
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
for (const candidate of [null, makeCode({ active: false })]) {
  const status = checkRedeemable(candidate, NOW);
  assert.ok(status.ok === false && status.message.length > 10, "a refusal must explain itself");
}

// ── What a claim is worth ────────────────────────────────────────────────────

const worth = dewRedemptionValue(makeCode({ dew: 12.5 }));
assert.equal(worth.dew, 12.5, "the amount comes from the code record");
assert.equal(worth.code, "MINO-TOPUP");
// The whole point of resolving here rather than in the claim: a caller can name
// a word, and nothing else.
assert.deepEqual(
  Object.keys(worth).sort(),
  ["code", "dew"],
  "a redemption carries the word and the amount, and nothing a caller chose"
);

// ── A claim carries no amount ────────────────────────────────────────────────
//
// The single property the whole feature rests on. If the claim could say what it
// is worth, then whoever can write a claim could write themselves a balance.

const rules = JSON.parse(readFileSync(join(process.cwd(), "database.rules.json"), "utf8")).rules;
const claimValidate = String(rules.redeems.$uid.$code[".validate"]);

// The claim's payload is fixed and small. `dew`, `plan` and `days` are not in it.
assert.ok(claimValidate.includes("['code','claimedAt']"), "the claim may only carry the code name and a time");
assert.ok(!claimValidate.includes("'dew'"), "a claim must not be able to carry an amount");
assert.ok(!claimValidate.includes("'plan'"), "a claim must not be able to carry a plan");
assert.ok(!claimValidate.includes("'days'"), "a claim must not be able to carry a length");
assert.ok(!claimValidate.includes("expiresAt"), "a claim must not be able to carry an end date");

// Termination is refused at the moment of writing, so a modified client cannot
// claim against a code the owner has switched off.
assert.ok(
  /root\.child\('codes'\)\.child\(\$code\)\.child\('active'\)\.val\(\) === true/.test(claimValidate),
  "the claim refuses the write unless the code is still switched on"
);

// A claim is written once. `claimedAt` is compared against what is already
// there, so re-typing a code cannot move the moment it was claimed — which is
// what turned one word into unlimited time.
assert.ok(
  /!data\.exists\(\) \|\| data\.child\('claimedAt'\)\.val\(\) === newData\.child\('claimedAt'\)\.val\(\)/.test(
    claimValidate
  ),
  "a claim's timestamp must be immutable, or redeeming resets the clock"
);

// ── The codes themselves are the owner's ─────────────────────────────────────

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

// A code is a Dew amount and nothing else, validated on the write itself — the
// server and the console both go through this rule.
const codeValidate = String(codeRules.$code[".validate"]);
assert.ok(codeValidate.includes("hasChildren(['dew'])"), "a code must carry a Dew amount");
assert.ok(codeValidate.includes("val() > 0"), "and it must be positive");
assert.ok(codeValidate.includes("val() <= 100000"), "and under the ceiling");
assert.ok(!codeValidate.includes("'plan'"), "no plan-shaped code may be written any more");
assert.ok(!codeValidate.includes("'days'"), "and no length-shaped one either");

// ── The subscription tree is gone ────────────────────────────────────────────
//
// Pay as you go means there is nowhere left for a plan to live. The rules must
// not offer the node, and no source file may still reach for it.

assert.equal(rules.subscriptions, undefined, "the rules no longer offer a subscriptions tree");

const forbidden = [
  "useSubscription",
  "subscriptionState",
  "paywallState",
  "paywallServer",
  "lib/plans",
  "lib/durations",
  "resolveEffectivePlan",
  "readCallerPlan",
  "SubscribeGate",
  "PayQrDialog",
  "PlanExpiryBanner",
  "SubscriptionCelebration",
  "/api/plan",
  "grantSubscription",
  "pauseSubscription",
  "resumeSubscription",
  "revokeSubscription",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const scanned = ["app", "components", "lib"].flatMap((dir) => walk(join(process.cwd(), dir)));
for (const file of scanned) {
  const source = readFileSync(file, "utf8");
  for (const token of forbidden) {
    assert.ok(
      !source.includes(token),
      `${file.replace(process.cwd() + "/", "")} still references "${token}"`
    );
  }
}

// ── The client helper writes the claim and nothing else ──────────────────────

const claimSource = readFileSync(join(process.cwd(), "lib", "redeem.ts"), "utf8");
const claimWrite = claimSource.slice(claimSource.indexOf("await set(claimRef"));
assert.ok(claimWrite.includes("code,") && claimWrite.includes("claimedAt:"), "the client writes the word and the time");
assert.ok(!/dew:|plan:|days:|expiresAt:/.test(claimWrite), "and nothing that would decide what it is worth");

// An already-claimed code is reported as already claimed, not as an error. The
// top-up is already theirs, and calling a working code "wrong" is the fastest
// way to make somebody ask for a replacement they do not need.
assert.ok(claimSource.includes("alreadyClaimed"), "re-using a code must be reported as success, with the reason");
assert.ok(
  /existing\.val\(\)\?\.claimedAt/.test(claimSource) || /Number\(existing\.val\(\)/.test(claimSource),
  "the client must read the claim before writing it, so it does not reset the clock"
);

// ── The server resolves from the code, fail-closed ───────────────────────────
//
// The reader re-checks `active` on every request rather than trusting a claim
// made while the code was on, and it reads with the caller's own token so the
// rules judge it exactly as they judge the browser.

const resolver = code(join(process.cwd(), "lib", "serverRedeem.ts"));
assert.ok(resolver.includes("checkRedeemable("), "every code must be re-checked for termination on each request");
assert.ok(resolver.includes("?auth="), "the code read must be made with the caller's token so the rules judge it");
assert.ok(resolver.includes("dewRedemptionValue("), "a claim resolves to the amount on the code");
assert.ok(!resolver.includes("planId"), "and never to a plan");
// A read that fails is worth nothing. The comment says so; the code must do it.
assert.ok(
  resolver.includes("values.filter((value): value is DewRedemption => value !== null)"),
  "an unreadable code contributes nothing rather than everything"
);

// ── The interface reads the balance, not a plan ──────────────────────────────
//
// The buyer's side used to watch `subscriptions/`, which a claim never writes,
// so a code that worked was followed by a screen that said Free. Now there is
// one number: the balance, read from the same derivation the routes enforce.

const redeemBox = code(join(process.cwd(), "components", "RedeemCodeBox.tsx"));
assert.ok(redeemBox.includes("useDew("), "the redeem box reads the shared balance store");
assert.ok(/await refresh\(\)/.test(redeemBox), "and re-reads it the moment a code lands");

console.log("redeem: all checks passed");
