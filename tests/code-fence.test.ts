// ── Mino — tests for the code fence label ───────────────────────────────────
//
// This decides whether a code block is labelled with a file name or just a
// language. Getting it wrong is quiet and ugly: a path read as a language gives
// broken highlighting, and a language read as a path puts "ts" above the block as
// though it were a filename. Both look plausible and neither is right, so the
// rule is pinned down here.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFenceInfo } from "../lib/codeFence";
import { getModelDisplayName } from "../lib/models";
import { toMinoName } from "../lib/modelEngines";

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

console.log("\nnamed files");

test("a language and a path give both", () => {
  assert.deepEqual(parseFenceInfo("ts src/lib/thing.ts"), {
    language: "ts",
    path: "src/lib/thing.ts",
  });
});

test("the path may come first", () => {
  assert.deepEqual(parseFenceInfo("src/lib/thing.ts ts"), {
    language: "ts",
    path: "src/lib/thing.ts",
  });
});

test("a colon separator works", () => {
  assert.deepEqual(parseFenceInfo("typescript:app/page.tsx"), {
    language: "typescript",
    path: "app/page.tsx",
  });
});

test("a path on its own has no language", () => {
  assert.deepEqual(parseFenceInfo("src/app/page.tsx"), { language: "", path: "src/app/page.tsx" });
});

test("a bare filename with an extension is a path", () => {
  assert.equal(parseFenceInfo("index.html").path, "index.html");
});

test("a path with no extension still counts when it has a slash", () => {
  assert.equal(parseFenceInfo("src/Makefile").path, "src/Makefile");
});

console.log("\nordinary code blocks");

test("a plain language is not treated as a file name", () => {
  assert.deepEqual(parseFenceInfo("ts"), { language: "ts", path: null });
});

test("a shell fence is not treated as a file name", () => {
  assert.deepEqual(parseFenceInfo("bash"), { language: "bash", path: null });
});

test("an empty fence is safe", () => {
  assert.deepEqual(parseFenceInfo(""), { language: "", path: null });
});

test("whitespace-only is safe", () => {
  assert.deepEqual(parseFenceInfo("   "), { language: "", path: null });
});

test("c# and other punctuated languages survive", () => {
  assert.deepEqual(parseFenceInfo("c#"), { language: "c#", path: null });
});

console.log("\nmodel names");

test("each wire model maps to a Mino name", () => {
  assert.equal(toMinoName("gemini-3.6-flash"), "Mino V1");
  assert.equal(toMinoName("gemini-3.7-flash"), "Mino V2");
  assert.equal(toMinoName("gemini-3.8-flash"), "Mino V3");
});

test("the router and image engine keep their own names", () => {
  assert.equal(toMinoName("openrouter/auto"), "Mino Auto");
  assert.equal(toMinoName("mino-canvas"), "Mino Canvas");
});

test("a wire id never becomes the wire id", () => {
  const inputs = [
    undefined,
    "",
    "gemini-3.9-flash",
    "gemini-exp-1206",
    "gpt-4",
    "claude-3-5-sonnet",
    "llama-3.3-70b-versatile",
    "some-unknown-model",
  ];
  for (const input of inputs) {
    const name = toMinoName(input);
    assert.ok(
      name === "Mino" || name.startsWith("Mino "),
      `"${input}" became "${name}", which is not a Mino name`
    );
  }
});

test("a stored Mino name survives display unchanged", () => {
  for (const name of ["Mino V1", "Mino V2", "Mino V3", "Mino Auto", "Mino Canvas"]) {
    assert.equal(getModelDisplayName(name), name);
  }
});

test("a stored provider id from an old backup is not shown", () => {
  // A backup written before the rename carries raw ids. Restoring one must not
  // put a vendor name back on screen.
  assert.equal(getModelDisplayName("gemini-3.8-flash"), "Mino");
  assert.equal(getModelDisplayName(undefined), "Mino");
});

const VENDOR_WORDS = ["gemini", "openrouter", "groq", "gpt-4", "claude", "llama", "deepseek"];

test("no provider name reaches a client module", () => {
  // The reason the catalog, the system prompt, and the wire ids are split into
  // server-only modules. Any of these files is compiled into the page bundle, so
  // a provider name written here is a provider name a user can read in the page
  // source — and, for anything stored on a message, in the backup they download.
  const clientModules = ["lib/models.ts", "lib/db.ts", "lib/types.ts"];
  for (const file of clientModules) {
    const source = readFileSync(join(process.cwd(), file), "utf8").toLowerCase();
    for (const word of VENDOR_WORDS) {
      assert.ok(
        !source.includes(word),
        `${file} mentions "${word}", which would reach the client`
      );
    }
  }
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
