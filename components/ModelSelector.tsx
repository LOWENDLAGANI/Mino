"use client";

import { useRouter } from "next/navigation";
import { MINO_MODES, type ModeId } from "@/lib/models";
import { isUnlocked, lockNoticeFor, MODE_FEATURE } from "@/lib/paywallState";
import type { PlanId } from "@/lib/plans";
import { useEffect, useRef, useState } from "react";

interface ModeSelectorProps {
  selected: ModeId;
  onChange: (mode: ModeId) => void;
  available: ModeId[];
  /** What this visitor has paid for. Null is the free tier. */
  planId: PlanId | null;
}

// Model icons for visual differentiation
const MODEL_ICONS = {
  auto: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1-9.123-12.776" />
      <path d="M15 15.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ),
  code: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  ),
  self: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  ),
};

// Model descriptions with more personality
const MODEL_DESCRIPTIONS = {
  auto: {
    tagline: "Best for everyday tasks",
    features: ["Smart model selection", "Balanced speed & quality", "Great for general questions"],
    color: "emerald",
  },
  code: {
    tagline: "Built for developers",
    features: ["File-aware code blocks", "Technical precision", "Fresh session per task"],
    color: "orange",
  },
  self: {
    tagline: "Mino's own model",
    features: ["Independent AI assistant", "Created by Minetallest", "Exclusive to Mino"],
    color: "azure",
  },
};

export default function ModeSelector({ selected, onChange, available, planId }: ModeSelectorProps) {
  const [probeDone, setProbeDone] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  const activeMode = MINO_MODES.find((mode) => mode.id === selected) ?? MINO_MODES[0];

  useEffect(() => {
    fetch("/api/chat")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { available?: ModeId[]; searchAvailable?: boolean } | null) => {
        if (data?.available) {
          window.dispatchEvent(new CustomEvent("mino:availability", {
            detail: {
              available: data.available,
              searchAvailable: Boolean(data.searchAvailable),
            },
          }));
        }
      })
      .catch(() => undefined)
      .finally(() => setProbeDone(true));
  }, []);

  const selectMode = (mode: ModeId) => {
    onChange(mode);
    detailsRef.current?.removeAttribute("open");
  };

  /** 
   * Pressing a locked mode takes them to the page that sells it.
   *
   * The lock is shown on the mode itself rather than hidden from the menu,
   * because a mode that silently does not appear is a question nobody asks out
   * loud. And it is the pricing page rather than a dialog, so what somebody
   * locked out of Mino Azure sees is the whole table — what Azure is, what it
   * costs, and what else Lunar opens — rather than a one-line refusal.
   */
  const chooseMode = (mode: ModeId) => {
    const feature = MODE_FEATURE[mode];
    if (feature === null || isUnlocked(feature, planId)) {
      selectMode(mode);
      return;
    }
    detailsRef.current?.removeAttribute("open");
    router.push("/plus");
  };

  const getColorClass = (modeId: ModeId, active: boolean) => {
    const desc = MODEL_DESCRIPTIONS[modeId];
    if (active) {
      switch (desc.color) {
        case "azure": return "bg-[#5b9bd5]/20 text-[#5b9bd5]";
        case "orange": return "bg-[#e08e6b]/20 text-[#e08e6b]";
        default: return "bg-[#2a6142] text-white";
      }
    }
    switch (desc.color) {
      case "azure": return "bg-white/[0.05] text-[#5b9bd5]/60";
      case "orange": return "bg-white/[0.05] text-[#e08e6b]/60";
      default: return "bg-white/[0.05] text-white/55";
    }
  };

  const getBorderClass = (modeId: ModeId, active: boolean, usable: boolean) => {
    if (active) {
      switch (MODEL_DESCRIPTIONS[modeId].color) {
        case "azure": return "border-[#5b9bd5]/30";
        case "orange": return "border-[#e08e6b]/30";
        default: return "border-[#3f7d5c]/30";
      }
    }
    return "border-transparent";
  };

  return (
    <details ref={detailsRef} className="group relative" data-tutorial="model-selector">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-full px-2.5 text-[14px] font-medium text-white/85 transition-colors hover:bg-white/[0.06] [&::-webkit-details-marker]:hidden">
        <span className="max-w-[120px] truncate sm:max-w-none">{activeMode.display}</span>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white/45 transition-transform group-open:rotate-180"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </summary>

      <div
        role="radiogroup"
        aria-label="Mino model"
        className="absolute right-0 top-full z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121c18]/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl animate-rise"
      >
        {MINO_MODES.map((mode) => {
          const active = selected === mode.id;
          const usable = available.includes(mode.id);
          const feature = MODE_FEATURE[mode.id];
          const locked = feature !== null && !isUnlocked(feature, planId);
          const notice = feature && locked ? lockNoticeFor(feature, planId) : null;
          const desc = MODEL_DESCRIPTIONS[mode.id];
          const colorClass = getColorClass(mode.id, active);
          const borderClass = getBorderClass(mode.id, active, usable);
          
          return (
            <button
              key={mode.id}
              role="radio"
              aria-checked={active}
              aria-disabled={locked}
              onClick={() => chooseMode(mode.id)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200 ${\n                active ? colorClass : "hover:bg-white/[0.04]"\n              } ${borderClass} border`}\n              type="button"\n            >\n              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${active ? "bg-white/10" : "bg-white/[0.03]"}`}>\n                <span className={colorClass}>\n                  {MODEL_ICONS[mode.id]}\n                </span>\n              </div>\n              <div className="min-w-0 flex-1">\n                <div className="flex items-center gap-2">\n                  <span className={`text-[15px] font-semibold ${active ? "text-white" : "text-white/90"}`}>\n                    {mode.display}\n                  </span>\n                  {desc.color === "azure" && active && (\n                    <span className="h-2 w-2 rounded-full bg-[#5b9bd5] animate-pulse" title="Mino Azure is active" />\n                  )}\n                  {probeDone && !usable && !locked && (\n                    <span\n                      className="h-1.5 w-1.5 rounded-full bg-amber-300/80"\n                      title={mode.id === "code" ? "This mode has no model configured yet" : "This mode will use the other configured provider"}\n                    />\n                  )}\n                </div>\n                <p className="mt-0.5 text-[12px] text-white/50 font-medium">{desc.tagline}</p>\n                <ul className="mt-1.5 space-y-0.5">\n                  {desc.features.map((feature) => (\n                    <li key={feature} className="flex items-center gap-1.5 text-[11px] text-white/40">\n                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-white/30" aria-hidden="true">\n                        <path d="M4.5 12.5 5.5 13.5 7.5 11.5" />\n                      </svg>\n                      {feature}\n                    </li>\n                  ))}\n                </ul>\n              </div>\n              {locked ? (\n                <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] px-2 py-1 text-[10px] font-medium text-white/55">\n                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>\n                    <rect x="4" y="10" width="16" height="11" rx="2" />\n                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />\n                  </svg>\n                  {notice?.planName?.replace("Mino ", "") ?? "Upgrade"}\n                </span>\n              ) : active ? (\n                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white ml-auto">\n                  <path d="m5 12 4 4L19 6" />\n                </svg>\n              ) : null}\n            </button>\n          );
        })}
      </div>
    </details>
  );
}

