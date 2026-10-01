// ── Mino — tests for how two devices' chat histories are merged ─────────────
//
// Chat history is written to the account so it follows the person to another
// browser, and it was failing at exactly that: the data was written correctly
// and then deliberately never read back, so signing in on a computer showed an
// empty list while the phone's conversations sat there unread.
//
// The fix makes the pull a **union**. That is the part worth pinning down,
// because the obvious alternative — remote replaces local — deletes a device's
// conversations on every visit, and it does so quietly, on the visit after the
// person worked.
//
//   bun run test

import assert from "node:assert/strict";
import { parseRemoteChat, planChatMerge } from "../lib/chatSync";
import type { Chat, ChatMessage } from "../lib/types";

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

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    chatId: "c1",
    role: "assistant",
    content: "hello",
    createdAt: 100,
    updatedAt: 100,
    ...over,
  };
}

function chat(over: Partial<Chat> = {}): Chat {
  return { id: "c1", title: "A chat", createdAt: 100, updatedAt: 100, ...over };
}

console.log("\na chat this browser has never seen");

test("is added whole, messages and all", () => {
  const remote = { chat: chat(), messages: [message(), message({ id: "m2", role: "user" })] };
  const merge = planChatMerge(remote, undefined, []);
  assert.equal(merge.addChat, true);
  assert.equal(merge.chatUpdate, null);
  assert.equal(merge.addMessages.length, 2);
  assert.equal(merge.updateMessages.length, 0);
});

console.log("\na chat both devices have");

test("adds only the messages this browser is missing", () => {
  // The phone wrote m1 and m2; this computer has only m1 because it is a
  // different conversation about the same chat.
  const remote = { chat: chat(), messages: [message(), message({ id: "m2", createdAt: 200 })] };
  const merge = planChatMerge(remote, chat(), [message()]);
  assert.equal(merge.addChat, false);
  assert.deepEqual(merge.addMessages.map((m) => m.id), ["m2"]);
  assert.equal(merge.updateMessages.length, 0);
});

test("does not rewrite a message that is already current", () => {
  const remote = { chat: chat({ updatedAt: 500 }), messages: [message({ content: "stale", updatedAt: 100 })] };
  const merge = planChatMerge(remote, chat({ updatedAt: 900 }), [message({ content: "current", updatedAt: 900 })]);
  assert.equal(merge.updateMessages.length, 0);
  assert.equal(merge.chatUpdate, null);
});

test("takes the newer copy of a message that changed elsewhere", () => {
  const remote = { chat: chat({ updatedAt: 500 }), messages: [message({ content: "finished on the phone", updatedAt: 800 })] };
  const merge = planChatMerge(remote, chat({ updatedAt: 500 }), [message({ content: "half a sen", updatedAt: 300 })]);
  assert.equal(merge.addMessages.length, 0);
  assert.equal(merge.updateMessages.length, 1);
  assert.equal(merge.updateMessages[0].changes.content, "finished on the phone");
});

test("an equal timestamp is not a reason to overwrite", () => {
  const remote = { chat: chat({ updatedAt: 500 }), messages: [message({ content: "theirs", updatedAt: 500 })] };
  const merge = planChatMerge(remote, chat({ updatedAt: 500 }), [message({ content: "mine", updatedAt: 500 })]);
  assert.equal(merge.updateMessages.length, 0);
});

test("keeps the attachments the upload never carried", () => {
  // Images, documents and generated images stay local. An overwrite that listed
  // every field would replace a message holding a photo with one that has none,
  // and the photo would be gone with nothing to get it back from.
  const local = message({
    content: "look at this",
    updatedAt: 300,
    images: [{ url: "data:image/jpeg;base64,AAA", name: "photo.jpg", size: 10 }],
    generatedImages: [
      { url: "data:image/png;base64,BBB", prompt: "a cat", mime: "image/png", model: "Mino Canvas", createdAt: 300 },
    ],
  });
  const remote = { chat: chat({ updatedAt: 500 }), messages: [message({ content: "look at this", updatedAt: 800 })] };
  const merge = planChatMerge(remote, chat({ updatedAt: 500 }), [local]);
  const changes = merge.updateMessages[0].changes;
  assert.ok(changes, "the newer remote copy should be adopted");
  assert.equal(changes.images, undefined);
  assert.equal(changes.generatedImages, undefined);
  assert.equal(changes.documents, undefined);
});

console.log("\nchat metadata");

test("a rename made elsewhere is adopted", () => {
  const remote = { chat: chat({ title: "Renamed on the phone", updatedAt: 900 }), messages: [] };
  const merge = planChatMerge(remote, chat({ title: "Old title", updatedAt: 400 }), []);
  assert.equal(merge.addChat, false);
  assert.equal(merge.chatUpdate?.title, "Renamed on the phone");
});

test("an unpin elsewhere is honoured, not undone", () => {
  const remote = { chat: chat({ pinned: false, updatedAt: 900 }), messages: [] };
  const merge = planChatMerge(remote, chat({ pinned: true, updatedAt: 400 }), []);
  assert.equal(merge.chatUpdate?.pinned, false);
});

console.log("\nanything read off the network is untrusted");

test("a node without an id is dropped", () => {
  assert.equal(parseRemoteChat(null), null);
  assert.equal(parseRemoteChat("nope"), null);
  assert.equal(parseRemoteChat({ title: "no id here" }), null);
  assert.equal(parseRemoteChat({ id: "" }), null);
});

test("missing timestamps and a missing title do not break it", () => {
  const parsed = parseRemoteChat({ id: "c9", messages: { a: { id: "m9", role: "assistant", content: "hi" } } });
  assert.ok(parsed);
  assert.equal(parsed.chat.title, "New chat");
  assert.equal(parsed.chat.updatedAt, 0);
  assert.equal(parsed.messages[0].createdAt, 0);
});

test("a message the interface cannot render is dropped, not stored", () => {
  const parsed = parseRemoteChat({
    id: "c9",
    messages: {
      good: { id: "m1", role: "user", content: "hi", createdAt: 1 },
      wrongRole: { id: "m2", role: "system", content: "be nice", createdAt: 2 },
      noId: { role: "assistant", content: "orphan", createdAt: 3 },
    },
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.messages.map((m) => m.id), ["m1"]);
});

test("a message's chat is taken from the chat it arrived under", () => {
  // The stored chatId cannot be trusted, and getting it wrong files a message
  // into a thread that does not exist — invisible, and unreadable ever again.
  const parsed = parseRemoteChat({
    id: "c-real",
    messages: { a: { id: "m1", role: "user", content: "hi", chatId: "someone-elses", createdAt: 1 } },
  });
  assert.ok(parsed);
  assert.equal(parsed.messages[0].chatId, "c-real");
});

test("a non-array sources value is discarded rather than stored", () => {
  const parsed = parseRemoteChat({
    id: "c9",
    messages: { a: { id: "m1", role: "assistant", content: "hi", sources: "not a list", createdAt: 1 } },
  });
  assert.ok(parsed);
  assert.equal(parsed.messages[0].sources, undefined);
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);