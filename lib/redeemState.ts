// ── Redeem codes ─────────────────────────────────────────────────────────────
// Pure logic only — no Firebase, no fetch — so every rule about what a code is,
// what claiming one does, and what happens when it is terminated can be tested
// without a browser or a network.
//
// A code is a word the owner chooses, carrying either a legacy plan + number of
// days (the old subscription model, still honoured by the claimer) or a Dew
// amount — the pay-as-you-go currency. The owner can switch any code off and
// back on again from the console. A visitor types the word, and the server
// reads what the code is worth from the code itself.
//
// The important rule, and the reason this is not just "write the plan to the
// user": **a claim never carries a plan or a duration.** It records which code
// was used, and the plan and the length are read from that code by the server.
// If the claim itself said "lunar, 365 days", then anything that could write a
// claim could write itself a plan, and the paywall would be worth nothing. So
// the only thing a user controls is the name of a code, and what that code is
// worth is not theirs to say.

import { planRank, type PlanId } from "./plans";
import { DAY_MS, MAX_DAYS, MIN_DAYS, normalizeDays } from "./durations";

/**
 * How a code is written down.
 *
 * Upper case and no spaces, so `mino-lunar` and `MINO LUNAR` are one code rather
 * than two that a buyer could mistype between. The owner picks the word; this
 * only decides the form it is stored in.
 */
export const CODE_MAX = 32;

export function normalizeCode(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, CODE_MAX);
}

/** Whether a word can be used as a code at all. */
export function isValidCode(value: unknown): boolean {
  return normalizeCode(value).length >= 4;
}

/** One code, as stored. */
export interface RedeemCode {
  /** The word, normalized. */
  code: string;
  plan: PlanId;
  /** What redeeming it granted, in days (legacy plan codes only). */
  days: number;
  /**
   * What redeeming it grants, in Dew.
   *
   * Present only on Dew codes; legacy plan codes leave this undefined. The
   * distinction is what the rest of the file branches on: a code with `dew`
   * tops up a balance and never touches a plan, and a code with `plan` does
   * the reverse.
   */
  dew?: number;
  /**
   * Off means the code cannot be redeemed and grants nothing to anyone.
   *
   * A switch rather than a deletion, because an owner who has handed a word out
   * and then found it being resold needs to stop it *now* and be able to bring
   * it back without retyping it.
   */
  active: boolean;
  createdAt: number;
  note: string;
}

/**
 * Reads what the database holds.
 *
 * Returns null for anything malformed rather than a half-filled code. A code
 * missing its plan or its length is not worth redeeming, and guessing at the
 * missing half is how somebody ends up with a plan nobody meant to give them.
 */
export function parseRedeemCode(raw: unknown): RedeemCode | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const code = normalizeCode(value.code ?? value.__name);
  if (!isValidCode(code)) return null;
  // A Dew amount is read strictly: whole-or-three-decimal, positive, and at
  // most 100,000. Anything else is not a Dew code — and a record with a
  // malformed `dew` is not silently downgraded to a plan code, because a code
  // whose meaning cannot be read must not resolve to whatever the reader
  // assumed. It resolves to nothing.
  const rawDew = Number(value.dew ?? NaN);
  let dew: number | undefined = undefined;
  if (Number.isFinite(rawDew)) {
    if (rawDew <= 0 || rawDew > 100_000) return null;
    dew = Math.round(rawDew * 1000) / 1000;
  }
  let plan: PlanId;
  if (dew === undefined) {
    // Legacy shape: a plan code must name a plan.
    if (value.plan !== "mini" && value.plan !== "lunar") return null;
    plan = value.plan;
  } else {
    // A Dew code carries no plan. Anything stored in that field is ignored
    // rather than honoured, so a plan value cannot ride in on a Dew code and
    // unlock something it was never sold for.
    plan = "mini";
  }

  const createdAt = Number(value.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;

  // The length is required on a legacy plan code, and refused rather than
  // defaulted. `normalizeDays` maps a nonsense number to one day, so letting a
  // missing `days` through would hand somebody a single day and call it a
  // month — the kind of mistake that is invisible in the console and
  // infuriating to the buyer. A Dew code carries `dew` instead and needs no
  // days at all.
  let days = 0;
  if (dew === undefined) {
    const rawDays = Number(value.days);
    if (!Number.isFinite(rawDays) || rawDays <= 0) return null;
    days = normalizeDays(rawDays);
  }

  return {
    code,
    plan,
    dew,
    days,
    // Absent `active` means created, which is what every code written by the
    // console carries. Defaulting the other way would silently kill every code
    // whose field went missing.
    active: value.active === undefined ? true : value.active === true,
    createdAt,
    note: String(value.note ?? "").trim().slice(0, 120),
  };
}

// ── What a code is worth right now ───────────────────────────────────────────

export type RedeemStatus =
  | { ok: true; code: RedeemCode }
  | { ok: false; reason: "unknown" | "terminated"; message: string };

/**
 * Whether this code can be redeemed by somebody, at this moment.
 *
 * The owner can terminate a code at any time and this is where that takes
 * effect. There is no use count, and that is deliberate rather than an omission:
 * counting redemptions needs a write to `codes/`, which the rules reserve for
 * the administrator, and the deployment holds no service account to do it
 * another way. A counter that stayed at zero while the console printed "0/1
 * used" would be a control that looks real and does nothing, and a "used up"
 * refusal that could never be reached is worse than no such state at all.
 *
 * So one code is one word, and how many people use it is bounded by the owner's
 * switch rather than by a number: switch it off the moment a word is being
 * resold, which is the moment that matters.
 */
export function checkRedeemable(code: RedeemCode | null, now: number): RedeemStatus {
  if (!code) {
    return {
      ok: false,
      reason: "unknown",
      message: "That code was not recognised. Check the letters and try again.",
    };
  }
  if (!code.active) {
    return {
      ok: false,
      reason: "terminated",
      message: "That code has been switched off. Ask for a new one.",
    };
  }
  // Nothing is checked against `now` here: a code does not expire on its own. It
  // is worth what the owner said it is worth, for as long as they leave it on —
  // turning it off is how they end it, and guessing at a deadline of our own
  // would quietly invalidate a code somebody is mid-way through handing over.
  void now;
  return { ok: true, code };
}

// ── What a claim is worth ────────────────────────────────────────────────────

/** What redeeming a Dew code produces: a top-up to the balance. */
export interface DewRedemption {
  dew: number;
}

/** What redeeming a code produces: the plan, and how long it runs from now. */
export interface Redemption {
  plan: PlanId;
  days: number;
  /** Milliseconds from now, for the caller's own arithmetic. */
  expiresAt: number;
}

/**
 * Turns a code into the subscription it grants.
 *
 * Written here rather than in the route so the arithmetic — which is what the
 * owner's console already previews when it shows a stacking grant — is the same
 * in both places.
 */
export function dewRedemptionValue(code: RedeemCode): DewRedemption | null {
  if (code.dew === undefined) return null;
  return { dew: code.dew };
}

export function redeemValue(code: RedeemCode, now: number): Redemption {
  const days = normalizeDays(code.days);
  return { plan: code.plan, days, expiresAt: now + days * DAY_MS };
}

/**
 * The best of several ways of having a plan.
 *
 * A code and a paid grant are additive in the way a buyer expects: somebody who
 * already has Mini and redeems a Mini code gets a month added to what they had,
 * not a replacement of it. So the winner is decided by tier first and by end
 * date second — a Lunar code must never be beaten by a Mini one that happens to
 * run longer, because that would mean paying more and receiving less.
 */
export function bestPlan(
  entries: readonly Redemption[],
  now: number
): Redemption | null {
  let best: Redemption | null = null;
  for (const entry of entries) {
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= 0) continue;
    // Expired means expired, not merely non-zero.
    //
    // A redemption's end date is measured from when it was *claimed*, so an old
    // claim produces a date in the past that is still a perfectly good positive
    // number. Rejecting only `<= 0` therefore let a lapsed code win this
    // comparison and go on granting its plan for ever — the exact "unlimited
    // time" bug, reappearing through a different door once the clock was
    // anchored correctly. Nothing that has run out is access.
    if (entry.expiresAt <= now) continue;
    if (
      !best ||
      planRank(entry.plan) > planRank(best.plan) ||
      (planRank(entry.plan) === planRank(best.plan) && entry.expiresAt > best.expiresAt)
    ) {
      best = entry;
    }
  }
  return best;
}

/** The ceiling on what a code may be worth, so a typo cannot mint a decade. */
export const CODE_MAX_DAYS = MAX_DAYS;

/** The shortest a code may grant, matching the shortest thing that can be bought. */
export const CODE_MIN_DAYS = MIN_DAYS;