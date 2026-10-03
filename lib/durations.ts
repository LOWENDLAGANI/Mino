// ── Subscription durations ───────────────────────────────────────────────────
// Pure logic only. Nothing here imports Firebase, so the rules about what a
// duration is worth, how long it lasts and how it is written in words can be
// tested without a browser.
//
// A subscription is stored as a plain number of days. That is the whole model,
// and everything else follows from it: the pricing page offers a day, a month
// and a year, the console offers those plus anything in between, and a span
// nobody has a name for — 45 days, say — is still just a number. Storing
// "months" instead would have made the day the buyer can now buy unrepresentable
// the moment somebody used one.

export const DAY_MS = 24 * 60 * 60 * 60 * 1000;

/** Shortest span anyone may buy or be granted. */
export const MIN_DAYS = 1;

/**
 * Longest span. Ten years.
 *
 * A bound, because the console lets an owner type any number of days and a
 * dropped digit is otherwise indistinguishable from a deliberate purchase.
 */
export const MAX_DAYS = 3650;

export type DurationId = "day" | "week" | "month" | "quarter" | "year";

export interface DurationOption {
  id: DurationId;
  /** What the button says. */
  label: string;
  /** The short line under it. */
  blurb: string;
  /** How many days this is. A month is thirty, a year is 365. */
  days: number;
}

/**
 * Every named span, in order.
 *
 * Thirty-day months and 365-day years, not calendar arithmetic. A buyer who
 * starts on the 31st loses a day, and that is stated on the button rather than
 * hidden: the exact end date is printed on the receipt and in the dialog that
 * follows the payment, so nothing here is a surprise later.
 */
export const DURATIONS: readonly DurationOption[] = [
  { id: "day", label: "A day", blurb: "Try it for 24 hours", days: 1 },
  { id: "week", label: "A week", blurb: "7 days", days: 7 },
  { id: "month", label: "A month", blurb: "30 days", days: 30 },
  { id: "quarter", label: "3 months", blurb: "90 days", days: 90 },
  { id: "year", label: "A year", blurb: "365 days", days: 365 },
] as const;

/**
 * The three a buyer can pick.
 *
 * Deliberately fewer than the console offers. A pricing page with a row of
 * every possible length is a spreadsheet, not a choice; the owner can still
 * grant any span at all from the console, which is the right place for the odd
 * one.
 */
export const BUYER_DURATION_IDS = ["day", "month", "year"] as const;

export type BuyerDurationId = (typeof BUYER_DURATION_IDS)[number];

export function durationOption(id: DurationId): DurationOption {
  return DURATIONS.find((option) => option.id === id) ?? DURATIONS[2];
}

export function buyerDuration(id: BuyerDurationId): DurationOption {
  return durationOption(id);
}

/** Clamps any input into something grantable and printable. */
export function normalizeDays(days: unknown): number {
  const value = Math.round(Number(days));
  if (!Number.isFinite(value) || value < MIN_DAYS) return MIN_DAYS;
  return Math.min(value, MAX_DAYS);
}

/** The preset a span of this length is, when it is exactly one. */
export function presetFor(days: number): DurationOption | null {
  return DURATIONS.find((option) => option.days === normalizeDays(days)) ?? null;
}

/**
 * A span in words, for a receipt and for the grant form.
 *
 * Whole months and years are named as such, and everything else is counted in
 * days — because "3 months and 15 days" reads as calendar arithmetic that
 * would need explaining, while "105 days" is exactly what was granted. Long
 * spans fall back to months once there are enough of them to be worth naming,
 * so nobody has to read "730 days".
 */
export function describeDuration(days: unknown): string {
  const total = normalizeDays(days);
  const preset = DURATIONS.find((option) => option.days === total);
  if (preset) return preset.label.toLowerCase();

  if (total >= 365) {
    const years = Math.floor(total / 365);
    const rest = total % 365;
    if (rest === 0) return `${years} year${years === 1 ? "" : "s"}`;
    const months = Math.round(rest / 30);
    return months > 0
      ? `${years} year${years === 1 ? "" : "s"} and ${months} month${months === 1 ? "" : "s"}`
      : `${years} year${years === 1 ? "" : "s"}`;
  }
  if (total >= 60) {
    const months = Math.round(total / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  if (total >= 14 && total % 7 === 0) {
    const weeks = total / 7;
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  return `${total} day${total === 1 ? "" : "s"}`;
}

/** How long a span lasts, in one unit, for the pricing page's button. */
export function endOf(now: number, days: number): number {
  return now + normalizeDays(days) * DAY_MS;
}