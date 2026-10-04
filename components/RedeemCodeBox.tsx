"use client";

import { useState } from "react";
import { claimRedeemCode } from "@/lib/redeem";

// ── Claiming a code ──────────────────────────────────────────────────────────
// The buyer's side of a manual sale. The owner hands over a word, and this is
// where it becomes a plan.
//
// It says plainly that claiming is not instant, because it is not: the claim is
// written to their own account and the server works out what the word was worth
// on their next request. Telling somebody to refresh after typing a code they
// were just given is the difference between "that worked" and "is it broken".
//
// The field is here and not behind a dialog, because the person who needs it
// usually arrived by clicking a link from the person who sold it, and a wall
// between them and the box would be a support message waiting to happen.

export default function RedeemCodeBox() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const claim = await claimRedeemCode(code);
      if (claim.ok) {
        setResult({
          ok: true,
          message: "Code accepted. Your plan is on its way — it will be here in a moment.",
        });
        setCode("");
      } else {
        setResult({ ok: false, message: claim.error ?? "That code could not be used." });
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "That code could not be used.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[14px] border border-dashed border-white/[0.12] px-4 py-3 text-[12px] text-white/50 transition hover:border-white/25 hover:text-white/75"
      >
        Got a code? Redeem it here
      </button>
    );
  }

  return (
    <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-4">
      <label
        htmlFor="redeem-code"
        className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35"
      >
        Your code
      </label>
      <input
        id="redeem-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !busy) void submit();
        }}
        placeholder="MINO-LUNAR"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        className="w-full rounded-[10px] border border-white/[0.09] bg-black/25 px-3 py-2.5 text-[14px] font-semibold uppercase tracking-[0.1em] text-white placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-white/25"
      />

      {result ? (
        <p
          className={`mt-2 text-[12px] leading-relaxed ${
            result.ok ? "text-emerald-300/90" : "text-red-200/90"
          }`}
          role="status"
        >
          {result.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || code.trim() === ""}
          className="flex-1 rounded-[10px] bg-white/10 px-3 py-2.5 text-[12px] font-semibold text-white transition hover:bg-white/[0.16] disabled:opacity-40"
        >
          {busy ? "Checking…" : "Redeem"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="rounded-[10px] px-3 py-2.5 text-[12px] text-white/45 transition hover:text-white/70"
        >
          Close
        </button>
      </div>
    </div>
  );
}