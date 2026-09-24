"use client";

import type { ChatMessage } from "@/lib/types";
import Markdown from "./Markdown";
import { getMode } from "@/lib/models";
import { useEffect, useRef, useState } from "react";

// ── ChatThread: quiet, editorial message list (no bubbles) ──────────────────

interface ChatThreadProps {
  messages: ChatMessage[];
  streamingId: string | null;
  isEmpty: boolean;
  suggestedMode: string;
  onSuggestionClick: (text: string) => void;
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-low transition-colors hover:bg-hover hover:text-text-mid"
      aria-label="Copy message"
      type="button"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MessageRow({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  const isUser = msg.role === "user";
  const modeFor = (engine?: string) =>
    engine?.startsWith("gemini") ? "Dev" : "Auto";

  // User: right-aligned, subtle tinted pill
  if (isUser) {
    return (
      <div className="flex justify-end animate-rise">
        <div className="max-w-[85%] md:max-w-[75%]">
          {msg.images && msg.images.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {msg.images.map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={img.url}
                  alt={img.name || `attachment ${i + 1}`}
                  className="h-24 w-auto max-w-[200px] cursor-zoom-in rounded-xl border border-line object-cover"
                  onClick={() => window.open(img.url, "_blank")}
                />
              ))}
            </div>
          )}
          {msg.content && (
            <div className="inline-block rounded-2xl rounded-br-md bg-hover px-4 py-2.5 text-[15px] leading-relaxed text-text-hi">
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          )}
        </div>
        {msg.error && (
          <div className="mt-1 w-full rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
            {msg.error}
          </div>
        )}
      </div>
    );
  }

  // Assistant: full-width, no bubble, name + content
  return (
    <div className="group animate-rise">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-canvas">
          M
        </div>
        <span className="text-[12px] font-medium text-text-mid">
          {msg.model ? modeFor(msg.model) : "Mino"}
        </span>
        {msg.usage && (
          <span className="text-[10px] text-text-low">
            {msg.usage.total.toLocaleString()} tok
          </span>
        )}
        {msg.content && !streaming && (
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            <CopyMessageButton text={msg.content} />
          </span>
        )}
      </div>

      {msg.images && msg.images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {msg.images.map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img.url}
              alt={img.name || `attachment ${i + 1}`}
              className="h-24 w-auto max-w-[200px] cursor-zoom-in rounded-xl border border-line object-cover"
              onClick={() => window.open(img.url, "_blank")}
            />
          ))}
        </div>
      )}

      {msg.content && (
        <div className={streaming ? "stream-cursor" : ""}>
          <Markdown content={msg.content} />
        </div>
      )}

      {msg.error && (
        <div className="mt-1 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] leading-relaxed text-red-300">
          {msg.error}
        </div>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  { label: "Explain", prompt: "Explain how IndexedDB works in three short bullet points." },
  { label: "Code", prompt: "Write a TypeScript debounce function with cancel support." },
  { label: "Analyze", prompt: "I'll attach an image — describe what's in it in detail." },
  { label: "Write", prompt: "Draft a concise launch announcement for a local-first AI chat app." },
];

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-blink rounded-full bg-text-mid"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

export default function ChatThread({
  messages,
  streamingId,
  isEmpty,
  suggestedMode,
  onSuggestionClick,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (stickRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  if (isEmpty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 pb-10">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-canvas">
          M
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-text-hi">
          How can I help?
        </h1>
        <p className="mt-1.5 text-[13px] text-text-mid">
          {suggestedMode === "dev" ? "Dev · Gemini" : "Auto · best model for you"} · private, on-device history
        </p>

        <div className="mt-8 grid w-full max-w-md grid-cols-2 gap-2 sm:max-w-lg">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => onSuggestionClick(s.prompt)}
              className="rounded-xl border border-line px-3.5 py-3 text-left transition-colors hover:bg-hover"
            >
              <span className="block text-[12px] font-medium text-text-hi">{s.label}</span>
              <span className="mt-0.5 block truncate text-[11px] text-text-low">{s.prompt}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-6 md:px-6">
        <div className="flex flex-col gap-7">
          {messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} streaming={msg.id === streamingId} />
          ))}
          {streamingId && !messages.find((m) => m.id === streamingId)?.content && (
            <div className="animate-rise">
              <div className="mb-1.5 flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-canvas">
                  M
                </div>
                <span className="text-[12px] font-medium text-text-mid">Mino</span>
              </div>
              <TypingDots />
            </div>
          )}
          <div ref={bottomRef} className="h-px" />
        </div>
      </div>
    </div>
  );
}
