// ── Mino — tests for a silently truncated answer ─────────────────────────────
//
// A response that stops at the model's length limit is the one failure mode
// that looks like success. It renders as a clean code block, copies as a clean
// code block, and a user has no way to tell the file is half a file. These pin
// the detection and, just as importantly, pin that Mino is not the thing
// shortening the answer itself.
//
//   bun run test

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

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

/** The same hold-back filter the route uses, minus the identity rewrites. */
class IdentityFilter {
  private carry = "";
  private readonly hold: number;
  constructor(hold = 64) {
    this.hold = hold;
  }
  push(delta: string): string {
    this.carry += delta;
    if (this.carry.length <= this.hold) return "";
    let cut = this.carry.length - this.hold;
    const breakAt = Math.max(
      this.carry.lastIndexOf(" ", cut),
      this.carry.lastIndexOf("\n", cut)
    );
    if (breakAt >= 0) cut = breakAt + 1;
    else if (this.carry.length > this.hold * 3) cut = this.carry.length;
    else return "";
    const safe = this.carry.slice(0, cut);
    this.carry = this.carry.slice(cut);
    return safe;
  }
  flush(): string {
    const rest = this.carry;
    this.carry = "";
    return rest;
  }
}

console.log("\nrecognising a cut-off answer");

test("the route reads the reason the model stopped", () => {
  const route = read("app/api/chat/route.ts");
  assert.match(
    route,
    /finish_reason\s*===\s*["']length["']/,
    "app/api/chat/route.ts never notices a length-truncated answer"
  );
  assert.match(
    route,
    /encodeEvent\(\{\s*truncated:\s*true\s*\}\)/,
    "a truncated answer is detected but never reported to the client"
  );
});

test("the client stores the flag on the message", () => {
  const page = read("app/page.tsx");
  assert.match(page, /evt\.truncated/, "the client ignores the truncated event");
  assert.match(
    page,
    /truncated:\s*true/,
    "the flag is not persisted, so it is lost on reload"
  );
});

test("the thread says so rather than showing half an answer as finished", () => {
  const thread = read("components/ChatThread.tsx");
  assert.match(thread, /msg\.truncated/, "a truncated answer is rendered as complete");
});

test("the message type can carry the flag", () => {
  const types = read("lib/types.ts");
  assert.match(types, /truncated\?:\s*boolean/, "ChatMessage has nowhere to record it");
});

console.log("\nfinishing a cut-off answer on another model");

test("a length cutoff no longer ends the answer", () => {
  // The flag is collected, not reported: reporting it the moment the model stops
  // would tell the user the answer is cut off while Mino is still completing it
  // on the next model.
  const route = read("app/api/chat/route.ts");
  assert.match(
    route,
    /finish_reason\s*===\s*["']length["']\s*\)\s*\{\s*\n\s*truncated\s*=\s*true/,
    "the cutoff is not captured for the continuation decision"
  );
  assert.ok(
    !/finish_reason\s*===\s*["']length["']\s*\)\s*\{[\s\S]{0,120}encodeEvent\(\{\s*truncated/.test(route),
    "the cutoff is still reported to the client before Mino tries another model"
  );
});

test("another model is asked to carry on from the partial text", () => {
  const route = read("app/api/chat/route.ts");
  assert.match(
    route,
    /continuationMessages\(\s*messages,\s*answer\s*\)/,
    "the follow-up model is not given what has already been written"
  );
  assert.match(
    route,
    /\.\.\.messages,[\s\S]{0,120}role:\s*["']assistant["'],\s*content:\s*partial/,
    "the conversation sent to the next model carries no partial answer"
  );
  assert.match(
    route,
    /Continue that same answer from exactly where it stopped/,
    "the next model is not told to continue rather than restart"
  );
});

test("the model that finishes the answer is the one that is named", () => {
  // A message that began on one model and ended on another must not be labelled
  // with the model that produced the part the user never saw.
  const route = read("app/api/chat/route.ts");
  assert.match(
    route,
    /attemptProvider\s*=\s*next;[\s\S]{0,400}getModelDisplayName\(toMinoName\(next\.model\)\)/,
    "the label is never updated when the answer moves to another model"
  );
});

test("each model is tried once, and the search is bounded", () => {
  const route = read("app/api/chat/route.ts");
  assert.match(
    route,
    /const\s+MAX_CONTINUATION_ATTEMPTS\s*=\s*2/,
    "the number of continuation attempts is not pinned"
  );
  assert.match(
    route,
    /attempted\.add\(next\)/,
    "a model can be asked to continue the same answer twice"
  );
  assert.match(
    route,
    /attempt\s*>=\s*MAX_CONTINUATION_ATTEMPTS\s*\|\|\s*!next/,
    "the continuation loop is not bounded by the attempt ceiling"
  );
});

test("the cutoff is only announced once no model could finish the answer", () => {
  const route = read("app/api/chat/route.ts");
  assert.match(
    route,
    /if \(truncated\) controller\.enqueue\(encodeEvent\(\{ truncated: true \}\)\);/,
    "the cut-off notice is not sent after the last attempt"
  );
});

console.log("\nMino is not the thing shortening the answer");

test("no output cap is sent to the provider", () => {
  // A cap here would be a legitimate design choice, but it must be deliberate
  // and visible — an accidental one is indistinguishable from a model that ran
  // out of room, and the user is told the wrong thing.
  const route = read("app/api/chat/route.ts");
  assert.ok(
    !/max_tokens|maxOutputTokens|max_output_tokens/.test(route),
    "the chat route sets an output cap that silently shortens answers"
  );
});

test("the request is never aborted part-way through a stream", () => {
  const route = read("app/api/chat/route.ts");
  assert.ok(
    !/setTimeout|AbortSignal\.timeout/.test(route),
    "a timeout in the chat route would cut long answers short"
  );
});

test("the streaming filter is lossless", () => {
  // The filter holds characters back so a vendor phrase split across two deltas
  // can be rewritten whole. Holding back is only safe if nothing is ever held
  // back for good, which is what flush() on the way out guarantees.
  const cases: Array<[string, string, number[]]> = [
    ["prose", "A sentence, then another one, and a conclusion that arrives later on.", [4]],
    ["code", "```ts src/a.ts\nexport const a = 1;\n```\n", [1]],
    ["no whitespace", "x".repeat(4000), [3]],
    ["one long token", "a".repeat(3000), [1]],
    ["ragged deltas", "const x = 1;\nconst y = 2;\nconst z = 3;", [1, 17, 3, 64, 2]],
  ];
  for (const [name, full, sizes] of cases) {
    const filter = new IdentityFilter();
    let out = "";
    let i = 0;
    let k = 0;
    while (i < full.length) {
      const size = sizes[k++ % sizes.length];
      out += filter.push(full.slice(i, i + size));
      i += size;
    }
    out += filter.flush();
    assert.equal(out, full, `the filter lost characters on ${name}`);
  }
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
