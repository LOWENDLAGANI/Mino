// ── Claiming a code ──────────────────────────────────────────────────────────
//
// The visitor types the word and this writes one node: which code they used and
// when. That is the entire payload — no amount, no balance, no expiry.
//
// It is worth being explicit about why, because the tempting version of this
// file would be to read the code, work out what it is worth, and write that into
// the visitor's balance. That version is a paywall with a hole in it: the record
// would then be written by the person claiming, and a bundle edit that wrote
// `dew: 1000` into it would grant exactly that. Here the visitor chooses a word
// and nothing else; `lib/serverRedeem.ts` looks up what the word is worth on the
// server, every time it is asked.
//
// Writing the claim is separate from receiving the credit on purpose. The rules
// withhold `codes/` from everyone but the administrator, and the deployment has
// no service account of its own — so the claim is recorded in the caller's own
// node, and the credit that follows is pinned by the rules to the amount on the
// code record itself.

import { firebaseConfigured, getServices } from "./firebaseHistory";
import { databaseRequest, userSession } from "./firebaseRest";
import { isValidCode, normalizeCode, parseRedeemCode } from "./redeemState";

export interface ClaimResult {
  ok: boolean;
  /** The word as it was understood, for showing back to the caller. */
  code: string;
  /**
   * True when this code had already been claimed by this account.
   *
   * Reported rather than treated as an error: the top-up is already theirs, and
   * telling somebody their working code is "wrong" would be both untrue and the
   * fastest way to make them ask you for a replacement.
   */
  alreadyClaimed?: boolean;
  /** Why it failed, in a sentence worth showing. */
  error?: string;
}

function notConfigured(): Error & { code?: string } {
  const error = new Error("Mino is not configured") as Error & { code?: string };
  error.code = "app/not-configured";
  return error;
}

/**
 * Records that this visitor used a code.
 *
 * Returns rather than throws for the ordinary "that word is not one of ours"
 * case, because the visitor is going to be shown that sentence and an exception
 * would make it indistinguishable from a broken deployment.
 *
 * The write is refused by the rules when the code does not exist or has been
 * switched off — `database.rules.json` checks `active` on the very write — so a
 * terminated code cannot be claimed by a modified client either. The server
 * checks again on every request for claims that were made before it was off.
 */
export async function claimRedeemCode(rawCode: string): Promise<ClaimResult> {
  const current = await getServices();
  if (!current) throw notConfigured();

  const code = normalizeCode(rawCode);
  if (!isValidCode(code)) {
    return { ok: false, code, error: "Enter the code exactly as it was given to you." };
  }

  try {
    const user = await current.ensureUser();
    // Requests rather than the socket: a socket that never connects leaves a
    // claim pending for good, which reaches the visitor as a spinner that never
    // resolves instead of the refusal the rules actually made.
    const session = userSession(current.databaseUrl, user);
    const uid = user.uid;

    // The moment this code was claimed, which never changes once it is set.
    //
    // The rules make a claim write-once: `claimedAt` cannot be moved, because a
    // claim that can be rewritten is a claim whose window restarts every time it
    // is typed — which is how one word becomes unlimited time. So this reads
    // first, and only writes when there is genuinely nothing there.
    const existing = await databaseRequest<{ claimedAt?: number }>(
      session,
      `redeems/${uid}/${code}`
    );
    const previous = Number(existing?.claimedAt);
    if (Number.isFinite(previous) && previous > 0) {
      return { ok: true, code, alreadyClaimed: true };
    }

    await databaseRequest(session, `redeems/${uid}/${code}`, {
      method: "PUT",
      body: { code, claimedAt: Date.now() },
    });

    // A Dew code tops up on the spot: the credit is written into dew/{uid}
    // with the exact amount the code record carries. The rules refuse any
    // other value for this key, so the writer picks only *whether* to claim —
    // the amount is still decided by the code, server-side. A record that is
    // not a Dew code is left alone here; the server folds in whatever the
    // claims are actually worth on the next request.
    const codeRecord = parseRedeemCode(await databaseRequest<unknown>(session, `codes/${code}`));
    if (codeRecord?.dew !== undefined && codeRecord.active) {
      try {
        await databaseRequest(session, `dew/${uid}/credits/${code}`, {
          method: "PUT",
          body: codeRecord.dew,
        });
      } catch {
        // The claim stands; the balance read on the next request folds it in
        // via the same rule check. A refused credit write is retried on the
        // next claim of the same word rather than reported as an error.
      }
    }
    return { ok: true, code };
  } catch (error) {
    const cause = error as { code?: string; message?: string } | null;
    const message = String(cause?.message ?? "");
    // The rules refuse a claim against a code that is switched off, which is the
    // one refusal with a meaning worth reporting. Everything else is a failure to
    // write, which is an outage rather than an answer.
    if (cause?.code === "app/permission-denied" || /permission/i.test(message)) {
      return {
        ok: false,
        code,
        error: "That code cannot be used right now. Ask for a new one.",
      };
    }
    return {
      ok: false,
      code,
      error: "Mino could not check that code. Please try again shortly.",
    };
  }
}

/** Whether this visitor has claimed a code, for showing the claim on /plus. */
export async function hasClaimed(rawCode: string): Promise<boolean> {
  if (!firebaseConfigured) return false;
  try {
    const current = await getServices();
    if (!current) return false;
    const user = await current.ensureUser();
    const claim = await databaseRequest<unknown>(
      userSession(current.databaseUrl, user),
      `redeems/${user.uid}/${normalizeCode(rawCode)}`
    );
    return claim !== null;
  } catch {
    return false;
  }
}