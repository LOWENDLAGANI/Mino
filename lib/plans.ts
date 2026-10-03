// ── Mino subscriptions ──────────────────────────────────────────────────────
// One file holds every paid tier: what it costs at each length, what it
// unlocks, and the QR a buyer scans to pay for it. Adding a plan, or a length,
// is a single entry here, and the pricing page, the payment dialog, the grant
// form and the receipt the buyer is shown all follow from it.

/**
 * Where the payment QR lives.
 *
 * A DuitNow QR is a merchant code that accepts any amount, so one static image
 * serves every plan and every length — the exact amount to enter is printed
 * next to it rather than baked into the code. To give a plan its own QR, drop an
 * image into /public and point that plan's `qr` at it.
 */
const DEFAULT_QR = "/mino-donate-qr.png";

/** Line shown under the QR in the payment dialog. */
const QR_CAPTION = "Scan with your banking app · DuitNow";

export type PlanId = "mini" | "lunar";

/**
 * The gated capabilities, named here so the comparison table cannot describe
 * something the paywall has never heard of. See `lib/paywallState.ts` for what
 * each one costs and which mode it locks.
 */
export type FeatureId = "reasoning" | "images" | "azure";

/**
 * The lengths a buyer may pay for.
 *
 * A year is ten months rather than twelve. Nobody should have to be talked into
 * a year, and a discount that removes two of them is the one that does not need
 * arguing about. Change the numbers here and the pricing page, the payment
 * dialog and the receipt all change together.
 */
export type TermId = "day" | "month" | "year";

export interface PlanTerm {
  id: TermId;
  /** How many days this term runs for. */
  days: number;
  /** What it costs, in ringgit, for this term. */
  ringgit: number;
  /** The button label, e.g. "A month". */
  label: string;
}

export type Plan = {
  id: PlanId;
  name: string;
  /** The name used on buttons and tab labels, e.g. "Upgrade to Lunar". */
  short: string;
  /**
   * The monthly price. The single number that decides what a month costs, and
   * what the renewal sentence quotes.
   */
  ringgit: number;
  /** What each length costs. Must include a `month` term. */
  terms: readonly PlanTerm[];
  blurb: string;
  /** The plan the page opens on and the one the sidebar advertises. */
  featured: boolean;
  qr: string;
  qrCaption: string;
};

export const PLANS: readonly Plan[] = [
  {
    id: "mini",
    name: "Mino Mini",
    short: "Mini",
    ringgit: 10,
    terms: [
      { id: "day", days: 1, ringgit: 1, label: "A day" },
      { id: "month", days: 30, ringgit: 10, label: "A month" },
      { id: "year", days: 365, ringgit: 100, label: "A year" },
    ],
    blurb: "Everything you need to chat",
    featured: false,
    qr: DEFAULT_QR,
    qrCaption: QR_CAPTION,
  },
  {
    id: "lunar",
    name: "Mino Lunar",
    short: "Lunar",
    ringgit: 15,
    terms: [
      { id: "day", days: 1, ringgit: 1.5, label: "A day" },
      { id: "month", days: 30, ringgit: 15, label: "A month" },
      { id: "year", days: 365, ringgit: 150, label: "A year" },
    ],
    blurb: "Maximum access to the whole brain",
    featured: true,
    qr: DEFAULT_QR,
    qrCaption: QR_CAPTION,
  },
] as const;

/** The plan shown first and the one the hero headline describes. */
export const DEFAULT_PLAN: Plan = PLANS.find((plan) => plan.featured) ?? PLANS[0];

/** The lengths offered on the pricing page, in the order they are offered. */
export const TERM_IDS: readonly TermId[] = ["day", "month", "year"];

/**
 * What each tier unlocks. Read per column, so `free` is what a visitor gets
 * with no plan at all, and a plan never claims something the free tier has.
 *
 * **Every row here is something Mino actually does**, and `enforced` says
 * whether the difference is real *today*. It exists because a row for a feature
 * the product does not have is not marketing, it is a lie somebody pays money
 * to discover — and "Agent mode with deep research" sat in this table for a
 * commit before anything in the codebase could have answered to it.
 *
 * A row with `enforced: false` is included with every plan and is *not yet
 * limited* per plan. It is honest to list it and dishonest to imply otherwise,
 * so `tests/subscription.test.ts` pins the two sets against each other: nothing
 * can be marked included-and-paid without a matching entry in the paywall.
 */
export const FEATURES: readonly {
  label: string;
  /** Which capability this is, for the paywall. Null when it is not gated. */
  feature: FeatureId | null;
  free: boolean;
  mini: boolean;
  lunar: boolean;
  /** True when the difference is enforced in the product, not just promised. */
  enforced: boolean;
}[] = [
  // Free for everybody. Mino works with a name, and this is what it does.
  { label: "Mino Auto and Mino Code", feature: null, free: true, mini: true, lunar: true, enforced: true },
  { label: "Send photos and screenshots", feature: null, free: true, mini: true, lunar: true, enforced: true },
  { label: "Voice input, uploads and chat history", feature: null, free: true, mini: true, lunar: true, enforced: true },
  { label: "Web search with sources", feature: null, free: true, mini: true, lunar: true, enforced: true },

  // Paid, and genuinely locked. Reasoning above Low and image generation both
  // cost real tokens per message, so gating them is honest on the price side too.
  { label: "Advanced reasoning, medium and high", feature: "reasoning", free: false, mini: true, lunar: true, enforced: true },
  { label: "Image creation", feature: "images", free: false, mini: true, lunar: true, enforced: true },

  // The one genuinely gated thing, and the reason Lunar costs more than Mini.
  { label: "Mino Azure — Mino's own model", feature: "azure", free: false, mini: false, lunar: true, enforced: true },
] as const;

/** The plan with this id, falling back to the default rather than throwing. */
export function planById(id: PlanId): Plan {
  return PLANS.find((plan) => plan.id === id) ?? DEFAULT_PLAN;
}

/** The plan ranking: higher is more. Free is 0. Used by the paywall. */
export function planRank(id: PlanId | null | undefined): 0 | 1 | 2 {
  if (id === "lunar") return 2;
  if (id === "mini") return 1;
  return 0;
}

/**
 * One length of one plan, with the price for it.
 *
 * Falls back to the monthly term rather than throwing: a caller with an unknown
 * term still has to show somebody something, and the month is the safest thing
 * to show.
 */
export function planTerm(plan: Plan, id: TermId): PlanTerm {
  return plan.terms.find((term) => term.id === id) ?? plan.terms.find((term) => term.id === "month") ?? plan.terms[0];
}

/**
 * The priced term a length of days was sold at.
 *
 * Used by the receipt: somebody who bought a year has to be told they bought a
 * year, at the year's price, rather than the headline monthly figure. A span
 * that is not on the price list — the console can grant 45 days — falls back to
 * the month, because there is no honest number to print for a length that was
 * never sold.
 */
export function termForDays(plan: Plan, days: number): PlanTerm {
  return plan.terms.find((term) => term.days === days) ?? planTerm(plan, "month");
}

/**
 * "RM 10" / "RM 1.50" — ringgit formatted in one place, so the plan tab, the
 * button, the payment dialog and the receipt can never quote different prices.
 */
export function formatRinggit(value: number): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `RM ${amount}`;
}

/** The monthly price, as the headline a plan is always described by. */
export function monthlyLabel(plan: Plan): string {
  return `${formatRinggit(plan.ringgit)}/mo`;
}