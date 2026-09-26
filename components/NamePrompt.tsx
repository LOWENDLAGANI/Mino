"use client";

import { useEffect, useState } from "react";

interface NamePromptProps {
  open: boolean;
  onSave: (name: string) => void;
  onSkip: () => void;
}

/** One-time prompt so returning visitors never have to type their name again. */
export default function NamePrompt({ open, onSave, onSkip }: NamePromptProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onSkip]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
    else onSkip();
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-5">
      <div
        className="absolute inset-0 bg-black/70"
        style={{ backdropFilter: "blur(6px)" }}
        onClick={onSkip}
        aria-hidden
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Mino"
        className="relative w-full max-w-sm rounded-[26px] border border-white/[0.09] bg-[#131316] p-6 shadow-2xl shadow-black/80 animate-rise"
      >
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white">Welcome to Mino</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-white/45">
          What should Mino call you? It is saved in this browser, so you will not be asked again
          on this device.
        </p>

        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            className="w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/25 focus:border-[#8b7cf6]/60"
          />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 rounded-[12px] px-3 py-2.5 text-[12px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={name.trim() === ""}
              className="flex-1 rounded-[12px] bg-white px-3 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
