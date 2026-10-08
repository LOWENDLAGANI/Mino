"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import MinoMark from "@/components/MinoMark";

const TUTORIAL_STORAGE_KEY = "mino:first-use-tutorial-v2";

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
  highlight?: "composer" | "selector" | "sidebar" | "tools";
}

const STEPS: TutorialStep[] = [
  {
    target: "composer",
    highlight: "composer",
    eyebrow: "Welcome to Mino",
    title: "Start a conversation",
    body: "Type any question or idea below and press send. Mino streams answers in real-time — watch it think as you read. Use Stop to pause, Copy to save.",
  },
  {
    target: "composer",
    highlight: "composer",
    eyebrow: "Bring context",
    title: "Add images & files",
    body: "Tap the attachment button, drag files in, or paste from clipboard. Mino understands images — show it something and ask questions about what you see.",
  },
  {
    target: "model-selector",
    highlight: "selector",
    eyebrow: "Choose your mode",
    title: "Pick the right Mino",
    body: "Mino Auto for everyday tasks, Mino Code for programming, or Mino Azure — Mino's own model created by Minetallest. Your choice is remembered.",
  },
  {
    target: "gallery-button",
    highlight: "tools",
    eyebrow: "Quick tools",
    title: "Everything at your fingertips",
    body: "The tools menu gives you fast access to gallery, search settings, and more. One tap, everything you need.",
  },
  {
    target: "sidebar-new-chat",
    highlight: "sidebar",
    eyebrow: "Your workspace",
    title: "New chat, fresh start",
    body: "Start a new conversation anytime. Your previous chats stay in Recent — pick up where you left off or begin something new.",
    mobileSidebar: true,
  },
  {
    target: "sidebar-recent",
    highlight: "sidebar",
    eyebrow: "Stay organized",
    title: "Recent conversations",
    body: "Every chat is saved locally. Reopen any conversation to continue, or swipe to delete. Your workspace, your control.",
    mobileSidebar: true,
  },
  {
    target: "sidebar-data",
    highlight: "sidebar",
    eyebrow: "Your data",
    title: "Stored on your device",
    body: "Mino keeps chats in your browser — no account needed. Import backups, export your data, or clear everything. You own your conversations.",
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
        top: targetRect.top - 8,
        left: targetRect.left - 8,
        width: targetRect.width + 16,
        height: targetRect.height + 16,
      }
    : null;

  const highlightColor = step.highlight === "selector" 
    ? "rgba(91, 155, 213, 0.4)" 
    : step.highlight === "composer" 
      ? "rgba(224, 142, 107, 0.4)"
      : "rgba(110, 194, 148, 0.4)";

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="mino-tutorial-title">
      {spotlightStyle && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-[24px] border border-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.78),0_0_0_1px_rgba(255,255,255,0.08)]"
          style={{ ...spotlightStyle, boxShadow: `0 0 0 9999px rgba(0,0,0,0.78), 0 0 0 1px rgba(255,255,255,0.08), 0 0 40px ${highlightColor}` }}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-4 pt-8 sm:items-center sm:p-8">
        <section className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#121c18]/[0.98] p-6 shadow-2xl shadow-black/70 backdrop-blur-2xl sm:p-7">
          {/* Header with logo and progress */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#a9d8bb]/20 to-[#2f6b48]/20 border border-[#a9d8bb]/20">
                <MinoMark className="h-8 w-8" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a9d8bb]/80">
                  {step.eyebrow}
                </p>
                <p className="mt-0.5 text-[11px] text-white/35">
                  {stepIndex + 1} / {STEPS.length}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={finish}
              className="rounded-full px-3 py-1.5 text-[12px] text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white/70"
              aria-label="Skip Mino tutorial"
            >
              Skip
            </button>
          </div>

          {/* Content */}
          <div className="mt-6">
            <h2 id="mino-tutorial-title" className="text-[26px] font-semibold tracking-[-0.04em] text-white leading-tight">
              {step.title}
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-white/60">{step.body}</p>
          </div>

          {/* Progress dots */}
          <div className="mt-6 flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((item, index) => (
              <span
                key={item.target + index}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === stepIndex ? "w-8 bg-gradient-to-r from-[#a9d8bb] to-[#2f6b48]" : "w-1.5 bg-white/15"
                }`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="mt-5 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={finish}
              className="text-[13px] text-white/40 transition-colors hover:text-white/70"
            >
              Skip tour
            </button>
            <button
              type="button"
              onClick={next}
              className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#a9d8bb] to-[#2f6b48] px-5 py-2.5 text-[13px] font-semibold text-[#121c18] transition-all duration-200 hover:shadow-lg hover:shadow-[#a9d8bb]/20 active:scale-[0.98]"
            >
              {stepIndex === STEPS.length - 1 ? "Start chatting" : "Next"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

