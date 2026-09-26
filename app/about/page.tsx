import Link from "next/link";
import MinoMark from "@/components/MinoMark";

// ── Fill these in ────────────────────────────────────────────────────────────
/** When the first Mino build was created. */
const DATE_CREATED = "Coming soon";

/** Short progress notes, newest first. Replace the placeholders below. */
const PROGRESS: Array<{ label: string; detail: string; state: "done" | "active" | "next" }> = [
  { label: "Local-first chat", detail: "Chats and messages live in your browser's IndexedDB. No account, no server history.", state: "done" },
  { label: "Multi-model routing", detail: "Mino Auto picks the strongest model per message; Mino Dev is tuned for code.", state: "done" },
  { label: "Resilient fallbacks", detail: "If one provider is down or rate-limited, Mino moves to the next without breaking the chat.", state: "done" },
  { label: "Private by design", detail: "You are the placeholder. Describe the next milestone here.", state: "active" },
  { label: "Next", detail: "Describe the next milestone here.", state: "next" },
];

const STATE_STYLES = {
  done: { label: "Shipped", chip: "bg-emerald-400/10 text-emerald-300/90", dot: "bg-emerald-300/80" },
  active: { label: "In progress", chip: "bg-[#9ee7ff]/10 text-[#9ee7ff]", dot: "bg-[#9ee7ff]" },
  next: { label: "Planned", chip: "bg-white/[0.06] text-white/45", dot: "bg-white/25" },
} as const;

export const metadata = {
  title: "About — Mino",
  description: "Mino is a private, local-first AI assistant created and developed by Minetallest.",
};

export default function AboutPage() {
  return (
    <div className="app-surface flex min-h-[100dvh] flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-7 sm:py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[12px] text-white/45 transition-colors hover:text-white/80"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back to chat
        </Link>

        <header className="mt-10 flex flex-col items-center text-center">
          <div className="relative flex h-32 w-32 items-center justify-center sm:h-40 sm:w-40">
            <div className="absolute inset-[-45%] rounded-full bg-[#7567e8]/20 blur-3xl" />
            <MinoMark className="relative h-full w-full" title="Mino" />
          </div>
          <h1 className="mt-7 text-balance text-[42px] font-normal leading-[1.05] tracking-[-0.05em] text-white sm:text-[58px]">
            Mino
          </h1>
          <p className="mt-3 max-w-md text-balance text-[13px] leading-relaxed text-white/45 sm:text-[14px]">
            A private, local-first AI assistant. Every conversation stays on your device unless you
            deliberately reach for something else.
          </p>
        </header>

        <section className="mt-12 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.03] p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Created by</div>
            <p className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-white">Minetallest</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">
              Sole creator, designer, and developer of Mino.
            </p>
          </div>
          <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.03] p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Date created</div>
            <p className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-white">{DATE_CREATED}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">
              When the first build of Mino went live.
            </p>
          </div>
          <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.03] p-5 sm:col-span-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">AI name</div>
            <p className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-white">Mino</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">
              Mino answers to one name only. If it is ever told otherwise, it corrects itself and
              carries on as Mino, created by Minetallest.
            </p>
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Progress</h2>
            <span className="text-[11px] text-white/25">Updated as things land</span>
          </div>
          <ol className="space-y-2">
            {PROGRESS.map((item) => {
              const style = STATE_STYLES[item.state];
              return (
                <li
                  key={item.label}
                  className="flex items-start gap-3.5 rounded-[18px] border border-white/[0.07] bg-white/[0.03] p-4"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-white/90">{item.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${style.chip}`}>
                        {style.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-white/40">{item.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <footer className="mt-12 border-t border-white/[0.07] pt-6 text-center">
          <p className="text-[12px] text-white/35">
            Mino · created by <span className="text-white/60">Minetallest</span>
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            Open Mino
          </Link>
        </footer>
      </div>
    </div>
  );
}
