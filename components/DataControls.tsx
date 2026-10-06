"use client";

// ── Settings → Your data ─────────────────────────────────────────────────────
// The local-first promise needs a visible end: a backup anyone can take, and
// an eraser anyone can pull. Both run on this device; the eraser additionally
// clears this identity's database nodes with the visitor's own token, and it
// keeps the paid plan — a purchase is not chat history.

import { useState } from "react";
import { exportBackup } from "@/lib/db";
import { deleteAllMyData } from "@/lib/privacy";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DataControls() {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const backup = await exportBackup();
      downloadJson(`mino-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
      setNotice("Backup saved to your downloads.");
    } catch {
      setNotice("Export failed. Try again in a moment.");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 5000);
      return;
    }
    setBusy(true);
    try {
      const result = await deleteAllMyData();
      setConfirmDelete(false);
      setNotice(
        result.remote > 0
          ? "Deleted on this device and from your account. Your plan was kept."
          : "Deleted on this device. Your plan was kept."
      );
      // The page listens for this and resets to a fresh chat, because the
      // thread that was just erased cannot keep standing in front of anyone.
      window.dispatchEvent(new Event("mino:data-wiped"));
    } catch {
      setConfirmDelete(false);
      setNotice("Could not finish deleting. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-semibold text-white">Your data</h3>
      <p className="mb-2.5 text-[11px] leading-relaxed text-white/40">
        Chats live in this browser first. Export keeps a copy you own; deleting removes every
        chat, memory and queue from this device and from your account. Your subscription is
        never touched.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={busy}
          className="flex-1 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[12px] font-medium text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
        >
          Export a backup
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={busy}
          className={`flex-1 rounded-[14px] border px-3 py-2.5 text-[12px] font-medium transition-colors disabled:opacity-40 ${
            confirmDelete
              ? "border-red-400/40 bg-red-500/20 text-red-100"
              : "border-red-400/15 bg-red-500/[0.06] text-red-200/80 hover:bg-red-500/[0.12]"
          }`}
        >
          {busy ? "Deleting…" : confirmDelete ? "Tap again to erase everything" : "Delete all my data"}
        </button>
      </div>

      {notice && (
        <p role="status" className="animate-rise mt-2 text-[11px] leading-relaxed text-white/55">
          {notice}
        </p>
      )}
    </section>
  );
}
