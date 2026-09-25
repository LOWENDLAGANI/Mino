"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Sidebar from "@/components/Sidebar";
import ChatThread from "@/components/ChatThread";
import ChatInput from "@/components/ChatInput";
import ModeSelector from "@/components/ModelSelector";
import MinoMark from "@/components/MinoMark";
import MinoTutorial from "@/components/MinoTutorial";
import {
  db,
  createChat,
  addMessage,
  updateMessageContent,
  setMessageError,
  setMessageUsage,
  maybeAutoTitle,
  loadSelectedMode,
  saveSelectedMode,
} from "@/lib/db";
import { DEFAULT_MODE_ID, getMode, type ModeId } from "@/lib/models";
// getMode is used for the assistant message engine label below.
import type {
  ApiContentPart,
  ApiMessage,
  ChatMessage,
  ImageAttachment,
  SearchMode,
  SearchSource,
} from "@/lib/types";

// ── Mino — main client orchestration: modes, streaming, chats ────────────────

interface SessionUsage {
  prompt: number;
  completion: number;
  total: number;
}

export default function HomePage() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ModeId>(DEFAULT_MODE_ID);
  const [available, setAvailable] = useState<ModeId[]>([DEFAULT_MODE_ID, "dev"]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>("auto");
  const [searchAvailable, setSearchAvailable] = useState(false);
  const [tutorialFinished, setTutorialFinished] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const messages = useLiveQuery(
    async () => {
      if (!activeChatId) return [] as ChatMessage[];
      return db.messages.where("chatId").equals(activeChatId).sortBy("createdAt");
    },
    [activeChatId],
    [] as ChatMessage[]
  );

  useEffect(() => {
    setSelectedMode(loadSelectedMode());
    setHydrated(true);
  }, []);

  // Probe which modes have keys configured server-side (may be empty).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        available?: ModeId[];
        searchAvailable?: boolean;
      };
      if (Array.isArray(detail.available)) setAvailable(detail.available);
      if (typeof detail.searchAvailable === "boolean") setSearchAvailable(detail.searchAvailable);
    };
    window.addEventListener("mino:availability", handler);
    return () => window.removeEventListener("mino:availability", handler);
  }, []);

  const handleModeChange = (mode: ModeId) => {
    setSelectedMode(mode);
    setModelNotice(null);
    saveSelectedMode(mode);
  };

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(null);
    setSidebarOpen(false);
    setModelNotice(null);
  }, []);

  const handleSelectChat = useCallback((chatId: string) => {
    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(chatId);
    setSidebarOpen(false);
    setModelNotice(null);
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const finishTutorial = useCallback(() => setTutorialFinished(true), []);

  // ── Streaming send ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[]) => {
      if (streamingId) return;
      if (!text && images.length === 0) return;

      let chatId = activeChatId;
      if (!chatId) {
        const chat = await createChat();
        chatId = chat.id;
        setActiveChatId(chatId);
      }

      await addMessage({
        chatId,
        role: "user",
        content: text,
        images: images.length > 0 ? images : undefined,
      });
      await maybeAutoTitle(chatId, text || "Image conversation");

      const history = await db.messages.where("chatId").equals(chatId).sortBy("createdAt");
      const apiMessages: ApiMessage[] = history.flatMap((message): ApiMessage[] => {
        if (message.error || (message.role !== "user" && message.role !== "assistant")) return [];
        if (message.role === "user" && message.images?.length) {
          const parts: ApiContentPart[] = [];
          if (message.content.trim()) parts.push({ type: "text", text: message.content });
          for (const image of message.images) {
            parts.push({ type: "image_url", image_url: { url: image.url } });
          }
          return [{ role: "user", content: parts }];
        }
        if (!message.content.trim()) return [];
        return [{ role: message.role, content: message.content }];
      });

      setModelNotice(null);
      const assistantMsg = await addMessage({
        chatId,
        role: "assistant",
        content: "",
        model: getMode(selectedMode).engine,
      });
      setStreamingId(assistantMsg.id);

      const controller = new AbortController();
      abortRef.current = controller;

      let sawError = false;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages, mode: selectedMode, searchMode }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || `Mino request failed (HTTP ${res.status})`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        const flushLine = async (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) return;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") return;
          try {
            const evt = JSON.parse(data) as {
              content?: string;
              error?: string;
              model?: string;
              usage?: SessionUsage;
              search?: { used: boolean; query?: string; sources?: SearchSource[] };
            };
            if (evt.model) {
              await db.messages.update(assistantMsg.id, { model: evt.model });
              if (evt.model !== getMode(selectedMode).engine) {
                setModelNotice(
                  "The model was changed automatically because the current model is experiencing a problem."
                );
              }
            }
            if (evt.error) {
              sawError = true;
              // Preserve any partial answer, but always show why streaming stopped.
              await setMessageError(assistantMsg.id, evt.error);
              return;
            }
            if (evt.content) {
              full += evt.content;
              await updateMessageContent(assistantMsg.id, full);
            }
            if (evt.usage) {
              await setMessageUsage(assistantMsg.id, evt.usage);
            }
            if (evt.search) {
              await db.messages.update(assistantMsg.id, {
                searchQuery: evt.search.query,
                sources: evt.search.sources ?? [],
              });
              if (!evt.search.used && searchMode !== "off") {
                setModelNotice("Mino checked the web but could not find a usable source.");
              }
            }
          } catch (err) {
            if (err instanceof Error && err.message !== "Stream interrupted") throw err;
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) await flushLine(line);
        }
        if (buffer.trim()) await flushLine(buffer);

        if (!full.trim() && !sawError) {
          await setMessageError(assistantMsg.id, "Mino returned an empty response. Try again.");
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          const message = err instanceof Error ? err.message : "Something went wrong";
          await setMessageError(assistantMsg.id, message);
        }
        if (aborted) {
          const msg = await db.messages.get(assistantMsg.id);
          if (msg && !msg.content) await db.messages.delete(assistantMsg.id);
        }
      } finally {
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [activeChatId, searchMode, selectedMode, streamingId]
  );

  const isStreaming = streamingId !== null;
  const visibleMessages = messages.filter((m) => m.content || m.images || m.error);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#030304] text-text-body">
      <Sidebar
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="app-surface relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="surface-glow pointer-events-none absolute inset-0" aria-hidden />

        <header className="safe-top relative z-20 flex h-16 shrink-0 items-center gap-3 px-4 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-body transition-colors hover:bg-white/[0.06] hover:text-white md:hidden"
            aria-label="Open menu"
            data-tutorial="mobile-menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <button
            onClick={handleNewChat}
            className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-2 text-left transition-opacity hover:opacity-80"
            aria-label="Start a new Mino chat"
          >
            <MinoMark className="h-7 w-7" />
            <span className="truncate text-[17px] font-medium tracking-[-0.02em] text-white">Mino</span>
          </button>

          <div className="flex-1" />
          <ModeSelector selected={selectedMode} onChange={handleModeChange} available={available} />
        </header>

        {modelNotice && (
          <div
            role="status"
            className="relative z-10 mx-4 mt-1 flex shrink-0 items-center justify-center gap-2 self-center rounded-full border border-white/[0.07] bg-white/[0.045] px-3.5 py-2 text-center text-[11px] leading-relaxed text-white/55 backdrop-blur-md md:max-w-xl"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#9ee7ff]" />
            <span>{modelNotice}</span>
          </div>
        )}

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <ChatThread
            messages={visibleMessages}
            streamingId={streamingId}
            isEmpty={visibleMessages.length === 0}
            suggestedMode={hydrated ? selectedMode : DEFAULT_MODE_ID}
          />
          <ChatInput
            onSend={sendMessage}
            disabled={isStreaming}
            onStop={stopStreaming}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            searchAvailable={searchAvailable}
          />
        </div>
      </main>

      {!tutorialFinished && (
        <MinoTutorial
          sidebarOpen={sidebarOpen}
          onOpenSidebar={openSidebar}
          onFinished={finishTutorial}
        />
      )}
    </div>
  );
}
