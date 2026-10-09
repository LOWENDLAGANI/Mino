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

import { formatRinggit, planById, termForDays, type PlanId } from "./plans";
import { DAY_MS, MAX_DAYS, MIN_DAYS, describeDuration, normalizeDays } from "./durations";

export type { PlanId } from "./plans";

/** The payment reference is what the owner reads off their banking app. */
export const NOTE_MAX = 120;

/**
 * One grant. Everything the celebration dialog prints comes from here.
 *
 * The length is a number of days rather than a number of months, because a day
 * is now the shortest thing that can be bought and "months" could not say one.
 */
export interface Subscription {
  plan: PlanId;
  /** When this grant was made — the start of a fresh purchase. */
  grantedAt: number;
  /** When the access runs out. An extension adds to this. */
  expiresAt: number;
  /** How many days were paid for in this grant. */
  days: number;
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
    days: readDays(value),
    note: normalizeNote(value.note),
    announcementId: Math.floor(announcementId),
  };
}

/**
 * How long this record was for.
 *
 * A record written before durations existed carries `months` and no `days`, and
 * those are real paid subscriptions sitting in the database. Reading them as
 * thirty-day months is exactly what they were granted as, so nobody loses the
 * access they already paid for when this ships.
 */
function readDays(value: Record<string, unknown>): number {
  const days = Number(value.days);
  if (Number.isFinite(days) && days > 0) return normalizeDays(days);
  const months = Number(value.months);
  if (Number.isFinite(months) && months > 0) return normalizeDays(months * 30);
  return 30;
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
  days: number,
  now: number
): number {
  const stillRunning = previous && previous.plan === plan && previous.expiresAt > now;
  const from = stillRunning ? previous.expiresAt : now;
  return from + normalizeDays(days) * DAY_MS;
}

/** Builds the record a grant writes. The admin's only job is choosing a plan. */
export function grantRecord(input: {
  plan: PlanId;
  days: number;
  now: number;
  note?: unknown;
  previous?: Subscription | null;
}): Subscription {
  const days = normalizeDays(input.days);
  return {
    plan: input.plan,
    grantedAt: input.now,
    expiresAt: nextExpiry(input.previous, input.plan, days, input.now),
    days,
    note: normalizeNote(input.note),
    announcementId: (input.previous?.announcementId ?? 0) + 1,
  };
}

// ── What the buyer is shown ──────────────────────────────────────────────────

/**
 * The span that was actually granted, measured from the record's own dates.
 *
 * `days` is what the grant *intended*; `expiresAt` is the boundary that is
 * actually enforced. They are not the same thing, because granting to somebody
 * who already has a running plan adds the new days to the end date they already
 * have. Reading "Paid for" from `days` alone is how a receipt ends up claiming
 * "a month" directly above "1800 days left" — two numbers for one subscription,
 * disagreeing, on the same screen.
 *
 * So the span that gets *shown* is the span between the two dates the record
 * carries. That is the truth about what somebody was given, and it cannot
 * contradict the end date, because it is computed from it.
 */
export function grantedSpanDays(subscription: Subscription): number {
  const span = Math.round((subscription.expiresAt - subscription.grantedAt) / DAY_MS);
  return normalizeDays(span > 0 ? span : subscription.days);
}

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
  // Measured from the record, not from what the grant intended — see
  // grantedSpanDays. Every row below is now derived from the same span, so the
  // receipt cannot contradict itself.
  const length = grantedSpanDays(subscription);
  const rows: SubscriptionDetail[] = [
    { label: "Plan", value: plan.name },
    { label: "Paid for", value: describeDuration(length) },
    // Only when the span is one this plan is actually sold at. Printing the
    // monthly price beside "5 years" would be a number nobody charged, so a
    // length that is not on the price list shows no price rather than a wrong
    // one.
    ...(plan.terms.some((term) => term.days === length)
      ? [{ label: "Price", value: formatRinggit(termForDays(plan, length).ringgit) }]
      : []),
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
  return `To keep it, transfer ${formatRinggit(planById(subscription.plan).ringgit)} a month again before ${formatDate(
    subscription.expiresAt
  )}.`;
}

/** The one-word verdict the dialog leads with. */
export function subscriptionVerdict(subscription: Subscription | null): string {
  if (!subscription) return "Free";
  return planById(subscription.plan).name;
}

// ── Paused subscriptions ─────────────────────────────────────────────────────
// A pause is a temporary suspension of access that does not spend the time
// bought. The buyer keeps the days they paid for; they just cannot use them
// while paused. That is the difference between pausing and revoking: revoke is
// a removal, pause is a hold.

/** The pause state written into a subscription record. */
export interface PauseState {
  /** When the pause started, so the pause duration can be measured. */
  pausedAt: number;
  /** When the pause was set, for the audit trail. */
  setAt: number;
  /** The administrator who set it, when known. */
  setBy: string;
  /** Why, in the owner's words. Shown in the console. */
  reason: string;
}

/** Reads a pause state from whatever the database holds. */
export function parsePauseState(raw: unknown): PauseState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const pausedAt = Number(value.pausedAt);
  const setAt = Number(value.setAt);
  if (!Number.isFinite(pausedAt) || pausedAt <= 0) return null;
  if (!Number.isFinite(setAt) || setAt <= 0) return null;
  return {
    pausedAt,
    setAt,
    setBy: String(value.setBy ?? "").slice(0, 120),
    reason: String(value.reason ?? "").slice(0, 200),
  };
}

/** True while the subscription is currently paused. */
export function isPaused(
  subscription: Subscription | null | undefined,
  now = Date.now()
): boolean {
  if (!subscription) return false;
  const candidate = (subscription as Subscription & { pausedUntil?: number }).pausedUntil ?? 0;
  return Number.isFinite(candidate) && candidate > now;
}

/** Read a pausedUntil value from a subscription-shaped object that may carry it. */
export function readPausedUntil(subscription: Subscription | null | undefined): number {
  if (!subscription) return 0;
  const candidate = (subscription as Subscription & { pausedUntil?: number }).pausedUntil ?? 0;
  return Number.isFinite(candidate) ? candidate : 0;
}
/** When the current pause ends, or 0 when not paused. */
export function pausedUntil(subscription: Subscription | null | undefined): number {
  if (!subscription) return 0;
  const raw = (subscription as Subscription & { pausedUntil?: number }).pausedUntil;
  const candidate = raw !== undefined ? raw : 0;
  return Number.isFinite(candidate) ? candidate : 0;
}

/**
 * When a paused subscription resumes, measured from the moment it was paused.
 *
 * The resumed subscription keeps the remaining time it had when paused, not a new
 * full term. Pausing does not spend time; it only defers access.
 */
export function resumeExpiry(
  subscription: Subscription,
  pauseState: PauseState,
  now: number
): number {
  const wasPausedAt = pauseState.pausedAt;
  const remainingAtPause = subscription.expiresAt - wasPausedAt;
  if (remainingAtPause <= 0) return now + DAY_MS; // edge case: already expired when paused
  return wasPausedAt + Math.max(0, remainingAtPause) + (now - wasPausedAt);
}

/**
 * The effective access window once paused status is taken into account.
 *
 * A paused subscription is still owned by the buyer; it just cannot be used
 * until the pause lifts. This helper is what the enforcement path reads so the
 * two decisions — do they have a plan, and is it usable right now — stay in one
 * place.
 */
export function effectiveExpiry(
  subscription: Subscription | null | undefined,
  now = Date.now()
): {
  planId: PlanId | null;
  expiresAt: number;
  paused: boolean;
  pausedUntil: number;
} {
  if (!subscription) return { planId: null, expiresAt: 0, paused: false, pausedUntil: 0 };
  const pUntil = readPausedUntil(subscription);
  return {
    planId: subscription.plan,
    expiresAt: subscription.expiresAt,
    paused: pUntil > now,
    pausedUntil: pUntil,
  };
}

/**
 * Reads the pause state out of a subscription view's raw payload.
 *
 * Kept separate from parseSubscription so the pure subscription logic does not
 * depend on the pause field, and the console can ask for it directly without
 * fishing it out of a parsed Subscription.
 */
export function readPauseState(raw: unknown): PauseState | null {
  if (!raw || typeof raw !== "object") return null;
  return parsePauseState((raw as Record<string, unknown>).pause ?? null);
}
