// ── Dew — Mino's pay-as-you-go currency ─────────────────────────────────────
// Pure logic only: no Firebase, no fetch. Everything about what a token costs,
// what a balance means, and what a balance looks like on screen is decided
// here, so the chat route, the image route, the client and the tests cannot
// drift apart.
//
// One Dew is 1/100 of a US dollar in value. Balances are held and computed in
// exactly three decimal places and stored rounded to that, so a balance a
// client computes from the same node the server read is the same balance the
// server enforced with.

export const DEW_PER_UNIT = 100; // 100 Dew = $1.00 of value
export const TRIAL_DEW = 25; // granted once at account creation
/** Below this balance a request is refused before it reaches a model. */
export const DUST_THRESHOLD = 0.05;
/** Mino Azure's smallest plausible answer; refuse below this rather than burning a slot. */
export const AZURE_FLOOR = 0.25;
/** The balance at which the UI chip turns amber, warning of a top-up. */
export const LOW_BALANCE_THRESHOLD = 10;
/** A pack somebody can transfer for, in Dew and ringgit. */
export interface DewPack {
  id: string;
  dew: number;
  ringgit: number;
}
export const DEW_PACKS: readonly DewPack[] = [
  { id: "100", dew: 100, ringgit: 5 },
  { id: "250", dew: 250, ringgit: 10 },
  { id: "500", dew: 500, ringgit: 20 },
  { id: "1000", dew: 1000, ringgit: 35 },
] as const;
/** Same DuitNow QR the rest of the product already uses. */
export const DEW_QR = "/mino-donate-qr.png";
export const DEW_QR_CAPTION = "Scan with your banking app · DuitNow";
/** Rounding: three decimals is the finest a Dew figure is ever kept. */
export const DEW_PRECISION = 3;

/** What one image generation costs, charged on completion. */
export const IMAGE_DEW_COST = 1;

/** Which pricing tier a request bills as. */
export type DewTier = "fast" | "pro";

/**
 * Cost in Dew per 1,000 tokens.
 *
 * Fast covers the flash models Auto and Code run on. Pro covers Mino Azure and
 * any request that explicitly asked for medium or high reasoning. Input and
 * output are priced separately because they cost the deployment separately.
 */
export const DEW_PRICING: Record<DewTier, { input: number; output: number }> = {
  fast: { input: 0.015, output: 0.06 },
  pro: { input: 0.25, output: 1.0 },
};

export interface TokenUsage {
  prompt: number;
  completion: number;
}

/** Rounds away float drift so a balance never shows 0.2999999999999998. */
export function roundDew(value: number): number {
  const factor = 10 ** DEW_PRECISION;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Millidew integer — the integer arithmetic unit, so sums never drift. */
export function toMillidew(value: number): number {
  return Math.round(value * 1000);
}

/** The fast/premium distinction is about how expensive the model is to serve. */
export function tierForRequest(mode: "auto" | "code" | "self", effort: string | null): DewTier {
  if (mode === "self") return "pro";
  if (effort === "medium" || effort === "high") return "pro";
  return "fast";
}

/**
 * The exact cost of one request, in Dew.
 */
export function calcDewCost(tier: DewTier, usage: TokenUsage): number {
  const pricing = DEW_PRICING[tier];
  const inCost = (Math.max(0, usage.prompt) / 1000) * pricing.input;
  const outCost = (Math.max(0, usage.completion) / 1000) * pricing.output;
  return roundDew(inCost + outCost);
}

/**
 * Rough token estimate for streams whose provider never reports usage.
 *
 * The 4-chars-per-token heuristic is deliberately crude; it is only used when
 * the honest number is unavailable, and it always errs in the same direction a
 * long answer errs - low for code-dense text. A provider that reports usage
 * overrides this entirely.
 */
export function estimateTokenUsage(text: string): TokenUsage {
  return { prompt: 0, completion: Math.ceil(text.length / 4) };
}

/**
 * "RM 35" — a ringgit price as the top-up page prints it: whole ringgit
 * without decimals, anything else to two places.
 */
export function formatRinggit(value: number): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `RM ${amount}`;
}

/**
 * "124.5" — a balance as it is shown next to the drop, never more decimals
 * than the currency keeps. A zero balance shows "0" and nothing else.
 */
export function formatDew(value: number): string {
  const rounded = roundDew(value);
  if (rounded === 0) return "0";
  return String(rounded);
}

/** Floor the float sum of credited Dew into a millidew integer. */
export function sumCredits(credits: Record<string, unknown> | null | undefined): number {
  if (!credits) return 0;
  let total = 0;
  for (const value of Object.values(credits)) {
    if (typeof value === "number" && value > 0) total += toMillidew(value);
  }
  return total;
}

/**
 * One account's Dew state, read straight out of the database node.
 *
 * The stored shape is two numbers and a map of credits:
 *   dew/{uid} = { credits: { TRIAL: 25, CODE1: 100 }, spent: 12.375 }
 * The balance is always derived - credits minus spent - never read from a
 * single scalar a client could have written.
 */
export function dewBalanceFrom(
  raw: { credits?: Record<string, number>; spent?: number } | null | undefined
): number {
  if (!raw || typeof raw !== "object") return 0;
  const credits = sumCredits((raw as Record<string, unknown>).credits as Record<string, number>);
  const spent = (raw as Record<string, unknown>).spent;
  const spentValue = typeof spent === "number" && Number.isFinite(spent) && spent > 0 ? toMillidew(spent) : 0;
  return roundDew(Math.max(0, (credits - spentValue) / 1000));
}

/**
 * The rule for writing a spent value: it may only grow for the owner.
 * Encoded here because the routes, the client and the tests must all agree.
 */
export function nextSpent(previous: number, charge: number): number {
  return roundDew(Math.max(0, previous) + Math.max(0, charge));
}

/** True when this balance covers starting a request at `floor`. */
export function canAfford(balance: number, floor: number = DUST_THRESHOLD): boolean {
  return balance >= floor;
}

/** The sentence the chat shows when somebody has run dry. */
export function outOfDewMessage(): string {
  return "**You're out of Dew.** Top up on the /plus page, or redeem a Dew code. Every message is billed for the tokens it uses, so the balance only drops as fast as you actually chat.";
}
