"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MaintenanceGate from "@/components/MaintenanceGate";
import RedeemCodeBox from "@/components/RedeemCodeBox";
import DewQrDialog from "@/components/DewQrDialog";
import { watchAccount } from "@/lib/account";
import type { AccountView } from "@/lib/accountState";
import { useDew } from "@/lib/useDew";
import {
  DEW_PACKS,
  DEW_PRICING,
  IMAGE_DEW_COST,
  TRIAL_DEW,
  formatDew,
  formatRinggit,
  type DewPack,
} from "@/lib/dew";

function DewPanel() {
  const { ready, balance, low, refresh } = useDew();
  useEffect(() => {
    void (async () => {
      try {
        const { authHeader } = await import("@/lib/firebaseHistory");
        await fetch("/api/dew", { method: "POST", headers: await authHeader(), cache: "no-store" });
        await refresh();
      } catch {
        // Balance still shows; the absence of the trial is a balance of 0.
      }
    })();
  }, [refresh]);

  return (
    <section className="relative overflow-hidden rounded-[26px] border border-[#2f6b48]/30 bg-[#2f6b48]/[0.07] p-5 shadow-[0_0_50px_-20px_rgba(47,107,72,0.7)] sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a9d8bb]/80">Your Dew</p>
      <h2 className="mt-1 text-[30px] font-semibold leading-tight tracking-tight">
        💧 {ready ? formatDew(balance) : "…"} <span className="text-[15px] font-normal text-white/50">Dew</span>
      </h2>
      <p className="mt-1 text-[14px] leading-snug text-white/55">
        1 Dew ≈ US$0.01 of model use.{" "}
        {low ? "Running low — top up below." : "Every message is billed for the tokens it actually uses."}
      </p>
    </section>
  );
}

function HowBillingWorks() {
  return (
    <section className="mt-5 rounded-[22px] border border-white/[0.08] bg-white/[0.03] p-5">
      <h2 className="text-[13px] font-semibold text-white/90">How billing works</h2>
      <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-white/60">
        <li>
          Every message is charged for the tokens it uses —{" "}
          <span className="font-medium text-white/85">
            {DEW_PRICING.fast.input} Dew in / {DEW_PRICING.fast.output} Dew out per 1,000 tokens
          </span>{" "}
          on Auto and Code, and{" "}
          <span className="font-medium text-white/85">
            {DEW_PRICING.pro.input} / {DEW_PRICING.pro.output}
          </span>{" "}
          when Mino Azure or heavier reasoning is asked for.
        </li>
        <li>
          One generated picture costs <span className="font-medium text-white/85">{IMAGE_DEW_COST} Dew</span>.
        </li>
        <li>
          A new account starts with <span className="font-medium text-white/85">{TRIAL_DEW} welcome Dew</span>, and
          nothing is charged until it runs out.
        </li>
        <li>Nothing renews and nothing expires: a balance is simply spent as you chat.</li>
      </ul>
    </section>
  );
}

export default function MinoPlusPage() {
  const [dewTopUp, setDewTopUp] = useState<DewPack | null>(null);
  const [account, setAccount] = useState<AccountView | null>(null);
  useEffect(() => watchAccount((view) => setAccount(view)), []);

  const signedIn = account?.status === "guest" || account?.status === "linked";
  const canShowWallet = signedIn;

  return (
    <MaintenanceGate>
      <main className="min-h-dvh bg-[#0b1310] px-5 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-8">
        <div className="mx-auto w-full max-w-2xl lg:max-w-3xl">
          <Link
            href="/"
            aria-label="Back to Mino"
            className="lift mb-6 flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.07] text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white"
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

          <h1 className="text-[clamp(2.1rem,8vw,3.2rem)] font-semibold leading-[1.05] tracking-tight">
            Mino <span className="bg-gradient-to-r from-[#2f6b48] via-[#a9d8bb] to-[#2f6b48] bg-clip-text text-transparent">Dew</span>
          </h1>


          {canShowWallet && <DewPanel />}

          {!canShowWallet && (
            <p className="mt-6 rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-[13.5px] leading-relaxed text-white/55">
              Sign in to see your balance and top up. A balance belongs to an account, so Mino needs
              to know who it is before it can show one.
            </p>
          )}

          {canShowWallet && (
            <section className="mt-5">
              <h2 className="text-[15px] font-semibold text-white">Top up Dew</h2>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {DEW_PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => setDewTopUp(pack)}
                    className="group flex flex-col items-start gap-1 rounded-[18px] border border-white/[0.09] bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:border-[#2f6b48]/50 hover:bg-[#2f6b48]/[0.08]"
                  >
                    <span className="flex items-center gap-1.5 text-[15px] font-semibold text-white">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-[#a9d8bb]" aria-hidden="true">
                        <path d="M12 2.7s6.6 7.1 6.6 11.6a6.6 6.6 0 1 1-13.2 0C5.4 9.8 12 2.7 12 2.7Z" />
                      </svg>
                      {formatDew(pack.dew)} Dew
                    </span>
                    <span className="text-[13px] font-medium text-white/70">
                      {formatRinggit(pack.ringgit)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <ul className="mt-5 space-y-2.5 text-[13px] leading-relaxed text-white/60">
            <li>
              Every message is charged for the tokens it uses —{" "}
              <span className="font-medium text-white/85">
                {DEW_PRICING.fast.input} Dew in / {DEW_PRICING.fast.output} Dew out per 1,000 tokens
              </span>{" "}
              on Auto and Code, and{" "}
              <span className="font-medium text-white/85">
                {DEW_PRICING.pro.input} / {DEW_PRICING.pro.output}
              </span>{" "}
              when Mino Azure or heavier reasoning is asked for.
            </li>
            <li>
              One generated picture costs <span className="font-medium text-white/85">{IMAGE_DEW_COST} Dew</span>.
            </li>
            <li>
              A new account starts with <span className="font-medium text-white/85">{TRIAL_DEW} welcome Dew</span>, and
              nothing is charged until it runs out.
            </li>
            <li>Nothing renews and nothing expires: a balance is simply spent as you chat.</li>
          </ul>

          <div className="mt-5">
            <RedeemCodeBox />
          </div>
        </div>
      </main>

      {dewTopUp && <DewQrDialog key={dewTopUp.id} pack={dewTopUp} onClose={() => setDewTopUp(null)} />}
    </MaintenanceGate>
  );
}
