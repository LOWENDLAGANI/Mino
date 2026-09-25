"use client";

import type { ChatMessage } from "@/lib/types";
import { getModelDisplayName } from "@/lib/models";
import Markdown from "./Markdown";
import MinoMark from "./MinoMark";
import { useEffect, useRef, useState } from "react";

interface ChatThreadProps {
  messages: ChatMessage[];
  streamingId: string | null;
  isEmpty: boolean;
  suggestedMode: string;
}

const STREAMING_MESSAGES = [
  "umm, finding ai suitable for your weird request",
  "Whatt?",
  "Almost done.. Just kidding",
  "Hacking your computer",
  "Please wait while we're staying your data",
] as const;

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
          // Clipboard access can be unavailable in some browsers.
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

function SearchSources({ sources }: { sources: NonNullable<ChatMessage["sources"]> }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-[#9ee7ff]/10 bg-[#9ee7ff]/[0.035] p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9ee7ff]/70">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4M12 3.5c2.1 2.3 3.2 5.1 3.2 8.5s-1.1 6.2-3.2 8.5c-2.1-2.3-3.2-5.1-3.2-8.5S9.9 5.8 12 3.5Z" />
        </svg>
        Web sources
      </div>
      <div className="space-y-1.5">
        {sources.map((source) => {
          let host = source.url;
          try {
            host = new URL(source.url).hostname.replace(/^www\./, "");
          } catch {
            // Keep the original URL if it is not parseable.
          }
          return (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group/source flex items-start gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.05]"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[9px] text-white/55">
                {source.id}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-white/70 group-hover/source:text-white">{source.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-white/30">{host}</span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0 text-white/25" aria-hidden="true">
                <path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
              </svg>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function MessageRow({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex flex-col items-end animate-rise">
        <div className="max-w-[88%] md:max-w-[76%]">
          {msg.images && msg.images.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {msg.images.map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={img.url}
                  alt={img.name || `attachment ${i + 1}`}
                  className="h-28 w-auto max-w-[220px] cursor-zoom-in rounded-2xl border border-white/10 object-cover shadow-2xl shadow-black/20"
                  onClick={() => window.open(img.url, "_blank")}
                />
              ))}
            </div>
          )}
          {msg.content && (
            <div className="inline-block rounded-[22px] rounded-br-md bg-white/[0.075] px-4 py-2.5 text-[15px] leading-relaxed text-white/90 backdrop-blur-sm">
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          )}
        </div>
        {msg.error && (
          <div className="mt-1 w-full max-w-[88%] rounded-xl border border-red-400/15 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-200/80 md:max-w-[76%]">
            {msg.error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group animate-rise">
      <div className="mb-2 flex items-center gap-2">
        <MinoMark className="h-5 w-5" />
        <span className="text-[12px] font-medium text-white/55">
          {getModelDisplayName(msg.model)}
        </span>
        {msg.usage && (
          <span className="text-[10px] text-text-low">{msg.usage.total.toLocaleString()} tok</span>
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
              className="h-28 w-auto max-w-[220px] cursor-zoom-in rounded-2xl border border-white/10 object-cover"
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

      {msg.sources && <SearchSources sources={msg.sources} />}

      {msg.error && (
        <div className="mt-2 rounded-xl border border-red-400/15 bg-red-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-red-200/80">
          {msg.error}
        </div>
      )}
    </div>
  );
}

function TypingDots({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 py-1" role="status" aria-live="polite">
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 animate-blink rounded-full bg-text-mid"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
      <span className="text-[12px] leading-relaxed text-white/45">{message}</span>
    </div>
  );
}

export default function ChatThread({ messages, streamingId, isEmpty, suggestedMode }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [loadingMessage, setLoadingMessage] = useState<string>(STREAMING_MESSAGES[0]);

  useEffect(() => {
    if (streamingId) {
      setLoadingMessage(STREAMING_MESSAGES[Math.floor(Math.random() * STREAMING_MESSAGES.length)]);
    }
  }, [streamingId]);

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
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-24 sm:pb-28">
        <div className="-translate-y-2 text-center sm:-translate-y-5">
          <div className="relative mx-auto mb-7 flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
            <div className="absolute inset-[-45%] rounded-full bg-[#7567e8]/20 blur-3xl" />
            <MinoMark className="relative h-full w-full" />
          </div>
          <h1 className="text-balance text-[38px] font-normal leading-[1.08] tracking-[-0.045em] text-white sm:text-[54px] lg:text-[62px]">
            What should we create?
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[12px] leading-relaxed text-white/38 sm:text-[13px]">
            {suggestedMode === "dev"
              ? "Mino 3.8 · tuned for code and technical work"
              : "Mino Auto · the best available model for every prompt"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-6 md:px-7 md:pt-9">
        <div className="flex flex-col gap-8">
          {messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} streaming={msg.id === streamingId} />
          ))}
          {streamingId && !messages.find((m) => m.id === streamingId)?.content && (
            <div className="animate-rise">
              <div className="mb-2 flex items-center gap-2">
                <MinoMark className="h-5 w-5" />
                <span className="text-[12px] font-medium text-white/55">Mino</span>
              </div>
              <TypingDots message={loadingMessage} />
            </div>
          )}
          <div ref={bottomRef} className="h-px" />
        </div>
      </div>
    </div>
  );
}
