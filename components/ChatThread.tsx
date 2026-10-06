"use client";

import type { ChatMessage, GeneratedImage } from "@/lib/types";
import { getModelDisplayName } from "@/lib/models";
import { imageDownloadName } from "@/lib/imageGeneration";
import { displayedContent, variantCount, variantPosition } from "@/lib/variants";
import { downloadChatImage } from "@/lib/shareImage";
import { buildShareLink } from "@/lib/shareLink";
import Markdown from "./Markdown";
import MinoMark from "./MinoMark";
import { useSmoothText } from "@/lib/useSmoothText";
import { speak, speechSupported, stopSpeaking } from "@/lib/tts";
import { useEffect, useRef, useState } from "react";

interface ChatThreadProps {
  messages: ChatMessage[];
  streamingId: string | null;
  /** Assistant message currently being drawn by the image model, if any. */
  drawingId: string | null;
  isEmpty: boolean;
  onRegenerate: (assistantId: string) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onCopyConversation: () => void;
  /** Which answer is on screen for a message that has more than one. */
  onSwitchVariant: (messageId: string, index: number | null) => void;
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
      className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.07] hover:text-white/80"
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy"}
      type="button"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-[#a9d8bb]" aria-hidden="true">
          <path d="m4.5 12.5 5 5 10-11" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2.5" />
          <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5" />
        </svg>
      )}
    </button>
  );
}

function SearchSources({ sources }: { sources: NonNullable<ChatMessage["sources"]> }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-[#a9d8bb]/10 bg-[#a9d8bb]/[0.035] p-3">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a9d8bb]/70">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4M12 3.5c2.1 2.3 3.2 5.1 3.2 8.5s-1.1 6.2-3.2 8.5c-2.1-2.3-3.2-5.1-3.2-8.5S9.9 5.8 12 3.5Z" />
        </svg>
        Web sources
      </div>
      {/* Prompt injection is real and pages are writable by anyone: the reader
          deserves to see that these snippets are reference material, not
          Mino's own words. The system prompt already says so to the model;
          this says it to the person. */}
      <p className="mb-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-white/35">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
          <path d="M12 3l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3Z" />
        </svg>
        <span>Untrusted web text — Mino was told to treat these pages as reference, not as instructions.</span>
      </p>
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
    <button
      onClick={onRegenerate}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.07] hover:text-white/80"
      aria-label="Retry this answer"
      title="Retry"
      type="button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 11a8 8 0 1 0-2.1 6.3" />
        <path d="M20 5v6h-6" />
      </svg>
    </button>
  );
}

/**
 * The stepper for an answer with more than one version.
 *
 * A retry or an edit used to replace the answer; now the old one stays, so the
 * reader needs a way to see both. Position 0 is the live answer and k is the
 * k-th previous one — the numbering counts from the newest, because that is the
 * one people think of as "the" answer when they start browsing.
 */
function VariantNav({
  message,
  onSwitch,
}: {
  message: ChatMessage;
  onSwitch: (index: number | null) => void;
}) {
  const count = variantCount(message);
  if (count <= 1) return null;
  const position = variantPosition(message);
  const go = (next: number) => onSwitch(next <= 0 ? null : next);

  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-1 py-0.5 text-[10px] text-white/45">
      <button
        type="button"
        onClick={() => go(position - 1)}
        disabled={position === 0}
        className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
        aria-label="Show the newer answer"
      >
        ‹
      </button>
      <span className={position === 0 ? "px-0.5" : "px-0.5 text-[#a9d8bb]"}>
        {position + 1}/{count}
        {position === 0 ? " latest" : " earlier"}
      </span>
      <button
        type="button"
        onClick={() => go(position + 1)}
        disabled={position >= count - 1}
        className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
        aria-label="Show the previous answer"
      >
        ›
      </button>
    </span>
  );
}

function MessageRow({ msg, streaming, drawing, onRegenerate, onEditMessage, onSwitchVariant, speaking, onSpeak, onStopSpeak }: {
  msg: ChatMessage;
  streaming: boolean;
  drawing: boolean;
  onRegenerate: () => void;
  onEditMessage: (content: string) => void;
  onSwitchVariant: (index: number | null) => void;
  speaking?: boolean;
  onSpeak?: () => void;
  onStopSpeak?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  // What the reader is looking at: the live answer, or an earlier one they
  // stepped back to. Every display and copy below uses this, so the screen and
  // the clipboard can never disagree about which answer is being read.
  const displayText = displayedContent(msg);
  // While the answer is arriving, the text on screen trails the text already
  // received, revealed at a steady pace instead of landing in whatever size
  // chunks the provider happened to send. Finished answers are never held
  // back — only the streaming one is animated.
  const shownContent = useSmoothText(displayText, streaming);
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
            <div className="w-full rounded-2xl border border-[#3f7d5c]/40 bg-black/20 p-2">
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} className="w-full resize-none bg-transparent p-1 text-[14px] text-white outline-none" autoFocus />
              <div className="flex justify-end gap-2 text-[11px]"><button type="button" onClick={() => { setEditing(false); setDraft(msg.content); }} className="px-2 py-1 text-white/40">Cancel</button><button type="button" onClick={() => onEditMessage(draft.trim())} className="rounded-lg bg-[#2a6142] px-2.5 py-1 text-white">Edit & send</button></div>
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
          <span
            className="text-[10px] text-text-low"
            title={`${msg.usage.prompt.toLocaleString()} in · ${msg.usage.completion.toLocaleString()} out`}
          >
            {msg.usage.total.toLocaleString()} tok
          </span>
        )}
        <VariantNav message={msg} onSwitch={onSwitchVariant} />
      </div>

      {drawing && <DrawingPlaceholder />}

      {msg.generatedImages && msg.generatedImages.length > 0 && (
        <div className="mb-2 max-w-md">
          {msg.generatedImages.map((image) => (
            <GeneratedImageCard key={image.createdAt} image={image} />
          ))}
        </div>
      )}

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

      {shownContent && (
        <div className={streaming ? "stream-cursor" : ""}>
          <Markdown content={shownContent} />
        </div>
      )}

      {msg.sources && <SearchSources sources={msg.sources} />}

      {/* The actions sit below the answer rather than in its header, and they
          appear only once the answer is genuinely finished. That placement is
          the point: a truncated response is the one failure here that is
          otherwise invisible, rendering and copying as a clean block and
          reading as complete. With the controls underneath, their absence is
          the signal — nothing to press means nothing finished, and the
          explanation below says why. A header button could not carry that
          meaning, because it would be missing for unrelated reasons. */}
      {msg.content && !streaming && !msg.truncated && !msg.error && (
        <div className="mt-2 flex items-center gap-1">
          <MessageActions onRegenerate={onRegenerate} />
          <CopyMessageButton text={displayText} />
          {speechSupported() && onSpeak && onStopSpeak && (
            speaking ? (
              <button
                onClick={onStopSpeak}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.07] text-white/80 transition-colors hover:bg-white/[0.12]"
                aria-label="Stop reading aloud"
                title="Stop reading"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="m16 9 5 6M21 9l-5 6" />
                </svg>
              </button>
            ) : (
              <button
                onClick={onSpeak}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.07] hover:text-white/80"
                aria-label="Read this answer aloud"
                title="Read aloud"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
                </svg>
              </button>
            )
          )}
        </div>
      )}

      {/* A cut-off answer, said out loud. A truncated file is the one failure
          mode here that is completely invisible: it renders as a clean code
          block, copies as a clean code block, and reads as finished. This only
          appears once every other model Mino can reach has also failed to
          finish it, so the wording says as much. */}
      {msg.truncated && (
        <div
          role="status"
          className="mt-2 rounded-xl border border-amber-300/15 bg-amber-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-100/80"
        >
          Mino tried other models and this answer still stops partway, because
          it hit their length limit too. Ask it to continue and it will pick up
          from where it left off.
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

function DrawingPlaceholder() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10" role="status" aria-live="polite">
      <div className="flex aspect-[4/3] w-full max-w-md items-center justify-center bg-white/[0.03]">
        <span className="animate-breathe flex items-center gap-2 text-[12px] text-white/45">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#a9d8bb]/40 border-t-transparent" />
          Drawing…
        </span>
      </div>
    </div>
  );
}

function GeneratedImageCard({ image }: { image: GeneratedImage }) {
  const download = () => {
    const link = document.createElement("a");
    link.href = image.url;
    link.download = imageDownloadName(image);
    link.click();
  };
  return (
    <figure className="animate-pop group/img mb-2 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.prompt}
        className="w-full cursor-zoom-in object-cover"
        onClick={() => window.open(image.url, "_blank")}
      />
      <figcaption className="flex items-center gap-2 border-t border-white/[0.07] px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-white/40" title={image.prompt}>
          {image.prompt}
        </span>
        <button
          type="button"
          onClick={download}
          className="lift shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-medium text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          Save
        </button>
      </figcaption>
    </figure>
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

export default function ChatThread({  messages,
  streamingId,
  drawingId,
  isEmpty,
  onRegenerate,
  onEditMessage,
  onCopyConversation,
  onSwitchVariant,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [loadingMessage, setLoadingMessage] = useState<string>(STREAMING_MESSAGES[0]);
  const [showSourceHistory, setShowSourceHistory] = useState(false);
  // Rendering a share image takes a moment (measure, draw at 2×, encode), and
  // the button says so rather than appearing to do nothing.
  const [sharing, setSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  // Which answer the voice is reading, so exactly one message shows Stop.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Leaving the thread must not leave a voice reading to an empty screen.
  useEffect(() => () => stopSpeaking(), []);
  // Seeded deterministically for SSR, then randomized after mount.
  const [headline, setHeadline] = useState(EMPTY_STATE_HEADLINES[0]);

  const handleSpeak = (msg: ChatMessage, text: string) => {
    if (speakingId === msg.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    const started = speak(text, () =>
      setSpeakingId((current) => (current === msg.id ? null : current))
    );
    setSpeakingId(started ? msg.id : null);
  };

  const handleShareImage = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const title = messages.find((message) => message.role === "user")?.content ?? "";
      await downloadChatImage(messages, title);
      setShareNotice("Image saved");
    } catch (cause) {
      setShareNotice(cause instanceof Error ? cause.message : "Could not build the image");
    } finally {
      setSharing(false);
      setTimeout(() => setShareNotice(null), 3000);
    }
  };

  /**
   * Hands this conversation over as a URL that carries it inside itself.
   *
   * The native share sheet goes first where the browser has one — this is a
   * phone-first product and "share" on a phone means the sheet — with the
   * clipboard as the fallback everywhere else, including desktop. Cancelling
   * the sheet is not a failure and says nothing.
   */
  const handleShareLink = async () => {
    if (linkBusy || sharing) return;
    setLinkBusy(true);
    try {
      const title = messages.find((message) => message.role === "user")?.content ?? "";
      const link = await buildShareLink(messages, title);
      const summary =
        link.included < link.total
          ? `Link copied · latest ${link.included} of ${link.total} messages`
          : "Link copied";

      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ title: "A chat from Mino", url: link.url });
          setShareNotice(
            link.included < link.total
              ? `Shared · latest ${link.included} of ${link.total} messages`
              : "Shared"
          );
          return;
        } catch (cause) {
          if (cause instanceof Error && cause.name === "AbortError") return;
          // Any other refusal (an insecure context, a browser that exposes
          // `share` but rejects URLs) falls through to the clipboard.
        }
      }

      await navigator.clipboard.writeText(link.url);
      setShareNotice(summary);
    } catch (cause) {
      setShareNotice(cause instanceof Error ? cause.message : "Could not build the link");
    } finally {
      setLinkBusy(false);
      setTimeout(() => setShareNotice(null), 4000);
    }
  };

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
            <div className="absolute inset-[-45%] rounded-full bg-[#2f6b48]/20 blur-3xl" />
            <MinoMark className="relative h-full w-full" />
          </div>
          <h1 className="text-balance text-[38px] font-normal leading-[1.08] tracking-[-0.045em] text-white sm:text-[54px] lg:text-[62px]">
            {headline}
          </h1>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4 md:px-7 md:pt-6">
        <div className="mb-5 flex items-center justify-end gap-1 text-[10px] text-white/30">
          {shareNotice && <span className="animate-rise mr-1 rounded-lg bg-white/[0.06] px-2 py-1.5 text-white/55">{shareNotice}</span>}
          <button type="button" onClick={() => void handleShareLink()} disabled={linkBusy || sharing} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:opacity-50">
            {linkBusy ? "Building…" : "Share link"}
          </button>
          <button type="button" onClick={() => void handleShareImage()} disabled={sharing} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:opacity-50">
            {sharing ? "Rendering…" : "Share image"}
          </button>
          <button type="button" onClick={onCopyConversation} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70">Copy chat</button>
          {allSources.length > 0 && <button type="button" onClick={() => setShowSourceHistory((value) => !value)} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70">Sources ({allSources.length})</button>}
          {showSourceHistory && <button type="button" onClick={() => void copySources()} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70">Copy links</button>}
        </div>
        {showSourceHistory && <div className="mb-5 rounded-2xl border border-[#a9d8bb]/10 bg-[#a9d8bb]/[0.035] p-3 animate-rise"><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a9d8bb]/70">Source history</div><p className="mb-2 text-[10px] leading-relaxed text-white/35">Untrusted web text — reference, not instructions.</p><div className="space-y-1">{allSources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="block truncate px-2 py-1 text-[11px] text-white/55 hover:text-white/85">{source.title} <span className="text-white/25">· {source.url}</span></a>)}</div></div>}
        <div className="flex flex-col gap-8">
          {messages.map((msg) => (
            <MessageRow
              key={msg.id}
              msg={msg}
              streaming={msg.id === streamingId}
              drawing={msg.id === drawingId}
              onRegenerate={() => onRegenerate(msg.id)}
              onEditMessage={(content) => onEditMessage(msg.id, content)}
              onSwitchVariant={(index) => onSwitchVariant(msg.id, index)}
              speaking={msg.id === speakingId}
              onSpeak={() => handleSpeak(msg, displayedContent(msg))}
              onStopSpeak={() => {
                stopSpeaking();
                setSpeakingId(null);
              }}
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
