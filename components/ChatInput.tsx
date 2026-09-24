"use client";

import type { ImageAttachment } from "@/lib/types";
import { compressFiles, formatBytes } from "@/lib/imageUtils";
import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";

// ── ChatInput: input bar, drag & drop, file picker, image previews ──────────

interface ChatInputProps {
  onSend: (text: string, images: ImageAttachment[]) => void;
  disabled: boolean;
  onTokenEstimateChange?: (tokens: number) => void;
}

const MAX_IMAGES = 4;

export default function ChatInput({ onSend, disabled, onTokenEstimateChange }: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);

  const notifyTokens = (nextText: string, nextImages: ImageAttachment[]) => {
    const chars = nextText.length + nextImages.reduce((acc, img) => acc + img.url.length, 0);
    onTokenEstimateChange?.(Math.ceil(chars / 4));
  };

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
      const updated = [...attachments, ...next];
      setAttachments(updated);
      if (errs.length) setErrors(errs);
      notifyTokens(text, updated);
    } finally {
      setCompressing(false);
    }
  };

  const removeAttachment = (index: number) => {
    const updated = attachments.filter((_, i) => i !== index);
    setAttachments(updated);
    setErrors([]);
    notifyTokens(text, updated);
  };

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
    setErrors([]);
    notifyTokens("", []);
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
    const files = Array.from(e.dataTransfer.files);
    void addFiles(files);
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
    notifyTokens(value, attachments);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="border-t border-ink-700 bg-ink-950/80 px-4 pb-4 pt-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {/* Errors */}
        {errors.length > 0 && (
          <div className="mb-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-300 animate-fade-in-up">
            {errors.join(" · ")}
          </div>
        )}

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 animate-fade-in-up">
            {attachments.map((img, i) => (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.name}
                  className="h-16 w-16 rounded-lg border border-ink-600 object-cover"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-ink-500 bg-ink-700 text-[10px] text-zinc-300 shadow transition-colors hover:bg-red-600 hover:text-white"
                  aria-label={`Remove ${img.name}`}
                  type="button"
                >
                  ✕
                </button>
                <span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/60 px-1 py-0.5 text-center font-mono text-[9px] text-zinc-300">
                  {formatBytes(img.size)}
                </span>
              </div>
            ))}
            {compressing && (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-ink-500 text-[10px] text-zinc-500 animate-pulse">
                compress…
              </div>
            )}
          </div>
        )}

        {/* Input box */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex items-end gap-2 rounded-2xl border bg-ink-850 p-2 pl-3 transition-colors ${
            dragOver
              ? "border-indigo-500 bg-indigo-950/20"
              : "border-ink-600 focus-within:border-zinc-500"
          }`}
        >
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-ink-700 hover:text-zinc-200"
            aria-label="Attach image"
            type="button"
            title="Attach image (or drag & drop / paste)"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              void addFiles(files);
              e.target.value = "";
            }}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={compressing ? "Compressing image…" : "Message Mino… (Shift+Enter for newline)"}
            className="max-h-[200px] flex-1 resize-none bg-transparent py-2 text-[15px] text-zinc-100 placeholder-zinc-600 outline-none"
            disabled={disabled}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ${
              canSend
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-950/50 hover:bg-indigo-500"
                : "bg-ink-700 text-zinc-600"
            }`}
            aria-label="Send message"
            type="button"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>

        <p className="mt-2 text-center text-[10px] text-zinc-600">
          Drag & drop or paste images to attach · stored locally until sent
        </p>
      </div>
    </div>
  );
}
