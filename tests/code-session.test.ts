// ── Mino — tests for the code-session primitives ─────────────────────────────
//
// The diff and the response parser are the two places where a subtle mistake is
// invisible until it has already corrupted a user's file, so they are covered
// here rather than left to inspection. The runner is a few lines of `node:assert`
// rather than a test framework: this project has no test dependency, and adding
// one to check pure functions would cost more than it returns.
//
//   bun run test

import assert from "node:assert/strict";
import { diffLines, toHunks, diffStats, languageFromPath, shortPath } from "../lib/diff";
import { parseResponse, filesToAttachmentBlock } from "../lib/codeSession";
import { resolveFile, derivePending } from "../lib/workspace";

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

const BASE = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
const MID_EDIT = "1\n2\n3\n4\nX\n6\n7\n8\n9\n10\n";

// Two edits far enough apart (lines 2 and 19) that 3 lines of context cannot
// bridge them, so they must be reviewable as two separate hunks. This is the
// same length as its base — a differing length would be an append, not a pair
// of edits, and the test would pass for the wrong reason.
const LONG_BASE = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19\n20\n";
const TWO_EDITS = "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\nY\n20\n";

console.log("\ndiff");

test("identical files produce no hunks", () => {
  assert.equal(toHunks(diffLines("a\nb\nc\n", "a\nb\nc\n")).length, 0);
});

test("a single mid-file edit is one hunk", () => {
  assert.equal(toHunks(diffLines(BASE, MID_EDIT)).length, 1);
});

test("added and removed lines are counted", () => {
  const stats = diffStats(toHunks(diffLines(BASE, MID_EDIT)));
  assert.deepEqual(stats, { added: 1, removed: 1, hunks: 1 });
});

test("distant edits become separate hunks", () => {
  const hunks = toHunks(diffLines(LONG_BASE, TWO_EDITS));
  assert.equal(hunks.length, 2);
  assert.equal(diffStats(hunks).added, 2);
});

test("a new file is entirely additions", () => {
  const hunks = toHunks(diffLines("", "hello\nworld\n"));
  assert.equal(hunks.length, 1);
  assert.ok(hunks[0]!.lines.every((line) => line.kind === "add"));
});

test("a deletion registers as a removal, not an addition", () => {
  const stats = diffStats(toHunks(diffLines("a\nb\nc\n", "a\nc\n")));
  assert.equal(stats.removed, 1);
  assert.equal(stats.added, 0);
});

test("line numbers are assigned on the side a line belongs to", () => {
  const added = diffLines("a\nb\n", "a\nB\n").find((line) => line.kind === "add");
  assert.equal(added?.newLine, 2);
  assert.equal(added?.oldLine, undefined);
});

console.log("\nresolving decisions");

test("no decisions means the proposal is taken as written", () => {
  assert.equal(resolveFile("a\nb\nc\n", "a\nX\nc\n", {}), "a\nb\nc\n");
});

test("rejecting every hunk restores the original bytes exactly", () => {
  assert.equal(resolveFile("a\nb\nc\n", "a\nX\nc\n", { "hunk-1": false }), "a\nX\nc\n");
});

test("rejecting one hunk of two leaves the other applied", () => {
  const hunks = toHunks(diffLines(LONG_BASE, TWO_EDITS));
  const mixed = resolveFile(TWO_EDITS, LONG_BASE, { [hunks[0]!.id]: false });
  // The first edit is undone, the second survives.
  assert.equal(mixed, "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\nY\n20\n");
});

test("an unchanged proposal resolves to itself", () => {
  assert.equal(resolveFile("a\nb\n", "a\nb\n", {}), "a\nb\n");
});

console.log("\nresponse parsing");

const RESPONSE = [
  "### Plan",
  "- Read the current route handler",
  "- Add the retry to the provider loop",
  "",
  "I tightened the provider fallback.",
  "",
  "```ts src/lib/thing.ts",
  "export const a = 1;",
  "export const b = 2;",
  "```",
].join("\n");

test("a fence naming a path becomes a file", () => {
  const parsed = parseResponse(RESPONSE);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0]!.path, "src/lib/thing.ts");
  assert.equal(parsed.files[0]!.language, "ts");
});

test("file contents and line count survive a multi-line fence", () => {
  const file = parseResponse(RESPONSE).files[0]!;
  assert.equal(file.content, "export const a = 1;\nexport const b = 2;");
  assert.equal(file.lines, 2);
});

test("a bare language fence is an example, not a change", () => {
  assert.equal(parseResponse("Example:\n\n```ts\nconst x = 1;\n```").files.length, 0);
});

test("a shell command fence is not a change", () => {
  assert.equal(parseResponse("```bash\nnpm run build\n```").files.length, 0);
});

test("lang:path and path-lang forms are both understood", () => {
  const colon = parseResponse("```typescript:app/page.tsx\nconst a = 1;\n```");
  assert.equal(colon.files[0]!.path, "app/page.tsx");
  const reversed = parseResponse("```tsx app/page.tsx\nconst a = 1;\n```");
  assert.equal(reversed.files[0]!.path, "app/page.tsx");
  assert.equal(reversed.files[0]!.language, "tsx");
});

test("several files in one response are all found", () => {
  const parsed = parseResponse("```ts a.ts\nA\n```\ntext\n```py b.py\nB\n```");
  assert.deepEqual(parsed.files.map((file) => file.path), ["a.ts", "b.py"]);
});

test("a plan heading yields ordered steps", () => {
  const steps = parseResponse(RESPONSE).steps;
  assert.equal(steps.length, 2);
  assert.equal(steps[0]!.label, "Read the current route handler");
});

test("a plan stops at the next heading", () => {
  const parsed = parseResponse("### Plan\n- one\n\n## Result\n- not a step");
  assert.deepEqual(parsed.steps.map((step) => step.label), ["one"]);
});

test("a fenced plan block is also read", () => {
  const parsed = parseResponse("```plan\n- one\n- two\n```\n\nAnswer.");
  assert.equal(parsed.steps.length, 2);
});

test("empty and file-free responses are safe", () => {
  assert.equal(parseResponse("").files.length, 0);
  assert.equal(parseResponse("Just prose.").files.length, 0);
});

test("an unterminated fence does not swallow the rest of the response", () => {
  const parsed = parseResponse("```ts src/a.ts\nconst a = 1;\nmore text");
  assert.equal(parsed.files.length, 1);
  assert.ok(parsed.files[0]!.content.includes("more text"));
});

test("attachments re-wrap files in the same named-fence grammar", () => {
  const block = filesToAttachmentBlock(parseResponse(RESPONSE).files);
  assert.ok(block.includes("```ts src/lib/thing.ts"));
});

console.log("\nprose and files are separate");

test("the file block is removed from the prose", () => {
  const parsed = parseResponse(RESPONSE);
  assert.ok(!parsed.prose.includes("```"));
  assert.ok(!parsed.prose.includes("export const a = 1;"));
});

test("the surrounding prose survives intact", () => {
  const parsed = parseResponse(RESPONSE);
  assert.ok(parsed.prose.includes("I tightened the provider fallback."));
  assert.ok(parsed.prose.includes("### Plan"));
  assert.ok(parsed.prose.includes("Read the current route handler"));
});

test("removing a file leaves no gap of blank lines", () => {
  const parsed = parseResponse(RESPONSE);
  assert.ok(!/\n{3,}/.test(parsed.prose));
});

test("a prose-only response is returned unchanged", () => {
  const parsed = parseResponse("Just an explanation, no files.");
  assert.equal(parsed.prose, "Just an explanation, no files.");
});

test("a non-file code block stays in the prose", () => {
  const parsed = parseResponse("Here is the pattern:\n\n```ts\nconst x = 1;\n```");
  assert.ok(parsed.prose.includes("const x = 1;"));
  assert.equal(parsed.files.length, 0);
});

test("every file is removed when several are present", () => {
  const parsed = parseResponse("Intro\n\n```ts a.ts\nAAA\n```\n\nMiddle\n\n```py b.py\nBBB\n```\n\nOutro");
  assert.equal(parsed.files.length, 2);
  assert.ok(!parsed.prose.includes("AAA"));
  assert.ok(!parsed.prose.includes("BBB"));
  assert.ok(parsed.prose.includes("Intro"));
  assert.ok(parsed.prose.includes("Middle"));
  assert.ok(parsed.prose.includes("Outro"));
});

test("prose and files never disagree about file count", () => {
  const parsed = parseResponse(RESPONSE);
  const fencesInProse = (parsed.prose.match(/^```/gm) ?? []).length;
  assert.equal(fencesInProse + parsed.files.length, 1);
});

console.log("\npaths");

test("languages are inferred from extensions", () => {
  assert.equal(languageFromPath("a/b.tsx"), "tsx");
  assert.equal(languageFromPath("a/b.py"), "python");
  assert.equal(languageFromPath("Makefile"), "text");
});

test("long paths are shortened to their last two segments", () => {
  assert.equal(shortPath("a/b/c/d.ts"), "…/c/d.ts");
  assert.equal(shortPath("a/b.ts"), "a/b.ts");
});

console.log("\nsession review state");

const fileMsg = (id: string, at: number, path: string, content: string, decisions?: Record<string, boolean>) => ({
  id,
  createdAt: at,
  files: [{ path, language: "ts", content, lines: content.split("\n").length, decisions }],
});

test("a proposal is diffed against nothing when the file is new", () => {
  const pending = derivePending([fileMsg("m1", 1, "a.ts", "one\ntwo\n")]);
  assert.equal(pending["m1"]!.length, 1);
  assert.equal(pending["m1"]![0]!.base, null);
});

test("a second proposal to the same file is diffed against the FIRST accepted state", () => {
  // This is the regression the derivation exists to prevent. Diffing either
  // message against the FINAL state would report no change, because the final
  // state already contains the proposal being diffed.
  const pending = derivePending([
    fileMsg("m1", 1, "a.ts", "one\ntwo\n"),
    fileMsg("m2", 2, "a.ts", "one\nTWO\n"),
  ]);
  assert.equal(pending["m1"]![0]!.base, null);
  assert.equal(pending["m2"]![0]!.base, "one\ntwo\n");
});

test("a proposal really is a change when derived, not 'no change'", () => {
  const pending = derivePending([fileMsg("m1", 1, "a.ts", "one\ntwo\n")]);
  const hunks = toHunks(diffLines(pending["m1"]![0]!.base ?? "", pending["m1"]![0]!.proposed));
  assert.ok(hunks.length > 0, "a new file must produce a diff");
});

test("an earlier proposal is not retroactively diffed against a later one", () => {
  const pending = derivePending([
    fileMsg("m1", 1, "a.ts", "one\ntwo\n"),
    fileMsg("m2", 2, "a.ts", "one\nTWO\n"),
  ]);
  // m1's own content must be untouched by what came after it.
  assert.equal(pending["m1"]![0]!.proposed, "one\ntwo\n");
  assert.equal(pending["m2"]![0]!.proposed, "one\nTWO\n");
});

test("stored decisions are carried into the rebuilt review state", () => {
  const pending = derivePending([
    fileMsg("m1", 1, "a.ts", "one\ntwo\n"),
    fileMsg("m2", 2, "a.ts", "one\nTWO\n", { "hunk-1": false }),
  ]);
  assert.equal(pending["m2"]![0]!.decisions["hunk-1"], false);
});

test("a rejected hunk changes the base the next proposal is diffed against", () => {
  const pending = derivePending([
    fileMsg("m1", 1, "a.ts", "one\ntwo\n"),
    // m2 changes line 2 and is rejected, so the workspace keeps "two".
    fileMsg("m2", 2, "a.ts", "one\nTWO\n", { "hunk-1": false }),
    fileMsg("m3", 3, "a.ts", "one\ntwo\nthree\n"),
  ]);
  assert.equal(pending["m3"]![0]!.base, "one\ntwo\n");
});

test("messages without files are skipped", () => {
  const pending = derivePending([
    { id: "m1", createdAt: 1, files: undefined },
    fileMsg("m2", 2, "a.ts", "one\n"),
  ]);
  assert.equal(pending["m1"], undefined);
  assert.equal(Object.keys(pending).length, 1);
});

test("an empty session yields no review state", () => {
  assert.deepEqual(derivePending([]), {});
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
