// ── The address a Realtime Database is reached at ───────────────────────────
//
// A legacy `<project>.firebaseio.com` address on a project that no longer has
// that namespace is the failure this pins down: the address resolves to 404,
// the SDK never reports it, and every read on that handle waits forever. The
// repair must use the canonical address in that case and must never rewrite an
// address on weaker evidence than a 404.

import { resolveDatabaseUrl } from "../lib/databaseUrl";

let passed = 0;
let failed = 0;

async function test(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
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

/** A probe that answers from a table and records what it was asked. */
function fakeProbe(answers: Record<string, boolean | null>) {
  const asked: string[] = [];
  return {
    asked,
    probe: async (url: string) => {
      asked.push(url);
      return answers[url] ?? null;
    },
  };
}

async function main(): Promise<void> {
  await test("a canonical address is used as it is, with no probe at all", async () => {
    const { probe, asked } = fakeProbe({});
    const resolved = await resolveDatabaseUrl(
      "https://mino-2425-default-rtdb.firebaseio.com",
      "mino-2425",
      probe
    );
    assertEqual(resolved, "https://mino-2425-default-rtdb.firebaseio.com", "canonical kept");
    assertEqual(asked, [], "nothing was probed");
  });

  await test("a regional firebasedatabase.app address is used as it is", async () => {
    const { probe, asked } = fakeProbe({});
    const url = "https://mino-2425-default-rtdb.europe-west1.firebasedatabase.app";
    assertEqual(await resolveDatabaseUrl(url, "mino-2425", probe), url, "regional kept");
    assertEqual(asked, [], "nothing was probed");
  });

  await test("a legacy address that still exists is left alone", async () => {
    const url = "https://old-project.firebaseio.com";
    const { probe } = fakeProbe({ [url]: true });
    assertEqual(await resolveDatabaseUrl(url, "old-project", probe), url, "live legacy kept");
  });

  await test("a legacy address refused by the rules is still left alone", async () => {
    // 401 from the probe is a live database, not a missing one.
    const url = "https://mino-2425.firebaseio.com";
    const canonical = "https://mino-2425-default-rtdb.firebaseio.com";
    const { probe } = fakeProbe({ [url]: true, [canonical]: true });
    assertEqual(await resolveDatabaseUrl(url, "mino-2425", probe), url, "401 is not missing");
  });

  await test("a legacy address that 404s falls back to the canonical one", async () => {
    const url = "https://mino-2425.firebaseio.com";
    const canonical = "https://mino-2425-default-rtdb.firebaseio.com";
    const { probe, asked } = fakeProbe({ [url]: false, [canonical]: true });
    assertEqual(await resolveDatabaseUrl(url, "mino-2425", probe), canonical, "canonical used");
    assertEqual(asked, [url, canonical], "legacy probed first, then canonical");
  });

  await test("nothing is rewritten when the canonical address is missing too", async () => {
    const url = "https://mino-2425.firebaseio.com";
    const { probe } = fakeProbe({ [url]: false, "https://mino-2425-default-rtdb.firebaseio.com": false });
    assertEqual(await resolveDatabaseUrl(url, "mino-2425", probe), url, "configured kept");
  });

  await test("a network that cannot answer leaves the address untouched", async () => {
    const url = "https://mino-2425.firebaseio.com";
    const { probe } = fakeProbe({ [url]: null, "https://mino-2425-default-rtdb.firebaseio.com": true });
    assertEqual(await resolveDatabaseUrl(url, "mino-2425", probe), url, "null is not evidence");
  });

  await test("a missing project id leaves the address untouched", async () => {
    const url = "https://mino-2425.firebaseio.com";
    const { probe, asked } = fakeProbe({ [url]: false });
    assertEqual(await resolveDatabaseUrl(url, undefined, probe), url, "no project id, no guess");
    assertEqual(asked, [], "nothing was probed");
  });

  await test("whitespace and a trailing slash are trimmed", async () => {
    const { probe } = fakeProbe({ "https://mino-2425-default-rtdb.firebaseio.com": true });
    assertEqual(
      await resolveDatabaseUrl("  https://mino-2425-default-rtdb.firebaseio.com/  ", "mino-2425", probe),
      "https://mino-2425-default-rtdb.firebaseio.com",
      "normalised"
    );
  });

  console.log(`\ndatabase-url: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
