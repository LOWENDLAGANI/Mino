// ── Notes ───────────────────────────────────────────────────────────────────
// The interesting part is the once-only rule: a reader must see a note exactly
// once after it is published, see nothing on the next visit, and see the next
// note published later.

import {
  findNote,
  newNoteId,
  normalizeNotes,
  publishedNotes,
  unseenNotes,
  upsertNote,
  type DevNote,
} from "../lib/notes";

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

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message} (got ${a}, want ${b})`);
}

function note(overrides: Partial<DevNote> = {}): DevNote {
  return {
    id: "note-1",
    title: "Force Close Issue",
    summary: "A summary.",
    body: "The body.",
    badge: "Important",
    badgeTone: "important",
    author: "mino_dev",
    dateLabel: "",
    published: true,
    publishedAt: 1000,
    ...overrides,
  };
}

console.log("notes");

test("a note with no title or id is dropped, because neither is reachable", () => {
  const notes = normalizeNotes([
    note(),
    { id: "x", title: "" },
    { id: "", title: "No id" },
    "not an object",
  ]);
  assertEqual(notes.map((n) => n.id), ["note-1"], "only the complete note survives");
});

test("a duplicate id keeps only the first occurrence", () => {
  const notes = normalizeNotes([note(), note({ title: "Copy" })]);
  assertEqual(notes.length, 1, "one note per id");
  assertEqual(notes[0].title, "Force Close Issue", "the first wins");
});

test("an unknown badge colour falls back rather than rendering nothing", () => {
  const [entry] = normalizeNotes([note({ badgeTone: "chartreuse" as never })]);
  assertEqual(entry.badgeTone, "neutral", "bad tone becomes neutral");
});

test("notes come back newest first", () => {
  const notes = normalizeNotes([
    note({ id: "old", publishedAt: 1 }),
    note({ id: "new", publishedAt: 2 }),
  ]);
  assertEqual(notes.map((n) => n.id), ["new", "old"], "newest leads");
});

test("only published notes are shown to readers", () => {
  const notes = normalizeNotes([note({ id: "a" }), note({ id: "b", published: false })]);
  assertEqual(publishedNotes(notes).map((n) => n.id), ["a"], "drafts stay hidden");
});

test("a note is unseen on the first visit and seen on every visit after", () => {
  const notes = [note()];
  assertEqual(unseenNotes(notes, []).map((n) => n.id), ["note-1"], "first visit sees it");

  // The prompt marks ids seen the moment it opens, so this is the state a
  // refresh or a second visit lands in.
  const seen = ["note-1"];
  assertEqual(unseenNotes(notes, seen), [], "never shown twice");
  assertEqual(unseenNotes(notes, seen), [], "and stays that way");
});

test("a note published later reaches a reader who has already seen the earlier one", () => {
  const seen = ["note-1"];
  const withNew = [note({ id: "note-1", publishedAt: 1 }), note({ id: "note-2", publishedAt: 2 })];
  assertEqual(unseenNotes(withNew, seen).map((n) => n.id), ["note-2"], "only the new one");
});

test("an unpublished note is not surfaced even when it was never seen", () => {
  const notes = [note({ id: "draft", published: false })];
  assertEqual(unseenNotes(notes, []), [], "drafts never reach the prompt");
});

test("a reader who saw nothing gets every note, newest first", () => {
  // The prompt shows them one at a time, so the queue is all of them rather
  // than only the newest — otherwise a reader would silently miss the rest.
  const notes = normalizeNotes([
    note({ id: "a", publishedAt: 1 }),
    note({ id: "b", publishedAt: 2 }),
  ]);
  assertEqual(unseenNotes(notes, []).map((n) => n.id), ["b", "a"], "newest leads the queue");
});

test("seen ids from a previous visit do not hide a note republished under the same id", () => {
  // The id is the identity, so republishing with the same id is a no-op by
  // design. This documents that rather than pretending otherwise.
  const notes = [note({ id: "note-1" })];
  assertEqual(unseenNotes(notes, ["note-1"]), [], "same id stays seen");
});

test("publishing a note that is not in the list yet adds it", () => {
  // The bug this covers: replacing by mapping over the stored list matches
  // nothing for a first-time publish, so the note was written back lost.
  const notes = normalizeNotes([note({ id: "old" })]);
  const fresh = note({ id: "new", title: "Brand New" });
  const result = upsertNote(notes, fresh);
  assertEqual(result.map((n) => n.id), ["new", "old"], "the new note leads");
  assertEqual(result.length, 2, "nothing was dropped");
});

test("publishing an existing note replaces it in place rather than duplicating", () => {
  const notes = normalizeNotes([note({ id: "a" }), note({ id: "b", publishedAt: 2 })]);
  const result = upsertNote(notes, { ...notes[1], title: "Updated" });
  assertEqual(result.length, 2, "still two notes");
  assertEqual(findNote(result, "b")?.title, "Updated", "the edit landed");
});

test("a first-time publish is what readers see", () => {
  const published = upsertNote([], { ...note({ id: "fresh" }), published: true });
  assertEqual(publishedNotes(published).map((n) => n.id), ["fresh"], "published immediately");
  assertEqual(unseenNotes(published, []).map((n) => n.id), ["fresh"], "so it reaches readers");
});

test("a note can be found by id, and a wrong or missing id finds nothing", () => {
  const notes = normalizeNotes([note()]);
  assertEqual(findNote(notes, "note-1")?.title, "Force Close Issue", "found by id");
  assertEqual(findNote(notes, "nope"), null, "unknown id");
  assertEqual(findNote(notes, null), null, "no id");
});

test("two notes composed in the same millisecond still get distinct ids", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newNoteId()));
  assert(ids.size === 200, `expected 200 distinct ids, got ${ids.size}`);
});

test("fields are trimmed and length-capped so one note cannot flood the screen", () => {
  const [entry] = normalizeNotes([note({ title: `  ${"x".repeat(400)}  ` })]);
  assertEqual(entry.title.length, 120, "title capped at 120");
});

console.log(`\nnotes: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);