"use client";

import { MINO_MODELS, getModel } from "@/lib/models";
import { useEffect, useRef, useState } from "react";

// ── ModelSelector: navbar dropdown for vision-capable OpenRouter models ─────

interface ModelSelectorProps {
  selected: string;
  onChange: (modelId: string) => void;
}

export default function ModelSelector({ selected, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getModel(selected);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-ink-500 hover:bg-ink-700"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="max-w-[140px] truncate sm:max-w-none">{current.name}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-2xl shadow-black/60 animate-fade-in-up"
        >
          <div className="border-b border-ink-700 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            Model · vision capable
          </div>
          <ul className="p-1.5">
            {MINO_MODELS.map((m) => (
              <li key={m.id}>
                <button
                  role="option"
                  aria-selected={m.id === selected}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    m.id === selected ? "bg-indigo-950/50" : "hover:bg-ink-700"
                  }`}
                  type="button"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${m.id === selected ? "text-indigo-300" : "text-zinc-200"}`}>
                        {m.name}
                      </span>
                      {m.id === selected && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-400">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">{m.description}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-600">{m.id}</div>
                  </div>
                  <span className="mt-1 shrink-0 rounded border border-ink-600 px-1 py-px text-[9px] uppercase tracking-wide text-zinc-500">
                    {m.vendor}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
