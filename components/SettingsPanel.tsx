"use client";

import type { Appearance, ReasoningEffort, ResponseLength } from "@/lib/settings";
import type { SearchMode } from "@/lib/types";
import { firebaseConfigured } from "@/lib/firebaseHistory";
import { useRouter } from "next/navigation";
import { isUnlocked } from "@/lib/paywallState";
import { useSubscription } from "@/lib/useSubscription";
import { useEffect } from "react";
import AccountSection from "@/components/AccountSection";
import DataControls from "@/components/DataControls";
import MemoryPanel from "@/components/MemoryPanel";
import PushSettings from "@/components/PushSettings";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  displayName: string;
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

const SEARCH_OPTIONS: Array<{ id: SearchMode; label: string; description: string; icon: React.ReactNode }> = [
  { 
    id: "auto", 
    label: "Auto", 
    description: "Smart search when needed",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  },
  { 
    id: "always", 
    label: "On", 
    description: "Search every message",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  },
  { 
    id: "off", 
    label: "Off", 
    description: "Never search",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  },
];

const LENGTH_OPTIONS: Array<{ id: ResponseLength; label: string; description: string }> = [
  { id: "short", label: "Short", description: "Lead with the answer" },
  { id: "balanced", label: "Balanced", description: "Default amount of detail" },
  { id: "detailed", label: "Detailed", description: "Thorough with examples" },
];

const EFFORT_OPTIONS: Array<{ id: ReasoningEffort; label: string; description: string; icon: React.ReactNode }> = [
  { 
    id: "low", 
    label: "Low", 
    description: "Fastest, cheapest",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  },
  { 
    id: "medium", 
    label: "Medium", 
    description: "Thinks a little harder",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  },
  { 
    id: "high", 
    label: "High", 
    description: "Slowest, most careful",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  },
];

/** Effort above Low costs real tokens on every message, so it belongs to a plan. */
const PAID_EFFORT: ReasoningEffort[] = ["medium", "high"];

export default function SettingsPanel({
  open,
  onClose,
  displayName,
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
  // What this visitor has paid for, so the paid effort levels can be locked and
  // say what they take rather than disappearing.
  const { planId } = useSubscription();
  const router = useRouter();

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
        style={{ backdropFilter: "blur(8px)" }}
        onClick={onClose}
        aria-hidden
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mino settings"
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-white/[0.09] bg-[#141f1a] shadow-2xl shadow-black/80 animate-rise sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">Settings</h2>
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

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <AccountSection displayName={displayName} />

          {/* Data controls sit under the account section for everyone — the
              eraser matters most to the visitor with no account at all. */}
          <DataControls />

          {/* Memory sits directly under the account because it follows the
              account, and it is the first thing worth changing after a visitor
              has named themselves. */}
          <MemoryPanel syncAvailable={firebaseConfigured} />

          {/* ── Quick Settings Cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4">
            
            {/* Web Search */}
            <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 card-hover">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-white">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-[#a9d8bb]" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  Web search
                  {!searchAvailable && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" title="No search key in the deployment environment" />
                  )}
                </h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SEARCH_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!searchAvailable}
                    onClick={() => onSearchModeChange(option.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg py-3 px-2 transition-all duration-200 ${\n                      searchMode === option.id\n                        ? "bg-white/[0.1] text-white ring-1 ring-white/20"\n                        : "text-white/45 hover:bg-white/[0.05] hover:text-white/75"\n                    } disabled:cursor-not-allowed disabled:opacity-40`}\n                  >\n                    <span className="text-xl">{option.icon}</span>\n                    <span className="text-[13px] font-medium">{option.label}</span>\n                    <span className="text-[10px] text-white/30">{option.description}</span>\n                  </button>\n                ))}\n              </div>\n            </section>\n\n            {/* Response Length */}\n            <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 card-hover">\n              <h3 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-white">\n                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-[#a9d8bb]" aria-hidden="true">\n                  <path d="M11 4h10M11 4l3 3M11 4v16" />\n                </svg>\n                Response length\n              </h3>\n              <div className="space-y-2">\n                {LENGTH_OPTIONS.map((option) => (\n                  <button\n                    key={option.id}\n                    type="button"\n                    onClick={() => onResponseLengthChange(option.id)}\n                    className={`flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-all duration-200 ${\n                      responseLength === option.id\n                        ? "border-[#a9d8bb]/30 bg-[#a9d8bb]/[0.08]"\n                        : "border-white/[0.06] hover:bg-white/[0.04]"\n                    }`}\n                  >\n                    <span\n                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${\n                        responseLength === option.id ? "border-[#a9d8bb]" : "border-white/25"\n                      }`}\n                    >\n                      {responseLength === option.id && <span className="h-2 w-2 rounded-full bg-[#a9d8bb]" />}\n                    </span>\n                    <div className="min-w-0 flex-1">\n                      <span className="block text-[13px] font-medium text-white/90">{option.label}</span>\n                      <span className="mt-0.5 block text-[11px] text-white/40">{option.description}</span>\n                    </div>\n                  </button>\n                ))}\n              </div>\n            </section>\n\n            {/* Reasoning Effort */}\n            <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 card-hover">\n              <h3 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-white">\n                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-[#a9d8bb]" aria-hidden="true">\n                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />\n                </svg>\n                Reasoning effort\n              </h3>\n              <div className="grid grid-cols-3 gap-2">\n                {EFFORT_OPTIONS.map((option) => {\n                  // Locked rather than hidden. A setting that silently vanishes is\n                  // a question nobody asks out loud, and this one costs real\n                  // tokens, so it is worth saying what it takes rather than\n                  // pretending the option was never there.\n                  const locked = PAID_EFFORT.includes(option.id) && !isUnlocked("reasoning", planId);\n                  return (\n                    <button\n                      key={option.id}\n                      type="button"\n                      aria-disabled={locked}\n                      onClick={() => {\n                        if (locked) {\n                          router.push("/plus");\n                          return;\n                        }\n                        onReasoningEffortChange(option.id);\n                      }}\n                      className={`flex flex-col items-center gap-1.5 rounded-lg py-3 px-2 transition-all duration-200 ${\n                        reasoningEffort === option.id\n                          ? "bg-white/[0.1] text-white ring-1 ring-white/20"\n                          : locked\n                            ? "text-white/30 cursor-not-allowed"\n                            : "text-white/45 hover:bg-white/[0.05] hover:text-white/75"\n                      }`}\n                    >\n                      <span className="text-lg">{option.icon}</span>\n                      <span className="text-[13px] font-medium">{option.label}</span>\n                      <span className="text-[10px] text-white/30">\n                        {locked ? "Mini+" : option.description}\n                      </span>\n                      {locked && (\n                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute text-white/35" aria-hidden>\n                          <rect x="4" y="10" width="16" height="11" rx="2" />\n                          <path d="M8 10V7a4 4 0 0 1 8 0v3" />\n                        </svg>\n                      )}\n                    </button>\n                  );\n                })}\n              </div>\n            </section>\n\n            {/* Appearance */}\n            <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 card-hover">\n              <h3 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-white">\n                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-[#a9d8bb]" aria-hidden="true">\n                  <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />\n                </svg>\n                Appearance\n              </h3>\n              <div className="grid grid-cols-2 gap-2">\n                {(["dark", "light"] as const).map((value) => (\n                  <button\n                    key={value}\n                    type="button"\n                    onClick={() => onAppearanceChange(value)}\n                    className={`flex flex-col items-center gap-2 rounded-lg py-3 px-4 transition-all duration-200 ${\n                      appearance === value\n                        ? "bg-white/[0.1] text-white ring-1 ring-white/20"\n                        : "text-white/45 hover:bg-white/[0.05] hover:text-white/75"\n                    }`}\n                  >\n                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${\n                      appearance === value ? "bg-white/10" : "bg-white/[0.03]"\n                    }`}\n                    >\n                      {value === "dark" ? (\n                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-[#a9d8bb]" aria-hidden="true">\n                          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />\n                        </svg>\n                      ) : (\n                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-[#fcd34d]" aria-hidden="true">\n                          <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />\n                        </svg>\n                      )}\n                    </div>\n                    <span className="text-[13px] font-medium capitalize">{value}</span>\n                  </button>\n                ))}\n              </div>\n            </section>\n          </div>\n\n          {/* Last, because it is the only setting that can fail for reasons\n              outside this device — missing server keys, a blocked permission —\n              and the settings above never do. */}\n          <PushSettings />\n        </div>\n      </section>\n    </div>\n  );
}

