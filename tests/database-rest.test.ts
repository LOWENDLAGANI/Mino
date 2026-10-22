// ── One-shot database requests ──────────────────────────────────────────────
//
// The console's numbers are these requests. What they used to get wrong was not
// the happy path — it was every unhappy one: a refusal, a database that is not
// there, and a network that never answers all arrived as the same silence, and
// the console rendered that silence as zeros. Each case below pins one answer.

import { databaseRequest, userSession, type DatabaseSession } from "../lib/firebaseRest";

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

const URL_ = "https://example-default-rtdb.firebaseio.com";

/** A session whose token is a recorded stub. */
function session(options: { anonymous?: boolean; token?: () => Promise<string> } = {}) {
  const calls: boolean[] = [];
  const value: DatabaseSession = userSession(
    URL_,
    {
      isAnonymous: options.anonymous ?? false,
      getIdToken: async (fresh?: boolean) => {
        calls.push(Boolean(fresh));
        return options.token ? options.token() : `token-${calls.length}`;
      },
    },
    2000
  );
  return { session: value, calls };
}

/** Replaces fetch for the duration of one case and records its calls. */
async function withFetch<T>(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
  run: (calls: Array<{ url: string; init: RequestInit | undefined }>) => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Runs a case and returns the error it threw. */
async function caught(run: () => Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await run();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error("expected the request to fail, but it resolved");
}

async function main(): Promise<void> {
  await test("a node is read, and the account's token travels with it", async () => {
    const { session: s } = session({ token: async () => "abc123" });
    await withFetch(
      async () => new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
      async (calls) => {
        assertEqual(await databaseRequest(s, "admin/registry"), { hello: "world" }, "parsed");
        assert(calls[0].url.includes("/admin/registry.json?auth=abc123"), `url was ${calls[0].url}`);
      }
    );
  });

  await test("an empty node is null, not an error", async () => {
    const { session: s } = session();
    await withFetch(async () => new Response("null", { status: 200 }), async () => {
      assertEqual(await databaseRequest(s, "dew"), null, "null body");
    });
  });

  await test("a refusal is retried once on a fresh token", async () => {
    const { session: s, calls } = session();
    let asked = 0;
    await withFetch(
      async () => {
        asked += 1;
        return asked === 1
          ? new Response('{"error":"Permission denied"}', { status: 401 })
          : new Response('{"ok":true}', { status: 200 });
      },
      async () => {
        assertEqual(await databaseRequest(s, "admin/registry"), { ok: true }, "succeeded on retry");
      }
    );
    assertEqual(calls, [false, true], "first token cached, second forced fresh");
  });

  await test("a refusal twice is not the administrator", async () => {
    const { session: s } = session();
    await withFetch(async () => new Response('{"error":"Permission denied"}', { status: 401 }), async () => {
      const error = await caught(() => databaseRequest(s, "admin/registry"));
      assertEqual(error.code, "app/permission-denied", "permission code");
    });
  });

  await test("an anonymous visitor is refused once, with no pointless retry", async () => {
    const { session: s, calls } = session({ anonymous: true });
    const asked: number[] = [];
    await withFetch(
      async () => {
        asked.push(1);
        return new Response('{"error":"Permission denied"}', { status: 401 });
      },
      async () => {
        const error = await caught(() => databaseRequest(s, "admin/registry"));
        assertEqual(error.code, "app/permission-denied", "permission code");
      }
    );
    assertEqual(asked.length, 1, "one request only");
    assertEqual(calls, [false], "token asked for once");
  });

  await test("a missing database says so, and names the address", async () => {
    const { session: s } = session();
    await withFetch(async () => new Response("Not Found", { status: 404 }), async () => {
      const error = await caught(() => databaseRequest(s, "admin/registry"));
      assertEqual(error.code, "database/not-found", "not-found code");
      assert(error.message.includes(URL_), "the address is in the message");
    });
  });

  await test("any other status is reported with its number", async () => {
    const { session: s } = session();
    await withFetch(async () => new Response("boom", { status: 500 }), async () => {
      const error = await caught(() => databaseRequest(s, "users"));
      assertEqual(error.code, "database/http-500", "http code");
    });
  });

  await test("a request that never completes is unreachable, not silent", async () => {
    const { session: s } = session();
    await withFetch(
      () => new Promise<Response>(() => undefined),
      async () => {
        const started = Date.now();
        const error = await caught(() =>
          databaseRequest(s, "users", { timeoutMs: 40 })
        );
        assertEqual(error.code, "database/unreachable", "unreachable code");
        assert(Date.now() - started < 3000, "gave up instead of waiting");
      }
    );
  });

  await test("a network failure is unreachable too", async () => {
    const { session: s } = session();
    await withFetch(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      async () => {
        const error = await caught(() => databaseRequest(s, "users"));
        assertEqual(error.code, "database/unreachable", "unreachable code");
      }
    );
  });

  await test("a token that cannot be issued is its own answer, with no request", async () => {
    const { session: s } = session({
      token: async () => {
        throw new Error("network down");
      },
    });
    await withFetch(
      async () => new Response("{}", { status: 200 }),
      async (calls) => {
        const error = await caught(() => databaseRequest(s, "users"));
        assertEqual(error.code, "auth/token-unavailable", "token code");
        assertEqual(calls.length, 0, "nothing was sent");
      }
    );
  });

  await test("a write sends its method and body to the right node", async () => {
    const { session: s } = session();
    await withFetch(
      async () => new Response("{}", { status: 200 }),
      async (calls) => {
        await databaseRequest(s, "config", { method: "PUT", body: { chatEnabled: false } });
        assertEqual(calls[0].init?.method, "PUT", "method");
        assertEqual(calls[0].init?.body, JSON.stringify({ chatEnabled: false }), "body");
        assert(calls[0].url.includes("/config.json?auth="), `url was ${calls[0].url}`);
      }
    );
    await withFetch(
      async () => new Response(null, { status: 200 }),
      async (calls) => {
        await databaseRequest(s, "users/someone", { method: "DELETE" });
        assertEqual(calls[0].init?.method, "DELETE", "delete method");
        assertEqual(calls[0].init?.body, undefined, "no body on a delete");
      }
    );
  });

  await test("a push comes back with the key the database allocated", async () => {
    const { session: s } = session();
    await withFetch(
      async () => new Response('{"name":"-Nabc123"}', { status: 200 }),
      async (calls) => {
        const created = await databaseRequest<{ name?: string }>(s, "admin/audit", {
          method: "POST",
          body: { action: "grantDew" },
        });
        assertEqual(created?.name, "-Nabc123", "allocated key");
        assertEqual(calls[0].init?.method, "POST", "post method");
      }
    );
  });

  console.log(`\ndatabase-rest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
