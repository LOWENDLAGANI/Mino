// ── Space prompt shaping ────────────────────────────────────────────────────
// The Space takes one string, so the conversation is flattened before it is
// sent. Getting this wrong is silent — the model simply answers something
// unrelated — which is why the shape is pinned here rather than eyeballed.

import { toSpacePrompt } from "../lib/gradioSpace";

let passed = 0;
let failed = 0;

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

console.log("space prompt");

test("the system prompt leads, labelled, so the model still gets the persona", () => {
  const prompt = toSpacePrompt("You are Mino.", [{ role: "user", content: "hi" }]);
  assert(prompt.startsWith("System: You are Mino."), `got: ${prompt.slice(0, 40)}`);
});

test("turns are labelled by speaker and kept in order", () => {
  const prompt = toSpacePrompt("sys", [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "user", content: "third" },
  ]);
  const user = prompt.indexOf("User: first");
  const assistant = prompt.indexOf("Assistant: second");
  const last = prompt.indexOf("User: third");
  assert(user !== -1 && assistant !== -1 && last !== -1, "every turn is present");
  assert(user < assistant && assistant < last, "order is preserved");
});

test("an assistant turn is not labelled as the user", () => {
  const prompt = toSpacePrompt("sys", [{ role: "assistant", content: "answer" }]);
  assert(!prompt.includes("User: answer"), "assistant text is not attributed to the user");
});

test("multimodal parts contribute their text rather than becoming [object Object]", () => {
  const prompt = toSpacePrompt("sys", [
    {
      role: "user",
      content: [
        { type: "text", text: "describe this" },
        { type: "image_url", image_url: { url: "https://example.com/a.png" } },
      ],
    },
  ]);
  assert(prompt.includes("describe this"), "text survives");
  assert(!prompt.includes("[object Object]"), "nothing is stringified into nonsense");
  assert(prompt.includes("[attachment]"), "the image is noted rather than dropped silently");
});

test("empty turns are dropped instead of sending blank lines", () => {
  const prompt = toSpacePrompt("sys", [
    { role: "user", content: "   " },
    { role: "user", content: "real question" },
  ]);
  assert(!prompt.includes("User:  "), "no blank turn");
  assert(prompt.includes("real question"), "the real turn is kept");
});

test("an absent system prompt still yields a usable transcript", () => {
  const prompt = toSpacePrompt("", [{ role: "user", content: "hello" }]);
  assert(prompt.includes("hello"), "the turn is there");
});

console.log(`\nspace prompt: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);