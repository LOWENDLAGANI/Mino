"use client";

import type { ChatMessage } from "@/lib/types";
import Markdown from "./Markdown";
import { getModel } from "@/lib/models";
import { useEffect, useRef, useState } from "react";

// ── ChatThread: streaming message list with markdown + base64 image rendering ──

interface ChatThreadProps {
  messages: ChatMessage[];
  streamingId: string | null;
  isEmpty: boolean;
  suggestedModel: string;
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
      className="rounded p-1 text-zinc-600 transition-colors hover:text-zinc-300"
      aria-label="Copy message"
      type="button"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}

function Avatar({ role }: { role: ChatMessage["role"] }) {
  if (role === "user") {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-500 bg-ink-700 text-[11px] font-semibold text-zinc-300">
        You
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white shadow-md shadow-indigo-950/60">
      M
    </div>
  );
}

function MessageBubble({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={`group flex gap-3 ${isUser ? "flex-row-reverse" : ""} animate-fade-in-up`}>
      <Avatar role={msg.role} />
      <div className={`max-w-[85%] min-w-0 md:max-w-[75%] ${isUser ? "items-end" : ""} flex flex-col gap-1.5`}>
        {/* Attached image thumbnails */}
        {msg.images && msg.images.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${isUser ? "justify-end" : ""}`}>
            {msg.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.url}
                alt={img.name || `attachment ${i + 1}`}
                className="h-28 max-w-[220px] cursor-zoom-in rounded-xl border border-ink-600 object-cover transition-transform hover:scale-[1.02]"
                onClick={() => window.open(img.url, "_blank")}
              />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {msg.content && (
          <div
            className={
              isUser
                ? "rounded-2xl rounded-tr-md border border-indigo-900/50 bg-indigo-950/40 px-4 py-2.5 text-[15px] leading-relaxed text-zinc-100"
                : "rounded-2xl rounded-tl-md border border-ink-600 bg-ink-800 px-4 py-3 text-zinc-200"
            }
          >
            {isUser ? (
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            ) : (
              <div className={streaming ? "stream-cursor" : ""}>
                <Markdown content={msg.content} />
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {msg.error && (
          <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs leading-relaxed text-red-300">
            {msg.error}
          </div>
        )}

        {/* Meta row */}
        <div className={`flex items-center gap-2 px-1 text-[10px] text-zinc-600 ${isUser ? "justify-end" : ""}`}>
          {!isUser && msg.model && <span className="font-mono">{getModel(msg.model).name}</span>}
          {msg.usage && (
            <span className="font-mono">
              {msg.usage.total.toLocaleString()} tokens
            </span>
          )}
          {!isUser && msg.content && <CopyMessageButton text={msg.content} />}
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Explain how IndexedDB works in 3 bullet points",
  "Write a TypeScript debounce function",
  "What's in this image? (attach one below)",
  "Draft a short launch tweet for Mino AI",
];

function TypingDots() {
  return (
    <div className="flex gap-1.5 py-2 px-4">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-zinc-500"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  );
}

export default function ChatThread({
  messages,
  streamingId,
  isEmpty,
  suggestedModel,
  onSuggestionClick,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Only auto-scroll when the user is already near the bottom.
  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  if (isEmpty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-bold text-white shadow-2xl shadow-indigo-950/60 text-glow">
          M
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Mino
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Created by Minetallest · {getModel(suggestedModel).name}
        </p>
        <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSuggestionClick(s)}
              className="rounded-xl border border-ink-600 bg-ink-850 px-4 py-3 text-left text-sm text-zinc-400 transition-all hover:border-indigo-800 hover:bg-ink-800 hover:text-zinc-200"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} streaming={msg.id === streamingId} />
        ))}
        {streamingId && !messages.find((m) => m.id === streamingId)?.content && (
          <div className="flex gap-3">
            <Avatar role="assistant" />
            <div className="rounded-2xl rounded-tl-md border border-ink-600 bg-ink-800">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
