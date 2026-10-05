"use client";

import { useState } from "react";
import Link from "next/link";
import MaintenanceGate from "@/components/MaintenanceGate";
import { DONATE_BANK, DONATE_PRESETS, DONATE_QR, DONATE_QR_CAPTION } from "@/lib/donate";

// ── Support Mino ────────────────────────────────────────────────────────────
// Mino is free, so this page asks for nothing until the reader chooses an
// amount, and the QR is the actual ask. The image path and bank fields live in
// lib/donate.ts — drop the QR into /public and fill in the rest there.

function Heart({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 20.7s-7.6-4.7-7.6-10A4.5 4.5 0 0 1 12 7.9a4.5 4.5 0 0 1 7.6 2.8c0 5.3-7.6 10-7.6 10Z" />
    </svg>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Clipboard can be blocked (insecure origin, denied permission);
          // the value is on screen anyway, so failing quietly is fine.
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      aria-label={`Copy ${label}`}
      className="shrink-0 rounded-full border border-white/[0.12] px-2.5 py-1 text-[11.5px] font-medium text-white/60 transition-colors hover:border-white/25 hover:text-white"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function DonatePage() {
  const [amount, setAmount] = useState<number | null>(DONATE_PRESETS[1]);
  const [custom, setCustom] = useState("");
  const [qrBroken, setQrBroken] = useState(false);

  const chosen = custom.trim() ? Number(custom) : amount;
  const payable = Number.isFinite(chosen) && (chosen ?? 0) > 0;

  const rows = [
    { label: "Bank", value: DONATE_BANK.bank },
    { label: "Account holder", value: DONATE_BANK.holder },
    { label: "Account number", value: DONATE_BANK.account },
    { label: "Email", value: DONATE_BANK.email },
  ].filter((row) => row.value);

  return (
    <MaintenanceGate>
      <main className="min-h-dvh bg-[#0b1310] px-5 pb-12 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-8">
        <div className="mx-auto w-full max-w-lg">
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

          <div className="relative mt-7 flex h-14 w-14 items-center justify-center">
            <span
              aria-hidden
              className="animate-halo absolute inset-0 rounded-full bg-rose-400/45 blur-xl"
            />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-300/25 bg-rose-400/10 text-rose-200 shadow-[0_0_28px_-8px_rgba(251,113,133,0.9)]">
              <Heart className="h-6 w-6" />
            </span>
          </div>

          <h1 className="mt-5 text-[clamp(1.9rem,7.5vw,2.9rem)] font-semibold leading-[1.08] tracking-tight">
            Support Mino
          </h1>
          <p className="mt-3 max-w-md text-[clamp(0.98rem,3.4vw,1.1rem)] leading-relaxed text-white/60">
            Mino stays free for everyone, with no ads and no account wall. If it
            saved you time, a little help keeps the models and the servers paid
            for.
          </p>

          {/* Amount */}
          <section className="mt-7">
            <h2 className="text-[13px] font-medium uppercase tracking-[0.14em] text-white/40">
              Pick an amount
            </h2>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {DONATE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setAmount(preset);
                    setCustom("");
                  }}
                  aria-pressed={!custom.trim() && amount === preset}
                  className={`rounded-2xl border px-2 py-3 text-[15px] font-semibold transition-all ${
                    !custom.trim() && amount === preset
                      ? "border-rose-300/50 bg-rose-400/15 text-white shadow-[0_0_24px_-8px_rgba(251,113,133,0.9)]"
                      : "border-white/[0.09] bg-white/[0.04] text-white/65 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.04] px-4 py-3 transition-colors focus-within:border-white/20">
              <span className="text-[15px] text-white/45">RM</span>
              <input
                inputMode="decimal"
                value={custom}
                onChange={(event) => setCustom(event.target.value.replace(/[^\d.]/g, ""))}
                placeholder="Other amount"
                aria-label="Custom amount in ringgit"
                className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-white/25"
              />
              <CopyButton value={payable ? String(chosen) : ""} label="amount" />
            </div>
          </section>

          {/* QR */}
          <section className="mt-7 rounded-[26px] border border-white/[0.08] bg-white/[0.035] p-5 text-center sm:p-6">
            <h2 className="text-[13px] font-medium uppercase tracking-[0.14em] text-white/40">
              Scan to donate
            </h2>

            {qrBroken ? (
              <div className="mt-4 rounded-2xl border border-dashed border-white/[0.14] px-5 py-10">
                <p className="text-[15px] font-medium text-white/85">QR not added yet</p>
                <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-white/45">
                  Put your bank QR in <code className="text-white/70">public/</code> named{" "}
                  <code className="text-white/70">{DONATE_QR.replace("/", "")}</code>, or set{" "}
                  <code className="text-white/70">DONATE_QR</code> in{" "}
                  <code className="text-white/70">lib/donate.ts</code>.
                </p>
              </div>
            ) : (
              <>
                <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3">
                  {/* A fixed square box so the code always scans at the same
                      size and never gets letterboxed by its own aspect ratio. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={DONATE_QR}
                    alt="Bank QR code for donations"
                    onError={() => setQrBroken(true)}
                    width={208}
                    height={208}
                    className="h-[168px] w-[168px] object-contain sm:h-[208px] sm:w-[208px]"
                  />
                </div>
                <p className="mt-3 text-[13px] text-white/45">{DONATE_QR_CAPTION}</p>
              </>
            )}

            {rows.length > 0 && (
              <dl className="mt-5 space-y-2 border-t border-white/[0.07] pt-4 text-left">
                {rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2"
                  >
                    <dt className="shrink-0 text-[12.5px] text-white/45">{row.label}</dt>
                    <dd className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-white/90">
                        {row.value}
                      </span>
                      <CopyButton value={row.value} label={row.label} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <p className="mt-6 text-center text-[13px] leading-relaxed text-white/35">
            Every ringgit goes straight back into Mino. Thank you.
          </p>
        </div>
      </main>
    </MaintenanceGate>
  );
}
