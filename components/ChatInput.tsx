"use client";

import type { ImageAttachment, SearchMode } from "@/lib/types";
import { compressFiles, formatBytes } from "@/lib/imageUtils";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";

// ── ChatInput: floating composer with attachments — minimal, mobile-first ───

interface ChatInputProps {
  onSend: (text: string, images: ImageAttachment[]) => void;
  disabled: boolean;
  onStop?: () => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  searchAvailable: boolean;
}

const MAX_IMAGES = 4;

const SEARCH_OPTIONS: Array<{ id: SearchMode; label: string; description: string }> = [
  { id: "auto", label: "Auto", description: "Only when asked" },
  { id: "always", label: "On", description: "Every message" },
  { id: "off", label: "Off", description: "Never search" },
];

export default function ChatInput({
  onSend,
  disabled,
  onStop,
  searchMode,
  onSearchModeChange,
  searchAvailable,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showTools, setShowTools] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!showTools) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setShowTools(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showTools]);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !compressing;

  const addFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const room = MAX_IMAGES - attachments.length;
    if (room <= 0) {
      setErrors([`Max ${MAX_IMAGES} images per message`]);
      return;
    }

    setCompressing(true);
    setErrors([]);
    try {
      const { results, errors: errs } = await compressFiles(imageFiles.slice(0, room));
      const next: ImageAttachment[] = results.map((r, i) => ({
        url: r.dataUrl,
        name: imageFiles[i]?.name ?? `image-${i + 1}`,
        size: r.size,
      }));
      setAttachments((prev) => [...prev, ...next]);
      if (errs.length) setErrors(errs);
    } finally {
      setCompressing(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setErrors([]);
  };

  const searchLabel = !searchAvailable
    ? "Web setup"
    : SEARCH_OPTIONS.find((option) => option.id === searchMode)?.label ?? "Auto";

  const handleSend = () => {
    // While streaming the send button becomes Stop.
    if (disabled) {
      onStop?.();
      return;
    }
    if (!canSend) return;
    onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
    setErrors([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const handleTextChange = (value: string) => {
    setText(value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    }
  };

  return (
    <div className="relative z-20 shrink-0 px-3 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3" data-tutorial="composer">
      <div className="mx-auto w-full max-w-4xl">
        {/* Errors */}
        {errors.length > 0 && (
          <div className="mb-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-[12px] text-red-300 animate-rise">
            {errors.join(" · ")}
          </div>
        )}

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 animate-rise">
            {attachments.map((img, i) => (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.name}
                  className="h-14 w-14 rounded-lg border border-line object-cover"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-raised text-text-mid transition-colors hover:bg-red-500/20 hover:text-red-400"
                  aria-label={`Remove ${img.name}`}
                  type="button"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
                <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-black/50 py-px text-center font-mono text-[8px] text-text-mid">
                  {formatBytes(img.size)}
                </span>
              </div>
            ))}
            {compressing && (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-line-strong">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-low border-t-transparent" />
              </div>
            )}
          </div>
        )}

        {/* Composer */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex min-h-16 items-end gap-1.5 rounded-[26px] border bg-[#202124]/95 p-2 pl-2 shadow-[0_18px_55px_rgba(0,0,0,0.38)] backdrop-blur-xl transition-all ${
            dragOver
              ? "border-[#8b7cf6]/60 shadow-[0_18px_60px_rgba(80,65,180,0.22)]"
              : "border-white/[0.09] focus-within:border-white/[0.16]"
          }`}
        >
          {/* Tools: Gallery + Web search */}
          <div ref={toolsRef} className="relative shrink-0">
            <button
              onClick={() => setShowTools((value) => !value)}
              data-tutorial="gallery-button"
              className="mb-1 flex h-12 w-12 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80"
              aria-label="Open tools menu"
              aria-expanded={showTools}
              type="button"
              title="Open Gallery and web search tools"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <circle cx="9" cy="9" r="1.6" />
                <path d="M21 15.5l-4.5-4.5L5 21" />
              </svg>
            </button>
            {showTools && (
              <div className="absolute bottom-14 left-0 z-50 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/[0.1] bg-[#151519]/[0.98] p-2 shadow-2xl shadow-black/70 backdrop-blur-xl animate-rise">
                <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Message tools</div>
                <button
                  type="button"
                  onClick={() => {
                    setShowTools(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#9ee7ff]/10 text-[#9ee7ff]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="9" cy="9" r="1.6" /><path d="M21 15.5l-4.5-4.5L5 21" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white/85">Gallery</span><span className="mt-0.5 block text-[10px] text-white/35">Attach images from your device</span></span>
                </button>
                <div className="my-2 border-t border-white/[0.07]" />
                <div className="px-2 pb-1.5 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-white/85">Web search</span>
                    <span className={`text-[10px] ${searchAvailable ? "text-[#9ee7ff]/70" : "text-amber-200/65"}`}>{searchAvailable ? searchLabel : "Setup needed"}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-black/20 p-1">
                    {SEARCH_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          onSearchModeChange(option.id);
                          setShowTools(false);
                        }}
                        className={`rounded-lg px-1 py-1.5 text-left transition-colors ${searchMode === option.id ? "bg-white/[0.1] text-white" : "text-white/40 hover:bg-white/[0.05] hover:text-white/70"}`}
                        title={option.description}
                      >
                        <span className="block text-[11px] font-medium">{option.label}</span>
                        <span className="mt-0.5 block truncate text-[8px] text-white/30">{option.description}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-white/30">Auto stays quiet for general knowledge questions.</p>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          {/* Textarea — 16px on mobile to prevent iOS zoom */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={compressing ? "Compressing…" : "Ask Mino anything…"}
            className="max-h-[180px] flex-1 resize-none bg-transparent py-3.5 text-[16px] leading-snug text-white/90 placeholder-white/32 outline-none md:text-[17px]"
          />

          {/* Send / Stop */}
          {disabled ? (
            <button
              onClick={onStop}
              className="mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/70 transition-colors hover:bg-white/[0.13] hover:text-white"
              aria-label="Stop generating"
              type="button"
              title="Stop generating"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={`mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all ${
                canSend
                  ? "bg-[#6f5bea] text-white shadow-[0_8px_24px_rgba(111,91,234,0.35)] hover:bg-[#7b67f0]"
                  : "text-white/25 hover:bg-white/[0.05]"
              }`}
              aria-label="Send message"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>

        {/* Hint — desktop only; keep mobile clean */}
        <p className="hidden pt-2 text-center text-[10px] text-white/25 md:block">
          Created by Minetallest · Shift + Enter for a new line
        </p>
        <div className="safe-bottom md:hidden" />
      </div>
    </div>
  );
}
