"use client";

// ── What Mino remembers ─────────────────────────────────────────────────────
// The whole list is shown, not summarised. That is the point: when an answer
// comes back wrong, the first question is always "what did Mino think I
// said", and the fastest answer to that is reading twenty short lines. A
// feature that hid its contents behind a summary would be the same thing that
// makes this class of bug so hard to troubleshoot.
//
// Capture has two doors: this panel, and the suggestion banner under the chat.
// Both end up in the same table, so everything shown here was written either by
// the user or by the user pressing Remember.

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
import { loadSuggestionEnabled, saveSuggestionEnabled } from "@/lib/memorySuggestions";
import type { Memory } from "@/lib/types";

interface MemoryPanelProps {
  /** False hides the panel entirely — no service configured, nothing to sync. */
  syncAvailable: boolean;
}

// Empty state illustration
const EMPTY_MEMORY_ICON = (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-white/15" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.08-.9-.1-1.36-.1Z" />
    <path d="M15 11.5H9" />
    <path d="M12 14.5v-3" />
    <path d="M10.5 17.5h3" />
  </svg>
);

export default function MemoryPanel({ syncAvailable }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [synced, setSynced] = useState(false);
  const [suggestEnabled, setSuggestEnabled] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () => {
    void listMemories().then(setMemories);
  };

  useEffect(refresh, []);

  useEffect(() => setSuggestEnabled(loadSuggestionEnabled()), []);

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
    setDeletingId(id);
    await deleteMemory(id);
    refresh();
    if (syncAvailable) void syncMemoryDelete(id);
    setDeletingId(null);
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
  
  // Calculate storage usage visualization
  const usagePercent = Math.min(100, (memories.length / MEMORY_COUNT_LIMIT) * 100);
  const usageColor = usagePercent >= 90 ? "bg-amber-400" : usagePercent >= 70 ? "bg-[#a9d8bb]" : "bg-[#2f6b48]";

  return (
    <section className="mb-5">
      {/* Header with usage indicator */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#a9d8bb]/10">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-[#a9d8bb]" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.08-.9-.1-1.36-.1Z" />
              <path d="M15 11.5H9" />
              <path d="M12 14.5v-3" />
              <path d="M10.5 17.5h3" />
            </svg>
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-white">What Mino remembers</h3>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 w-20 rounded-full bg-white/[0.08] overflow-hidden">
                <div className={`h-full ${usageColor} transition-all duration-300`} style={{ width: `${usagePercent}%` }} />
              </div>
              <span className="text-[11px] text-white/40">
                {memories.length}/{MEMORY_COUNT_LIMIT}
              </span>
            </div>
          </div>
        </div>
        {syncAvailable && (
          <span className={`text-[11px] transition-colors ${synced ? "text-[#a9d8bb]/60" : "text-white/30"}`}>
            {synced ? "Synced" : "Syncing..."}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="mb-3 text-[12px] leading-relaxed text-white/45">
        Short facts Mino keeps about you and uses in every conversation. Mino
        notices some of them itself and offers them below the chat — you choose
        what it keeps.
        {syncAvailable && synced && " These follow your account across devices."}
      </p>

      {/* Memory list with visual cards */}
      {memories.length > 0 ? (
        <div className="mb-4 space-y-2">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className={`group/mem relative flex items-start gap-3 rounded-xl border p-3 transition-all duration-200 ${
                editingId === memory.id
                  ? "border-[#a9d8bb]/30 bg-[#a9d8bb]/[0.05]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1] hover:bg-white/[0.03]"
              }`}
            >
              {/* Index badge */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-[10px] font-medium text-white/30 tabular-nums">
                {memories.indexOf(memory) + 1}
              </span>
              
              {/* Content */}
              <div className="min-w-0 flex-1">
                {editingId === memory.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      maxLength={MEMORY_TEXT_LIMIT}
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none"
                      aria-label="Edit memory"
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => saveEdit(memory.id)}
                        className="rounded-md px-2.5 py-1 text-[11px] font-medium text-[#0a100d] transition-colors hover:bg-[#a9d8bb]/20"
                        style={{ background: "linear-gradient(135deg, #a9d8bb 0%, #2f6b48 100%)" }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md px-2 py-1 text-[11px] text-white/40 hover:bg-white/[0.07] hover:text-white/70"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] leading-relaxed text-white/75">
                    {memory.text}
                  </p>
                )}
              </div>

              {/* Actions */}
              {editingId !== memory.id && (
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/mem:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(memory.id);
                      setEditDraft(memory.text);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/[0.07] hover:text-[#a9d8bb]"
                    aria-label="Edit memory"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(memory.id)}
                    disabled={deletingId === memory.id}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"
                    aria-label="Delete memory"
                  >
                    {deletingId === memory.id ? (
                      <span className="flex h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Empty state */
        <div className="mb-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 py-8">
          {EMPTY_MEMORY_ICON}
          <p className="text-[13px] text-white/40 text-center">
            No memories yet. Add facts you want Mino to remember.
          </p>
        </div>
      )}

      {/* Add memory form */}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) void submit();
          }}
          maxLength={MEMORY_TEXT_LIMIT}
          disabled={full}
          placeholder={full ? `Limit of ${MEMORY_COUNT_LIMIT} reached` : "I prefer TypeScript over JavaScript..."}
          className="min-w-0 flex-1 rounded-full border border-white/[0.09] bg-white/[0.03] px-4 py-2.5 text-[13px] text-white outline-none transition-all placeholder:text-white/20 focus:border-[#a9d8bb]/40 focus:bg-white/[0.05] disabled:opacity-40"
          aria-label="Add a memory"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={full || !draft.trim()}
          className="shrink-0 rounded-full px-4 py-2.5 text-[13px] font-semibold text-[#0a100d] transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #a9d8bb 0%, #2f6b48 100%)" }}
        >
          Add
        </button>
      </div>

      {/* Notice */}
      {notice && (
        <p role="status" className="mt-2 text-[11.5px] leading-relaxed text-amber-100/75">
          {notice}
        </p>
      )}

      {/* Suggestion toggle */}
      <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] leading-relaxed text-white/50 transition-colors hover:bg-white/[0.03]">
        <input
          type="checkbox"
          checked={suggestEnabled}
          onChange={(event) => {
            setSuggestEnabled(event.target.checked);
            saveSuggestionEnabled(event.target.checked);
          }}
          className="h-4 w-4 shrink-0 rounded border-white/[0.2] bg-white/[0.05] accent-[#a9d8bb] transition-colors"
        />
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-white/25" aria-hidden="true">
            <path d="M9.5 14.5 12 17l-2.5 2.5M7.5 17h9" />
            <circle cx="12" cy="12" r="9.5" />
          </svg>
          Let Mino suggest things to remember
        </span>
      </label>

      {/* Clear all */}
      {memories.length > 0 && (
        <button
          type="button"
          onClick={() => void clearAll()}
          className="mt-3 text-center text-[11.5px] text-white/30 underline-offset-2 transition-colors hover:text-red-200/80 hover:underline"
        >
          Forget everything
        </button>
      )}
    </section>
  );
}

