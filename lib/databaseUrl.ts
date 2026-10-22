// ── Which address a Realtime Database is actually reached at ────────────────
//
// `<project>.firebaseio.com` is the legacy spelling of a database address. It
// only exists for projects old enough to have been given a namespace under that
// name; for anything newer it answers 404, and the Realtime Database SDK does
// not report that at all — a `get()` or `onValue()` on such a handle simply
// never settles. A local-first app barely notices, because the database is only
// ever a background mirror. Then the one screen that needs a remote answer, the
// administrator sign-in, waits on it forever with a single line of console
// warning as the only clue.
//
// So the legacy spelling is checked once per page load against the canonical
// address, and the canonical one is used when the legacy host is missing. Only
// a 404 counts as "missing": a 401 is a live database refusing an anonymous
// read, and an unreachable network is no evidence at all, so both leave the
// configured address untouched.

/** How long a namespace probe may take before it counts as "could not tell". */
export const PROBE_TIMEOUT_MS = 4_000;

/**
 * Whether anything answers at `url`.
 *
 * `true` is a live database (it may still refuse the read — 401 means the rules
 * said no, not that nothing is there), `false` is no such namespace, and `null`
 * is a network that could not answer either way.
 */
export async function probeNamespace(url: string): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/.json?shallow=true`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.status !== 404;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The database address to bind to, given the configured one.
 *
 * `probe` is injectable so the decision can be tested without a network; in the
 * app it is {@link probeNamespace}.
 */
export async function resolveDatabaseUrl(
  configured: string,
  projectId: string | undefined,
  probe: (url: string) => Promise<boolean | null> = probeNamespace
): Promise<string> {
  const url = configured.trim().replace(/\/+$/, "");
  const legacyHost = /^https:\/\/([a-z0-9-]+)\.firebaseio\.com$/i.exec(url)?.[1]?.toLowerCase();
  // Only the bare `<project>.firebaseio.com` spelling can be a stale alias;
  // `-default-rtdb` and the regional `firebasedatabase.app` hosts are left be.
  if (!legacyHost || legacyHost.endsWith("-default-rtdb") || !projectId) return url;

  const canonical = `https://${projectId}-default-rtdb.firebaseio.com`;
  if ((await probe(url)) !== false) return url;
  if ((await probe(canonical)) === false) return url;

  console.warn(
    `[mino] NEXT_PUBLIC_FIREBASE_DATABASE_URL is ${url}, which does not exist. Using ${canonical} instead — point the deployment variable at it so the two stay in step.`
  );
  return canonical;
}
