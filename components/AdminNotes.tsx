"use client";

import { useEffect, useState } from "react";
import { subscribeAppConfig, type AppConfig } from "@/lib/appConfig";
import { formatNoteDate, newNoteId, type DevNote, type NoteBadgeTone } from "@/lib/notes";

// ── Notes composer ──────────────────────────────────────────────────────────
// Every field on the note is editable here: the badge text and its colour, the
// byline, the date wording, the card summary and the full body. Publishing is
// the only action that writes, so a half-written note stays a draft.

interface AdminNotesProps {
  onError: (message: string | null) => void;
  onSave: (next: AppConfig) => Promise<void>;
  saving: boolean;
}

const TONE_LABELS: Record<NoteBadgeTone, string> = {
  important: "Red",
  info: "Blue",
  success: "Green",
  neutral: "Grey",
};

function blankNote(): DevNote {
  return {
    id: newNoteId(),
    title: "",
    summary: "",
    body: "",
    badge: "",
    badgeTone: "important",
    author: "",
    dateLabel: "",
    published: false,
    publishedAt: 0,
  };
}

const inputClass =
  "w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/25 focus:border-white/25";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[11px] font-medium text-white/50">{children}</span>;
}

export default function AdminNotes({ onError, onSave, saving }: AdminNotesProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<DevNote | null>(null);

  useEffect(
    () =>
      subscribeAppConfig((next) => {
        setConfig(next);
        setTitle(next.notesTitle);
      }),
    [],
  );

  const notes = config?.notes ?? [];

  const commit = (nextNotes: DevNote[], patch?: Partial<AppConfig>) => {
    if (!config) return;
    // `publishedAt` is stamped at the moment of publishing, so the list order
    // and the "Published 25 Sep 2026" line both mean the same thing.
    void onSave({ ...config, notesTitle: title.trim() || config.notesTitle, notes: nextNotes, ...patch })
      .catch(() => undefined);
  };

  const publish = (note: DevNote) => {
    if (!note.title.trim()) {
      onError("A note needs a title before it can be published.");
      return;
    }
    onError(null);
    commit(
      notes.map((entry) =>
        entry.id === note.id
          ? { ...entry, published: true, publishedAt: note.publishedAt || Date.now() }
          : entry,
      ),
    );
    setDraft(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const exists = notes.some((entry) => entry.id === draft.id);
    commit(
      exists ? notes.map((entry) => (entry.id === draft.id ? draft : entry)) : [draft, ...notes],
    );
    setDraft(null);
  };

  const unpublish = (id: string) => commit(notes.map((n) => (n.id === id ? { ...n, published: false } : n)));
  const remove = (id: string) => commit(notes.filter((n) => n.id !== id));

  const set = <K extends keyof DevNote>(key: K, value: DevNote[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <section className="border-t border-white/[0.07] pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
          News from developers
        </h3>
        {saving && <span className="text-[10px] text-white/35">Saving…</span>}
      </div>

      <div>
        <Label>Page title</Label>
        <input
          value={title}
          maxLength={60}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (config && title.trim() && title.trim() !== config.notesTitle) {
              commit(notes, { notesTitle: title.trim() });
            }
          }}
          placeholder="News From Developers"
          className={inputClass}
        />
      </div>

      {/* Composer — opened by New, or by tapping an existing note. */}
      {draft ? (
        <div className="mt-3 space-y-2.5 rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white/70">
              {notes.some((n) => n.id === draft.id) ? "Edit note" : "New note"}
            </span>
            <button
              type="button"
              onClick={() => setDraft(null)}
              aria-label="Cancel"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 hover:bg-white/[0.08] hover:text-white"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
              </svg>
            </button>
          </div>

          <div>
            <Label>Title</Label>
            <input
              value={draft.title}
              maxLength={120}
              onChange={(event) => set("title", event.target.value)}
              placeholder="Force Close Issue"
              className={inputClass}
            />
          </div>

          <div>
            <Label>Badge (blank hides it)</Label>
            <div className="flex gap-2">
              <input
                value={draft.badge}
                maxLength={24}
                onChange={(event) => set("badge", event.target.value)}
                placeholder="Important"
                className={`${inputClass} min-w-0 flex-1`}
              />
              <select
                value={draft.badgeTone}
                onChange={(event) => set("badgeTone", event.target.value as NoteBadgeTone)}
                aria-label="Badge colour"
                className="shrink-0 rounded-[10px] border border-white/10 bg-black/30 px-2 text-[12px] text-white/80 outline-none"
              >
                {(Object.keys(TONE_LABELS) as NoteBadgeTone[]).map((tone) => (
                  <option key={tone} value={tone}>
                    {TONE_LABELS[tone]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Author</Label>
              <input
                value={draft.author}
                maxLength={60}
                onChange={(event) => set("author", event.target.value)}
                placeholder="mino_dev"
                className={inputClass}
              />
            </div>
            <div>
              <Label>Date shown</Label>
              <input
                value={draft.dateLabel}
                maxLength={40}
                onChange={(event) => set("dateLabel", event.target.value)}
                placeholder={formatNoteDate(Date.now()) || "25 Sep"}
                className={inputClass}
              />
            </div>
          </div>
          <p className="-mt-1 text-[10.5px] leading-relaxed text-white/30">
            Leave the date blank to use the publish date automatically.
          </p>

          <div>
            <Label>Card summary</Label>
            <textarea
              value={draft.summary}
              maxLength={240}
              rows={2}
              onChange={(event) => set("summary", event.target.value)}
              placeholder="One or two lines shown on the card. Leave blank to use the body's first lines."
              className={`${inputClass} resize-y leading-relaxed`}
            />
          </div>

          <div>
            <Label>Body (markdown)</Label>
            <textarea
              value={draft.body}
              rows={8}
              onChange={(event) => set("body", event.target.value)}
              placeholder={"The issue was related to…\n\nThe latest build:\n\n- [nightly.link](https://nightly.link)\n- [Nightly channel](https://example.com)"}
              className={`${inputClass} resize-y font-mono text-[12px] leading-relaxed`}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => publish(draft)}
              className="flex-1 rounded-full bg-white px-3 py-2 text-[12px] font-semibold text-black transition-opacity disabled:opacity-40"
            >
              {draft.published ? "Update" : "Publish"}
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="shrink-0 rounded-full border border-white/[0.12] px-3.5 py-2 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Save draft
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            onError(null);
            setDraft(blankNote());
          }}
          className="mt-3 w-full rounded-[12px] border border-dashed border-white/[0.14] px-3 py-2.5 text-[12px] font-semibold text-white/55 transition-colors hover:border-white/25 hover:text-white/85"
        >
          + New note
        </button>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {notes.map((note) => (
            <li key={note.id} className="rounded-[12px] border border-white/[0.06] bg-white/[0.03] p-2.5">
              <button
                type="button"
                onClick={() => setDraft(note)}
                className="block w-full text-left"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      note.published ? "bg-emerald-400" : "bg-white/25"
                    }`}
                    aria-label={note.published ? "Published" : "Draft"}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white/90">
                    {note.title}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] text-white/30">
                  {[
                    note.badge && `[${note.badge}]`,
                    note.author,
                    note.dateLabel || formatNoteDate(note.publishedAt),
                    note.published ? "" : "draft",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>

              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => (note.published ? unpublish(note.id) : setDraft(note))}
                  className="rounded-[8px] bg-white/[0.07] px-2 py-1 text-[10.5px] font-semibold text-white/70 transition-colors hover:bg-white/[0.13] hover:text-white"
                >
                  {note.published ? "Unpublish" : "Publish"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(note.id)}
                  className="rounded-[8px] bg-red-500/12 px-2 py-1 text-[10.5px] font-semibold text-red-200/85 transition-colors hover:bg-red-500/22"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-white/30">
        A reader sees a note once, the first time they visit after it is published. Unpublishing
        hides it for everyone.
      </p>
    </section>
  );
}