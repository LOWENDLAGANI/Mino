// ── Mino — tests for the send-later, trash, rate-limit, usage and read-aloud
//    features ─────────────────────────────────────────────────────────────────
//
// These are the pure parts: the parts that decide *when* something fires,
// *whether* something expired, *how long* a wait is, and *what* the console
// counts. Each one can quietly lie in a way a screenshot never shows — a
// schedule that fires a day early, a weekly count summed instead of unioned —
// so they are pinned here. A few source-level checks cover the wiring that
// connects them to the UI, in the same spirit as the model-health suite.
//
//   bun run test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCHEDULE_PRESETS,
  dueFirst,
  earliestSchedule,
  formatScheduleTime,
  isDue,
  nextMorningAt,
} from "../lib/scheduler";
import { TRASH_RETENTION_MS, isTrashExpired } from "../lib/trash";
import { parseRetrySeconds, secondsRemaining } from "../lib/rateLimit";
import { summarizeUsage, type UsageDayInput } from "../lib/usageStats";
import { speechText } from "../lib/tts";

let failures = 0;
let passes = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
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

async function main(): Promise<void> {
console.log("\nscheduled messages");

await test("a message is due the moment its time passes, not before", () => {
  assert.equal(isDue({ sendAt: 1_000 }, 1_000), true, "the appointment itself is due");
  assert.equal(isDue({ sendAt: 1_001 }, 1_000), false, "the future is not due");
});

await test("a backlog fires oldest first", () => {
  const queue = [{ sendAt: 300 }, { sendAt: 100 }, { sendAt: 200 }];
  queue.sort(dueFirst);
  assert.deepEqual(queue.map((item) => item.sendAt), [100, 200, 300]);
});

await test("the morning preset lands on today's 9:00 when the hour is ahead", () => {
  const morning = new Date(2026, 9, 6, 8, 0, 0, 0);
  assert.equal(nextMorningAt(9, morning.getTime()), new Date(2026, 9, 6, 9, 0, 0, 0).getTime());
});

await test("the morning preset rolls to tomorrow once today's 9:00 has passed", () => {
  const evening = new Date(2026, 9, 6, 22, 0, 0, 0);
  assert.equal(nextMorningAt(9, evening.getTime()), new Date(2026, 9, 7, 9, 0, 0, 0).getTime());
});

await test("a chip reads relative while it is near and never negative", () => {
  const now = Date.now();
  assert.equal(formatScheduleTime(now - 1_000, now), "due now");
  assert.equal(formatScheduleTime(now + 30 * 60_000, now), "in 30m");
  assert.equal(formatScheduleTime(now + 5_000, now), "in 1m", "a near deadline rounds up, never to zero");
});

await test("a far-off chip does not claim to be today", () => {
  const now = new Date(2026, 9, 6, 10, 0, 0, 0).getTime();
  const tomorrow = new Date(2026, 9, 7, 9, 0, 0, 0).getTime();
  assert.ok(!formatScheduleTime(tomorrow, now).startsWith("today"));
});

await test("the custom picker's floor is a minute away in ISO local shape", () => {
  const before = Date.now() + 59_000;
  const floor = new Date(earliestSchedule(before)).getTime();
  assert.ok(floor >= before + 1_000, "the floor must be in the future");
  assert.equal(earliestSchedule(before).length, 16, "datetime-local wants yyyy-mm-ddThh:mm");
});

await test("every quick pick is either an offset or a wall-clock hour", () => {
  assert.ok(SCHEDULE_PRESETS.length >= 4);
  for (const preset of SCHEDULE_PRESETS) {
    assert.ok(
      preset.offsetMs !== undefined || preset.hour !== undefined,
      `${preset.label} would fire at an undefined time`
    );
  }
});

console.log("\nrate limit countdown");

await test("the server's own refusal is read as a number of seconds", () => {
  assert.equal(
    parseRetrySeconds("Too many messages at once. Please wait 12s and try again."),
    12
  );
  assert.equal(
    parseRetrySeconds("Too many images at once. Please wait 45 s and try again."),
    45
  );
});

await test("an error with no wait in it starts no countdown", () => {
  assert.equal(parseRetrySeconds("Mino is paused right now. Please try again shortly."), null);
  assert.equal(parseRetrySeconds(""), null);
  assert.equal(parseRetrySeconds("Please wait a moment"), null, "no number, no countdown");
});

await test("a nonsensical or enormous wait is refused or clamped", () => {
  assert.equal(parseRetrySeconds("wait 0s"), null, "zero seconds is not a wait");
  assert.equal(parseRetrySeconds("wait -5s"), null);
  assert.equal(parseRetrySeconds("please wait 999999s"), 600, "clamped to ten minutes");
});

await test("the countdown never goes negative", () => {
  const now = 10_000;
  assert.equal(secondsRemaining(now + 2_500, now), 3, "whole seconds, rounded up");
  assert.equal(secondsRemaining(now - 1, now), 0);
});

console.log("\ntrash retention");

await test("thirty days is the retention, and expiry is strictly past it", () => {
  assert.equal(TRASH_RETENTION_MS, 30 * 86_400_000);
  const now = 1_000_000_000_000;
  assert.equal(isTrashExpired({ deletedAt: now - TRASH_RETENTION_MS }, now), false, "on the boundary is still recoverable");
  assert.equal(isTrashExpired({ deletedAt: now - TRASH_RETENTION_MS - 1 }, now), true);
  assert.equal(isTrashExpired({ deletedAt: now }, now), false, "just deleted is the case the feature exists for");
});

console.log("\nusage statistics");

const week: UsageDayInput[] = [
  { day: "2026-09-20", uids: ["old-timer"], chat: 9 }, // outside the weekly window
  { day: "2026-09-30", uids: ["d"] },
  { day: "2026-10-04", uids: ["a", "b"], chat: 3, image: 1, auto: 2, code: 1 },
  { day: "2026-10-05", uids: ["b", "c"], chat: 2, auto: 1 },
  { day: "2026-10-06", uids: ["a", "c"], chat: 4, image: 2, self: 5, code: 2 },
];
const now = Date.UTC(2026, 9, 6, 12, 0, 0);

await test("WAU is a union of people, not a sum of days", () => {
  const summary = summarizeUsage(week, now);
  // The window holds four distinct visitors; the daily counts add to six, and
  // the day outside the window adds one more. A summed weekly would say 7.
  assert.equal(summary.wau, 4, "the same person twice in a week is one person");
});

await test("DAU is per-day, oldest first, one bar each", () => {
  const summary = summarizeUsage(week, now);
  assert.deepEqual(summary.dau, [
    { day: "2026-09-20", users: 1 },
    { day: "2026-09-30", users: 1 },
    { day: "2026-10-04", users: 2 },
    { day: "2026-10-05", users: 2 },
    { day: "2026-10-06", users: 2 },
  ]);
});

await test("the headline numbers come from the most recent day", () => {
  const summary = summarizeUsage(week, now);
  assert.equal(summary.latestDay, "2026-10-06");
  assert.equal(summary.latestUsers, 2);
});

await test("totals span all history and modes are ranked largest first", () => {
  const summary = summarizeUsage(week, now);
  assert.deepEqual(summary.totals, { chat: 18, image: 3 });
  assert.deepEqual(summary.modes, [
    { mode: "self", count: 5 },
    { mode: "auto", count: 3 },
    { mode: "code", count: 3 },
  ]);
});

await test("an empty history is zeros, not an error", () => {
  const summary = summarizeUsage([], now);
  assert.deepEqual(summary.dau, []);
  assert.equal(summary.wau, 0);
  assert.equal(summary.latestDay, null);
  assert.equal(summary.latestUsers, 0);
  assert.deepEqual(summary.totals, { chat: 0, image: 0 });
  assert.deepEqual(summary.modes, []);
});

await test("unsorted input is still read in day order", () => {
  const summary = summarizeUsage([...week].reverse(), now);
  assert.equal(summary.latestDay, "2026-10-06");
  assert.deepEqual(summary.dau.map((bar) => bar.day), week.map((row) => row.day));
});

console.log("\nread aloud");

await test("code blocks are announced, not read character by character", () => {
  const text = speechText("Before\n```ts\nconst x = 1;\n```\nafter");
  assert.ok(!text.includes("const x"), "the code itself must not be spoken");
  assert.ok(text.includes("Code block omitted"));
  assert.ok(text.includes("Before") && text.includes("after"));
});

await test("markdown decoration is stripped but its words are kept", () => {
  const text = speechText("# Title\n- **bold** and `code`\n[link](https://example.com) ![img](x.png)");
  assert.ok(!text.includes("#"), "headings are not read as hashtags");
  assert.ok(!text.includes("*"), "emphasis markers are not read as asterisks");
  assert.ok(!text.includes("`"), "inline code markers are not read as backticks");
  assert.ok(!text.includes("]("), "a link's URL is not read out");
  assert.ok(!text.includes("img.png"), "an image URL is not read out");
  assert.ok(text.includes("Title") && text.includes("bold") && text.includes("code") && text.includes("link"));
});

await test("a huge answer is capped so one reply cannot hold the voice for minutes", () => {
  const text = speechText("word ".repeat(5_000));
  assert.equal(text.length, 4_000);
});

await test("whitespace collapses so pauses do not stack", () => {
  assert.equal(speechText("one\n\n\n  two     three"), "one two three");
});

console.log("\nthe wiring these features hang off");

await test("the composer receives the queue, the canceller, and the countdown", () => {
  const page = read("app/page.tsx");
  assert.match(page, /onSchedule=\{handleSchedule\}/, "the schedule menu is not connected");
  assert.match(page, /scheduled=\{scheduled\}/, "the chips have no queue to show");
  assert.match(page, /onCancelScheduled=\{handleCancelScheduled\}/, "a chip cannot be cancelled");
  assert.match(page, /rateLimitUntil=\{rateLimitUntil\}/, "the countdown never reaches the composer");
});

await test("the page consumes a due schedule through sendMessage's own options", () => {
  const page = read("app/page.tsx");
  assert.match(page, /scheduledId: item\.id/, "a fired schedule is not consumed with the send");
  assert.match(page, /purgeTrash\(\)/, "expired trash is never dropped on start");
  assert.match(page, /mino:data-wiped/, "the wipe event leaves the page on dead data");
});

await test("the database migration gives the queue and the trash their tables", () => {
  const db = read("lib/db.ts");
  assert.match(db, /this\.version\(4\)\.stores\(\{/);
  assert.match(db, /scheduled: "id, sendAt"/);
  assert.match(db, /trash: "id, deletedAt"/);
});

await test("the wipe button is the two-tap one and clears through lib/privacy", () => {
  const data = read("components/DataControls.tsx");
  assert.match(data, /deleteAllMyData/);
  assert.match(data, /Tap again to erase everything/, "the destructive button must need two taps");
});

await test("every finished answer has a read-aloud control that stops on unmount", () => {
  const thread = read("components/ChatThread.tsx");
  assert.match(thread, /Read aloud/);
  assert.match(thread, /stopSpeaking\(\)/, "a navigated-away page would keep talking otherwise");
});

await test("the sidebar opens overlays instead of a search section", () => {
  const sidebar = read("components/Sidebar.tsx");
  assert.match(sidebar, /SearchOverlay/);
  assert.match(sidebar, /TrashOverlay/);
  assert.match(sidebar, /GalleryOverlay/);
});

await test("a push broadcast is admin-gated on the server", () => {
  const push = read("app/api/push/route.ts");
  assert.match(push, /action\?: "subscribe" \| "unsubscribe" \| "test" \| "broadcast"/);
  assert.match(push, /requireAdmin\(req\.headers\)/, "broadcast must not be open to any caller");
});

await test("the console has the usage section with its chart", () => {
  const admin = read("components/AdminPanel.tsx");
  assert.match(admin, /<UsageSection \/>/, "the trend chart is not mounted in the console");
  assert.match(admin, /function UsageSection/);
});

console.log(
  failures === 0
    ? `\n${passes} passed\n`
    : `\n${passes} passed, ${failures} FAILED\n`
);
}

void main().then(() => {
  process.exit(failures === 0 ? 0 : 1);
});
