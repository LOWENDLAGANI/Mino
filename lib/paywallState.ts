// ── The paywall ──────────────────────────────────────────────────────────────
// Pure logic only. Nothing here imports Firebase or touches the DOM, so every
// question about what a plan unlocks — and what a person without one is told —
// is answered in one place and can be tested without a browser.
//
// This is the *interface* gate: it decides what the page shows, not what the
// server will serve. Someone who edits the bundle can walk past it, because the
// decision is being made on a device that has not told the server who they are.
// It is kept anyway, because it is what puts the padlock on the button and the
// sentence in front of the person, and doing that well is worth a second table.
//
// The boundary is `lib/paywallServer.ts`, which decides from the plan the server
// reads out of the database with a token it verified itself. Both files read the
// same `FEATURE_MIN_PLAN` table below, and `tests/paywall-server.test.ts` fails
// if the two ever disagree about what a plan opens.
//
// The rule is one flat table. A capability names the cheapest plan that opens
// it, and everything else — the lock badge, the sentence a blocked person reads,
// which modes disappear — is derived. Adding a paywalled feature means adding
// one row here and nothing else.

import { planById, type FeatureId, type PlanId } from "./plans";
import type { ModeId } from "./models";

export type { FeatureId };

/**
 * Under Dew, capabilities are priced, not locked: everything costs what its
 * tier charges, and the check that matters is the balance, enforced in the
 * routes. This table survives only as the *interface* price hint — what the
 * lock badge used to say — and the plan gates in the interface read it as
 * "always open" now.
 *
 * Kept for compatibility with the tests that pin the plan tables; nothing on
 * the enforcement side reads `FEATURE_MIN_PLAN` any more.
 */
export const FEATURE_MIN_PLAN: Record<FeatureId, PlanId | null> = {
  reasoning: "mini",
  images: "mini",
  azure: "lunar",
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
  { id: "reasoning", label: "Advanced reasoning", blurb: "let Mino think harder on every answer" },
  { id: "images", label: "Image creation", blurb: "create images inside Mino" },
  { id: "azure", label: "Mino Azure", blurb: "answer from Mino's own model" },
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

/**
 * True when this capability may be used — which under Dew is: always, subject
 * to the balance the routes enforce. A signed-out visitor with no account has
 * no balance and will be refused at /api/chat; the interface still shows the
 * controls rather than hiding them, and the refusal sentence does the
 * explaining.
 */
export function isUnlocked(feature: FeatureId, _planId: PlanId | null | undefined): boolean {
  void _planId;
  return true;
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