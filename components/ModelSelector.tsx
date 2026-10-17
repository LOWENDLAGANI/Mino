"use client";

import { MINO_MODES, type ModeId } from "@/lib/models";
import { useEffect, useRef, useState } from "react";

interface ModeSelectorProps {
  selected: ModeId;
  onChange: (mode: ModeId) => void;
  available: ModeId[];
}

export default function ModeSelector({ selected, onChange, available }: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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
      .catch(() => undefined);
  }, []);

  const selectMode = (mode: ModeId) => {
    onChange(mode);
    setOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      data-tutorial="model-selector"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.06] active:scale-[0.985]"
        aria-label="Switch model"
        aria-expanded={open}
      >
        <span className="max-w-[140px] truncate sm:max-w-none">{activeMode.display}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white/40 transition-transform group-open:rotate-180"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div
          role="radiogroup"
          aria-label="Mino model"
          className="animate-pop absolute right-0 top-full z-50 mt-1.5 w-56 origin-top-right overflow-hidden rounded-xl border border-white/[0.08] bg-[#121c18]/98 p-1 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          {MINO_MODES.map((mode) => {
            const active = selected === mode.id;
            return (
              <button
                key={mode.id}
                role="radio"
                aria-checked={active}
                onClick={() => selectMode(mode.id)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${active ? "bg-[#2f6b48]/20 text-white" : "text-white/75 hover:bg-white/[0.04]"}`}
                type="button"
              >
                <span className={`font-medium ${active ? "text-white" : "text-white/90"}`}>
                  {mode.display}
                </span>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#a9d8bb]">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

