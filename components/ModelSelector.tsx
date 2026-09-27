"use client";

import { MINO_MODES, type ModeId } from "@/lib/models";
import { useEffect, useRef, useState } from "react";

interface ModeSelectorProps {
  selected: ModeId;
  onChange: (mode: ModeId) => void;
  available: ModeId[];
}

export default function ModeSelector({ selected, onChange, available }: ModeSelectorProps) {
  const [probeDone, setProbeDone] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
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
        className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111113]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl animate-rise"
      >
        {MINO_MODES.map((mode) => {
          const active = selected === mode.id;
          const usable = available.includes(mode.id);
          return (
            <button
              key={mode.id}
              role="radio"
              aria-checked={active}
              onClick={() => selectMode(mode.id)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
              }`}
              type="button"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
                  active ? "bg-[#6f5bea] text-white" : "bg-white/[0.06] text-white/55"
                }`}
              >
                {mode.id === "auto" ? "A" : "C"}
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="flex items-center gap-1.5 text-[14px] font-medium text-white/90">
                  {mode.display}
                  {probeDone && !usable && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-300/80"
                      title={mode.id === "code" ? "This mode has no model configured yet" : "This mode will use the other configured provider"}
                    />
                  )}
                </span>
                <span className="text-[11px] leading-tight text-white/40">{mode.blurb}</span>
              </span>
              {active && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#9ee7ff]">
                  <path d="m5 12 4 4L19 6" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </details>
  );
}
