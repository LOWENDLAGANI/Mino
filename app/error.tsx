"use client";

// ── Render failures ──────────────────────────────────────────────────────────
// A client-side exception used to reach the visitor as Next's development
// overlay, or as nothing at all in production. This exists so a crash still
// reads as Mino, says what happened in one sentence, and offers the two things
// that actually help: try again, and go back to the chat.
//
// The stack is deliberately not printed. This runs on the visitor's machine and
// a wall of module paths is noise to them; the message alone is enough to know
// whether a retry is worth pressing.

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#060a08] px-6 text-center">
      <div className="relative mb-6 flex h-14 w-14 items-center justify-center">
        <div className="absolute inset-[-45%] rounded-full bg-red-500/10 blur-3xl" aria-hidden />
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#e88f8f"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="relative"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5M12 16.2v.3" />
        </svg>
      </div>

      <h1 className="text-[24px] font-semibold tracking-[-0.03em] text-white">
        Something broke on the way in.
      </h1>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-white/50">
        {error.message || "Mino hit an unexpected error while drawing this screen."}
      </p>

      <div className="mt-6 flex items-center gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-[#2f6b48] px-5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#3a7d55]"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border border-white/10 px-5 py-2.5 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          Back to chat
        </a>
      </div>
    </div>
  );
}
