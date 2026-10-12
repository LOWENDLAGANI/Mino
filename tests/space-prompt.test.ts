// ── Space prompt shaping ────────────────────────────────────────────────────
// The Space takes one string, so the conversation is flattened before it is
// sent. Getting this wrong is silent — the model simply answers something
// unrelated — which is why the shape is pinned here rather than eyeballed.

import { toSpacePrompt, looksTruncated } from "../lib/gradioSpace";
import { getProviders } from "../lib/providers";

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

console.log("\nthe prompt budget");

test("a short conversation is sent whole", () => {
  const prompt = toSpacePrompt("sys", [{ role: "user", content: "short" }], 500);
  assert(!prompt.includes("omitted"), "nothing is dropped when nothing needs to be");
  assert(prompt.includes("short"), "the turn survives");
});

test("a long conversation drops its oldest turns, not its newest question", () => {
  const long = "x".repeat(400);
  const prompt = toSpacePrompt(
    "sys",
    [
      { role: "user", content: `oldest ${long}` },
      { role: "assistant", content: `middle ${long}` },
      { role: "user", content: "the newest question" },
    ],
    700
  );
  assert(!prompt.includes("oldest"), "the oldest turn is what falls off");
  assert(prompt.includes("the newest question"), "the live question always survives");
  assert(prompt.includes("omitted"), "the loss is stated rather than silent");
  assert(prompt.length <= 700, `prompt is ${prompt.length} chars, over the 700 budget`);
});

test("the persona survives the budget even when every turn is dropped", () => {
  const prompt = toSpacePrompt("you are mino", [{ role: "user", content: "y".repeat(500) }], 200);
  assert(prompt.startsWith("System: you are mino"), "the system prompt leads and is never trimmed");
  assert(prompt.includes("User:"), "the question is still asked, shortened if need be");
});

console.log("\nhonest finish reasons");

test("an unclosed code fence reads as cut off", () => {
  assert(looksTruncated("Here you go:\n```ts\nconst a = 1;\n"), "an open fence cannot be a finished answer");
});

test("a tail that cannot end a sentence reads as cut off", () => {
  assert(looksTruncated("const total = items.reduce((a, b) =>"), "the answer stops mid-expression");
});

test("a finished answer is not mislabelled as broken", () => {
  assert(!looksTruncated("All done. Here is the file."), "a full stop ends an answer");
  assert(!looksTruncated("```ts\nconst a = 1;\n```"), "a closed fence is complete");
  assert(!looksTruncated("Call foo() when you are ready."), "a closing paren ends an answer");
  assert(!looksTruncated(""), "an empty answer is not a truncated one");
});

console.log("\nwhere Mino's own model sits in the fallback chain");

test("Self mode is the Space and nothing else", () => {
  const providers = getProviders("self");
  assert(providers.length === 1, "exactly one provider");
  assert(providers[0].family === "space", "and it is the Space");
});

test("Code mode never silently answers with Mino's own model", () => {
  assert(!getProviders("code").some((p) => p.family === "space"), "Code stays single-family");
});

test("Auto reaches the Space only after every vendor has been tried", () => {
  const providers = getProviders("auto");
  const last = providers[providers.length - 1];
  assert(last?.family === "space", "the Space is the last resort");
  assert(
    providers.filter((p) => p.family === "space").length <= 1,
    "the Space appears at most once, so a cut-off answer can never loop back into it"
  );
});

console.log(`\nspace prompt: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);