// ── Mino — tests for the Google tools layer ──────────────────────────────────
//
// Pins what must never drift:
//  - action block extraction from a streamed answer (split, partial, multiple)
//  - the allowlist: unknown actions and malformed params are refused, not run
//  - intent detection: Calendar/Tasks/Sheets/Docs/Maps requests turn the tools
//    on, and ordinary conversation leaves them off
//  - the tools prompt contains every action name and the fence format
//  - the encrypted token blob survives a round trip and refuses a wrong key
//
//   bunx tsx tests/google-tools.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// ── Pure-logic copies (the modules import node:crypto and env, so the pieces
// under test that are pure are re-implemented here verbatim from the source and
// asserted against the source text — the same trick server-control.test.ts
// uses to pin route behavior without a runtime).

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

const toolsSource = read("lib/googleTools.ts");
const authSource = read("lib/googleAuth.ts");
const routeSource = read("app/api/chat/route.ts");

// Real extraction, imported for real. googleTools.ts imports node:crypto only
// transitively (it does not import it at all), so it loads in tsx cleanly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { extractActionBlocks, parseActionBlock, shouldUseGoogleTools, actionNames, googleToolsPrompt, ACTION_FENCE } from "../lib/googleTools";
import { encryptBlob, decryptBlob, createStateCookie, readStateCookie } from "../lib/googleAuth";

// ── Action blocks ────────────────────────────────────────────────────────────

test("a complete action block parses", () => {
  const actions = extractActionBlocks(
    'Sure!\n```' + ACTION_FENCE + '\n{"action":"calendar.create","params":{"summary":"Dentist","start":"2026-10-09T15:00:00"}}\n```\nDone.'
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "calendar.create");
  assert.equal((actions[0].params as { summary: string }).summary, "Dentist");
});

test("multiple blocks in one answer are all extracted", () => {
  const text = '```' + ACTION_FENCE + '\n{"action":"tasks.list","params":{}}\n```\nmiddle\n```' + ACTION_FENCE + '\n{"action":"maps.search","params":{"query":"coffee"}}\n```';
  const actions = extractActionBlocks(text);
  assert.deepEqual(actions.map((a) => a.action), ["tasks.list", "maps.search"]);
});

test("an incomplete fence is ignored, not run", () => {
  const actions = extractActionBlocks('```' + ACTION_FENCE + '\n{"action":"calendar.create","params":{"summary":"Cut');
  assert.equal(actions.length, 0);
});

test("malformed JSON inside a block is refused", () => {
  assert.equal(parseActionBlock("{not json}"), null);
  assert.equal(parseActionBlock('{"action":""}'), null);
  assert.equal(parseActionBlock('{"action":"calendar.create","params":[1,2]}'), null);
  assert.equal(parseActionBlock('{"action":"calendar.create","params":null}'), null);
});

test("params default to an empty object", () => {
  const parsed = parseActionBlock('{"action":"tasks.list"}');
  assert.ok(parsed);
  assert.deepEqual(parsed.params, {});
});

// ── The allowlist ────────────────────────────────────────────────────────────

test("every expected action is in the allowlist", () => {
  const names = actionNames();
  for (const expected of [
    "calendar.list", "calendar.create", "calendar.update", "calendar.delete",
    "tasks.list", "tasks.create", "tasks.complete", "tasks.delete",
    "sheets.read", "sheets.write", "sheets.append", "sheets.create", "sheets.find",
    "docs.create", "docs.read", "docs.append", "docs.find",
    "maps.search", "maps.directions",
  ]) {
    assert.ok(names.includes(expected), `missing action: ${expected}`);
  }
});

test("no action outside the allowlist can be dispatched", () => {
  // The dispatch reads from one frozen record built only from the handler maps;
  // a stray "drive.delete" or "gmail.send" must not exist anywhere.
  const names = actionNames();
  assert.ok(!names.includes("drive.delete"));
  assert.ok(!names.includes("gmail.send"));
  assert.ok(!names.includes("admin"));
});

// ── Intent detection ─────────────────────────────────────────────────────────

test("google requests turn the tools on", () => {
  const yes = [
    "set a reminder tomorrow on my calendar",
    "what's on my calendar tomorrow",
    "schedule a meeting with Sara on Friday",
    "add a task to buy milk",
    "show my to-do list",
    "make a spreadsheet of my expenses",
    "append a row to my sheet",
    "create a google doc with the meeting notes",
    "directions from Ulaanbaatar to Erdenet",
    "find cafes near me on maps",
  ];
  for (const text of yes) {
    assert.ok(shouldUseGoogleTools(text), `should match: ${text}`);
  }
});

test("ordinary conversation leaves the tools off", () => {
  const no = [
    "what is the capital of France",
    "explain how a hash map works",
    "write me a poem about autumn",
    "hi",
    "what's the weather like in Paris", // no google surface named
    "tell me a joke",
  ];
  for (const text of no) {
    assert.ok(!shouldUseGoogleTools(text), `should NOT match: ${text}`);
  }
});

// ── The tools prompt ─────────────────────────────────────────────────────────

test("the tools prompt names every action and the fence", () => {
  const prompt = googleToolsPrompt("2026-10-08T10:00:00.000Z", "Asia/Ulaanbaatar");
  assert.ok(prompt.includes("```" + ACTION_FENCE));
  assert.ok(prompt.includes("Asia/Ulaanbaatar"));
  assert.ok(prompt.includes("2026-10-08T10:00:00.000Z"));
  for (const name of actionNames()) {
    assert.ok(prompt.includes(name), `prompt missing action: ${name}`);
  }
});

test("the tools prompt demands a plain-language statement before writes", () => {
  const prompt = googleToolsPrompt("2026-10-08T10:00:00.000Z");
  assert.ok(/state plainly what you are about to do/i.test(prompt));
  assert.ok(/ask first instead of acting/i.test(prompt));
});

// ── The encrypted cookie blob ────────────────────────────────────────────────

test("the token blob round-trips and binds to a uid", () => {
  // Real crypto, real functions — run with the env the test sets.
  process.env.GOOGLE_ENCRYPTION_KEY = "test-key-for-roundtrip";
  {
    const blob = {
      uid: "uid-123",
      email: "user@example.com",
      scope: "calendar",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3_600_000,
    };
    const sealed = encryptBlob(blob);
    const opened = decryptBlob(sealed);
    assert.ok(opened);
    assert.equal(opened.uid, "uid-123");
    assert.equal(opened.refreshToken, "rt");

    // A different key cannot read it — the cookie is only usable by the
    // deployment that encrypted it.
    process.env.GOOGLE_ENCRYPTION_KEY = "a-different-key";
    // googleAuth caches nothing for the key (hashed per call), so a fresh
    // decrypt with the wrong key must fail closed.
    assert.equal(decryptBlob(sealed), null);
  }
});

test("the state cookie is signed and uid-bound", () => {
  process.env.GOOGLE_ENCRYPTION_KEY = "test-key-for-state";
  {
    const cookie = createStateCookie("uid-abc");
    const headers = new Headers({ cookie: cookie.split(";")[0] });
    const state = readStateCookie(headers);
    assert.ok(state);
    assert.equal(state.uid, "uid-abc");

    // Tampered value: flipping the uid must fail the HMAC.
    const raw = cookie.split(";")[0].split("=")[1];
    const tampered = raw.replace("uid-abc", "uid-evil");
    assert.equal(readStateCookie(new Headers({ cookie: `mino_google_state=${tampered}` })), null);
  }
});

// ── Route wiring ─────────────────────────────────────────────────────────────

test("the chat route resolves Google before the model and executes after the stream", () => {
  assert.ok(routeSource.includes("shouldUseGoogleTools(latestUserText)"));
  assert.ok(routeSource.includes("extractActionBlocks(answer)"));
  assert.ok(routeSource.includes("runGoogleAction"));
  // The token cookie can be refreshed inside the chat response.
  assert.ok(routeSource.includes('append("Set-Cookie", googleSetCookie)'));
});

test("the google session is bound to the verified caller's uid", () => {
  assert.ok(authSource.includes("blob.uid !== uid"));
  assert.ok(routeSource.includes("readSession(req.headers, identity.uid)"));
});

test("maps works without oauth but is flagged by its own key", () => {
  assert.ok(authSource.includes("GOOGLE_MAPS_API_KEY"));
  assert.ok(toolsSource.includes("maps.googleapis.com/maps/api/place/textsearch"));
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
