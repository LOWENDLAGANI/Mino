"use client";

import { MINO_MODES, getMode, type ModeId } from "@/lib/models";
import { useEffect, useState } from "react";

// ── ModeSelector: Auto / Dev segmented toggle ───────────────────────────────

interface ModeSelectorProps {
  selected: ModeId;
  onChange: (mode: ModeId) => void;
  /** Modes that have a key configured server-side (from /api/chat GET) */
  available: ModeId[];
}

export default function ModeSelector({ selected, onChange, available }: ModeSelectorProps) {
  const [probeDone, setProbeDone] = useState(false);
  const [tooltip, setTooltip] = useState<ModeId | null>(null);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { available?: ModeId[] } | null) => {
        if (d?.available) {
          // Surface server-side availability to the page via a custom event,
          // handled by page.tsx (single source of truth lives there).
          window.dispatchEvent(new CustomEvent("mino:availability", { detail: d.available }));
        }
      })
      .catch(() => undefined)
      .finally(() => setProbeDone(true));
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="AI mode"
      className="flex items-center rounded-full border border-line bg-raised p-0.5"
    >
      {MINO_MODES.map((mode) => {
        const active = selected === mode.id;
        const usable = available.includes(mode.id);
        return (
          <div key={mode.id} className="relative">
            <button
              role="radio"
              aria-checked={active}
              onClick={() => onChange(mode.id)}
              onMouseEnter={() => setTooltip(mode.id)}
              onMouseLeave={() => setTooltip(null)}
              className={`relative rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                active
                  ? "bg-accent text-canvas"
                  : "text-text-mid hover:text-text-hi"
              }`}
              type="button"
            >
              {mode.name}
              {probeDone && !usable && (
                <span
                  className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${
                    active ? "bg-canvas/60" : "bg-amber-400"
                  }`}
                  title={`${mode.envVar} not configured — will fall back`}
                />
              )}
            </button>
            {tooltip === mode.id && (
              <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-line bg-raised p-3 shadow-2xl shadow-black/50 animate-rise">
                <div className="text-[12px] font-medium text-text-hi">{mode.name}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-text-mid">{mode.tagline}</div>
                <div className="mt-1.5 font-mono text-[9px] text-text-low">{mode.engine}</div>
                {probeDone && !usable && (
                  <div className="mt-1.5 text-[10px] text-amber-400">
                    Key not set — will use the other mode
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { getMode };
