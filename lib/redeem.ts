// ── Claiming a code ──────────────────────────────────────────────────────────
//
// The visitor types the word and this writes one node: which code they used and
// when. That is the entire payload — no plan, no days, no expiry.
//
// It is worth being explicit about why, because the tempting version of this
// file would be to read the code, work out the plan, and write it into the
// visitor's subscription. That version is a paywall with a hole in it: the
// record would then be written by the person claiming, and a bundle edit that
// wrote `plan: "lunar"` into it would grant exactly that. Here the visitor
// chooses a word and nothing else; `lib/serverRedeem.ts` looks up what the word
// is worth on the server, every time it is asked.
//
// Writing the claim is separate from receiving the plan on purpose. The grant
// itself is never written by the visitor — the rules withhold `subscriptions/`
// from everyone but the administrator — so the claim is recorded in their own
// node and the server folds it into what they are entitled to.

import { get, ref, set } from "firebase/database";
import { firebaseConfigured, getServices } from "./firebaseHistory";
import { isValidCode, normalizeCode } from "./redeemState";

export interface ClaimResult {
  ok: boolean;
  /** The word as it was understood, for showing back to the caller. */
  code: string;
  /**
   * True when this code had already been claimed by this account.
   *
   * Reported rather than treated as an error: the plan is already theirs, and
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
    const uid = (await current.ensureUser()).uid;
    const claimRef = ref(current.database, `redeems/${uid}/${code}`);

    // The moment this code was claimed, which never changes once it is set.
    //
    // The rules make a claim write-once: `claimedAt` cannot be moved, because a
    // claim that can be rewritten is a claim whose window restarts every time it
    // is typed — which is how one word becomes unlimited time. So this reads
    // first, and only writes when there is genuinely nothing there.
    const existing = await get(claimRef);
    const previous = Number(existing.val()?.claimedAt);
    if (Number.isFinite(previous) && previous > 0) {
      return { ok: true, code, alreadyClaimed: true };
    }

    await set(claimRef, { code, claimedAt: Date.now() });
    return { ok: true, code };
  } catch (error) {
    const cause = error as { code?: string; message?: string } | null;
    const message = String(cause?.message ?? "");
    // The rules refuse a claim against a code that is switched off, which is the
    // one refusal with a meaning worth reporting. Everything else is a failure to
    // write, which is an outage rather than an answer.
    if (/permission/i.test(message)) {
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
    const uid = (await current.ensureUser()).uid;
    const snapshot = await get(ref(current.database, `redeems/${uid}/${normalizeCode(rawCode)}`));
    return snapshot.exists();
  } catch {
    return false;
  }
}