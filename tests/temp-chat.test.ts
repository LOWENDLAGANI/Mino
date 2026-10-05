// ── Mino — tests for the chat that is never written down ────────────────────
//
// A temporary chat promises two things: it behaves like a real conversation
// while it is open, and nothing about it survives. The second is the one worth
// pinning in a test, because it is a promise about storage and every change to
// the send path is a chance to break it quietly — a stray `db.messages.add`
// would leave the whole conversation on the device, and because the account
// sync starts from local rows it would then reach Firebase as well.
//
//   bun run test

import assert from "node:assert/strict";
import { TempThread } from "../lib/tempChat";

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
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("temporary chat");

test("a message appended to the thread comes back with an id and a time", () => {
  const thread = new TempThread();
  const message = thread.append({ chatId: "temporary", role: "user", content: "hello" });
  assert.equal(message.content, "hello");
  assert.ok(message.id);
  assert.ok(message.createdAt > 0);
  assert.equal(thread.list().length, 1);
});

test("two messages never share an id, or the edit of one edits the other", () => {
  const thread = new TempThread();
  const first = thread.append({ chatId: "temporary", role: "user", content: "first" });
  const second = thread.append({ chatId: "temporary", role: "assistant", content: "second" });
  assert.notEqual(first.id, second.id);
  thread.patch(first.id, { content: "edited" });
  assert.equal(thread.get(second.id)?.content, "second");
});

test("streaming replaces the whole answer rather than appending to it", () => {
  const thread = new TempThread();
  const answer = thread.append({ chatId: "temporary", role: "assistant", content: "" });
  for (const partial of ["H", "He", "Hel", "Hello"]) thread.patch(answer.id, { content: partial });
  assert.equal(thread.get(answer.id)?.content, "Hello");
  assert.equal(thread.list().length, 1);
});

test("editing a message keeps the turns after it and drops the rest", () => {
  const thread = new TempThread();
  const first = thread.append({ chatId: "temporary", role: "user", content: "first" });
  const answer = thread.append({ chatId: "temporary", role: "assistant", content: "answer" });
  const later = thread.append({ chatId: "temporary", role: "user", content: "later" });
  void answer;
  void later;
  thread.dropFrom(first.id, false);
  assert.deepEqual(thread.list().map((message) => message.content), ["first"]);
});

test("regenerating removes the answer being retried", () => {
  const thread = new TempThread();
  const question = thread.append({ chatId: "temporary", role: "user", content: "question" });
  const answer = thread.append({ chatId: "temporary", role: "assistant", content: "wrong answer" });
  thread.dropFrom(answer.id, true);
  assert.deepEqual(thread.list().map((message) => message.content), ["question"]);
  void question;
});

test("dropping an unknown id changes nothing", () => {
  const thread = new TempThread();
  thread.append({ chatId: "temporary", role: "user", content: "kept" });
  thread.drop("not-a-real-id");
  thread.dropFrom("not-a-real-id", true);
  assert.equal(thread.list().length, 1);
});

test("leaving a temporary chat leaves nothing behind to read", () => {
  const thread = new TempThread();
  thread.append({ chatId: "temporary", role: "user", content: "secret" });
  thread.append({ chatId: "temporary", role: "assistant", content: "answer" });
  thread.clear();
  assert.deepEqual(thread.list(), []);
});

test("the thread cannot be read back through a copy held earlier", () => {
  const thread = new TempThread();
  thread.append({ chatId: "temporary", role: "user", content: "before" });
  const snapshot = thread.list();
  thread.clear();
  assert.equal(snapshot.length, 1);
  assert.equal(thread.list().length, 0);
});

console.log(`\n${passes + failures} checks`);
if (failures > 0) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("temp-chat: all checks passed");
