"use client";

// ── Image gallery overlay ────────────────────────────────────────────────────
// Every picture this device has created or attached, newest first, in one
// grid. Clicking one opens the conversation it came from — the gallery is a
// view over chat history, not a separate library to manage.

import { useEffect, useState } from "react";
import { listGallery, type GalleryItem } from "@/lib/gallery";

interface GalleryOverlayProps {
  open: boolean;
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
}

export default function GalleryOverlay({ open, onClose, onSelectChat }: GalleryOverlayProps) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);

  useEffect(() => {
    if (!open) {
      setItems(null);
      return;
    }
    let cancelled = false;
    void listGallery()
      .then((found) => {
        if (!cancelled) setItems(found);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center px-3 pb-3 sm:items-center sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70" style={{ backdropFilter: "blur(6px)" }} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Image gallery"
        className="animate-pop relative flex max-h-[82dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-white/[0.1] bg-[#141f1a] shadow-2xl shadow-black/80"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">Images</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Close gallery"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {items === null ? (
            <div className="flex items-center justify-center py-14">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#a9d8bb]/40 border-t-transparent" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-10 text-center text-[12px] leading-relaxed text-white/35">
              No images yet. Anything you create with the image model or attach to a message
              appears here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((item) => (
                <button
                  key={`${item.messageId}-${item.createdAt}-${item.kind}`}
                  type="button"
                  onClick={() => {
                    onSelectChat(item.chatId);
                    onClose();
                  }}
                  title={item.label}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.07] bg-black/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={item.label}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                  />
                  <span
                    className={`pointer-events-none absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide backdrop-blur-sm ${
                      item.kind === "generated" ? "bg-[#2f6b48]/60 text-white" : "bg-black/50 text-white/70"
                    }`}
                  >
                    {item.kind === "generated" ? "Made" : "Sent"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-white/[0.06] px-5 py-3">
          <p className="text-[10px] leading-relaxed text-white/30">
            Tap an image to open the conversation it came from. Everything here is stored on
            this device, inside your chats.
          </p>
        </footer>
      </section>
    </div>
  );
}
