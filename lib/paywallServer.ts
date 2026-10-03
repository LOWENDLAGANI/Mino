// ── The paywall, enforced on the server ─────────────────────────────────────
//
// `lib/paywallState.ts` answers the same questions for the *interface*: which
// mode shows a padlock, what the pricing page promises, where a lock badge
// points. All of that runs on a device the person using it controls, so it is
// advice, not a boundary. Someone who edits the bundle — or who simply posts to
// `/api/chat` with curl — goes straight past it.
//
// This module is the boundary. It takes the plan the *server* read for this
// caller and nothing else. There is deliberately no code path here that accepts
// a plan from the request body, a header, or a query string: a client that
// claims to be on Lunar is a client on whatever the database says, and no amount
// of editing the bundle changes that.
//
// Pure logic, no Firebase and no fetch, so every rule below is testable without
// a network. The two route handlers that use it are the only places a decision
// is actually applied.
//
// Two shapes of refusal, and the difference matters:
//
//   • Asking for something that costs money is **refused**, with the reason and
//     what would open it. Refusing is correct for an edited client: it learns
//     nothing, and the person learns only that the feature is genuinely paid.
//   • Asking for *more reasoning than the plan allows* while not having asked
//     for it at all is **clamped** to what the plan does allow, because that is
//     the route's own default rather than a person's request. Refusing there
//     would lock out free users of Code mode, whose default effort has always
//     been higher.

import { lockNoticeFor, isUnlocked, type FeatureId } from "./paywallState";
import type { PlanId } from "./plans";
import type { ModeId } from "./models";

export type ReasoningEffort = "low" | "medium" | "high";

/** Ordered so a lower index means "less thinking", which is what clamping needs. */
const EFFORT_ORDER: readonly ReasoningEffort[] = ["low", "medium", "high"];

/** The most effort this plan is entitled to. Unpaid means the cheapest one. */
export function maxReasoningEffort(planId: PlanId | null | undefined): ReasoningEffort {
  return isUnlocked("reasoning", planId) ? "high" : "low";
}

function effortRank(effort: ReasoningEffort): number {
  const index = EFFORT_ORDER.indexOf(effort);
  return index === -1 ? 0 : index;
}

/** The most effort allowed, as an actual value. */
export function clampReasoningEffort(
  effort: ReasoningEffort,
  planId: PlanId | null | undefined
): ReasoningEffort {
  const ceiling = maxReasoningEffort(planId);
  return effortRank(effort) <= effortRank(ceiling) ? effort : ceiling;
}

export interface ChatRequest {
  mode: ModeId;
  /**
   * The effort the caller explicitly asked for, or null when they did not ask.
   *
   * The distinction is the whole reason clamping exists: an explicit request for
   * a paid setting is refused, and an absent one is filled in by the route and
   * clamped. Conflating them would either hand out paid reasoning to everyone or
   * break Code mode for people who never asked for anything.
   */
  requestedEffort: ReasoningEffort | null;
  /** The effort the route picks when nobody asked. Clamped, never refused. */
  defaultEffort: ReasoningEffort;
}

export type ChatEntitlement =
  | { allowed: true; mode: ModeId; effort: ReasoningEffort; clamped: boolean }
  | { allowed: false; error: string; feature: FeatureId };

/**
 * Whether this request may proceed, and with what.
 *
 * Only the two paid capabilities in the chat route are decided here. Auto and
 * Code are free, so the ordinary request is untouched by any of this.
 */
export function checkChatEntitlement(
  planId: PlanId | null | undefined,
  request: ChatRequest
): ChatEntitlement {
  // Mino Azure is the one mode the route can be asked for by name, so it is the
  // one mode that has to be checked. Silently answering an Azure request from
  // another model would be the worst outcome available: the person asked for
  // Mino's own model and would be told, truthfully, that some other model
  // answered.
  if (request.mode === "self" && !isUnlocked("azure", planId)) {
    return { allowed: false, feature: "azure", error: refusal("azure", planId) };
  }

  if (
    request.requestedEffort &&
    !isUnlocked("reasoning", planId) &&
    effortRank(request.requestedEffort) > effortRank("low")
  ) {
    return { allowed: false, feature: "reasoning", error: refusal("reasoning", planId) };
  }

  const wanted = request.requestedEffort ?? request.defaultEffort;
  const effort = clampReasoningEffort(wanted, planId);
  return {
    allowed: true,
    mode: request.mode,
    effort,
    clamped: effort !== wanted,
  };
}

export interface EntitlementCheck {
  allowed: boolean;
  /** Present when refused: what to tell the person, and what would open it. */
  error?: string;
  feature?: FeatureId;
}

/** Image generation. Same shape as the chat check so both routes read alike. */
export function checkImageEntitlement(
  planId: PlanId | null | undefined
): EntitlementCheck {
  if (isUnlocked("images", planId)) return { allowed: true };
  return { allowed: false, feature: "images", error: refusal("images", planId) };
}

/** The mode gate on its own, for a caller that only needs to know this. */
export function checkModeEntitlement(
  mode: ModeId,
  planId: PlanId | null | undefined
): EntitlementCheck {
  if (mode !== "self" || isUnlocked("azure", planId)) return { allowed: true };
  return { allowed: false, feature: "azure", error: refusal("azure", planId) };
}

/**
 * What a refused request says.
 *
 * Reuses the wording the lock badge already shows, so the sentence a person
 * reads in the chat is the same sentence they read on the pricing page and
 * cannot drift into describing a plan that does not exist.
 */
function refusal(feature: FeatureId, planId: PlanId | null | undefined): string {
  const notice = lockNoticeFor(feature, planId);
  if (!notice) return "";
  return `${notice.title}. ${notice.body} Open /plus to upgrade.`;
}