"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import MinoMark from "@/components/MinoMark";

const TUTORIAL_STORAGE_KEY = "mino:first-use-tutorial-v1";

type TutorialTarget =
  | "mobile-menu"
  | "sidebar-new-chat"
  | "sidebar-utilities"
  | "sidebar-recent"
  | "sidebar-data"
  | "model-selector"
  | "gallery-button"
  | "composer";

interface TutorialStep {
  target: TutorialTarget;
  eyebrow: string;
  title: string;
  body: string;
  fallbackTarget?: TutorialTarget;
  mobileSidebar?: boolean;
}

const STEPS: TutorialStep[] = [
  {
    target: "composer",
    eyebrow: "01 · Start a conversation",
    title: "Ask Mino anything",
    body: "Type a question or idea into the composer, then press the arrow to send it. Mino streams its answer here in real time; use Stop to end a response early, then Copy to reuse an answer.",
  },
  {
    target: "composer",
    eyebrow: "02 · Add context",
    title: "Bring images into the chat",
    body: "Select the image button, drag files into the composer, or paste an image from your clipboard. Mino prepares up to four image attachments for your message, so you can ask questions about what you share.",
  },
  {
    target: "model-selector",
    eyebrow: "03 · Choose your helper",
    title: "Pick the right Mino mode",
    body: "Use the model menu in the top bar. Mino Auto chooses the best available model for each prompt, while Mino Dev is tuned for code and technical work. Your choice is remembered on this device.",
  },
  {
    target: "gallery-button",
    eyebrow: "04 · Add your tools",
    title: "Everything useful, one tap away",
    body: "Open this compact tools menu to attach images from your Gallery or choose how Mino handles web search. Auto stays quiet for general knowledge questions, while On and Off give you direct control.",
  },
  {
    target: "mobile-menu",
    fallbackTarget: "sidebar-new-chat",
    eyebrow: "05 · Open your workspace",
    title: "Everything is one tap away",
    body: "On small screens, the menu button opens your Mino workspace. From there you can start a new chat, find recent conversations, and manage the data stored on this device.",
  },
  {
    target: "sidebar-new-chat",
    eyebrow: "06 · Start a fresh conversation",
    title: "New chat keeps things clear",
    body: "Use New chat whenever you want a clean slate. Your current conversation is cleared without deleting anything from Recent.",
    mobileSidebar: true,
  },
  {
    target: "sidebar-recent",
    eyebrow: "07 · Keep chats organized",
    title: "Your work stays close",
    body: "Recent chats are saved locally. Reopen any conversation to continue where you left off, or use the small delete control to remove an individual chat.",
    mobileSidebar: true,
  },
  {
    target: "sidebar-utilities",
    eyebrow: "08 · Find and move your work",
    title: "Search or bring in a backup",
    body: "Search chats filters your recent titles as you type. Library opens a Mino JSON backup for import, while Export saves a copy of your chats and messages. Clear removes the local data after confirmation.",
    mobileSidebar: true,
  },
  {
    target: "sidebar-data",
    eyebrow: "09 · Yours, on this device",
    title: "Local-first by default",
    body: "Mino stores chats and messages locally in your browser, so your workspace stays available without an account. The account footer and data controls are here whenever you want to manage that local copy.",
    mobileSidebar: true,
  },
];

interface MinoTutorialProps {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onFinished: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function hasSeenTutorial(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

function rememberTutorial(): void {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "done");
  } catch {
    // The tutorial can still be completed for this session when storage is unavailable.
  }
}

export default function MinoTutorial({ sidebarOpen, onOpenSidebar, onFinished }: MinoTutorialProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [visible, setVisible] = useState(false);
  const step = STEPS[stepIndex];

  const finish = useCallback(() => {
    rememberTutorial();
    onFinished();
  }, [onFinished]);

  const next = useCallback(() => {
    if (stepIndex === STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((current) => current + 1);
  }, [finish, stepIndex]);

  useEffect(() => {
    if (hasSeenTutorial()) {
      onFinished();
      return;
    }
    setVisible(true);
  }, [onFinished]);

  useEffect(() => {
    if (!visible) return;
    if (step.mobileSidebar && !sidebarOpen) onOpenSidebar();
  }, [onOpenSidebar, sidebarOpen, step.mobileSidebar, visible]);

  useEffect(() => {
    if (!visible) return;
    const targetIds = [step.target, ...(step.fallbackTarget ? [step.fallbackTarget] : [])];
    const measure = () => {
      for (const targetId of targetIds) {
        const element = document.querySelector<HTMLElement>(`[data-tutorial="${targetId}"]`);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
        return;
      }
      setTargetRect(null);
    };

    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (observer) {
      for (const targetId of targetIds) {
        const observerTarget = document.querySelector<HTMLElement>(`[data-tutorial="${targetId}"]`);
        if (observerTarget) observer.observe(observerTarget);
      }
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [sidebarOpen, step.fallbackTarget, step.target, visible]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight" && !event.metaKey && !event.ctrlKey) next();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [finish, next, visible]);

  if (!visible) return null;

  const spotlightStyle: CSSProperties | null = targetRect
    ? {
        top: targetRect.top - 5,
        left: targetRect.left - 5,
        width: targetRect.width + 10,
        height: targetRect.height + 10,
      }
    : null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="mino-tutorial-title">
      {spotlightStyle && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-[22px] border border-[#9ee7ff]/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.76),0_0_0_1px_rgba(158,231,255,0.25),0_0_32px_rgba(126,111,255,0.28)]"
          style={spotlightStyle}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-4 pt-8 sm:items-center sm:p-8">
        <section className="pointer-events-auto w-full max-w-sm rounded-[26px] border border-white/[0.12] bg-[#111116]/[0.97] p-5 shadow-2xl shadow-black/70 backdrop-blur-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.07]">
                <MinoMark className="h-7 w-7" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9ee7ff]/75">Mino quick tour</p>
                <p className="mt-1 text-[12px] text-white/40">{stepIndex + 1} of {STEPS.length}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={finish}
              className="rounded-full px-2 py-1 text-[12px] text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white"
              aria-label="Skip Mino tutorial"
            >
              Skip
            </button>
          </div>

          <div className="mt-6">
            <p className="text-[11px] font-medium tracking-[0.08em] text-[#a7a0ff]">{step.eyebrow}</p>
            <h2 id="mino-tutorial-title" className="mt-2 text-[23px] font-semibold tracking-[-0.035em] text-white">
              {step.title}
            </h2>
            <p className="mt-3 text-[14px] leading-6 text-white/60">{step.body}</p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {STEPS.map((item, index) => (
                <span
                  key={item.target + index}
                  className={`h-1.5 rounded-full transition-all ${index === stepIndex ? "w-6 bg-[#9ee7ff]" : "w-1.5 bg-white/20"}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={next}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-[#111116] transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {stepIndex === STEPS.length - 1 ? "Start chatting" : "Next"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
