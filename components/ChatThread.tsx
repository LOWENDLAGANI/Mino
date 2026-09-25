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
