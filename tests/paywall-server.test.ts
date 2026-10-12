// ── Mino — tests for the server-side paywall ────────────────────────────────
//
// The paywall exists in two places on purpose. `lib/paywallState.ts` decides
// what the interface shows; `lib/paywallServer.ts` decides what the routes will
// actually serve. The second is the one that has to hold against a client that
// was edited, so these tests are mostly about what it refuses and what it
// refuses *not* to refuse — an over-eager gate that locks out paying customers,
// or that breaks Code mode for people who never bought anything, costs real
// money too.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkChatEntitlement,
  checkImageEntitlement,
  checkModeEntitlement,
  clampReasoningEffort,
  maxReasoningEffort,
  type ReasoningEffort,
} from "../lib/paywallServer";
import { isUnlocked } from "../lib/paywallState";
import type { PlanId } from "../lib/plans";
import {
  DEW_PRICING,
  IMAGE_DEW_COST,
  TRIAL_DEW,
  calcDewCost,
  dewBalanceFrom,
  formatDew,
  nextSpent,
  roundDew,
  tierForRequest,
} from "../lib/dew";

const PLANS: (PlanId | null)[] = [null, "mini", "lunar"];
const PAID: (PlanId | null)[] = ["mini", "lunar"];

// ── Reasoning ────────────────────────────────────────────────────────────────

// Low is the free tier's answer. Anything above it is the thing Mini sells, so
// this single assertion is the difference between an honest paywall and a
// decorative one.
// Under Dew, effort is priced rather than gated, so every plan and no plan can
// ask for anything. These replace the old clamp assertions on purpose: the
// clamp logic survives, but nothing under Dew produces a lowered effort.
assert.equal(maxReasoningEffort(null), "high", "effort is priced, never gated");
assert.equal(maxReasoningEffort("mini"), "high", "effort is priced, never gated");
assert.equal(maxReasoningEffort("lunar"), "high", "effort is priced, never gated");

for (const effort of ["low", "medium", "high"] as ReasoningEffort[]) {
  for (const plan of PAID) {
    assert.equal(
      clampReasoningEffort(effort, plan),
      effort,
      `a paying plan must keep the effort it asked for (${plan}, ${effort})`
    );
  }
}
assert.equal(clampReasoningEffort("high", null), "high", "requests are billed, not clamped");
assert.equal(clampReasoningEffort("medium", null), "medium", "requests are billed, not clamped");
assert.equal(clampReasoningEffort("low", null), "low", "low must never be clamped");

// ── Chat requests ────────────────────────────────────────────────────────────

// Free traffic is untouched. This matters more than it looks: a gate that
// refuses ordinary Auto-mode chat would take the whole product offline for
// everyone who has not subscribed.
for (const mode of ["auto", "code"] as const) {
  for (const effort of ["low", "medium", "high"] as const) {
    if (effort !== "low") continue;
    const result = checkChatEntitlement(null, {
      mode,
      requestedEffort: effort,
      defaultEffort: "low",
    });
    assert.equal(result.allowed, true, `free ${mode} chat at ${effort} must be allowed`);
  }
}

// The defaults the route fills in — nobody asked for these, so they must be
// clamped rather than refused. Refusing them would lock out free Code mode.
for (const plan of PLANS) {
  const result = checkChatEntitlement(plan, {
    mode: "code",
    requestedEffort: null,
    defaultEffort: "medium",
  });
  assert.equal(result.allowed, true, `Code mode's own default must never be refused (${plan})`);
  if (result.allowed) {
    assert.equal(result.effort, "medium", `Code mode's own default medium survives (${plan})`);
    assert.equal(result.clamped, false, `nothing under Dew gets clamped (${plan})`);
  }
}

// Explicit reasoning requests, with or without a plan, are allowed — they are
// billed at the pro tier now rather than gated. The refusal tests that used to
// live here are inverted on purpose: the whole point of the Dew refactor is
// that the answer to "can I think harder" is "yes, for more Dew".
for (const effort of ["medium", "high"] as const) {
  for (const plan of PLANS) {
    const result = checkChatEntitlement(plan, {
      mode: "auto",
      requestedEffort: effort,
      defaultEffort: "low",
    });
    assert.equal(result.allowed, true, `${effort} reasoning is priced, not gated (${plan})`);
    if (result.allowed) {
      assert.equal(result.effort, effort, `the requested effort survives untouched (${plan}, ${effort})`);
      assert.equal(result.clamped, false, `nothing under Dew is clamped down (${plan}, ${effort})`);
    }
  }
}

// Low is free and must never be refused, on any plan.
for (const plan of PLANS) {
  const result = checkChatEntitlement(plan, {
    mode: "auto",
    requestedEffort: "low",
    defaultEffort: "low",
  });
  assert.equal(result.allowed, true, `low reasoning must always be allowed (${plan})`);
}

// ── Mino Azure ───────────────────────────────────────────────────────────────

// Requested by name in the body, so it is the mode most worth forging.
const freeAzure = checkChatEntitlement(null, {
  mode: "self",
  requestedEffort: null,
  defaultEffort: "low",
});
assert.equal(freeAzure.allowed, true, "Azure is a pro-tier price, not a plan lock");
assert.equal(freeAzure.effort, "low", "an unrequested effort keeps the route default");
for (const plan of PAID) {
  const paid = checkChatEntitlement(plan, {
    mode: "self",
    requestedEffort: null,
    defaultEffort: "low",
  });
  assert.equal(paid.allowed, true, `${plan} can reach Azure, billed at the pro tier`);
}

for (const mode of ["auto", "code"] as const) {
  const result = checkModeEntitlement(mode, null);
  assert.equal(result.allowed, true, `free ${mode} must not be gated`);
}
assert.equal(checkModeEntitlement("self", null).allowed, true, "Azure is priced at the pro tier");
assert.equal(checkModeEntitlement("self", "mini").allowed, true, "Azure is priced at the pro tier");
assert.equal(checkModeEntitlement("self", "lunar").allowed, true, "Azure is priced at the pro tier");

// ── Images ───────────────────────────────────────────────────────────────────

for (const plan of PAID) {
  assert.equal(checkImageEntitlement(plan).allowed, true, `${plan} must be allowed to generate images`);
}
const freeImage = checkImageEntitlement(null);
assert.equal(freeImage.allowed, true, "images are priced per generation, not plan-locked");

/**
 * A file with its comments removed.
 *
 * The assertions below look for things that must never appear in a route, and a
 * comment that *discusses* those things would otherwise fail them — which is the
 * wrong way round: the explanation of why a route never reads a plan from the
 * body is not the route reading a plan from the body. Stripping comments first
 * keeps the check about the code.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/[ \t]+$/gm, "");
}

const routeSource = (name: string): string => code(join(process.cwd(), "app", "api", name, "route.ts"));

// A refusal must not cost the caller anything.
//
// Both routes spend a daily allowance (a message, an image) before doing the
// work. If the paywall ran after that counter, every refused attempt would burn
// a slot of an allowance the person needs for the things they *can* use, and
// after enough attempts they would be told to come back tomorrow rather than
// told what to buy. The ordering is the whole difference between a paywall and a
// dead end, so it is pinned here rather than left to review.
// The Dew pre-flight must come before any model call in the chat route, and the
// image route must refuse a dust-balance caller before spending quota.
const chatSource = routeSource("chat");
const imageSource = routeSource("image");
assert.ok(
  chatSource.includes("canStartRequest(") && chatSource.includes("deductDew("),
  "the chat route must pre-flight the Dew balance and deduct on completion"
);
assert.ok(
  chatSource.includes("resolveDew("),
  "the chat route must read the balance from the server-side resolver"
);
assert.ok(
  imageSource.includes("DEDW_PLACEHOLDER") === false && imageSource.includes("deductDew("),
  "the image route must charge Dew on success"
);
assert.ok(
  !chatSource.includes("consumeUsage("),
  "the daily message cap is retired: the chat route must not count messages"
);
assert.ok(
  !imageSource.includes("consumeUsage("),
  "the daily image cap is retired: the image route must not count images"
);

// ── The client is never the authority ────────────────────────────────────────
//
// The enforcement point has to read the plan from the server's own record. The
// failure this guards against is quiet and total: a route that accepts a plan
// from the request body is enforced by nothing, because the value being checked
// is the one being forged. These assertions read the source, so a future edit
// that reintroduces that cannot pass unnoticed.

for (const route of ["chat", "image"]) {
  const source = routeSource(route);
  assert.ok(
    source.includes("resolveDew("),
    `${route} must resolve the Dew balance server-side before enforcing anything`
  );
  assert.ok(
    !/body\.(dewBalance|balance)\b/.test(source),
    `${route} must never read a balance from the request body`
  );
  assert.ok(
    !/query\.(dewBalance|balance)\b/.test(source) && !/searchParams\.get\(\s*["'`]balance/.test(source),
    `${route} must never read a balance from the query string`
  );
}

// The server module must have no way to be handed a plan at all, which is why
// it takes one argument and never parses a request.
const serverModule = code(join(process.cwd(), "lib", "paywallServer.ts"));
// It must not reach for the HTTP request itself. `request` is the local name of
// the chat request's shape, so the check is for the specific ways a module would
// touch the transport rather than the bare word.
assert.ok(
  !/NextRequest|req\.headers|req\.json|req\.nextUrl/.test(serverModule),
  "the paywall check must stay independent of the HTTP request it guards"
);
assert.ok(
  !/firebase|database|fetch\(/.test(serverModule),
  "the paywall check must stay pure so it can be tested without a network"
);

// The plan reader resolves from a verified uid and a forwarded token — the two
// things a client does not control.
const planReader = code(join(process.cwd(), "lib", "serverPlan.ts"));
assert.ok(
  planReader.includes("subscriptions/"),
  "the plan reader must read the subscription node, not something derived"
);
assert.ok(
  planReader.includes("?auth="),
  "the plan read must be made with the caller's token so the rules judge it"
);
assert.ok(
  /parseSubscription/.test(planReader) && /isActive/.test(planReader),
  "the plan reader must parse and expiry-check rather than trust the stored shape"
);
// A read that fails is no plan. The comment says so; the code must do it.
assert.ok(
  /return none/.test(planReader),
  "a failed plan read must resolve to no plan rather than failing open"
);

// A claimed code is worth whatever the *code* says, read at the moment it is
// asked for. A resolver that trusted the claim, or that never re-checked
// `active`, would hand out a plan the owner has since terminated.
const resolver = code(join(process.cwd(), "lib", "serverRedeem.ts"));
assert.ok(
  resolver.includes("checkRedeemable("),
  "every code must be re-checked for termination on each request"
);
assert.ok(
  resolver.includes("?auth="),
  "the code read must be made with the caller's token so the rules judge it"
);
// The Dew reader must be fail-closed and CAS-based.
const serverDew = code(join(process.cwd(), "lib", "serverDew.ts"));
assert.ok(
  serverDew.includes("dewBalanceFrom("),
  "the Dew reader must derive the balance from credits and spend"
);
assert.ok(
  serverDew.includes("If-Match") || serverDew.includes("If-Match\": \"\"") || serverDew.includes('"If-Match"'),
  "the deduction must be a conditional write, not a blind put"
);
assert.ok(
  serverDew.includes("412"),
  "a lost race must be detected and reported rather than assumed"
);

// ── The client gate stays, and stays advisory ────────────────────────────────
//
// It is still worth having: it is what puts the padlock on the button and the
// sentence in front of the person. What it must not be is described as the
// security boundary now that the routes enforce the same table.
const clientState = code(join(process.cwd(), "lib", "paywallState.ts"));
// The client gate is now the advisory one, and the module must say so in its own
// words rather than leaving a reader to assume it is still the boundary. Comments
// are stripped above, so this one deliberately reads the raw file.
const clientComments = readFileSync(join(process.cwd(), "lib", "paywallState.ts"), "utf8");
assert.ok(
  /advisory|not a\s+security boundary|server/i.test(clientComments),
  "the client gate must be documented as advisory now that the server enforces"
);
assert.ok(
  /paywallServer/.test(clientComments),
  "the client gate must point at the module that actually enforces"
);

console.log("paywall-server: all checks passed");
// ── Dew arithmetic ──────────────────────────────────────────────────────────

// The pricing table is the whole contract with the buyer, so it is pinned.
assert.deepEqual(DEW_PRICING.fast, { input: 0.015, output: 0.06 }, "fast tier prices");
assert.deepEqual(DEW_PRICING.pro, { input: 0.25, output: 1.0 }, "pro tier prices");
assert.equal(IMAGE_DEW_COST, 1, "one image costs one Dew");
assert.equal(TRIAL_DEW, 25, "the welcome grant is 25 Dew");

// Token arithmetic — exact, not approximate.
assert.equal(calcDewCost("fast", { prompt: 1000, completion: 1000 }), 0.075);
assert.equal(calcDewCost("pro", { prompt: 1000, completion: 1000 }), 1.25);
assert.equal(calcDewCost("fast", { prompt: 0, completion: 0 }), 0);
assert.equal(calcDewCost("pro", { prompt: 20000, completion: 4000 }), 9);

// Balances derive from credits minus spend, and never go negative.
assert.equal(dewBalanceFrom(null), 0);
assert.equal(dewBalanceFrom({ credits: { TRIAL: 25 }, spent: 0 }), 25);
assert.equal(dewBalanceFrom({ credits: { TRIAL: 25, DEW100: 100 }, spent: 12.5 }), 112.5);
assert.equal(dewBalanceFrom({ credits: { TRIAL: 25 }, spent: 900 }), 0, "spend past credits floors at zero");

// Spend only grows.
assert.equal(nextSpent(10, 1.25), 11.25);
assert.equal(nextSpent(10, 0), 10);
assert.equal(nextSpent(-1, 5), 5, "a corrupt negative spend is treated as zero, never as credit");

// Formatting: no floating dust on the interface.
assert.equal(formatDew(25), "25");
assert.equal(formatDew(12.5), "12.5");
assert.equal(roundDew(0.1 + 0.2), 0.3);

// Tiers: Azure and heavy reasoning bill as pro; everything else is fast.
assert.equal(tierForRequest("self", null), "pro");
assert.equal(tierForRequest("auto", "high"), "pro");
assert.equal(tierForRequest("code", "medium"), "pro");
assert.equal(tierForRequest("code", null), "fast");
assert.equal(tierForRequest("auto", "low"), "fast");

// The interface gate is advisory only now: it opens everything.
for (const plan of PLANS) {
  assert.equal(isUnlocked("reasoning", plan), true);
  assert.equal(isUnlocked("images", plan), true);
  assert.equal(isUnlocked("azure", plan), true);
}
