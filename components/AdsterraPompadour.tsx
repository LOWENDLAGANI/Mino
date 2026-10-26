"use client";

import Link from "next/link";

/**
 * Adsterra Pompadour ad unit.
 *
 * Pompadour is an Adsterra redirect/direct-link format: the dashboard gives you
 * a single URL, and visitors click it to be sent to the advertiser's offer.
 * There is no `atOptions` script for this format — it is a plain anchor.
 *
 * The URL is public by design (it is a tracking link, not a secret) and is
 * embedded in the browser bundle, so it lives in NEXT_PUBLIC_* and is read
 * straight from process.env in the component.
 *
 * If the env var is missing the component renders nothing, so a deployment
 * with no ad configured stays clean rather than showing a broken placeholder.
 */
export default function AdsterraPompadour() {
  const url = process.env.NEXT_PUBLIC_ADSTERRA_POMPADOUR_URL;

  if (!url) return null;

  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex w-full items-center gap-2 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
      aria-label="Sponsored Link — Adsterra Pompadour ad"
      title="Sponsored Link"
    >
      <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      <span className="relative flex shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/40">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2 2 7l10 5 10-5-10-5Z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </span>
      <span className="relative truncate">Sponsored Link</span>
    </Link>
  );
}
