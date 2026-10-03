// ── The paywall ──────────────────────────────────────────────────────────────
// Pure logic only. Nothing here imports Firebase or touches the DOM, so every
// question about what a plan unlocks — and what a person without one is told —
// is answered in one place and can be tested without a browser.
//
// This is a *client-side* gate, and that is a deliberate, stated limit. It stops
// the honest user from using what they have not paid for, and it is what makes
// the pricing page honest about what is behind the paywall. It is not a
// security boundary: someone who edits the bundle can bypass it, because the
// decision has to be made on a device that has not told the server who they are.
// Anything that must not be bypassable — the daily caps, the ban list — is
// enforced in the route handlers, and the caps a plan raises are configuration
// the server already reads.
//
// The rule is one flat table. A capability names the cheapest plan that opens
// it, and everything else — the lock badge, the sentence a blocked person reads,
// which modes disappear — is derived. Adding a paywalled feature means adding
// one row here and nothing else.

import { planById, planRank, type PlanId } from "./plans";
import type { ModeId } from "./models";

export type FeatureId =
  /** Advanced reasoning effort. */
  | "reasoning"
  /** Image generation. */
  | "images"
  /** Additional memory slots. */
  | "memory"
  /** Mino Azure — Mino's own model, served from its own Space. */
  | "azure"
  /** Agent mode with deep research. */
  | "research";

/**
 * The cheapest plan that unlocks each capability, and `null` for free.
 *
 * The whole paywall, in one table, in order of price. Free is what somebody who
 * has never paid for gets, which is why it is `null` rather than a plan: the
 * honest reason a free visitor cannot use a feature is that they have no plan.
 */
export const FEATURE_MIN_PLAN: Record<FeatureId, PlanId | null> = {
  reasoning: "mini",
  images: "mini",
  memory: "mini",
  azure: "lunar",
  research: "lunar",
};

/** One capability, described. */
export interface Feature {
  id: FeatureId;
  /** What it is called in a sentence to somebody who cannot use it. */
  label: string;
  /** The shortest honest explanation of what they are missing. */
  blurb: string;
}

export const FEATURES_CATALOG: readonly Feature[] = [
  { id: "reasoning", label: "Advanced reasoning", blurb: "think harder on every answer" },
  { id: "images", label: "Image creation", blurb: "create and edit images" },
  { id: "memory", label: "More memory", blurb: "keep more in mind about you" },
  { id: "azure", label: "Mino Azure", blurb: "answer from Mino's own model" },
  { id: "research", label: "Agent mode", blurb: "research deeply on its own" },
] as const;

/**
 * Which capability each chat mode needs.
 *
 * A mode is a feature the user picks by name, so gating the modes is the
 * clearest form this gate can take: the lock is on the thing they were about to
 * press, not hidden behind a setting.
 */
export const MODE_FEATURE: Record<ModeId, FeatureId | null> = {
  auto: null,
  code: null,
  self: "azure",
};

/** True when `planId` — or having no plan at all — opens this capability. */
export function isUnlocked(feature: FeatureId, planId: PlanId | null | undefined): boolean {
  const needed = FEATURE_MIN_PLAN[feature];
  return planRank(planId) >= planRank(needed);
}

/** True when this mode may be picked on this plan. */
export function isModeUnlocked(mode: ModeId, planId: PlanId | null | undefined): boolean {
  const feature = MODE_FEATURE[mode];
  return feature === null ? true : isUnlocked(feature, planId);
}

/**
 * What somebody who cannot use something should be told, or null when they can.
 *
 * Written to be read in a dialog with no room for a paragraph: the name of what
 * they are missing, the plan that opens it, and the price, because the price is
 * the thing most people are actually deciding on at this point.
 */
export interface LockNotice {
  feature: FeatureId;
  label: string;
  blurb: string;
  /** The cheapest plan that opens it. Null when the feature is free. */
  requiredPlan: PlanId | null;
  /** "Mino Lunar" or null. */
  planName: string | null;
  /** "RM 15/mo", or null when nothing is required. */
  price: string | null;
  /** The sentence shown to somebody on no plan. */
  title: string;
  /** The sentence under it. */
  body: string;
}

/** Why a mode cannot be picked, or null when it can. */
export function lockNoticeFor(
  feature: FeatureId,
  planId: PlanId | null | undefined
): LockNotice | null {
  if (isUnlocked(feature, planId)) return null;

  const requiredPlan = FEATURE_MIN_PLAN[feature];
  const described = FEATURES_CATALOG.find((entry) => entry.id === feature);
  const label = described?.label ?? "That";
  const blurb = described?.blurb ?? "";
  const plan = requiredPlan ? planById(requiredPlan) : null;

  // Two different sentences, because they are two different situations and
  // telling somebody who already pays for the cheaper tier to buy the dearer one
  // without saying why is how a paywall starts looking like a scam.
  const alreadyPaying = planId !== null && planId !== undefined;
  const title = alreadyPaying
    ? `${label} is part of ${plan?.name ?? "the next plan up"}`
    : `${label} is not on the free tier`;

  return {
    feature,
    label,
    blurb,
    requiredPlan,
    planName: plan?.name ?? null,
    price: plan ? `RM ${plan.ringgit}/mo` : null,
    title,
    body: alreadyPaying
      ? `${plan?.name ?? "The next plan"} adds ${blurb}. You are on ${
          planById(planId as PlanId).name
        } — upgrade to switch it on, and the time you have left carries over.`
      : `${plan?.name ?? "A plan"} adds ${blurb}, from ${
          plan?.ringgit ? `RM ${plan.ringgit}` : ""
        } a month. It attaches to your account, so it is still here on your next device.`,
  };
}

/** The modes this plan can open, in the order the selector shows them. */
export function unlockedModes(
  modes: readonly ModeId[],
  planId: PlanId | null | undefined
): ModeId[] {
  return modes.filter((mode) => isModeUnlocked(mode, planId));
}

/**
 * A safe mode to be in, given what this plan opens.
 *
 * Used when a stored preference turns out to be locked — somebody who used
 * Azure and lets it lapse should not find themselves stuck on a mode they can no
 * longer send. Auto is always open, so there is always somewhere to land.
 */
export function resolveMode(
  preferred: ModeId,
  available: readonly ModeId[],
  planId: PlanId | null | undefined
): ModeId {
  if (available.includes(preferred) && isModeUnlocked(preferred, planId)) return preferred;
  const firstOpen = available.find((mode) => isModeUnlocked(mode, planId));
  return firstOpen ?? available[0] ?? "auto";
}