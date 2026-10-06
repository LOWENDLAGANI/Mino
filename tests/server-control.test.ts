// ── Mino — tests for the ban system ──────────────────────────────────────────
//
// The ban list is the one control that has to hold against a caller who edits
// the client bundle, so these tests are about what the gate refuses and what it
// refuses *not* to refuse: a ban carries a reason and a length, an expired ban
// lifts by itself rather than lingering forever, a legacy uid-only config keeps
// banning with no migration, and the administrator can never lock themselves
// out with their own control.
//
//   bun run test

import assert from "node:assert/strict";
// Erased at compile time — this loads no module, so the administrator address
// can still be set before `serverControl` is imported inside `main`.
import type { BanRecord } from "../lib/appConfig";

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

async function main(): Promise<void> {
  // `serverControl` reads the administrator's address once, at import time, so
  // the environment has to be in place before the module loads.
  process.env.MINO_ADMIN_EMAIL = "admin@example.com";
  const { activeBans, banMessage, identityControlsActive, identityGate, isAdmin } = await import(
    "../lib/serverControl"
  );
  const { DEFAULT_CONFIG, isBanActive, normalizeConfig } = await import("../lib/appConfig");

  const DAY = 86_400_000;
  // Built at run time, so "in the future" stays in the future however slowly
  // the machine executes the assertions below it.
  const NOW = Date.now();

  const ban = (overrides: Partial<BanRecord> & { uid: string }): BanRecord => ({
    reason: "",
    bannedAt: NOW - DAY,
    expiresAt: null,
    bannedBy: "admin@example.com",
    ...overrides,
  });

  const configWith = (bans: BanRecord[]) => ({ ...DEFAULT_CONFIG, bans });

  // ── Reading the stored list ────────────────────────────────────────────────

  test("a legacy bannedUids config is folded into permanent bans", () => {
    const config = normalizeConfig({ bannedUids: ["uid-a", "uid-b", 42, "", "uid-a"] });
    assert.deepEqual(
      config.bans.map((entry) => entry.uid),
      ["uid-a", "uid-b"],
      "legacy uids become bans; junk dropped; duplicates collapsed"
    );
    assert.ok(
      config.bans.every((entry) => entry.expiresAt === null && entry.reason === ""),
      "a legacy ban was permanent and carried no reason"
    );
  });

  test("a bans map keyed by uid is parsed, and junk entries are ignored", () => {
    const config = normalizeConfig({
      bans: {
        "uid-a": { reason: "Spamming the chat", bannedAt: 1_000, expiresAt: 2_000, bannedBy: "admin@example.com" },
        "uid-b": null,
        "uid-c": { reason: 42, bannedAt: "yesterday" },
      },
    });
    assert.deepEqual(
      config.bans.map((entry) => entry.uid),
      ["uid-a", "uid-c"],
      "a null entry is dropped; a record without its own uid binds to its key"
    );
    const a = config.bans.find((entry) => entry.uid === "uid-a");
    assert.equal(a?.reason, "Spamming the chat");
    assert.equal(a?.expiresAt, 2_000);
    const c = config.bans.find((entry) => entry.uid === "uid-c");
    assert.equal(c?.reason, "", "a non-string reason becomes empty rather than leaking through");
    assert.equal(c?.expiresAt, null, "a malformed expiry reads as permanent, never as expired");
    assert.equal(c?.bannedAt, 0, "a non-numeric date is dropped rather than kept as NaN");
  });

  test("a bans array is parsed and a repeated uid keeps its first record", () => {
    const config = normalizeConfig({
      bans: [
        { uid: "uid-a", reason: "First", bannedAt: 5, expiresAt: 9, bannedBy: "" },
        { uid: "uid-a", reason: "Second", bannedAt: 6, expiresAt: 10, bannedBy: "" },
        "not-a-record",
      ],
    });
    assert.equal(config.bans.length, 1);
    assert.equal(config.bans[0]?.reason, "First");
  });

  // ── What counts as an active ban ───────────────────────────────────────────

  test("a permanent ban is active, a future ban is active, a past ban is not", () => {
    assert.equal(isBanActive(ban({ uid: "u", expiresAt: null })), true);
    assert.equal(isBanActive(ban({ uid: "u", expiresAt: NOW + DAY })), true);
    assert.equal(isBanActive(ban({ uid: "u", expiresAt: NOW - DAY })), false);
    assert.equal(isBanActive(ban({ uid: "u", expiresAt: NOW })), false, "a ban lifts the moment it expires");
  });

  test("identityControlsActive counts only bans still in force", () => {
    assert.equal(identityControlsActive(configWith([ban({ uid: "u", expiresAt: NOW - DAY })]), 0), false);
    assert.equal(identityControlsActive(configWith([ban({ uid: "u", expiresAt: NOW + DAY })]), 0), true);
    assert.equal(identityControlsActive(DEFAULT_CONFIG, 5), true, "a configured cap alone still needs identity");
    assert.equal(
      activeBans(configWith([ban({ uid: "u", expiresAt: NOW + DAY }), ban({ uid: "v" })])).length,
      2
    );
  });

  // ── The gate itself ────────────────────────────────────────────────────────

  test("a banned visitor is refused, and is told the reason and the end date", () => {
    const endsAt = NOW + 3 * DAY;
    const gate = identityGate(
      { uid: "uid-a", email: "" },
      configWith([ban({ uid: "uid-a", reason: "Spamming", expiresAt: endsAt })]),
      0
    );
    assert.equal(gate.allowed, false);
    assert.ok(gate.error?.includes("Spamming"), "the reason reaches the visitor");
    assert.ok(gate.error?.includes(new Date(endsAt).toISOString().slice(0, 10)), "the end date reaches the visitor");
  });

  test("a permanent ban without a reason keeps the plain sentence", () => {
    const gate = identityGate({ uid: "uid-a", email: "" }, configWith([ban({ uid: "uid-a" })]), 0);
    assert.equal(gate.allowed, false);
    assert.equal(gate.error, "This device is not allowed to use Mino.");
  });

  test("the appeal sentence appears once, after a reason", () => {
    const message = banMessage(ban({ uid: "u", reason: "Spamming." }));
    assert.equal(
      message,
      "This device is not allowed to use Mino. Reason: Spamming. If you believe this is a mistake, contact the administrator."
    );
  });

  test("an expired ban lifts by itself and stops forcing identification", () => {
    const config = configWith([ban({ uid: "uid-a", expiresAt: NOW - DAY })]);
    assert.equal(identityGate({ uid: "uid-a", email: "" }, config, 0).allowed, true);
    assert.equal(
      identityGate(null, config, 0).allowed,
      true,
      "an expired ban must not lock out callers who were never banned"
    );
  });

  test("an unidentified caller is refused while a ban is configured", () => {
    assert.equal(identityGate(null, configWith([ban({ uid: "uid-a" })]), 0).allowed, false);
  });

  test("with no ban and no cap, an unidentified caller is allowed", () => {
    assert.equal(identityGate(null, DEFAULT_CONFIG, 0).allowed, true);
  });

  test("a cap alone still refuses the unidentified", () => {
    assert.equal(identityGate(null, DEFAULT_CONFIG, 10).allowed, false);
  });

  test("the administrator is exempt from their own ban list", () => {
    const config = configWith([ban({ uid: "uid-admin", reason: "Testing the control" })]);
    assert.ok(isAdmin({ uid: "uid-admin", email: "admin@example.com" }));
    assert.equal(identityGate({ uid: "uid-admin", email: "admin@example.com" }, config, 0).allowed, true);
    assert.equal(
      identityGate({ uid: "uid-admin", email: "someone@example.com" }, config, 0).allowed,
      false,
      "sharing the administrator's uid is not exemption; the address decides"
    );
  });
}

void main().then(() => {
  console.log(
    failures === 0
      ? `\n${passes} passed\n`
      : `\n${passes} passed, ${failures} FAILED\n`
  );
  process.exit(failures === 0 ? 0 : 1);
});
