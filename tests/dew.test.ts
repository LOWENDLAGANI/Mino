// ── Mino — tests for the Dew pay-as-you-go currency ─────────────────────────
//
// Dew is the only money Mino has. Every rule about what it costs, what a
// balance means, and whether a request may start is decided in lib/dew.ts and
// enforced by the routes — so the arithmetic here is the arithmetic the
// deployment runs on. A silent error in pricing, rounding, or the balance
// derivation is a real shortfall or an over-charge, not a failed test.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AZURE_FLOOR,
  calcDewCost,
  canAfford,
  DEW_PACKS,
  DEW_PER_UNIT,
  DEW_PRICING,
  dewBalanceFrom,
  DUST_THRESHOLD,
  estimateTokenUsage,
  formatDew,
  IMAGE_DEW_COST,
  LOW_BALANCE_THRESHOLD,
  nextSpent,
  roundDew,
  sumCredits,
  tierForRequest,
  toMillidew,
  type DewTier,
} from "../lib/dew";
import { parseRedeemCode } from "../lib/redeemState";

// ── Pricing tiers ─────────────────────────────────────────────────────────────

assert.equal(tierForRequest("auto", "low"), "fast");
assert.equal(tierForRequest("auto", "medium"), "pro");
assert.equal(tierForRequest("auto", "high"), "pro");
assert.equal(tierForRequest("auto", null), "fast");
assert.equal(tierForRequest("code", "low"), "fast");
assert.equal(tierForRequest("code", "medium"), "pro");
assert.equal(tierForRequest("self", "low"), "pro");
assert.equal(tierForRequest("self", "high"), "pro");

// ── Cost calculation ──────────────────────────────────────────────────────────

// 1k in + 1k out fast = 0.015 + 0.06 = 0.075
assert.equal(calcDewCost("fast", { prompt: 1000, completion: 1000 }), 0.075);
// 1k in + 1k out pro = 0.25 + 1.0 = 1.25
assert.equal(calcDewCost("pro", { prompt: 1000, completion: 1000 }), 1.25);
// A typical 20k-in / 4k-out pro request = 5 + 4 = 9
assert.equal(calcDewCost("pro", { prompt: 20000, completion: 4000 }), 9);
// Zero usage is free
assert.equal(calcDewCost("fast", { prompt: 0, completion: 0 }), 0);
// Negative usage is clamped to zero, not negative cost
assert.equal(calcDewCost("fast", { prompt: -100, completion: -50 }), 0);

// ── Rounding ──────────────────────────────────────────────────────────────────

// Float drift must not leak into a balance
assert.equal(roundDew(0.1 + 0.2), 0.3);
assert.equal(roundDew(1.005), 1.005);
assert.equal(roundDew(0), 0);
assert.equal(roundDew(-5), -5);

// Millidew integer arithmetic
assert.equal(toMillidew(0.075), 75);
assert.equal(toMillidew(1.25), 1250);
assert.equal(toMillidew(0), 0);

// ── Balance derivation ────────────────────────────────────────────────────────

// Credits minus spent, floored at zero
assert.equal(dewBalanceFrom({ credits: { TRIAL: 25 }, spent: 12.375 }), 12.625);
// Missing everything is zero
assert.equal(dewBalanceFrom(null), 0);
assert.equal(dewBalanceFrom(undefined), 0);
assert.equal(dewBalanceFrom({}), 0);
// Overspent is floored at zero, not negative
assert.equal(dewBalanceFrom({ credits: { TRIAL: 25 }, spent: 30 }), 0);
// Spent of zero with no credits
assert.equal(dewBalanceFrom({ spent: 5 }), 0);
// Negative spent is treated as zero
assert.equal(dewBalanceFrom({ credits: { TRIAL: 25 }, spent: -3 }), 25);

// ── Sum credits ───────────────────────────────────────────────────────────────
//
// sumCredits is the accumulator dewBalanceFrom subtracts spent *in*, so it
// answers in millidew — 1000 to the Dew — and the division back into Dew
// happens there. Asserting 125 here would put the test in a different unit
// from the contract the function documents and the balance above proves.

assert.equal(sumCredits(null), 0);
assert.equal(sumCredits({}), 0);
assert.equal(sumCredits({ TRIAL: 25, CODE1: 100 }), 125_000);
assert.equal(sumCredits({ TRIAL: 25, bad: "not a number", CODE1: 100 }), 125_000);
assert.equal(sumCredits({ TRIAL: 25, negative: -10, CODE1: 100 }), 125_000);
// …and in the Dew the interface prints, that same credit is 125.
assert.equal(dewBalanceFrom({ credits: { TRIAL: 25, CODE1: 100 }, spent: 0 }), 125);

// ── nextSpent ─────────────────────────────────────────────────────────────────

assert.equal(nextSpent(0, 0.075), 0.075);
assert.equal(nextSpent(12.375, 0.075), 12.45);
assert.equal(nextSpent(0, 0), 0);
assert.equal(nextSpent(5, -1), 5);
assert.equal(nextSpent(-3, 1), 1);

// ── canAfford ─────────────────────────────────────────────────────────────────

assert.equal(canAfford(0.05), true);
assert.equal(canAfford(0.04), false);
assert.equal(canAfford(25), true);
assert.equal(canAfford(0), false);
assert.equal(canAfford(0.3, AZURE_FLOOR), true);
assert.equal(canAfford(0.2, AZURE_FLOOR), false);

// ── Thresholds ────────────────────────────────────────────────────────────────

assert.equal(DUST_THRESHOLD, 0.05);
assert.equal(AZURE_FLOOR, 0.25);
assert.equal(LOW_BALANCE_THRESHOLD, 10);
assert.equal(IMAGE_DEW_COST, 1);
assert.equal(DEW_PER_UNIT, 100);

// ── Dew packs ─────────────────────────────────────────────────────────────────

assert.equal(DEW_PACKS.length, 4);
// Packs are ordered by value
for (let i = 1; i < DEW_PACKS.length; i++) {
  assert.ok(DEW_PACKS[i].dew > DEW_PACKS[i - 1].dew, "packs must be ordered by dew");
}
// Every pack has a positive dew and ringgit value
for (const pack of DEW_PACKS) {
  assert.ok(pack.dew > 0, "pack dew must be positive");
  assert.ok(pack.ringgit > 0, "pack ringgit must be positive");
}

// ── estimateTokenUsage ────────────────────────────────────────────────────────

const estimated = estimateTokenUsage("abcd");
assert.equal(estimated.completion, 1);
assert.equal(estimated.prompt, 0);
assert.equal(estimateTokenUsage("").completion, 0);
assert.equal(estimateTokenUsage("a".repeat(400)).completion, 100);

// ── formatDew ─────────────────────────────────────────────────────────────────

assert.equal(formatDew(0), "0");
assert.equal(formatDew(0.075), "0.075");
assert.equal(formatDew(12.5), "12.5");
assert.equal(formatDew(25), "25");
assert.equal(formatDew(0.1 + 0.2), "0.3");

// ── Dew codes parse correctly ─────────────────────────────────────────────────

const dewCode = parseRedeemCode({ code: "dew500", dew: 500, active: true, createdAt: Date.now() });
assert.ok(dewCode);
assert.equal(dewCode.dew, 500);
assert.equal(dewCode.active, true);
// A Dew code ignores any plan value — a plan cannot ride in on a Dew code
const dewCodeWithPlan = parseRedeemCode({ code: "dew500", dew: 500, plan: "lunar", days: 365, active: true, createdAt: Date.now() });
assert.ok(dewCodeWithPlan);
assert.equal("plan" in dewCodeWithPlan, false, "the stored plan is not honoured, and not kept");
assert.equal("days" in dewCodeWithPlan, false, "nor is a length");
// A malformed dew value resolves to nothing
assert.equal(parseRedeemCode({ code: "bad", dew: -5, createdAt: Date.now() }), null);
assert.equal(parseRedeemCode({ code: "bad", dew: 200000, createdAt: Date.now() }), null);

// ── The routes actually charge ───────────────────────────────────────────────────
//
// Pricing that nobody enforces is a price list. These read the source of the two
// routes and of the deduction itself, because a regression there stays invisible
// until a balance quietly stops moving.

/** A file with its comments stripped, so an explanation cannot pass for code. */
function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const chatSource = source(join("app", "api", "chat", "route.ts"));
const imageSource = source(join("app", "api", "image", "route.ts"));
// The whole server-Dew module, and the one function the charges go through.
const dewSource = source(join("lib", "serverDew.ts"));
const deductDewSource = dewSource.slice(dewSource.indexOf("export async function deductDew"), dewSource.indexOf("export interface DewChargeLine"));

// The chat route reads the balance server-side, refuses before the model runs,
// and charges once the answer is fully known.
assert.ok(chatSource.includes("resolveDew("), "the chat route must resolve the balance server-side");
assert.ok(chatSource.includes("canStartRequest("), "and pre-flight it before any model call");
assert.ok(chatSource.includes("deductDew("), "and deduct when the answer is done");
assert.ok(
  chatSource.includes("await deductDew("),
  "the deduction must be awaited: once the stream closes a serverless deployment may freeze the process, and a charge still in flight never happens"
);

// The image route charges one Dew per picture on success.
assert.ok(imageSource.includes("resolveDew("), "the image route must resolve the balance server-side");
assert.ok(imageSource.includes("deductDew("), "and charge Dew on success");

// A balance is never whatever the caller says it is.
for (const [name, route] of [["chat", chatSource], ["image", imageSource]] as const) {
  assert.ok(!/body\.(dewBalance|balance)\b/.test(route), `${name} must never read a balance from the request body`);
  assert.ok(
    !/query\.(dewBalance|balance)\b/.test(route) && !/searchParams\.get\(\s*["'`]balance/.test(route),
    `${name} must never read a balance from the query string`
  );
  assert.ok(!/body\.plan\b/.test(route), `${name} must never read a plan from the request body`);
  assert.ok(!route.includes("consumeUsage("), `${name} does not count messages or images: Dew is the only control`);
}

// The deduction is a conditional write, and it has to know what to do about an
// account that has never been charged — which is every account, once.
assert.ok(dewSource.includes("dewBalanceFrom("), "the Dew reader must derive the balance from credits and spend");
assert.ok(dewSource.includes('"If-Match"'), "the deduction must be a conditional write, not a blind put");
assert.ok(
  dewSource.includes('"null_etag"'),
  "a location that does not exist has no ETag to echo: without the documented null_etag the very first charge on an account is a guaranteed 412, and the balance never moves again"
);
assert.ok(dewSource.includes("attempt === 0"), "a lost race is re-read and placed once, never looped");
assert.ok(
  deductDewSource.includes("fallback: true"),
  "when the conditional path has failed twice, the charge must still land with a plain computed write: a lost 412 or a misbehaving conditional-write backend must never become a balance that stops moving"
);
assert.ok(
  deductDewSource.includes("reason:"),
  "a refusal is reported with its own diagnosis, not just a boolean"
);
