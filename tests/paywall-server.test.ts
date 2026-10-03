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

const PLANS: (PlanId | null)[] = [null, "mini", "lunar"];
const PAID: (PlanId | null)[] = ["mini", "lunar"];

// ── Reasoning ────────────────────────────────────────────────────────────────

// Low is the free tier's answer. Anything above it is the thing Mini sells, so
// this single assertion is the difference between an honest paywall and a
// decorative one.
assert.equal(maxReasoningEffort(null), "low", "no plan must be limited to low reasoning");
assert.equal(maxReasoningEffort("mini"), "high", "Mini must unlock high reasoning");
assert.equal(maxReasoningEffort("lunar"), "high", "Lunar must unlock high reasoning");

for (const effort of ["low", "medium", "high"] as ReasoningEffort[]) {
  for (const plan of PAID) {
    assert.equal(
      clampReasoningEffort(effort, plan),
      effort,
      `a paying plan must keep the effort it asked for (${plan}, ${effort})`
    );
  }
}
assert.equal(clampReasoningEffort("high", null), "low", "high must be clamped for no plan");
assert.equal(clampReasoningEffort("medium", null), "low", "medium must be clamped for no plan");
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
    const expected = isUnlocked("reasoning", plan) ? "medium" : "low";
    assert.equal(result.effort, expected, `Code default effort must be clamped to ${expected} (${plan})`);
    assert.equal(result.clamped, !isUnlocked("reasoning", plan), `clamped flag must match reality (${plan})`);
  }
}

// Asking for paid reasoning without a plan is refused, in every mode.
for (const effort of ["medium", "high"] as const) {
  const result = checkChatEntitlement(null, {
    mode: "auto",
    requestedEffort: effort,
    defaultEffort: "low",
  });
  assert.equal(result.allowed, false, `an explicit ${effort} request without a plan must be refused`);
  assert.equal(result.allowed === false && result.feature, "reasoning", "the refusal must name the feature");
  assert.ok(
    result.allowed === false && result.error.includes("/plus"),
    "the refusal must say where to go, not just that it is refused"
  );
}

// Asking for paid reasoning *with* Mini is allowed — the whole point of the tier.
for (const effort of ["medium", "high"] as const) {
  for (const plan of PAID) {
    const result = checkChatEntitlement(plan, {
      mode: "auto",
      requestedEffort: effort,
      defaultEffort: "low",
    });
    assert.equal(result.allowed, true, `${plan} must be allowed ${effort} reasoning`);
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
assert.equal(freeAzure.allowed, false, "Mino Azure must be refused without a plan");
assert.equal(
  freeAzure.allowed === false && freeAzure.feature,
  "azure",
  "the Azure refusal must name the feature"
);

// Mini pays for reasoning and images, but explicitly *not* for Azure.
const miniAzure = checkChatEntitlement("mini", {
  mode: "self",
  requestedEffort: null,
  defaultEffort: "low",
});
assert.equal(miniAzure.allowed, false, "Mini must not reach Mino Azure");

const lunarAzure = checkChatEntitlement("lunar", {
  mode: "self",
  requestedEffort: null,
  defaultEffort: "low",
});
assert.equal(lunarAzure.allowed, true, "Lunar must reach Mino Azure");

for (const mode of ["auto", "code"] as const) {
  const result = checkModeEntitlement(mode, null);
  assert.equal(result.allowed, true, `free ${mode} must not be gated`);
}
assert.equal(checkModeEntitlement("self", null).allowed, false, "free Azure must be refused");
assert.equal(checkModeEntitlement("self", "mini").allowed, false, "Mini must not reach Azure");
assert.equal(checkModeEntitlement("self", "lunar").allowed, true, "Lunar must reach Azure");

// ── Images ───────────────────────────────────────────────────────────────────

for (const plan of PAID) {
  assert.equal(checkImageEntitlement(plan).allowed, true, `${plan} must be allowed to generate images`);
}
const freeImage = checkImageEntitlement(null);
assert.equal(freeImage.allowed, false, "image creation must be refused without a plan");
assert.equal(freeImage.feature, "images", "the image refusal must name the feature");

// ── The client is never the authority ────────────────────────────────────────
//
// The enforcement point has to read the plan from the server's own record. The
// failure this guards against is quiet and total: a route that accepts a plan
// from the request body is enforced by nothing, because the value being checked
// is the one being forged. These assertions read the source, so a future edit
// that reintroduces that cannot pass unnoticed.

const routeSource = (name: string): string => code(join(process.cwd(), "app", "api", name, "route.ts"));

/**
 * A file with its comments removed.
 *
 * These assertions look for things that must never appear in a route, and a
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

for (const route of ["chat", "image"]) {
  const source = routeSource(route);
  assert.ok(
    source.includes("readCallerPlan("),
    `${route} must resolve the plan server-side before enforcing anything`
  );
  assert.ok(
    source.includes("checkChatEntitlement(") || source.includes("checkImageEntitlement("),
    `${route} must consult the shared paywall check`
  );
  assert.ok(
    !/body\.(plan|planId|subscription)\b/.test(source),
    `${route} must never read a plan from the request body`
  );
  assert.ok(
    !/query\.(plan|planId)\b/.test(source) && !/searchParams\.get\(\s*["'`]plan/.test(source),
    `${route} must never read a plan from the query string`
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