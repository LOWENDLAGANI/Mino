// ── 404 ──────────────────────────────────────────────────────────────────────
// Mino has no marketing sitemap, so almost every unknown URL is a typo or a
// link that aged out. A bare Next 404 reads as a broken site; this says which
// happened and puts the two useful exits in reach.

export default function NotFound() {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#060a08] px-6 text-center">
      <div className="relative mb-6 flex h-14 w-14 items-center justify-center">
        <div className="absolute inset-[-45%] rounded-full bg-[#2f6b48]/20 blur-3xl" aria-hidden />
        <span className="relative text-[30px] font-semibold leading-none tracking-[-0.05em] text-[#a9d8bb]">
          M
        </span>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/30">404</p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.03em] text-white">
        There is nothing at this address.
      </h1>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-white/50">
        The page was moved, renamed, or never existed. Your chats are exactly where you left
        them.
      </p>

      <div className="mt-6 flex items-center gap-2.5">
        <a
          href="/"
          className="rounded-full bg-[#2f6b48] px-5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#3a7d55]"
        >
          Back to chat
        </a>
        <a
          href="/about"
          className="rounded-full border border-white/10 px-5 py-2.5 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          About Mino
        </a>
      </div>
    </div>
  );
}
