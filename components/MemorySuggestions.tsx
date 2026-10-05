"use client";

// ── Worth remembering ────────────────────────────────────────────────────────
// Mino notices facts by itself now, and offers them instead of storing them.
//
// The offer is the feature. A model that quietly wrote down what it inferred is
// the reason memory in this category has a bad reputation: you find out months
// later that it has been working from a belief you never held. So every line
// here is a claim you can read, keep, edit later, or refuse — and refusing
// outright ("Don't suggest this") is one tap, because the alternative is a
// banner that keeps reappearing at people who have already said no.

import { useState } from "react";
import { addMemory } from "@/lib/memory";
import { syncMemoryUp } from "@/lib/firebaseHistory";

interface MemorySuggestionsProps {
  suggestions: string[];
  /** True while the server decides whether this exchange contains a fact. */
  checking: boolean;
  /** False hides the accept path entirely — no account service, nothing to sync. */
  syncAvailable: boolean;
  /** Stops suggesting for good, remembered on this browser. */
  onStopSuggesting: () => void;
  /** Hides this batch only; the next message can still produce one. */
  onHide: () => void;
}

export default function MemorySuggestions({
  suggestions,
  checking,
  syncAvailable,
  onStopSuggesting,
  onHide,
}: MemorySuggestionsProps) {
  const [saved, setSaved] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  if (!suggestions.length) {
    if (!checking) return null;
    return (
      <div className="mx-4 mb-2 self-center text-[11px] leading-relaxed text-white/25 md:max-w-xl">
        Checking whether this is worth remembering…
      </div>
    );
  }

  const remember = async (text: string) => {
    const result = await addMemory(text);
    if (result.error) {
      setNotice(result.error);
      setTimeout(() => setNotice(null), 4000);
      return;
    }
    setSaved((current) => [...current, text]);
    // The panel reads the same Dexie table live, so nothing has to be told to
    // refresh — the list behind Settings is already showing it.
    if (syncAvailable && result.memory) void syncMemoryUp(result.memory);
  };

  const pending = suggestions.filter((text) => !saved.includes(text));

  return (
    <div className="animate-rise mx-4 mb-2 w-full self-center rounded-2xl border border-[#a9d8bb]/15 bg-[#a9d8bb]/[0.04] p-3 backdrop-blur-md md:max-w-xl">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-white/85">Worth remembering</h3>
        <button
          type="button"
          onClick={onHide}
          className="text-[11px] text-white/30 underline-offset-2 transition-colors hover:text-white/60"
        >
          Not now
        </button>
      </div>

      <ul className="space-y-1.5">
        {suggestions.map((text) => {
          const kept = saved.includes(text);
          return (
            <li
              key={text}
              className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-2"
            >
              <span
                className={`min-w-0 flex-1 text-[13px] leading-relaxed ${
                  kept ? "text-white/35 line-through" : "text-white/75"
                }`}
              >
                {text}
              </span>
              <button
                type="button"
                onClick={() => void remember(text)}
                disabled={kept}
                aria-label={`Remember: ${text}`}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#a9d8bb] transition-opacity hover:bg-white/[0.07] disabled:opacity-30"
              >
                {kept ? "Kept" : "Remember"}
              </button>
            </li>
          );
        })}
      </ul>

      {pending.length > 1 && (
        <button
          type="button"
          onClick={() => void Promise.all(pending.map((text) => remember(text)))}
          className="mt-2.5 text-[11.5px] font-medium text-[#a9d8bb] underline-offset-2 transition-opacity hover:opacity-75"
        >
          Remember all {pending.length}
        </button>
      )}

      {notice && (
        <p role="status" className="mt-2 text-[11.5px] leading-relaxed text-amber-100/75">
          {notice}
        </p>
      )}

      <button
        type="button"
        onClick={onStopSuggesting}
        className="mt-2 text-[11.5px] text-white/25 underline-offset-2 transition-colors hover:text-white/55 hover:underline"
      >
        Don&apos;t suggest this
      </button>
    </div>
  );
}