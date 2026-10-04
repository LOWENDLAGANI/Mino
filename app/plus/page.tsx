"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import MaintenanceGate from "@/components/MaintenanceGate";
import PayQrDialog from "@/components/PayQrDialog";
import SubscribeGate from "@/components/SubscribeGate";
import RedeemCodeBox from "@/components/RedeemCodeBox";
import { watchAccount } from "@/lib/account";
import type { AccountView } from "@/lib/accountState";
import { useSubscription } from "@/lib/useSubscription";
import { describeDuration } from "@/lib/durations";
import { subscriptionDetails, type Subscription } from "@/lib/subscriptionState";
import {
  DEFAULT_PLAN,
  FEATURES,
  PLANS,
  TERM_IDS,
  formatRinggit,
  planById,
  planTerm,
  planRank,
  type PlanId,
  type TermId,
} from "@/lib/plans";

// ── Mino subscriptions ──────────────────────────────────────────────────────
// Two real paid plans. Everything about them — price at every length, features,
// payment QR — lives in lib/plans.ts, so this file is only the page that
// presents it.
//
// Three things it has to answer, in this order: what you already have, what
// else there is, and how to pay. A page that only ever asks "would you like to
// buy this" is useless to somebody who has already paid, so the plan somebody
// holds is stated at the top with a tick and its exact remaining time, and the
// plans they could move to are laid out underneath it as an upgrade rather than
// as a second purchase.
//
// A plan belongs to an *account*, so the QR is behind a sign-in. Pressing a plan
// opens SubscribeGate unless this browser is already signed in with Google, and
// the QR opens only once that has succeeded. The alternative is a transfer from
// an account nobody can be identified on, which the owner could confirm and not
// hand to anybody.

function Mark({ on }: { on: boolean }) {
  if (on) {
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto text-[#4da3ff]"
        aria-label="Included"
      >
        <path d="m4.5 12.5 5 5 10-11" />
      </svg>
    );
  }
  return <span className="mx-auto block h-px w-5 bg-white/35" aria-label="Not included" />;
}

function date(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The panel that replaces the buy button for somebody who already has a plan. */
function CurrentPlan({ subscription }: { subscription: Subscription }) {
  const plan = planById(subscription.plan);
  const daysLeft = Math.max(0, Math.ceil((subscription.expiresAt - Date.now()) / 86_400_000));

  return (
    <section className="relative overflow-hidden rounded-[26px] border border-[#4da3ff]/30 bg-[#4da3ff]/[0.07] p-5 shadow-[0_0_50px_-20px_rgba(77,163,255,0.7)] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4da3ff]">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#04070d"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m4.5 12.5 5 5 10-11" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ee7ff]/80">
            Your plan
          </p>
          <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight">
            {plan.name} is active
          </h2>
          <p className="mt-1 text-[14px] leading-snug text-white/55">
            {daysLeft === 0
              ? "It ends today."
              : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · until ${date(
                  subscription.expiresAt
                )}`}
          </p>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-white/[0.07] rounded-[16px] border border-white/[0.07] bg-black/20 px-4">
        {subscriptionDetails(subscription, date).map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-[12.5px] text-white/40">{row.label}</dt>
            <dd className="text-right text-[13px] font-medium text-white/90">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** What moving to a higher plan would actually open up. */
function UpgradeFor({ from, to }: { from: PlanId | null; to: PlanId }) {
  const gains = FEATURES.filter((feature) => {
    const has = (key: "free" | "mini" | "lunar") =>
      from === null ? feature.free : feature[key];
    return feature[to] && !has;
  });
  if (gains.length === 0) return null;

  const plan = planById(to);
  return (
    <section className="mt-5 rounded-[22px] border border-white/[0.08] bg-white/[0.03] p-5">
      <h3 className="text-[13px] font-semibold text-white/90">
        {from === null ? "Upgrade to" : "Switch to"} {plan.name}
      </h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">
        Adds {gains.length} thing{gains.length === 1 ? "" : "s"} you do not have now. You keep
        whatever time is left on your current plan.
      </p>
      <ul className="mt-3 space-y-1.5">
        {gains.map((feature) => (
          <li key={feature.label} className="flex items-center gap-2.5 text-[13.5px] text-white/75">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4da3ff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              aria-hidden
            >
              <path d="m4.5 12.5 5 5 10-11" />
            </svg>
            {feature.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MinoPlusPage() {
  const [plan, setPlan] = useState<PlanId>(DEFAULT_PLAN.id);
  // Which length is being bought. Drives the price, the amount printed in the
  // payment dialog, and nothing else — a month is the default because it is
  // what most people mean by "subscribe".
  const [term, setTerm] = useState<TermId>("month");
  // Which plan the payment QR is open for, or null when the dialog is closed.
  // Kept separate from `plan` so switching tabs with the dialog shut does not
  // open it, and so the QR is never shown for a plan the buyer did not choose.
  const [paying, setPaying] = useState<{ plan: PlanId; term: TermId } | null>(null);
  // The plan whose sign-in gate is open, if any. Null until a signed-out buyer
  // presses a plan, and cleared as soon as they have an account.
  const [gating, setGating] = useState<{ plan: PlanId; term: TermId } | null>(null);
  // null means the account service has not answered yet, which is treated the
  // same as signed out: the gate opens, and it opens for a good reason.
  const [account, setAccount] = useState<AccountView | null>(null);
  const { subscription } = useSubscription();

  useEffect(() => watchAccount((view) => setAccount(view)), []);

  const signedIn = account?.isLinked ?? false;

  const closePay = useCallback(() => setPaying(null), []);
  const closeGate = useCallback(() => setGating(null), []);

  // The single way into the QR. A signed-out browser is sent through the gate
  // first, and never past it.
  const beginPurchase = useCallback(
    (wanted: { plan: PlanId; term: TermId }) => {
      if (signedIn) setPaying(wanted);
      else setGating(wanted);
    },
    [signedIn]
  );

  const signedInAndPaying = useCallback(() => {
    const wanted = gating;
    setGating(null);
    // The account is only just attached, so `signedIn` is still the old value on
    // this render. Carrying the choice across explicitly is what makes the QR
    // open the instant the gate closes rather than one interaction later.
    if (wanted) setPaying(wanted);
  }, [gating]);

  const active = planById(plan);
  const activeTerm = planTerm(active, term);
  const currentPlanId = subscription?.plan ?? null;
  // Somebody already on the best plan is not asked to buy it again; the page
  // opens on the next thing up, which is the only thing there is to sell them.
  const isCurrent = currentPlanId === active.id;
  const upgrades = PLANS.filter((item) => planRank(item.id) > planRank(currentPlanId));

  return (
    <MaintenanceGate>
      <main className="min-h-dvh bg-[#0a0a0b] px-5 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-8">
        <div className="mx-auto w-full max-w-2xl lg:max-w-3xl">
          <Link
            href="/"
            aria-label="Back to Mino"
            className="lift inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.07] text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 5.5 8.5 12l6.5 6.5" />
            </svg>
          </Link>

          {/* What you have comes first. A pricing page that opens by asking for
              money from somebody who already paid is a page that has not read
              who is reading it. */}
          {subscription && <CurrentPlan subscription={subscription} />}

          {!subscription && (
            <h1 className="mt-7 text-[clamp(2.1rem,8vw,3.6rem)] font-semibold leading-[1.05] tracking-tight">
              Mino{" "}
              <span className="bg-gradient-to-r from-[#4da3ff] via-[#9ee7ff] to-[#4da3ff] bg-clip-text text-transparent">
                {active.name.replace("Mino ", "")}
              </span>
            </h1>
          )}
          <p className="mt-3 max-w-xl text-[clamp(1rem,3.6vw,1.3rem)] leading-snug text-white/60">
            {subscription
              ? "Buy longer, or move up a tier — whatever you choose adds to the time you already have."
              : "Get more access with advanced intelligence and agents"}
          </p>

          {/* Plan switch */}
          <div
            role="tablist"
            aria-label="Choose a plan"
            className="mt-6 grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1"
          >
            {PLANS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={plan === item.id}
                onClick={() => setPlan(item.id)}
                className={`relative overflow-hidden rounded-full px-3 py-3 text-[15px] font-medium transition-all ${
                  plan === item.id
                    ? "bg-white/[0.14] text-white shadow-[0_0_22px_-4px_rgba(77,163,255,0.75),0_1px_0_rgba(255,255,255,0.1)_inset]"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {plan === item.id && (
                  <span className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                )}
                <span className="relative flex items-center justify-center gap-1.5">
                  {item.featured && plan === item.id && (
                    <span className="text-[13px] leading-none" aria-hidden>
                      🔥
                    </span>
                  )}
                  {item.short}
                  {currentPlanId === item.id && (
                    <span className="text-[#9ee7ff]" aria-label="your current plan">
                      ✓
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[14px] text-white/45">
            <span className="font-semibold text-white/85">{active.name}</span> — {active.blurb}.{" "}
            {formatRinggit(active.ringgit)} a month, cancel any time.
          </p>

          {/* Length. Three choices, because a page offering every possible span
              is a spreadsheet rather than a choice. */}
          <div className="mt-5 grid grid-cols-3 gap-1.5">
            {TERM_IDS.map((id) => {
              const option = planTerm(active, id);
              const chosen = term === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => setTerm(id)}
                  className={`rounded-[16px] border px-2 py-3 text-center transition-colors ${
                    chosen
                      ? "border-[#4da3ff]/60 bg-[#4da3ff]/15 text-white"
                      : "border-white/[0.09] bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white/80"
                  }`}
                >
                  <span className="block text-[13.5px] font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[13px] font-semibold text-white/85">
                    {formatRinggit(option.ringgit)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-[13.5px] leading-snug text-white/40">
            {active.name} for {describeDuration(activeTerm.days)} —{" "}
            {formatRinggit(activeTerm.ringgit)}, ending{" "}
            {date(Date.now() + activeTerm.days * 86_400_000)}. You will be told the exact date when
            the payment lands.
          </p>

          {/* Features */}
          <section className="relative mt-5 overflow-hidden rounded-[26px] border border-[#4da3ff]/20 bg-white/[0.035] p-4 shadow-[0_0_50px_-18px_rgba(77,163,255,0.6)] sm:p-6">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 sm:gap-x-8">
              <span className="text-[15px] text-white/50">Features</span>
              <span className="w-9 text-center text-[13px] text-white/50 sm:w-20 sm:text-[15px]">
                Free
              </span>
              <span className="w-11 text-center text-[13px] text-white/50 sm:w-20 sm:text-[15px]">
                Mini
              </span>
              <span className="w-12 text-center text-[13px] font-medium text-[#4da3ff] sm:w-20 sm:text-[15px]">
                Lunar
              </span>
            </div>

            <ul className="mt-2">
              {FEATURES.map((feature) => (
                <li
                  key={feature.label}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 border-t border-white/[0.06] py-4 sm:gap-x-8 sm:py-5"
                >
                  <span className="text-[clamp(0.95rem,3.4vw,1.15rem)] leading-snug text-white/90">
                    {feature.label}
                  </span>
                  <span className="w-9 sm:w-20">
                    <Mark on={feature.free} />
                  </span>
                  <span className="w-11 sm:w-20">
                    <Mark on={feature.mini} />
                  </span>
                  <span className="w-12 sm:w-20">
                    <Mark on={feature.lunar} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* What the next tier adds, for somebody who already has one. */}
          {upgrades.length > 0 &&
            upgrades.map((item) => (
              <UpgradeFor key={item.id} from={currentPlanId} to={item.id} />
            ))}

          {isCurrent ? (
            <div className="mt-5 rounded-[20px] border border-[#4da3ff]/25 bg-[#4da3ff]/[0.08] px-5 py-4 text-center">
              <p className="text-[14px] font-medium text-white/90">
                {active.name} is the plan you have.
              </p>
              <p className="mt-1 text-[13px] leading-snug text-white/45">
                Buy it again below whenever you want more time — the days add to what is left.
              </p>
            </div>
          ) : null}

          <div className="relative mt-5">
            {/* Breathing halo behind the button, plus a thin conic ring that
                sweeps once per loop. Both are siblings, so the button stays
                clickable and the glow never shifts layout. */}
            <span
              aria-hidden
              className="animate-halo pointer-events-none absolute -inset-3 rounded-full bg-[#4da3ff]/45 blur-2xl"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-[3px] overflow-hidden rounded-full"
            >
              <span className="animate-sheen absolute inset-y-0 -left-1/2 w-1/2 bg-[conic-gradient(from_90deg_at_50%_50%,transparent,rgba(158,231,255,0.9),transparent)] blur-[2px]" />
            </span>
            <button
              onClick={() => beginPurchase({ plan: active.id, term })}
              className="lift relative flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-4 text-[clamp(1rem,3.8vw,1.15rem)] font-semibold text-black transition-transform sm:py-[18px]"
            >
              {isCurrent
                ? `Add ${describeDuration(activeTerm.days)} of ${active.short}`
                : `${currentPlanId ? "Switch to" : "Get"} ${active.short} — ${formatRinggit(
                    activeTerm.ringgit
                  )}`}
            </button>
          </div>

          <p className="mt-4 text-center text-[14px] text-white/45">
            Billed monthly. Cancel anytime.
          </p>
        </div>
      </main>

      {/* The payment QR for whichever plan and length was pressed. Keyed on the
          plan so a switch starts from a clean image, free of a previous
          plan's error. */}
      {paying && (
        <PayQrDialog
          key={`${paying.plan}-${paying.term}`}
          plan={planById(paying.plan)}
          term={planTerm(planById(paying.plan), paying.term)}
          onClose={closePay}
        />
      )}

      {/* For somebody who was handed a word rather than asked to pay: the
          owner's code is how a manual sale finishes at a distance. */}
      <RedeemCodeBox />

      {/* In front of that, for anyone not signed in: a plan with no account
          behind it is a transfer nobody can be given. */}
      {gating && (
        <SubscribeGate
          plan={planById(gating.plan)}
          term={planTerm(planById(gating.plan), gating.term)}
          onSignedIn={signedInAndPaying}
          onClose={closeGate}
        />
      )}
    </MaintenanceGate>
  );
}