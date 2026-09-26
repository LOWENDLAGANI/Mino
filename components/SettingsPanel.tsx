"use client";

import type { Appearance, ReasoningEffort, ResponseLength } from "@/lib/settings";
import type { SearchMode } from "@/lib/types";
import { useEffect } from "react";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  searchAvailable: boolean;
  responseLength: ResponseLength;
  onResponseLengthChange: (value: ResponseLength) => void;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  appearance: Appearance;
  onAppearanceChange: (value: Appearance) => void;
}

const SEARCH_OPTIONS: Array<{ id: SearchMode; label: string; description: string }> = [
  { id: "auto", label: "Auto", description: "Only when asked" },
  { id: "always", label: "On", description: "Every message" },
  { id: "off", label: "Off", description: "Never search" },
];

const LENGTH_OPTIONS: Array<{ id: ResponseLength; label: string; description: string }> = [
  { id: "short", label: "Short", description: "Lead with the answer" },
  { id: "balanced", label: "Balanced", description: "Default amount of detail" },
  { id: "detailed", label: "Detailed", description: "Thorough with examples" },
];

const EFFORT_OPTIONS: Array<{ id: ReasoningEffort; label: string; description: string }> = [
  { id: "low", label: "Low", description: "Fastest, cheapest" },
  { id: "medium", label: "Medium", description: "Thinks a little harder" },
  { id: "high", label: "High", description: "Slowest, most careful" },
];

export default function SettingsPanel({
  open,
  onClose,
  searchMode,
  onSearchModeChange,
  searchAvailable,
  responseLength,
  onResponseLengthChange,
  reasoningEffort,
  onReasoningEffortChange,
  appearance,
  onAppearanceChange,
}: SettingsPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/70"
        style={{ backdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mino settings"
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-white/[0.09] bg-[#131316] shadow-2xl shadow-black/80 animate-rise sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Close settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
          <section>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold text-white">Web search</h3>
              {!searchAvailable && <span className="text-[10px] text-amber-200/65">Setup needed</span>}
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-[16px] bg-white/[0.05] p-1">
              {SEARCH_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={!searchAvailable}
                  onClick={() => onSearchModeChange(option.id)}
                  className={`rounded-[12px] px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    searchMode === option.id ? "bg-white/[0.12] text-white" : "text-white/45 hover:bg-white/[0.06] hover:text-white/75"
                  }`}
                >
                  <span className="block text-[12px] font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[9px] text-white/30">{option.description}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-white/30">
              {searchAvailable
                ? "Auto stays quiet for general knowledge questions and searches when you ask for sources."
                : "Add a search API key to the deployment environment to enable web search."}
            </p>
          </section>

          <section>
            <h3 className="mb-2.5 text-[13px] font-semibold text-white">Response length</h3>
            <div className="space-y-1">
              {LENGTH_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onResponseLengthChange(option.id)}
                  className={`flex w-full items-center gap-3 rounded-[16px] border px-3.5 py-3 text-left transition-colors ${
                    responseLength === option.id
                      ? "border-white/[0.14] bg-white/[0.08]"
                      : "border-white/[0.06] hover:bg-white/[0.04]"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      responseLength === option.id ? "border-white" : "border-white/25"
                    }`}
                  >
                    {responseLength === option.id && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-white/90">{option.label}</span>
                    <span className="mt-0.5 block text-[10px] text-white/35">{option.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2.5 text-[13px] font-semibold text-white">Effort</h3>
            <div className="grid grid-cols-3 gap-1 rounded-[16px] bg-white/[0.05] p-1">
              {EFFORT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onReasoningEffortChange(option.id)}
                  className={`rounded-[12px] px-2 py-2 text-left transition-colors ${
                    reasoningEffort === option.id
                      ? "bg-white/[0.12] text-white"
                      : "text-white/45 hover:bg-white/[0.06] hover:text-white/75"
                  }`}
                >
                  <span className="block text-[12px] font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[9px] text-white/30">{option.description}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-white/30">
              How long Mino thinks before answering. Higher effort costs more tokens and time; it is ignored
              by models that do not support it.
            </p>
          </section>

          <section>
            <h3 className="mb-2.5 text-[13px] font-semibold text-white">Appearance</h3>
            <div className="grid grid-cols-2 gap-1 rounded-[16px] bg-white/[0.05] p-1">
              {(["dark", "light"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onAppearanceChange(value)}
                  className={`rounded-[12px] px-3 py-2.5 text-[12px] font-medium capitalize transition-colors ${
                    appearance === value ? "bg-white/[0.12] text-white" : "text-white/45 hover:bg-white/[0.06] hover:text-white/75"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
