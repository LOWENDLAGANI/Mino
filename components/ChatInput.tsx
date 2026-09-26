"use client";

import type { DocumentAttachment, ImageAttachment } from "@/lib/types";
import { compressFiles, formatBytes } from "@/lib/imageUtils";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";

// ── ChatInput: floating composer with attachments — minimal, mobile-first ───

interface ChatInputProps {
  onSend: (text: string, images: ImageAttachment[], documents?: DocumentAttachment[]) => void;
  disabled: boolean;
  onStop?: () => void;
}

const MAX_IMAGES = 4;
const MAX_DOCUMENTS = 3;
const MAX_DOCUMENT_SIZE = 100_000;
const DOCUMENT_TYPES = new Set([
  "text/plain", "text/markdown", "text/csv", "application/json", "application/javascript",
  "text/typescript", "text/x-python", "text/html", "text/css", "text/sql",
]);

type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition };

export default function ChatInput({ onSend, disabled, onStop }: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [documents, setDocuments] = useState<DocumentAttachment[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showTools, setShowTools] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (!showTools) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setShowTools(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showTools]);

  const canSend = (text.trim().length > 0 || attachments.length > 0 || documents.length > 0) && !compressing;

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

  const addDocuments = async (files: File[]) => {
    const supported = files.filter((file) => DOCUMENT_TYPES.has(file.type) || /\.(txt|md|csv|json|js|jsx|ts|tsx|py|html|css|sql)$/i.test(file.name));
    if (supported.length === 0) {
      setErrors(["Text and code files are supported (up to 100 KB each)"]);
      return;
    }
    const room = MAX_DOCUMENTS - documents.length;
    if (room <= 0) {
      setErrors([`Max ${MAX_DOCUMENTS} documents per message`]);
      return;
    }
    const next: DocumentAttachment[] = [];
    for (const file of supported.slice(0, room)) {
      if (file.size > MAX_DOCUMENT_SIZE) {
        setErrors([`${file.name} is larger than 100 KB`]);
        continue;
      }
      const fullText = await file.text();
      next.push({ name: file.name, size: file.size, text: fullText.slice(0, MAX_DOCUMENT_SIZE), truncated: fullText.length > MAX_DOCUMENT_SIZE });
    }
    setDocuments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setErrors([]);
  };

  const removeDocument = (index: number) => setDocuments((prev) => prev.filter((_, i) => i !== index));

  const toggleVoice = () => {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setErrors(["Voice input is not supported in this browser"]);
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) handleTextChange(`${text}${text ? " " : ""}${transcript}`);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => {
      setIsListening(false);
      setErrors(["Voice input could not be started"]);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleSend = () => {
    // While streaming the send button becomes Stop.
    if (disabled) {
      onStop?.();
      return;
    }
    if (!canSend) return;
    onSend(text.trim(), attachments, documents);
    setText("");
    setAttachments([]);
    setDocuments([]);
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
    const files = Array.from(e.dataTransfer.files);
    void addFiles(files);
    void addDocuments(files);
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
      void addDocuments(files);
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

        {documents.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 animate-rise">
            {documents.map((document, i) => (
              <div key={`${document.name}-${i}`} className="flex max-w-full items-center gap-2 rounded-xl border border-line bg-white/[0.05] px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#9ee7ff]/10 text-[#9ee7ff]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M9 12h6M9 15h6" /></svg>
                </span>
                <span className="min-w-0"><span className="block max-w-[150px] truncate text-[11px] text-white/75">{document.name}</span><span className="text-[9px] text-white/35">{formatBytes(document.size)}{document.truncated ? " · truncated" : ""}</span></span>
                <button type="button" onClick={() => removeDocument(i)} className="ml-1 text-white/30 hover:text-red-300" aria-label={`Remove ${document.name}`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
              </div>
            ))}
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
              title="Open message tools"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8.5" className="opacity-40" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </button>
            {showTools && (
              <div className="absolute bottom-14 left-0 z-50 w-[286px] max-w-[calc(100vw-2rem)] rounded-[26px] border border-white/[0.08] bg-[#131316]/[0.98] p-1.5 shadow-2xl shadow-black/80 backdrop-blur-xl animate-rise">
                <button
                  type="button"
                  onClick={() => {
                    setShowTools(false);
                    cameraInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h1.7l1.2-2h7.2l1.2 2h1.7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
                      <circle cx="12" cy="13" r="3.4" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">Camera</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/40">Take a photo with your phone</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTools(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="4.5" /><circle cx="8.75" cy="8.75" r="1.6" /><path d="M21 15.5l-4.5-4.5L5 21" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">Gallery</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/40">Pick images already on your device</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTools(false);
                    document.getElementById("mino-document-picker")?.click();
                  }}
                  className="flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M9 12h6M9 15.5h4" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">Files</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/40">Attach text or code, up to 100 KB</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={`flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.09] ${isListening ? "bg-red-500/10" : ""}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white ${isListening ? "animate-pulse" : ""}`}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">{isListening ? "Listening…" : "Voice input"}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/40">Dictate a message with your mic</span>
                  </span>
                </button>
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
            {/* capture="environment" opens the rear camera directly on phones;
                desktop browsers ignore it and fall back to a normal file picker. */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <input
              id="mino-document-picker"
              type="file"
              accept=".txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.sql"
              multiple
              className="hidden"
              onChange={(e) => {
                void addDocuments(Array.from(e.target.files ?? []));
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
