// ── Mino — tests for the admin model health checks ───────────────────────────
//
// A status board that cannot be trusted is worse than none: an administrator
// who sees every model green while a chat is failing stops investigating. These
// pin the three things that make the check mean something — it asks the model
// you asked about, it tells the truth when the model cannot be reached, and it
// never carries a provider name into the browser to get there.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listModelTargets, modelTargetId, probeModel, PROBE_PROMPT } from "../lib/modelHealth";

let failures = 0;
let passes = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passes += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

/** Runs `fn` with the given keys present, then puts the environment back. */
async function withKeys(keys: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(keys)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// The suite is sequential: the environment is mutated per test, and several
// checks depend on the previous one having put the keys back.
async function main(): Promise<void> {
console.log("\nthe model list the panel receives");

await test("every configured model gets its own row", async () => {
  await withKeys({ GEMINI_API_KEY: "test-key", OPENROUTER_API_KEY: "test-key", GROQ_API_KEY: undefined }, () => {
    const targets = listModelTargets();
    const names = targets.map((target) => target.name);
    assert.deepEqual(names, ["Mino Auto", "Mino V3", "Mino V2", "Mino V1"]);
  });
});

await test("the last-resort models are listed separately and are distinguishable", async () => {
  await withKeys({ GEMINI_API_KEY: undefined, OPENROUTER_API_KEY: undefined, GROQ_API_KEY: "test-key" }, () => {
    const targets = listModelTargets();
    assert.equal(targets.length, 3, "the last-resort models are missing from the panel");
    const names = targets.map((target) => target.name);
    assert.equal(new Set(names).size, names.length, `two rows share a name: ${names.join(", ")}`);
    for (const target of targets) assert.match(target.name, /^Mino Backup \d+$/);
  });
});

await test("nothing in the list carries a provider name or a wire model", async () => {
  await withKeys({ GEMINI_API_KEY: "test-key", OPENROUTER_API_KEY: "test-key", GROQ_API_KEY: "test-key" }, () => {
    const serialised = JSON.stringify(listModelTargets());
    for (const word of ["gemini", "openrouter", "groq", "gpt", "llama", "https", "api_key"]) {
      assert.ok(
        !serialised.toLowerCase().includes(word),
        `the model list sent to the browser contains "${word}"`
      );
    }
  });
});

await test("the id is stable and says nothing about the model", () => {
  const model = "gemini-3.8-flash";
  assert.equal(modelTargetId(model), modelTargetId(model), "the id changes between reads, so saved results drift");
  assert.notEqual(modelTargetId(model), modelTargetId("gemini-3.7-flash"), "two models share an id");
  assert.ok(!modelTargetId(model).includes("gemini"), "the id spells out the model it hides");
  assert.match(modelTargetId(model), /^[0-9a-f]{12}$/);
});

console.log("\nthe check itself");

await test("a check asks the model it was pointed at, not the fallback chain", () => {
  const health = read("lib/modelHealth.ts");
  assert.match(
    health,
    /getProviders\(mode\)\.find\(\(provider\) => modelTargetId\(provider\.model\) === id\)/,
    "the probe cannot tell which provider a row refers to"
  );
  // The fallback chain is what made a broken model invisible in the first place:
  // chat silently moves to another model, so the broken one never appears. The
  // probe must therefore talk to the one provider it resolved, never "the next
  // one that answers".
  assert.match(
    health,
    /await fetch\(provider\.url/,
    "the check does not call the provider it resolved"
  );
  assert.match(
    health,
    /const match = getProviders\(mode\)\.find\(/,
    "the check resolves more than one provider"
  );
});

await test("the probe is a real, bounded, vendor-scrubbed request", () => {
  const health = read("lib/modelHealth.ts");
  assert.match(health, /AbortSignal\.timeout\(PROBE_TIMEOUT_MS\)/, "a hanging model would never be reported");
  assert.match(health, /sanitizeIdentity/, "the model's reply is shown without the identity filter");
  assert.match(health, /sanitizeProviderDetail/, "a provider's error text is shown without being scrubbed");
  assert.match(health, /max_tokens/, "the reply is uncapped, so one check can be expensive");
  assert.match(health, /content: PROBE_PROMPT/, "the model is not asked for a comparable answer");
});

await test("an unreachable model is reported, not thrown", async () => {
  await withKeys({ GEMINI_API_KEY: "test-key", OPENROUTER_API_KEY: undefined, GROQ_API_KEY: undefined }, async () => {
    const target = listModelTargets()[0]!;
    // The key is not a real credential, so this cannot succeed. The point is
    // that it comes back as a result an administrator can read.
    const result = await probeModel(target.id);
    assert.equal(result.ok, false, "a check with no usable key reported itself online");
    assert.ok(result.error.length > 0, "a failed check says nothing about why");
    assert.equal(result.reply, "");
  });
});

await test("an id that is not one of ours is refused without a request", async () => {
  await withKeys({ GEMINI_API_KEY: "test-key", OPENROUTER_API_KEY: undefined, GROQ_API_KEY: undefined }, async () => {
    const result = await probeModel("not-a-model");
    assert.equal(result.ok, false);
    assert.match(result.error, /not configured/);
  });
});

console.log("\nonly the administrator can run a check");

await test("both admin model operations go through the administrator gate", () => {
  const route = read("app/api/admin/models/route.ts");
  const gates = route.match(/requireAdmin\(req\.headers\)/g) ?? [];
  assert.equal(gates.length, 2, "listing and checking must each be gated");
  assert.ok(!/isAdmin|verifyCaller/.test(route), "the route decides who is the administrator on its own");
});

await test("a check costs provider quota, so it is rate limited separately", () => {
  const route = read("app/api/admin/models/route.ts");
  assert.match(route, /PROBE_MIN_INTERVAL_MS/, "an unlimited button drains the deployment's quota");
  // The chat's own limits must not apply here, or testing models could lock the
  // administrator out of the console.
  assert.ok(!/consumeUsage|checkRateLimit|identityGate/.test(route), "a model check is counted as a chat message");
});

await test("only a hash can be sent as a model id", () => {
  const route = read("app/api/admin/models/route.ts");
  assert.match(
    route,
    /\^\[0-9a-f\]\{6,64\}\$/,
    "the id is not shape-checked, so a caller could aim a request at anything"
  );
});

console.log("\nwhat the administrator sees");

await test("every model has its own button and its own answer", () => {
  const panel = read("components/ModelHealth.tsx");
  assert.match(panel, /models\.map\(/, "the panel does not render a row per model");
  assert.match(panel, /onTest/, "a row has no button of its own");
  assert.match(panel, /Online/, "a successful check is not shown as online");
  assert.match(panel, /Offline/, "a failed check is not shown as offline");
  assert.match(panel, /\{result\.reply\}/, "the model's own words are not shown, so the check cannot be verified");
  assert.match(panel, /runCheck\(model\)/, "the button does not test the model on its own row");
});

await test("the panel is part of the admin console", () => {
  const admin = read("components/AdminPanel.tsx");
  assert.match(admin, /ModelHealthSection/, "the health section is not mounted in the console");
});

await test("no provider name reaches the panel", () => {
  const panel = read("components/ModelHealth.tsx");
  for (const word of ["gemini", "openrouter", "groq", "gpt-", "llama"]) {
    assert.ok(!panel.toLowerCase().includes(word), `components/ModelHealth.tsx mentions "${word}"`);
  }
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
}

void main().then(() => {
  process.exit(failures === 0 ? 0 : 1);
});
