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
import { parseFenceInfo } from "../lib/codeFence";

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

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
