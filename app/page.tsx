"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Sidebar from "@/components/Sidebar";
import ChatThread from "@/components/ChatThread";
import ChatInput from "@/components/ChatInput";
import ModelSelector from "@/components/ModelSelector";
import {
  db,
  createChat,
  addMessage,
  updateMessageContent,
  setMessageError,
  setMessageUsage,
  maybeAutoTitle,
  loadSelectedModel,
  saveSelectedModel,
} from "@/lib/db";
import { DEFAULT_MODEL_ID, estimateTokens, getModel } from "@/lib/models";
import type { ApiContentPart, ApiMessage, ChatMessage, ImageAttachment } from "@/lib/types";

// ── Mino — main client orchestration: chats, streaming, model switching ─────

interface SessionUsage {
  prompt: number;
  completion: number;
  total: number;
}

export default function HomePage() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionUsage, setSessionUsage] = useState<SessionUsage>({ prompt: 0, completion: 0, total: 0 });
  const [hydrated, setHydrated] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const messages = useLiveQuery(
    async () => {
      if (!activeChatId) return [] as ChatMessage[];
      return db.messages.where("chatId").equals(activeChatId).sortBy("createdAt");
    },
    [activeChatId],
    [] as ChatMessage[]
  );

  // Hydrate persisted model preference on mount.
  useEffect(() => {
    setSelectedModel(loadSelectedModel());
    setHydrated(true);
  }, []);

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    saveSelectedModel(modelId);
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

  // ── Streaming send ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[]) => {
      if (streamingId) return;
      if (!text && images.length === 0) return;
      setInputError(null);

      // Ensure a chat exists.
      let chatId = activeChatId;
      if (!chatId) {
        const chat = await createChat();
        chatId = chat.id;
        setActiveChatId(chatId);
      }

      // Persist user message (with base64 attachments) to IndexedDB.
      const userMsg = await addMessage({
        chatId,
        role: "user",
        content: text,
        images: images.length > 0 ? images : undefined,
      });
      await maybeAutoTitle(chatId, text || "Image conversation");

      // Build multimodal payload per OpenRouter format.
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

      // Load full history for context (persisted assistant replies included).
      const history = await db.messages.where("chatId").equals(chatId).sortBy("createdAt");
      const apiMessages: ApiMessage[] = history
        .filter((m) => !m.error && m.id !== userMsg.id && (m.content ?? "").trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));

      // Placeholder assistant bubble to stream into.
      const assistantMsg = await addMessage({ chatId, role: "assistant", content: "", model: selectedModel });
      setStreamingId(assistantMsg.id);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...apiMessages, apiUserMessage],
            model: selectedModel,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? `Request failed (${res.status})`);
        }

        // Read the SSE relay from the route handler.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        const flushLine = async (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) return;
          const data = trimmed.slice(5).trim();
          if (!data) return;
          if (data === "[DONE]") return;
          try {
            const evt = JSON.parse(data) as {
              content?: string;
              error?: string;
              usage?: SessionUsage;
            };
            if (evt.error) throw new Error(evt.error);
            if (evt.content) {
              full += evt.content;
              await updateMessageContent(assistantMsg.id, full);
            }
            if (evt.usage) {
              await setMessageUsage(assistantMsg.id, evt.usage);
              setSessionUsage((u) => ({
                prompt: u.prompt + evt.usage!.prompt,
                completion: u.completion + evt.usage!.completion,
                total: u.total + evt.usage!.total,
              }));
            }
          } catch (err) {
            if (err instanceof Error && err.message !== "Stream interrupted") {
              throw err;
            }
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            await flushLine(line);
          }
        }
        if (buffer.trim()) await flushLine(buffer);

        if (!full.trim()) {
          await setMessageError(assistantMsg.id, "Mino returned an empty response. Try again.");
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          const message = err instanceof Error ? err.message : "Something went wrong";
          await setMessageError(assistantMsg.id, message);
          setInputError(message);
        }
        // Remove an empty assistant bubble on abort before any content arrived.
        const msg = await db.messages.get(assistantMsg.id);
        if (msg && !msg.content && !msg.usage && (aborted || err instanceof Error)) {
          if (aborted) await db.messages.delete(assistantMsg.id);
        }
      } finally {
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [activeChatId, selectedModel, streamingId]
  );

  // Handle suggestion clicks from the empty state.
  useEffect(() => {
    if (pendingSuggestion) {
      const text = pendingSuggestion;
      setPendingSuggestion(null);
      void sendMessage(text, []);
    }
  }, [pendingSuggestion, sendMessage]);

  const isStreaming = streamingId !== null;
  const visibleMessages = messages.filter((m) => m.content || m.images || m.error);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-dvh overflow-hidden bg-ink-950">
      <Sidebar
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Navbar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900/80 px-4 backdrop-blur">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-ink-700 hover:text-zinc-200 md:hidden"
            aria-label="Open sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <div className="flex items-center gap-2 md:hidden">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white">
              M
            </div>
            <span className="text-sm font-semibold text-zinc-200">Mino</span>
          </div>

          <div className="flex-1 truncate px-1 text-sm text-zinc-500">
            <span className="hidden md:inline">
              {hydrated ? getModel(selectedModel).description : ""}
            </span>
          </div>

          {/* Live token usage */}
          <div className="hidden items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-[11px] text-zinc-400 sm:flex">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            {sessionUsage.total.toLocaleString()} tokens
          </div>

          <ModelSelector selected={selectedModel} onChange={handleModelChange} />
        </header>

        {/* Thread */}
        <ChatThread
          messages={visibleMessages}
          streamingId={streamingId}
          isEmpty={visibleMessages.length === 0}
          suggestedModel={selectedModel}
          onSuggestionClick={(text) => setPendingSuggestion(text)}
        />

        {/* Input */}
        <div className="shrink-0">
          <ChatInput onSend={sendMessage} disabled={isStreaming} />
          {inputError && (
            <div className="px-4 pb-2 text-center text-xs text-red-400">{inputError}</div>
          )}
        </div>
      </div>
    </div>
  );
}
