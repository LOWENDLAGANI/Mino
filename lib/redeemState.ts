// ── Redeem codes ─────────────────────────────────────────────────────────────
// Pure logic only — no Firebase, no fetch — so every rule about what a code is,
// what claiming one does, and what happens when it is terminated can be tested
// without a browser or a network.
//
// A code is a word the owner chooses, carrying a Dew amount — the pay-as-you-go
// currency Mino bills in. It used to carry a plan and a number of days; the
// subscription model is gone, and so is that shape. A record without a Dew
// amount is not a code any more: it resolves to nothing rather than to the
// nearest thing that still fits, because a code whose meaning cannot be read
// must never turn into somebody's balance by accident.
//
// The important rule, and the reason this is not just "write the amount to the
// user": **a claim never carries an amount.** It records which code was used,
// and what that code is worth is read from the code itself by the server. If
// the claim said "100 Dew", then anything able to write a claim could write
// itself a balance, and the rules that pin the amount would be worth nothing.
// So the only thing a user controls is the name of a code.

/**
 * How a code is written down.
 *
 * Upper case and no spaces, so `mino-topup` and `MINO TOPUP` are one code rather
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
  /** What redeeming it grants, in Dew. */
  dew: number;
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
 * Returns null for anything malformed rather than a half-filled code: a record
 * with no Dew amount, a non-numeric one, a negative one, or one above the
 * ceiling the rules enforce. Legacy `plan`/`days` fields that may still sit on
 * an old record are ignored outright rather than honoured, so a plan value
 * cannot ride in on a code and become money.
 */
export function parseRedeemCode(raw: unknown): RedeemCode | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const code = normalizeCode(value.code ?? value.__name);
  if (!isValidCode(code)) return null;

  // A Dew amount is read strictly: a number, positive, and at most 100,000 —
  // the same ceiling `database.rules.json` validates on the write. A string
  // that happens to look like a number is refused rather than coerced: the rules
  // only ever store a number, so anything else arrived by some other road.
  const rawDew = value.dew;
  if (typeof rawDew !== "number" || !Number.isFinite(rawDew)) return null;
  if (rawDew <= 0 || rawDew > 100_000) return null;
  const dew = Math.round(rawDew * 1000) / 1000;

  const rawCreatedAt = value.createdAt;
  if (typeof rawCreatedAt !== "number" || !Number.isFinite(rawCreatedAt) || rawCreatedAt <= 0) return null;

  return {
    code,
    dew,
    // Absent `active` means created, which is what every code written by the
    // console carries. Defaulting the other way would silently kill every code
    // whose field went missing.
    active: value.active === undefined ? true : value.active === true,
    createdAt: rawCreatedAt,
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

/** What redeeming a code produces: a top-up to the balance. */
export interface DewRedemption {
  code: string;
  dew: number;
}

/**
 * Turns a code into the top-up it grants.
 *
 * The amount comes from the code record, never from the claim — see the note at
 * the top of this file.
 */
export function dewRedemptionValue(code: RedeemCode): DewRedemption {
  return { code: code.code, dew: code.dew };
}
