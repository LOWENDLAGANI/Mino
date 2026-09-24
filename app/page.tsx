"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Sidebar from "@/components/Sidebar";
import ChatThread from "@/components/ChatThread";
import ChatInput from "@/components/ChatInput";
import ModeSelector from "@/components/ModelSelector";
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
import type { ApiContentPart, ApiMessage, ChatMessage, ImageAttachment } from "@/lib/types";

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
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);
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
      const detail = (e as CustomEvent).detail as ModeId[];
      if (Array.isArray(detail)) setAvailable(detail);
    };
    window.addEventListener("mino:availability", handler);
    return () => window.removeEventListener("mino:availability", handler);
  }, []);

  const handleModeChange = (mode: ModeId) => {
    setSelectedMode(mode);
    saveSelectedMode(mode);
  };

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(null);
    setSidebarOpen(false);
  }, []);

  const handleSelectChat = useCallback((chatId: string) => {
    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(chatId);
    setSidebarOpen(false);
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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

      // Multimodal payload (OpenAI-compatible format).
      let content: string | ApiContentPart[] = text;
      if (images.length > 0) {
        const parts: ApiContentPart[] = [];
        if (text) parts.push({ type: "text", text });
        for (const img of images) {
          parts.push({ type: "image_url", image_url: { url: img.url } });
        }
        content = parts;
      }
      const apiUserMessage: ApiMessage = { role: "user", content };

      const history = await db.messages.where("chatId").equals(chatId).sortBy("createdAt");
      const apiMessages: ApiMessage[] = history
        .filter((m) => !m.error && (m.content ?? "").trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));

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
          body: JSON.stringify({ messages: [...apiMessages, apiUserMessage], mode: selectedMode }),
          signal: controller.signal,
        });

        // Even non-OK responses are handled gracefully below — never crash the UI.
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
            const evt = JSON.parse(data) as { content?: string; error?: string; usage?: SessionUsage };
            if (evt.error) {
              sawError = true;
              // Surface mid-stream errors when nothing has been rendered yet.
              if (!full.trim()) await setMessageError(assistantMsg.id, evt.error);
              return;
            }
            if (evt.content) {
              full += evt.content;
              await updateMessageContent(assistantMsg.id, full);
            }
            if (evt.usage) {
              await setMessageUsage(assistantMsg.id, evt.usage);
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
    [activeChatId, selectedMode, streamingId]
  );

  useEffect(() => {
    if (pendingSuggestion) {
      const text = pendingSuggestion;
      setPendingSuggestion(null);
      void sendMessage(text, []);
    }
  }, [pendingSuggestion, sendMessage]);

  const isStreaming = streamingId !== null;
  const visibleMessages = messages.filter((m) => m.content || m.images || m.error);

  return (
    <div className="flex h-[100dvh] bg-canvas text-text-body">
      <Sidebar
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="safe-top hairline-b flex h-14 shrink-0 items-center gap-1.5 px-3 md:px-5">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-mid transition-colors hover:bg-hover hover:text-text-hi md:hidden"
            aria-label="Open menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>

          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <button
              onClick={handleNewChat}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-mid transition-colors hover:bg-hover hover:text-text-hi"
              aria-label="New chat"
              title="New chat"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <span className="truncate text-sm font-medium text-text-hi">Mino</span>
          </div>

          <div className="flex-1" />

          <ModeSelector selected={selectedMode} onChange={handleModeChange} available={available} />
        </header>

        {/* Thread */}
        <ChatThread
          messages={visibleMessages}
          streamingId={streamingId}
          isEmpty={visibleMessages.length === 0}
          suggestedMode={hydrated ? selectedMode : DEFAULT_MODE_ID}
          onSuggestionClick={(text) => setPendingSuggestion(text)}
        />

        {/* Input */}
        <ChatInput onSend={sendMessage} disabled={isStreaming} onStop={stopStreaming} />
      </div>
    </div>
  );
}
