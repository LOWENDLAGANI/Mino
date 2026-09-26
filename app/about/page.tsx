import Link from "next/link";
import AboutLogo from "@/components/AboutLogo";

// ── Fill these in ────────────────────────────────────────────────────────────
/** When the first Mino build was created. */
const DATE_CREATED = "24/9/2026";

/** Milestones reached, oldest first. Titles only — the point is the trail. */
const PROGRESS: Array<{ label: string; state: "done" | "active" | "next" }> = [
  { label: "Local-first chat", state: "done" },
  { label: "Streaming responses", state: "done" },
  { label: "Auto and Dev modes", state: "done" },
  { label: "Resilient provider fallback", state: "done" },
  { label: "Web search", state: "done" },
  { label: "Camera and file attachments", state: "done" },
  { label: "Anonymous history sync", state: "done" },
  { label: "Strict identity", state: "done" },
  { label: "Settings panel", state: "done" },
  { label: "Admin console", state: "done" },
  { label: "Visitor names", state: "done" },
  { label: "Reasoning effort", state: "done" },
  { label: "Image generation", state: "active" },
  { label: "Next", state: "next" },
];

const STATE_STYLES = {
  done: {
    label: "Shipped",
    chip: "bg-emerald-400/10 text-emerald-300/90",
    ring: "text-emerald-300/70",
    arrow: "text-emerald-300/70",
  },
  active: {
    label: "In progress",
    chip: "bg-[#9ee7ff]/10 text-[#9ee7ff]",
    ring: "text-[#9ee7ff] shadow-[0_0_14px_-2px_rgba(158,231,255,0.5)]",
    arrow: "text-[#9ee7ff]",
  },
  next: {
    label: "Planned",
    chip: "bg-white/[0.06] text-white/45",
    ring: "text-white/25",
    arrow: "text-white/25",
  },
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
            <AboutLogo className="relative h-full w-full" />
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
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Progress</h2>
            <span className="text-[11px] text-white/25">{PROGRESS.length - 1} shipped</span>
          </div>
          <ol className="relative">
            {/* One continuous rail behind the markers, inset to sit on the arrow. */}
            <span
              className="absolute bottom-4 left-[13px] top-4 w-px bg-white/[0.08]"
              aria-hidden
            />
            {PROGRESS.map((item) => {
              const style = STATE_STYLES[item.state];
              return (
                <li key={item.label} className="relative flex items-center gap-3.5 py-2.5">
                  <span
                    className={`relative z-10 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[#0a0a0f] ${style.ring}`}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={style.arrow}
                      aria-hidden
                    >
                      <path d="M5 12h13M13 6l6 6-6 6" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 text-[14px] font-medium text-white/90">{item.label}</span>
                  {item.state !== "done" && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${style.chip}`}
                    >
                      {style.label}
                    </span>
                  )}
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
