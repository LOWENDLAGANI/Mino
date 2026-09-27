"use client";

import type { CodeStep, VerificationResult } from "@/lib/types";

// ── Mino — progress and proof ────────────────────────────────────────────────

/**
 * The step timeline.
 *
 * A long code generation is a minute of nothing visible followed by a wall of
 * text. The plan the model declares up front is what turns that into observable
 * progress, so it is shown as a checklist rather than as more prose to read.
 */
export function StepTimeline({ steps, streaming }: { steps: CodeStep[]; streaming: boolean }) {
  if (steps.length === 0) return null;

  return (
    <ol className="mb-3 space-y-1" aria-label="Progress">
      {steps.map((step, index) => (
        <li
          key={`${step.label}-${index}`}
          className={`flex items-center gap-2 text-[12px] leading-relaxed transition-colors ${
            step.status === "active" ? "text-white/75" : "text-white/40"
          }`}
        >
          {step.status === "active" ? (
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[#9ee7ff]/50 border-t-transparent" aria-hidden="true" />
          ) : (
            <span className="flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400/60">
                <path d="m5 12 4 4L19 6" />
              </svg>
            </span>
          )}
          <span className="min-w-0 flex-1">{step.label}</span>
        </li>
      ))}
      {streaming && steps.every((step) => step.status === "done") && (
        <li className="flex items-center gap-2 text-[12px] text-white/40">
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[#9ee7ff]/50 border-t-transparent" aria-hidden="true" />
          <span>Working…</span>
        </li>
      )}
    </ol>
  );
}

/**
 * The result of running the project's own checks.
 *
 * This is the part that makes a coding session trustworthy rather than merely
 * fluent: the output is the tool's, not the model's account of it, and it is fed
 * back on the next turn.
 */
export function VerificationPanel({
  result,
  onDismiss,
}: {
  result: VerificationResult;
  onDismiss?: () => void;
}) {
  return (
    <section
      className={`mb-3 overflow-hidden rounded-2xl border ${
        result.passed ? "border-emerald-400/20 bg-emerald-400/[0.04]" : "border-red-400/20 bg-red-400/[0.04]"
      }`}
      aria-live="polite"
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
            result.passed ? "bg-emerald-400/20 text-emerald-300" : "bg-red-400/20 text-red-300"
          }`}
          aria-hidden="true"
        >
          {result.passed ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 4 4L19 6" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          )}
        </span>
        <span className="font-mono text-[12px] text-white/75">{result.check}</span>
        <span className={`text-[11px] ${result.passed ? "text-emerald-300/80" : "text-red-300/80"}`}>
          {result.passed ? "passed" : "failed"}
        </span>
        <span className="flex-1" />
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          >
            Dismiss
          </button>
        )}
      </header>
      {result.output && (
        <pre className="max-h-64 overflow-auto border-t border-black/20 bg-black/30 px-3 py-2 font-mono text-[11px] leading-[1.55] text-white/60">
          {result.output}
        </pre>
      )}
    </section>
  );
}
