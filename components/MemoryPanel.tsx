"use client";

// ── What Mino remembers ─────────────────────────────────────────────────────
// The whole list is shown, not summarised. That is the point: when an answer
// comes back wrong, the first question is always "what did Mino think I
// said", and the fastest answer to that is reading twenty short lines. A
// feature that hid its contents behind a summary would be the same thing that
// makes this class of bug so hard to troubleshoot.
//
// Capture is manual throughout — nothing here is written by a model.

import { useEffect, useState } from "react";
import {
  MEMORY_COUNT_LIMIT,
  MEMORY_TEXT_LIMIT,
  addMemory,
  clearMemories,
  deleteMemory,
  listMemories,
  updateMemory,
} from "@/lib/memory";
import { syncMemoryDelete, syncMemoryUp, loadMemoriesFromAccount } from "@/lib/firebaseHistory";
import type { Memory } from "@/lib/types";

interface MemoryPanelProps {
  /** False hides the panel entirely — no service configured, nothing to sync. */
  syncAvailable: boolean;
}

export default function MemoryPanel({ syncAvailable }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [synced, setSynced] = useState(false);

  const refresh = () => {
    void listMemories().then(setMemories);
  };

  useEffect(refresh, []);

  // Adopt anything written on another browser. The local list wins on
  // conflicts — this only ever adds facts this device did not have, so an
  // import can never quietly overwrite something edited here.
  useEffect(() => {
    if (!syncAvailable) return;
    let cancelled = false;
    void (async () => {
      const remote = await loadMemoriesFromAccount();
      if (cancelled || !remote) return;
      const local = await listMemories();
      const known = new Set(local.map((memory) => memory.text.toLowerCase()));
      const incoming = remote.filter((memory) => !known.has(memory.text.toLowerCase()));
      if (incoming.length === 0) {
        if (!cancelled) setSynced(true);
        return;
      }
      const { db } = await import("@/lib/db");
      await db.memories.bulkAdd(incoming);
      if (!cancelled) {
        refresh();
        setSynced(true);
      }
    })().catch(() => {
      // No rules published yet, or offline. Local memories stand alone.
    });
    return () => {
      cancelled = true;
    };
  }, [syncAvailable]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };

  const submit = async () => {
    const result = await addMemory(draft);
    if (result.error) {
      flash(result.error);
      return;
    }
    setDraft("");
    refresh();
    if (syncAvailable && result.memory) void syncMemoryUp(result.memory);
  };

  const saveEdit = async (id: string) => {
    const result = await updateMemory(id, editDraft);
    if (result.error) {
      flash(result.error);
      return;
    }
    setEditingId(null);
    refresh();
    if (syncAvailable && result.memory) void syncMemoryUp(result.memory);
  };

  const remove = async (id: string) => {
    await deleteMemory(id);
    refresh();
    if (syncAvailable) void syncMemoryDelete(id);
  };

  const clearAll = async () => {
    if (!window.confirm("Delete every memory? Mino will forget all of them on every device.")) return;
    const existing = memories;
    await clearMemories();
    refresh();
    if (syncAvailable) {
      await Promise.all(existing.map((memory) => syncMemoryDelete(memory.id)));
    }
  };

  const full = memories.length >= MEMORY_COUNT_LIMIT;

  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-white">What Mino remembers</h3>
        <span className="text-[11px] text-white/35">
          {memories.length}/{MEMORY_COUNT_LIMIT}
        </span>
      </div>

      <p className="mb-3 text-[12px] leading-relaxed text-white/45">
        Short facts Mino keeps about you and uses in every conversation. Nothing
        is remembered without you asking.
        {syncAvailable && synced && " These follow your account across devices."}
      </p>

      {memories.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="group/mem flex items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-2"
            >
              {editingId === memory.id ? (
                <>
                  <input
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    maxLength={MEMORY_TEXT_LIMIT}
                    autoFocus
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none"
                    aria-label="Edit memory"
                  />
                  <button
                    type="button"
                    onClick={() => void saveEdit(memory.id)}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#9ee7ff] hover:bg-white/[0.07]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-white/40 hover:bg-white/[0.07] hover:text-white/70"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/75">
                    {memory.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(memory.id);
                      setEditDraft(memory.text);
                    }}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-white/30 opacity-100 transition-opacity hover:bg-white/[0.07] hover:text-white/70 focus:opacity-100 md:opacity-0 md:group-hover/mem:opacity-100"
                    aria-label="Edit memory"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(memory.id)}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-white/30 opacity-100 transition-opacity hover:bg-white/[0.07] hover:text-red-200/80 focus:opacity-100 md:opacity-0 md:group-hover/mem:opacity-100"
                    aria-label="Delete memory"
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) void submit();
          }}
          maxLength={MEMORY_TEXT_LIMIT}
          disabled={full}
          placeholder={full ? `Limit of ${MEMORY_COUNT_LIMIT} reached` : "I prefer TypeScript over JavaScript"}
          className="min-w-0 flex-1 rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/[0.18] disabled:opacity-40"
          aria-label="Add a memory"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={full || !draft.trim()}
          className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold text-[#08080a] transition-opacity disabled:opacity-30"
          style={{ background: "linear-gradient(180deg, #a9a4ff 0%, #7c7cf4 100%)" }}
        >
          Add
        </button>
      </div>

      {notice && (
        <p role="status" className="mt-2 text-[11.5px] leading-relaxed text-amber-100/75">
          {notice}
        </p>
      )}

      {memories.length > 0 && (
        <button
          type="button"
          onClick={() => void clearAll()}
          className="mt-3 text-[11.5px] text-white/30 underline-offset-2 transition-colors hover:text-red-200/80 hover:underline"
        >
          Forget everything
        </button>
      )}
    </section>
  );
}