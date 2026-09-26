"use client";

import { useEffect, useState } from "react";

interface NamePromptProps {
  open: boolean;
  onSave: (name: string) => void;
}

/**
 * Mandatory entry gate: Mino cannot be used until a name is given.
 *
 * There is deliberately no skip, no backdrop dismissal and no Escape handler —
 * the name is what the admin console lists visitors by, so it is required.
 */
export default function NamePrompt({ open, onSave }: NamePromptProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-5">
      <div
        className="absolute inset-0 bg-black/80"
        style={{ backdropFilter: "blur(8px)" }}
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
          Before you can use Mino, tell us your name. It is saved in this browser, so you will not
          be asked again on this device.
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
            aria-label="Your name"
            className="w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-[15px] text-white outline-none placeholder:text-white/25 focus:border-[#8b7cf6]/60"
          />
          <button
            type="submit"
            disabled={name.trim() === ""}
            className="mt-4 w-full rounded-[12px] bg-white px-3 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Enter Mino
          </button>
          <p className="mt-3 text-center text-[10px] leading-relaxed text-white/25">
            Mino cannot be opened until a name is entered.
          </p>
        </form>
      </section>
    </div>
  );
}
