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
  onRegenerate: (assistantId: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onCopyConversation: () => void;
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

function MessageActions({ onRegenerate }: { onRegenerate: () => void }) {
  return (
    <button onClick={onRegenerate} className="rounded-md px-1.5 py-0.5 text-[11px] text-text-low transition-colors hover:bg-hover hover:text-text-mid" type="button">
      Retry
    </button>
  );
}

function MessageRow({ msg, streaming, onRegenerate, onEditMessage }: { msg: ChatMessage; streaming: boolean; onRegenerate: () => void; onEditMessage: (content: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  if (msg.role === "user") {
    return (
      <div className="group flex flex-col items-end animate-rise">
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
          {msg.documents && msg.documents.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-1.5">
              {msg.documents.map((document) => <span key={document.name} className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/55">📄 {document.name}</span>)}
            </div>
          )}
          {msg.content && !editing && (
            <div className="inline-block rounded-[22px] rounded-br-md bg-white/[0.075] px-4 py-2.5 text-[15px] leading-relaxed text-white/90 backdrop-blur-sm">
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          )}
          {editing ? (
            <div className="w-full rounded-2xl border border-[#8b7cf6]/40 bg-black/20 p-2">
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} className="w-full resize-none bg-transparent p-1 text-[14px] text-white outline-none" autoFocus />
              <div className="flex justify-end gap-2 text-[11px]"><button type="button" onClick={() => { setEditing(false); setDraft(msg.content); }} className="px-2 py-1 text-white/40">Cancel</button><button type="button" onClick={() => onEditMessage(draft.trim())} className="rounded-lg bg-[#6f5bea] px-2.5 py-1 text-white">Edit & send</button></div>
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="mt-1 self-end text-[10px] text-white/25 opacity-100 transition-opacity hover:text-white/70 md:opacity-0 md:group-hover:opacity-100">Edit</button>
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
          <span className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <MessageActions onRegenerate={onRegenerate} />
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

// Empty-state headlines. They are walked in order and the cursor is persisted,
// so consecutive loads never repeat before the whole list has been seen.
const EMPTY_STATE_HEADLINES = [
  "What should we create?",
  "What are we building today?",
  "Where do you want to start?",
  "What is on your mind?",
  "Ask me anything at all.",
  "What are we figuring out?",
  "Bring me a problem.",
  "What would you like to know?",
  "Give me something to work with.",
  "What are we solving today?",
  "Let's make something useful.",
  "What is the first question?",
  "Drop it here, I will take it from there.",
  "What are you curious about?",
  "What deserves a second look?",
  "Start anywhere. I will keep up.",
  "What is the short version?",
  "Explain it to me and I will sharpen it.",
  "What are we untangling?",
  "Give me a rough idea and we will refine it.",
  "What is the best next step?",
  "What is worth exploring today?",
  "Point me at something.",
  "What should we think through?",
  "What is the real question here?",
  "Make a list, make a plan, or just talk.",
  "What do you want to understand better?",
  "Which rabbit hole are we going down?",
  "What needs a second brain?",
  "What is worth a few minutes of thought?",
  "Say it the messy way. I will organise it.",
  "What is the idea you cannot shake?",
  "What would you do with an extra hour?",
  "Tell me a story and I will keep straight.",
  "What should we stop overthinking?",
  "Which half-finished thing should we finish?",
  "What does good look like here?",
  "Paste the thing you do not want to read.",
  "What are you avoiding?",
  "Name the thing, I will find the angle.",
  "What would you ask a very patient expert?",
  "What is the version of this that actually ships?",
  "What is new since you last looked?",
  "Turn the messy notes into a plan.",
  "What is the smallest useful first step?",
  "What is worth keeping simple?",
  "What has been bothering you?",
  "What do you want to be careful about?",
  "Which trade-off are you weighing?",
  "What would you write if nobody read it?",
  "What is the one thing I should not forget?",
  "Show me the rough version, not the polished one.",
  "What is stuck?",
  "What would you do with unlimited time?",
  "What is the question behind the question?",
  "What deserves a proper explanation?",
  "What would you like to argue about?",
  "What is the best way to begin?",
  "What changed your mind recently?",
  "What would you fix if you could fix one thing?",
  "What should we make a list of?",
  "Where do you want more clarity?",
  "What is the thing you keep meaning to ask?",
  "What would make today feel productive?",
  "What is the whole idea in one line?",
  "What are we taking on next?",
  "What would you like a second opinion on?",
  "Which habit are you trying to build?",
  "What is the question you keep postponing?",
  "What should we make simpler?",
  "What is worth writing down properly?",
  "What are you hoping changes?",
  "Which idea deserves a rough draft today?",
  "What would a good outcome look like in a week?",
  "What is the part you already know the answer to?",
  "What do you want to be reminded of?",
  "What should we measure progress by?",
  "Where is the friction coming from?",
  "What would you do with a blank page?",
  "Which task has been quietly growing?",
  "What is the assumption worth testing?",
  "What would you tell a friend in this spot?",
  "What are you optimising for right now?",
  "What is the one thing to protect this week?",
  "What deserves a name before it becomes real?",
  "Which thread can we pull on?",
  "What is ready for a decision?",
  "What would make this feel finished?",
  "Where do you want a second set of eyes?",
  "What is the smallest thing that would help?",
  "What have you already tried?",
  "What should we leave alone?",
  "What is the part that is actually hard?",
  "What do you want to sound like?",
  "Which constraint is real and which is imagined?",
  "What would you regret not asking?",
  "What is the difference you want to see?",
  "What is the next honest step?",
  "What should we check before we commit?",
  "What are you avoiding saying out loud?",
  "What would make this conversation useful?",
  "Which idea has been sitting longest?",
  "What do you want to be different about tomorrow?",
  "What is worth keeping out of scope?",
  "What could we do in ten minutes?",
  "What is the shape of the problem?",
  "Which idea would be fun to test?",
  "What are you waiting on?",
  "What is worth writing a summary of?",
  "What would you change if you could?",
  "What is the second-order effect here?",
  "What should we ask the team?",
  "What has to be true for this to work?",
  "What is the kind of help you need?",
  "What is worth doing badly first?",
  "Which version of this would you actually use?",
  "What is the point of this, in one line?",
  "What should we stop, start, and continue?",
  "What is new in how you are thinking about it?",
  "What would you want remembered?",
  "What is the simplest honest answer?",
  "Which detail is doing all the work?",
  "What is worth another hour?",
  "What would change your mind?",
  "What are you optimising against?",
  "What is the thing underneath the thing?",
  "What should we do before Friday?",
  "What would you build if nobody was watching?",
  "What is the question behind the work?",
  "Which half of this is actually the task?",
  "What deserves a fresh pair of eyes?",
  "What is the most useful next reply?",
  "What would you like to be able to do?",
  "What is ready to be decided today?",
  "What are we avoiding by staying busy?",
  "What is the clearest way to say it?",
];

const HEADLINE_CURSOR_KEY = "mino:empty-headline-cursor";

/** Walks the list in order so two refreshes in a row never show the same line. */
function nextHeadline(): string {
  let cursor = 0;
  try {
    const stored = Number(localStorage.getItem(HEADLINE_CURSOR_KEY));
    if (Number.isInteger(stored) && stored >= 0) cursor = stored;
  } catch {
    // localStorage can be unavailable in private mode; fall back to a plain pick.
    return EMPTY_STATE_HEADLINES[Math.floor(Math.random() * EMPTY_STATE_HEADLINES.length)] ?? EMPTY_STATE_HEADLINES[0];
  }

  const headline = EMPTY_STATE_HEADLINES[cursor % EMPTY_STATE_HEADLINES.length] ?? EMPTY_STATE_HEADLINES[0];
  try {
    localStorage.setItem(HEADLINE_CURSOR_KEY, String(cursor + 1));
  } catch {
    // Non-fatal: the headline still changes within this session.
  }
  return headline;
}

export default function ChatThread({ messages, streamingId, isEmpty, suggestedMode, onRegenerate, onEditMessage, onCopyConversation }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [loadingMessage, setLoadingMessage] = useState<string>(STREAMING_MESSAGES[0]);
  const [showSourceHistory, setShowSourceHistory] = useState(false);
  // Seeded deterministically for SSR, then randomized after mount.
  const [headline, setHeadline] = useState(EMPTY_STATE_HEADLINES[0]);

  useEffect(() => {
    if (!isEmpty) return;
    setHeadline(nextHeadline());
  }, [isEmpty]);

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

  const allSources = messages.flatMap((message) => message.sources ?? []);
  const copySources = async () => {
    const text = allSources.map((source) => `${source.title}\n${source.url}`).join("\n\n");
    if (text) await navigator.clipboard.writeText(text).catch(() => undefined);
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
            {headline}
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
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4 md:px-7 md:pt-6">
        <div className="mb-5 flex items-center justify-end gap-1 text-[10px] text-white/30">
          <button type="button" onClick={onCopyConversation} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70">Copy chat</button>
          {allSources.length > 0 && <button type="button" onClick={() => setShowSourceHistory((value) => !value)} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70">Sources ({allSources.length})</button>}
          {showSourceHistory && <button type="button" onClick={() => void copySources()} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70">Copy links</button>}
        </div>
        {showSourceHistory && <div className="mb-5 rounded-2xl border border-[#9ee7ff]/10 bg-[#9ee7ff]/[0.035] p-3 animate-rise"><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9ee7ff]/70">Source history</div><div className="space-y-1">{allSources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="block truncate px-2 py-1 text-[11px] text-white/55 hover:text-white/85">{source.title} <span className="text-white/25">· {source.url}</span></a>)}</div></div>}
        <div className="flex flex-col gap-8">
          {messages.map((msg) => (
            <MessageRow
              key={msg.id}
              msg={msg}
              streaming={msg.id === streamingId}
              onRegenerate={() => onRegenerate(msg.id)}
              onEditMessage={(content) => onEditMessage(msg.id, content)}
            />
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
