// ── Subscription state ──────────────────────────────────────────────────────
// Pure logic only. Nothing here imports Firebase, so the rules that decide what
// a grant means, when a plan has run out, and whether a person is owed the
// celebration dialog can be tested without a browser, a network, or a project.
//
// A subscription is written by the administrator and read by its owner. There
// is no payment gateway in the loop — people transfer by QR and the owner checks
// the bank, then grants by hand — so everything here is about the two moments
// that follow: the record that describes what was bought, and the rule for
// showing the person their purchase landed exactly once.

import { formatRinggit, planById, type PlanId } from "./plans";

/**
 * A month is priced per calendar month but stored as a fixed span.
 *
 * Thirty days rather than a calendar month because there is no date arithmetic
 * in the product worth the complexity, and a person who buys on the 31st should
 * not silently lose a day. What the dialog says is always an exact date, so the
 * approximation is never hidden from them.
 */
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Longest grant the console offers, so a typo cannot buy ten years. */
export const MAX_MONTHS = 12;

/**
 * The spans the console actually offers.
 *
 * A plain list rather than a free number field: the price is per month, so
 * "how many months" is a quantity with sensible values, and typing one is how a
 * ten-year subscription happens by accident.
 */
export const MONTHS_OFFERED = [1, 3, 6, 12] as const;

/** The payment reference is what the owner reads off their banking app. */
export const NOTE_MAX = 120;

/** One grant. Everything the celebration dialog prints comes from here. */
export interface Subscription {
  plan: PlanId;
  /** When this grant was made — the start of a fresh purchase. */
  grantedAt: number;
  /** When the access runs out. An extension adds to this. */
  expiresAt: number;
  /** How many months were paid for in this grant. */
  months: number;
  /** The owner's own note about the payment. Shown to the buyer. */
  note: string;
  /**
   * Increments on every grant.
   *
   * This is what makes the celebration one-shot without needing a delete: the
   * dialog is owed whenever this number is higher than the one the person has
   * already acknowledged, so a second grant — a renewal, a tier upgrade — earns
   * a second dialog while the same grant never earns it twice.
   */
  announcementId: number;
}

export interface SubscriptionView {
  subscription: Subscription | null;
  /** The highest grant this person has already been shown. 0 for never. */
  acknowledged: number;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export function isPlanId(value: unknown): value is PlanId {
  return value === "mini" || value === "lunar";
}

/**
 * Reads what the database actually holds.
 *
 * Returns null rather than a half-filled record for anything that does not
 * look right, because this is what decides whether someone is told they have
 * paid for something. A missing field is far better treated as "no subscription"
 * than as a plan with no end date, which would read as unlimited access.
 */
export function parseSubscription(raw: unknown): Subscription | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!isPlanId(value.plan)) return null;

  const grantedAt = Number(value.grantedAt);
  const expiresAt = Number(value.expiresAt);
  const announcementId = Number(value.announcementId);
  if (!Number.isFinite(grantedAt) || grantedAt <= 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  if (!Number.isFinite(announcementId) || announcementId < 1) return null;

  return {
    plan: value.plan,
    grantedAt,
    // A grant that expires before it began is a mistake, not a long subscription.
    expiresAt: Math.max(expiresAt, grantedAt),
    months: normalizeMonths(value.months),
    note: normalizeNote(value.note),
    announcementId: Math.floor(announcementId),
  };
}

/**
 * Reads the whole node, separating what was bought from what has been shown.
 *
 * Both halves live in one node so a single realtime read answers both questions,
 * and so the acknowledgement can never drift away from the grant it belongs to.
 */
export function parseSubscriptionView(raw: unknown): SubscriptionView {
  if (!raw || typeof raw !== "object") return { subscription: null, acknowledged: 0 };
  const value = raw as Record<string, unknown>;
  const ack = (value.ack ?? {}) as Record<string, unknown>;
  const acknowledged = Number(ack.announcementId);
  return {
    subscription: parseSubscription(value),
    acknowledged: Number.isFinite(acknowledged) && acknowledged > 0 ? Math.floor(acknowledged) : 0,
  };
}

// ── Granting ────────────────────────────────────────────────────────────────

export function normalizeMonths(months: unknown): number {
  const value = Math.floor(Number(months));
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, MAX_MONTHS);
}

export function normalizeNote(note: unknown): string {
  return String(note ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, NOTE_MAX);
}

/**
 * Where a new grant starts counting from.
 *
 * Buying again while a plan is still running adds the months to the date it
 * already ends on, so a renewal never throws away time the buyer paid for.
 * Switching tier starts again from today: there is no proration to work out
 * here, and quietly carrying Mini's remaining days into a Lunar charge would
 * invent a discount nobody agreed to.
 */
export function nextExpiry(
  previous: Subscription | null | undefined,
  plan: PlanId,
  months: number,
  now: number
): number {
  const stillRunning = previous && previous.plan === plan && previous.expiresAt > now;
  const from = stillRunning ? previous.expiresAt : now;
  return from + normalizeMonths(months) * MONTH_MS;
}

/** Builds the record a grant writes. The admin's only job is choosing a plan. */
export function grantRecord(input: {
  plan: PlanId;
  months: number;
  now: number;
  note?: unknown;
  previous?: Subscription | null;
}): Subscription {
  const months = normalizeMonths(input.months);
  return {
    plan: input.plan,
    grantedAt: input.now,
    expiresAt: nextExpiry(input.previous, input.plan, months, input.now),
    months,
    note: normalizeNote(input.note),
    announcementId: (input.previous?.announcementId ?? 0) + 1,
  };
}

// ── What the buyer is shown ──────────────────────────────────────────────────

/** True while the plan has not run out. An expired grant is treated as none. */
export function isActive(subscription: Subscription | null | undefined, now: number): boolean {
  return Boolean(subscription) && (subscription as Subscription).expiresAt > now;
}

/** The person who is owed the dialog, or null when they are not. */
export function shouldCelebrate(
  view: SubscriptionView | null | undefined,
  seen: { local?: number | null; now: number }
): Subscription | null {
  const subscription = view?.subscription ?? null;
  if (!isActive(subscription, seen.now)) return null;
  const id = (subscription as Subscription).announcementId;
  // Both sides are checked because either one alone can fail: the local record
  // is per device and the remote one needs a rule that has been published. With
  // only one of them, a renewal would pop up again forever on a deployment that
  // has not republished, or on a second browser that has never seen it.
  const shown = Math.max(seen.local ?? 0, view?.acknowledged ?? 0);
  return id > shown ? (subscription as Subscription) : null;
}

/** One line, for the sidebar and any other summary. */
export function subscriptionHeadline(subscription: Subscription): string {
  return `${planById(subscription.plan).name} · active`;
}

export interface SubscriptionDetail {
  label: string;
  value: string;
}

/**
 * Everything the celebration prints, in one list.
 *
 * "All the details" means the buyer should never have to ask what they paid for:
 * the tier, what it costs, how long it was paid for, when it started, the exact
 * date it ends, and the payment reference the owner typed when granting it.
 *
 * The date formatter is passed in rather than called here, so this stays pure
 * and the dialog can format dates in the reader's own locale.
 */
export function subscriptionDetails(
  subscription: Subscription,
  formatDate: (timestamp: number) => string
): SubscriptionDetail[] {
  const plan = planById(subscription.plan);
  const rows: SubscriptionDetail[] = [
    { label: "Plan", value: plan.name },
    { label: "Price", value: `${formatRinggit(plan.ringgit)} / month` },
    { label: "Paid for", value: `${subscription.months} month${subscription.months === 1 ? "" : "s"}` },
    { label: "Activated", value: formatDate(subscription.grantedAt) },
    { label: "Active until", value: formatDate(subscription.expiresAt) },
  ];
  if (subscription.note) rows.push({ label: "Payment reference", value: subscription.note });
  return rows;
}

/** The sentence under the details, so nobody is surprised by the end date. */
export function renewalNote(
  subscription: Subscription,
  formatDate: (timestamp: number) => string
): string {
  return `To keep it, transfer ${formatRinggit(
    planById(subscription.plan).ringgit
  )} again before ${formatDate(subscription.expiresAt)}.`;
}

/** The one-word verdict the dialog leads with. */
export function subscriptionVerdict(subscription: Subscription | null): string {
  if (!subscription) return "Free";
  return planById(subscription.plan).name;
}