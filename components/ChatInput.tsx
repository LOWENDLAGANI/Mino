"use client";

import type { DocumentAttachment, ImageAttachment } from "@/lib/types";
import {
  SCHEDULE_PRESETS,
  earliestSchedule,
  formatScheduleTime,
  nextMorningAt,
  type ScheduledMessage,
} from "@/lib/scheduler";
import { secondsRemaining } from "@/lib/rateLimit";
import { compressFiles, formatBytes } from "@/lib/imageUtils";
import { MEMORY_TEXT_LIMIT, addMemory } from "@/lib/memory";
import { syncMemoryUp } from "@/lib/firebaseHistory";
import { useRouter } from "next/navigation";
import { isUnlocked } from "@/lib/paywallState";
import { useSubscription } from "@/lib/useSubscription";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";

// ── ChatInput: floating composer with attachments — minimal, mobile-first ───

interface ChatInputProps {
  onSend: (text: string, images: ImageAttachment[], documents?: DocumentAttachment[]) => void;
  disabled: boolean;
  onStop?: () => void;
  /** Image mode turns the composer into a prompt box for the image model. */
  imageMode: boolean;
  onImageModeChange: (enabled: boolean) => void;
  imageAvailable: boolean;
  /** Whether memories can follow the account to another device. */
  syncAvailable: boolean;
  /** Queues the composer's contents to be sent at `sendAt`. */
  onSchedule: (text: string, images: ImageAttachment[], documents: DocumentAttachment[], sendAt: number) => void;
  /** Messages this device has queued, rendered as chips above the composer. */
  scheduled: ScheduledMessage[];
  onCancelScheduled: (id: string) => void;
  /** Epoch ms until which the server has asked us to hold off; null when free. */
  rateLimitUntil: number | null;
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

export default function ChatInput({
  onSend,
  disabled,
  onStop,
  imageMode,
  onImageModeChange,
  imageAvailable,
  syncAvailable,
  onSchedule,
  scheduled,
  onCancelScheduled,
  rateLimitUntil,
}: ChatInputProps) {
  // Image generation is a paid capability. The gate is client-side — see the note
  // on lib/paywallState.ts — so it stops the ordinary user, not a determined one.
  const { planId } = useSubscription();
  const router = useRouter();
  const lockedImages = !isUnlocked("images", planId);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [documents, setDocuments] = useState<DocumentAttachment[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showTools, setShowTools] = useState(false);
  const [showRemember, setShowRemember] = useState(false);
  const [rememberText, setRememberText] = useState("");
  const [rememberNotice, setRememberNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [customDate, setCustomDate] = useState("");
  // Ticks once a second while a rate limit is counting down, so the chip
  // loses a number rather than sitting frozen until the next render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!rateLimitUntil || rateLimitUntil <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [rateLimitUntil]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (!showTools && !showSchedule) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setShowTools(false);
      if (!scheduleRef.current?.contains(event.target as Node)) setShowSchedule(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showTools, showSchedule]);

  // In image mode the prompt is the only input, so attachments and documents
  // are hidden and cannot be attached to an image request.
  const hasContent = imageMode
    ? text.trim().length > 0
    : text.trim().length > 0 || attachments.length > 0 || documents.length > 0;
  const rateRemaining = rateLimitUntil ? secondsRemaining(rateLimitUntil, now) : 0;
  const rateLimited = rateRemaining > 0;
  const canSend = hasContent && !compressing && !rateLimited;

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
    onSend(text.trim(), imageMode ? [] : attachments, imageMode ? [] : documents);
    clearComposer();
  };

  const clearComposer = () => {
    setText("");
    setAttachments([]);
    setDocuments([]);
    setErrors([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const commitSchedule = (sendAt: number) => {
    if (!hasContent || imageMode) return;
    onSchedule(text.trim(), attachments, documents, sendAt);
    clearComposer();
    setShowSchedule(false);
    setCustomDate("");
  };

  /** The rate-limited escape hatch: the message waits in the queue instead of
   *  the composer, and fires the moment the server will hear us out. */
  const queueInstead = () => {
    if (!rateLimitUntil || !hasContent || imageMode) return;
    onSchedule(text.trim(), attachments, documents, rateLimitUntil + 1000);
    clearComposer();
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

        {/* Rate limit — a countdown, not a scolding. The queue button turns
            the refused message into a scheduled one, so the wait costs the
            writer nothing but time. */}
        {rateLimited && (
          <div
            role="status"
            className="mb-2 flex items-center gap-2 rounded-xl border border-amber-300/15 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-100/85 animate-rise"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span className="min-w-0 flex-1">Rate limited — you can send again in {rateRemaining}s.</span>
            {hasContent && !imageMode && (
              <button
                type="button"
                onClick={queueInstead}
                className="shrink-0 rounded-lg bg-white/[0.08] px-2.5 py-1 text-[10px] font-semibold text-white/80 transition-colors hover:bg-white/[0.14]"
              >
                Queue until then
              </button>
            )}
          </div>
        )}

        {/* Scheduled messages waiting their turn. Horizontally scrollable on a
            phone rather than wrapping into a stack that buries the composer. */}
        {scheduled.length > 0 && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Scheduled messages">
            {scheduled.map((item) => (
              <span
                key={item.id}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#a9d8bb]/20 bg-[#a9d8bb]/[0.07] py-1 pl-2.5 pr-1 text-[10px] text-[#c9e6d4]"
                title={item.content || "Attachment"}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span className="font-semibold">{formatScheduleTime(item.sendAt)}</span>
                <span className="max-w-[110px] truncate text-white/45">{item.content || "Attachment"}</span>
                <button
                  type="button"
                  onClick={() => onCancelScheduled(item.id)}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Cancel this scheduled message"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Image mode indicator — a title is enough; no explanation needed. */}
        {imageMode && (
          <div className="mb-2 flex items-center gap-2 animate-rise">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#a9d8bb]/12 text-[#a9d8bb]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="3.5" /><circle cx="8.75" cy="9.75" r="1.6" /><path d="M20.5 15.5 16 11l-9 9.5" />
              </svg>
            </span>
            <span className="text-[12px] font-medium text-white/70">Image</span>
            <button
              type="button"
              onClick={() => onImageModeChange(false)}
              className="ml-auto shrink-0 rounded-full p-1 text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white"
              aria-label="Exit image mode"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}

        {/* Attachment previews */}
        {!imageMode && attachments.length > 0 && (
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

        {!imageMode && documents.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 animate-rise">
            {documents.map((document, i) => (
              <div key={`${document.name}-${i}`} className="flex max-w-full items-center gap-2 rounded-xl border border-line bg-white/[0.05] px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#a9d8bb]/10 text-[#a9d8bb]">
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
          className={`flex min-h-16 items-end gap-1.5 rounded-[26px] border bg-[#1a2620]/95 p-2 pl-2 shadow-[0_18px_55px_rgba(0,0,0,0.38)] backdrop-blur-xl transition-all ${
            dragOver
              ? "border-[#3f7d5c]/60 shadow-[0_18px_60px_rgba(47,107,72,0.22)]"
              : "border-white/[0.09] focus-within:border-white/[0.16]"
          }`}
        >
          {/* Tools: Gallery + Web search */}
          <div ref={toolsRef} className="relative shrink-0">
            <button
              onClick={() => setShowTools((value) => !value)}
              data-tutorial="gallery-button"
              className="lift mb-1 flex h-12 w-12 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80"
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
              <div className="animate-pop absolute bottom-14 left-0 z-50 w-[286px] max-w-[calc(100vw-2rem)] rounded-[26px] border border-white/[0.08] bg-[#141f1a]/[0.98] p-1.5 shadow-2xl shadow-black/80 backdrop-blur-xl">
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
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">Camera</span>
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
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">Gallery</span>
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
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">Files</span>
                </button>
                <a
                  href="/donate"
                  onClick={() => setShowTools(false)}
                  className="flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-400/10 text-rose-200">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 20.7s-7.6-4.7-7.6-10A4.5 4.5 0 0 1 12 7.9a4.5 4.5 0 0 1 7.6 2.8c0 5.3-7.6 10-7.6 10Z" />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">
                    Support Mino
                    <span className="rounded-full bg-rose-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-200">
                      Donate
                    </span>
                  </span>
                </a>
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
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">{isListening ? "Listening…" : "Voice input"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTools(false);
                    setShowRemember(true);
                  }}
                  className="flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20.5s-7-4.4-7-9.4a4.1 4.1 0 0 1 7-2.9 4.1 4.1 0 0 1 7 2.9c0 5-7 9.4-7 9.4Z" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">Remember this</span>
                </button>
                <button
                  type="button"onClick={() => {
                      setShowTools(false);
                      // Locked rather than hidden, and it says which plan opens
                      // it. Image generation costs real money per picture, so a
                      // free visitor reaching it by editing the bundle is a cost
                      // to you, not a lost sale.
                      if (lockedImages) {
                        router.push("/plus");
                        return;
                      }
                      onImageModeChange(true);
                    }}
                  className="flex w-full items-center gap-3.5 rounded-[18px] px-2 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m12 3 1.9 4.8L19 9.6l-4.1 3 1.2 5.1L12 15.2 7.9 17.7l1.2-5.1L5 9.6l5.1-1.8z" />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">
                    Create image
                    {!imageAvailable && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" title="Not configured in the deployment environment" />
                    )}
                    {lockedImages && (
                      <span className="shrink-0 rounded-full bg-white/[0.09] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/50">
                        Mini
                      </span>
                    )}
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
            placeholder={
              imageMode
                ? "Describe the image to create…"
                : compressing
                  ? "Compressing…"
                  : "Ask Mino anything…"
            }
            className="max-h-[180px] flex-1 resize-none bg-transparent py-3.5 text-[16px] leading-snug text-white/90 placeholder-white/32 outline-none md:text-[17px]"
          />

          {/* Send later — only when there is something to send, and never in
              image mode, where the draw happens through its own pipeline. */}
          {!disabled && !imageMode && hasContent && (
            <div ref={scheduleRef} className="relative shrink-0">
              <button
                onClick={() => setShowSchedule((value) => !value)}
                className="mb-1 flex h-10 w-10 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80"
                aria-label="Schedule this message"
                aria-expanded={showSchedule}
                type="button"
                title="Send later"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </button>
              {showSchedule && (
                <div className="animate-pop absolute bottom-12 right-0 z-50 w-56 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/[0.08] bg-[#141f1a]/[0.98] p-1.5 shadow-2xl shadow-black/80 backdrop-blur-xl">
                  <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
                    Send later
                  </div>
                  {SCHEDULE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        commitSchedule(
                          preset.offsetMs ? Date.now() + preset.offsetMs : nextMorningAt(preset.hour ?? 9)
                        )
                      }
                      className="block w-full rounded-xl px-2.5 py-2 text-left text-[12px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      {preset.label}
                    </button>
                  ))}
                  <div className="mt-1 flex items-center gap-1.5 border-t border-white/[0.07] px-2 pb-1 pt-2">
                    <input
                      type="datetime-local"
                      min={earliestSchedule()}
                      value={customDate}
                      onChange={(event) => setCustomDate(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white outline-none [color-scheme:dark]"
                      aria-label="Custom send time"
                    />
                    <button
                      type="button"
                      disabled={!customDate}
                      onClick={() => {
                        const at = new Date(customDate).getTime();
                        if (Number.isFinite(at) && at > Date.now()) commitSchedule(at);
                      }}
                      className="shrink-0 rounded-lg bg-[#2a6142] px-2 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-[#35744f] disabled:opacity-40"
                    >
                      Set
                    </button>
                  </div>
                  <p className="px-2.5 pb-1.5 pt-1.5 text-[9px] leading-relaxed text-white/30">
                    Fires from this tab while it is open — keep it open if the timing matters.
                  </p>
                </div>
              )}
            </div>
          )}

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
              className={`lift mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors ${
                canSend
                  ? "bg-[#2a6142] text-white shadow-[0_8px_24px_rgba(63,125,92,0.35)] hover:bg-[#35744f]"
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

        {/* Creator credit — kept deliberately; the keyboard hint was the
            redundant part, not the attribution. The heart is the one place
            a donation is offered without a menu: people who like Mino are
            looking right here. Desktop only, so it never crowds the phone
            composer; phones get it from the tools menu and the sidebar. */}
        <p className="hidden pt-2.5 text-center text-[10px] text-white/25 md:block">
          Created by Minetallest
          <span className="mx-1.5 text-white/15">·</span>
          <a
            href="/donate"
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 align-middle text-white/35 transition-colors hover:text-rose-200"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 20.7s-7.6-4.7-7.6-10A4.5 4.5 0 0 1 12 7.9a4.5 4.5 0 0 1 7.6 2.8c0 5.3-7.6 10-7.6 10Z" />
            </svg>
            Support Mino
          </a>
        </p>
        <div className="safe-bottom md:hidden" />
      </div>

      {/* "Remember this" — the composer route into memory.
          Sits in the tools menu rather than Settings alone, because a fact
          worth keeping is noticed while it is being said, and a panel nobody
          opens is a feature nobody uses. Nothing is ever saved without this
          explicit step. */}
      {showRemember && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center px-3 pb-3"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setShowRemember(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Remember something"
            className="animate-pop w-full max-w-sm rounded-[26px] border border-white/[0.12] bg-[#121c18]/[0.98] p-4 pb-3 shadow-2xl shadow-black/80 backdrop-blur-2xl"
          >
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
              What should Mino remember?
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">
              One short sentence about you. Mino uses it in every conversation
              until you remove it.
            </p>

            <textarea
              value={rememberText}
              onChange={(event) => setRememberText(event.target.value)}
              maxLength={MEMORY_TEXT_LIMIT}
              rows={2}
              autoFocus
              placeholder="I work mostly in TypeScript and React"
              className="mt-3 w-full resize-none rounded-2xl border border-white/[0.09] bg-white/[0.03] p-3 text-[14px] leading-relaxed text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/[0.18]"
              aria-label="Memory to remember"
            />

            {rememberNotice && (
              <p role="status" className="mt-2 text-[11.5px] leading-relaxed text-amber-100/75">
                {rememberNotice}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const result = await addMemory(rememberText);
                  if (result.error) {
                    setRememberNotice(result.error);
                    return;
                  }
                  if (syncAvailable && result.memory) void syncMemoryUp(result.memory);
                  setRememberText("");
                  setShowRemember(false);
                  setRememberNotice(null);
                  // The panel reads Dexie live, so there is nothing to refresh.
                }}
                disabled={!rememberText.trim()}
                className="flex-1 rounded-full px-4 py-2.5 text-[14px] font-semibold text-[#0a100d] transition-opacity disabled:opacity-30"
                style={{ background: "linear-gradient(180deg, #a9d8bb 0%, #1f4a33 100%)" }}
              >
                Remember
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRemember(false);
                  setRememberText("");
                  setRememberNotice(null);
                }}
                className="shrink-0 rounded-full border border-white/[0.12] px-4 py-2.5 text-[14px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
