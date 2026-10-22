// ── Talking to the Realtime Database over plain HTTP ────────────────────────
//
// The SDK's socket is the right tool for live updates, and it stays in charge of
// those. But every *one-shot* question — "is this account the administrator",
// "who has visited", "what is the config", "grant this Dew" — goes over REST
// instead, for one reason: a socket read on a handle bound to an address that
// does not exist never settles at all. No error, no rejection, no timeout, just
// a promise that waits for as long as the tab is open. Refused, missing and
// unreachable were therefore indistinguishable, and the console sat on zeros
// with nothing to show for it.
//
// An HTTP request reports a status for each of those, so each one gets its own
// answer. `database.rules.json` judges the token exactly as it judges the
// socket: the `?auth=` value is the account's own, so nothing here can grant
// what the rules refuse.

/** The most one request may take before it counts as silence. */
export const REST_TIMEOUT_MS = 15_000;

export function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${milliseconds}ms`)),
      milliseconds
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Firebase is not configured in this deployment. */
export function notConfigured(): Error & { code?: string } {
  const error = new Error("Firebase is not configured") as Error & { code?: string };
  error.code = "app/not-configured";
  return error;
}

/** The rules refused this account. `false` in the gate; an error everywhere else. */
export function unauthorized(): Error & { code?: string } {
  const error = new Error("This account is not the Mino administrator.") as Error & { code?: string };
  error.code = "app/permission-denied";
  return error;
}

/** A database that answered with something other than yes or no. */
export function databaseAnswered(url: string, status: number): Error & { code?: string } {
  const error = new Error(
    status === 404
      ? `There is no Realtime Database at ${url}. Copy the address shown in Firebase → Realtime Database into NEXT_PUBLIC_FIREBASE_DATABASE_URL.`
      : `The database answered HTTP ${status} instead of allowing or refusing the read.`
  ) as Error & { code?: string };
  error.code = status === 404 ? "database/not-found" : `database/http-${status}`;
  return error;
}

/** A database that never answered at all. */
export function databaseUnreachable(url: string, cause: unknown): Error & { code?: string } {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `No answer from ${url} (${reason}). The database cannot be reached from this browser — a proxy, an ad blocker, a firewall or a captive portal can do that.`
  ) as Error & { code?: string };
  error.code = "database/unreachable";
  return error;
}

/** A browser that could not be given a token. */
export function tokenUnavailable(cause: unknown): Error & { code?: string } {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `Firebase did not issue a sign-in token (${reason}). A proxy, an ad blocker or a captive network can hold the token service open.`
  ) as Error & { code?: string };
  error.code = "auth/token-unavailable";
  return error;
}

/** A session against the database: where it is, and who this browser is there. */
export interface DatabaseSession {
  url: string;
  /** The signed-in account's ID token; `fresh` forces a new one. */
  token: (fresh: boolean) => Promise<string>;
  /** False for an anonymous visitor, whose refusal a refresh cannot change. */
  canRefresh: boolean;
}

/** A session for whoever is signed in, wrapped so a failure says what failed. */
export function userSession(
  url: string,
  user: { isAnonymous: boolean; getIdToken(fresh?: boolean): Promise<string> },
  timeoutMs = REST_TIMEOUT_MS
): DatabaseSession {
  return {
    url,
    canRefresh: !user.isAnonymous,
    token: async (fresh) => {
      try {
        return await withTimeout(user.getIdToken(fresh), timeoutMs);
      } catch (cause: unknown) {
        throw tokenUnavailable(cause);
      }
    },
  };
}

export interface RequestOptions {
  method?: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  /** Serialised as JSON. Omitted for a read and for a delete. */
  body?: unknown;
  /** Forces a new token first, for a write that must not race a sign-in. */
  fresh?: boolean;
  timeoutMs?: number;
}

/**
 * One request to one node, with the rules deciding the answer.
 *
 * A refusal is retried once on a freshly minted token: right after a Google
 * sign-in the browser can still be holding the anonymous visitor's token, and
 * that first refusal is not the account's real answer. Nothing is granted by
 * the retry — Firebase evaluates the same rule against the new token.
 */
export async function databaseRequest<T>(
  session: DatabaseSession,
  path: string,
  options: RequestOptions = {}
): Promise<T | null> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? REST_TIMEOUT_MS;

  const attempt = async (fresh: boolean): Promise<Response> => {
    const token = await session.token(fresh);
    try {
      return await withTimeout(
        fetch(`${session.url}/${path}.json?auth=${encodeURIComponent(token)}`, {
          method,
          headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          cache: "no-store",
        }),
        timeoutMs
      );
    } catch (cause: unknown) {
      // The token failure above carries its own code and has already been
      // reported; anything else here is the request itself not completing.
      if ((cause as { code?: string })?.code) throw cause;
      throw databaseUnreachable(session.url, cause);
    }
  };

  let response = await attempt(Boolean(options.fresh));
  if ((response.status === 401 || response.status === 403) && session.canRefresh) {
    response = await attempt(true);
  }
  if (response.status === 401 || response.status === 403) throw unauthorized();
  if (!response.ok) throw databaseAnswered(session.url, response.status);

  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    const error = new Error(`The database answered ${session.url} with something that is not data.`) as Error & {
      code?: string;
    };
    error.code = "database/unreadable";
    throw error;
  }
}
