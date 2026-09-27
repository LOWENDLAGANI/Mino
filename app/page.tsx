"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Sidebar from "@/components/Sidebar";
import ChatThread from "@/components/ChatThread";
import ChatInput from "@/components/ChatInput";
import ModeSelector from "@/components/ModelSelector";
import MinoMark from "@/components/MinoMark";
import MinoTutorial from "@/components/MinoTutorial";
import SettingsPanel from "@/components/SettingsPanel";
import SessionNotes from "@/components/SessionNotes";
import WorkspacePanel from "@/components/WorkspacePanel";
import CommandPalette, { useAvailableChecks, useCommandPaletteHotkey, useRunCheck } from "@/components/CommandPalette";
import NamePrompt from "@/components/NamePrompt";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import { loadDisplayName, saveDisplayName } from "@/lib/visitorName";
import { syncVisitorProfile } from "@/lib/firebaseHistory";
import {
  db,
  createChat,
  createSessionChat,
  setChatNotes,
  addMessage,
  updateMessageContent,
  setMessageError,
  setMessageUsage,
  setMessageFiles,
  clearMessageVerification,
  maybeAutoTitle,
  loadSelectedMode,
  saveSelectedMode,
} from "@/lib/db";
import { DEFAULT_MODE_ID, getMode, IMAGE_ENGINE, type ModeId } from "@/lib/models";
import { parseResponse } from "@/lib/codeSession";
import { listWorkspace, loadPending, persistDecision, workspaceAttachment, type PendingFile, type WorkspaceFile } from "@/lib/workspace";
import type { CheckId } from "@/lib/verification";
import { generateImage, imageGenerationConfigured } from "@/lib/imageGeneration";
// getMode is used for the assistant message engine label below.
import type {
  ApiContentPart,
  ApiMessage,
  ChatMessage,
  DocumentAttachment,
  ImageAttachment,
  SearchMode,
  SearchSource,
} from "@/lib/types";
import {
  loadAppearance,
  loadReasoningEffort,
  loadResponseLength,
  saveAppearance,
  saveReasoningEffort,
  saveResponseLength,
  type Appearance,
  type ReasoningEffort,
  type ResponseLength,
} from "@/lib/settings";
import { authHeader, firebaseConfigured, syncFirebaseHistory } from "@/lib/firebaseHistory";
import { subscribeAppConfig, type AppConfig } from "@/lib/appConfig";
import { useMaintenance } from "@/lib/useMaintenance";

// ── Mino — main client orchestration: modes, streaming, chats ────────────────

interface SessionUsage {
  prompt: number;
  completion: number;
  total: number;
}

interface SendOptions {
  editMessageId?: string;
  regenerateAssistantId?: string;
}

export default function HomePage() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ModeId>(DEFAULT_MODE_ID);
  const [available, setAvailable] = useState<ModeId[]>([DEFAULT_MODE_ID, "code"]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>("auto");
  const [searchAvailable, setSearchAvailable] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [imageAvailable, setImageAvailable] = useState(false);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [tutorialFinished, setTutorialFinished] = useState(false);
  const [responseLength, setResponseLength] = useState<ResponseLength>("balanced");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("low");
  const [appearance, setAppearance] = useState<Appearance>("dark");
  const [loggingError, setLoggingError] = useState(false);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  // ── Code session state ─────────────────────────────────────────────────────
  /** Per-message reviewable proposals, keyed by assistant message id. */
  const [pendingByMessage, setPendingByMessage] = useState<Record<string, PendingFile[]>>({});
  /** The session's accepted file contents, as the workspace sees them. */
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  /** Paths sent with the next message. */
  const [attached, setAttached] = useState<string[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [sessionNotes, setSessionNotes] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The most recent check run, fed back on the next request. */
  const [lastVerification, setLastVerification] = useState<{ check: string; passed: boolean; output: string } | null>(null);
  const [checking, setChecking] = useState<CheckId | null>(null);
  const maintenance = useMaintenance();
  const abortRef = useRef<AbortController | null>(null);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messages = useLiveQuery(
    async () => {
      if (!activeChatId) return [] as ChatMessage[];
      return db.messages.where("chatId").equals(activeChatId).sortBy("createdAt");
    },
    [activeChatId],
    [] as ChatMessage[]
  );

  const chats = useLiveQuery(() => db.chats.orderBy("updatedAt").reverse().toArray(), [], []);

  useEffect(() => {
    setSelectedMode(loadSelectedMode());
    setResponseLength(loadResponseLength());
    setReasoningEffort(loadReasoningEffort());
    const nextAppearance = loadAppearance();
    setAppearance(nextAppearance);
    saveAppearance(nextAppearance);
    const savedName = loadDisplayName();
    setDisplayName(savedName);
    setHydrated(true);
    // Refresh last-seen on every return visit so the console's visitor list
    // stays live. On a first visit there is nothing to refresh yet — the name
    // screen does that write.
    if (savedName) {
      void syncVisitorProfile(savedName).catch((error: unknown) => {
        console.error("[Mino] Could not log the visitor name", error);
      });
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !firebaseConfigured) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      void syncFirebaseHistory()
        .then((result) => {
          if (result.synced) setLoggingError(false);
        })
        .catch((error: unknown) => {
          console.error("[Mino] Firebase logging failed", error);
          setLoggingError(true);
        });
    }, 900);
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [hydrated, chats, messages]);

  // Image generation is optional: probe once and show the setup note in the
  // composer tools if the Cloudflare keys are not in the environment.
  useEffect(() => {
    void imageGenerationConfigured()
      .then(setImageAvailable)
      .catch(() => setImageAvailable(false));
  }, []);

  // The administrator's announcement, read live from the same public node the
  // server enforces. A visitor who blocks the read simply never sees it.
  useEffect(() => subscribeAppConfig(setAppConfig), []);

  useEffect(() => {
    if (!loggingError) return;
    const timeout = setTimeout(() => setLoggingError(false), 4000);
    return () => clearTimeout(timeout);
  }, [loggingError]);

  // Remember the name in this browser and log it under the anonymous id.
  const handleSaveName = useCallback((name: string) => {
    const saved = saveDisplayName(name);
    setDisplayName(saved);
    void syncVisitorProfile(saved).catch((error: unknown) => {
      console.error("[Mino] Could not log the visitor name", error);
    });
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

  // Switching modes is not a mid-conversation toggle. Code mode is pinned to the
  // Gemini 3.8/3.7/3.6 family for code-generation accuracy, and continuing a
  // chat written by another model under a third one would blend two different
  // answers into one thread. So picking a mode that declares `separateSession`
  // starts a fresh session instead of reinterpreting the current one.
  const handleModeChange = (mode: ModeId) => {
    setSelectedMode(mode);
    setModelNotice(null);
    saveSelectedMode(mode);

    if (mode === selectedMode) return;
    if (!getMode(mode).separateSession) return;

    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(null);
    setSidebarOpen(false);
    setImageMode(false);
  };

  const handleResponseLengthChange = (value: ResponseLength) => {
    setResponseLength(value);
    saveResponseLength(value);
  };

  const handleReasoningEffortChange = (value: ReasoningEffort) => {
    setReasoningEffort(value);
    saveReasoningEffort(value);
  };

  const handleAppearanceChange = (value: Appearance) => {
    setAppearance(value);
    saveAppearance(value);
  };

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(null);
    setSidebarOpen(false);
    setModelNotice(null);
    setPendingByMessage({});
    setAttached([]);
    setLastVerification(null);
    setSessionNotes("");
  }, []);

  /**
   * Starts a Code session.
   *
   * This is the entry point the palette and the mode switch both use, and it is
   * separate from `handleNewChat` because a Code session carries state a chat
   * does not: it defaults to Code mode, its files and notes, and its own
   * verification history.
   */
  const handleNewCodeSession = useCallback(() => {
    abortRef.current?.abort();
    setStreamingId(null);
    setSelectedMode("code");
    saveSelectedMode("code");
    setActiveChatId(null);
    setSidebarOpen(false);
    setModelNotice(null);
    setPendingByMessage({});
    setAttached([]);
    setFilesOpen(false);
    setSessionNotes("");
    setLastVerification(null);
  }, []);

  // The workspace follows the active session, so switching chats shows the files
  // that belong to the chat you switched to rather than the previous one. The
  // review state is rebuilt alongside it, because it lives in React state and
  // would otherwise be empty after every reload.
  useEffect(() => {
    if (!activeChatId) {
      setWorkspaceFiles([]);
      setPendingByMessage({});
      return;
    }
    let active = true;
    void Promise.all([listWorkspace(activeChatId), loadPending(activeChatId)]).then(
      ([files, pending]) => {
        if (!active) return;
        setWorkspaceFiles(files);
        setPendingByMessage(pending);
      }
    );
    return () => {
      active = false;
    };
  }, [activeChatId, messages]);

  // Notes are per chat, so they load with the session.
  useEffect(() => {
    if (!activeChatId) {
      setSessionNotes("");
      return;
    }
    let active = true;
    void db.chats.get(activeChatId).then((chat) => {
      if (active) setSessionNotes(chat?.notes ?? "");
    });
    return () => {
      active = false;
    };
  }, [activeChatId]);

  const handleSaveNotes = useCallback(
    async (notes: string) => {
      setSessionNotes(notes);
      // A chat with no messages yet has no id, so the notes are held in state
      // and written when the session is created by the first send.
      if (activeChatId) await setChatNotes(activeChatId, notes);
    },
    [activeChatId]
  );

  /**
   * Records a hunk decision and refreshes the derived workspace.
   *
   * The decision is written to the message, not held in React state, because the
   * workspace is derived from it — a decision kept only in state would be lost
   * on reload and the rejected hunk would return as if accepted.
   */
  const handleDecisionChange = useCallback(
    async (messageId: string, path: string, hunkId: string, accepted: boolean) => {
      setPendingByMessage((current) => {
        const list = current[messageId];
        if (!list) return current;
        return {
          ...current,
          [messageId]: list.map((file) =>
            file.path === path
              ? { ...file, decisions: { ...file.decisions, [hunkId]: accepted } }
              : file
          ),
        };
      });
      await persistDecision(messageId, path, hunkId, accepted);
      if (activeChatId) {
        const files = await listWorkspace(activeChatId);
        setWorkspaceFiles(files);
      }
    },
    [activeChatId]
  );

  const handleToggleAttach = useCallback((path: string) => {
    setAttached((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    );
  }, []);

  const handleCopyFile = useCallback(async (path: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setModelNotice(`${path} copied to your clipboard`);
    } catch {
      setModelNotice("Clipboard access is unavailable in this browser");
    }
  }, []);

  const handleDismissVerification = useCallback(
    async (messageId: string) => {
      await clearMessageVerification(messageId);
      setLastVerification(null);
    },
    []
  );

  /**
   * Writes a check result into the session as its own message.
   *
   * It is a message rather than a banner so the output sits in the thread where
   * the conversation can refer to it, and so it is still there after a reload.
   * The session may not exist yet — a check can be run before the first send —
   * so one is created in Code mode if needed.
   */
  const recordVerification = useCallback(
    async (result: { check: string; passed: boolean; output: string; at?: number }) => {
      let chatId = activeChatId;
      if (!chatId) {
        const chat = await createSessionChat("code");
        chatId = chat.id;
        setActiveChatId(chat.id);
      }
      if (!chatId) return;
      await addMessage({
        chatId,
        role: "assistant",
        content: "",
        model: getMode("code").engine,
        verification: {
          check: result.check,
          passed: result.passed,
          output: result.output,
          at: result.at ?? Date.now(),
        },
      });
    },
    [activeChatId]
  );

  const handleSelectChat = useCallback((chatId: string) => {
    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(chatId);
    setSidebarOpen(false);
    setModelNotice(null);
    // File reviews are keyed by message id, which is unique per message, so
    // carrying them across a chat switch would attach another session's diffs
    // to this one. The workspace and notes are re-derived from the new chat by
    // their own effects.
    setPendingByMessage({});
    setAttached([]);
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const checks = useAvailableChecks();
  const { run: runCheck, running } = useRunCheck((result) => {
    setLastVerification({ check: result.check, passed: result.passed, output: result.output });
    setChecking(null);
    setModelNotice(
      result.passed
        ? `${result.check} passed. Ask Mino what you want next and it will see the result.`
        : `${result.check} failed. The real output is in the thread — ask Mino to fix it.`
    );
    // The result is recorded as a message so the output is visible in the
    // thread and survives a reload. Without this the panel below would never
    // render, because it reads the result off the message rather than off
    // component state.
    void recordVerification(result);
  });
  // Surfaced in the header so a run is visible even before it finishes.
  useEffect(() => {
    if (running) setChecking(running);
  }, [running]);

  const handleRunCheck = useCallback(
    (check: CheckId) => {
      if (checking) return;
      setChecking(check);
      setModelNotice(`Running ${check}…`);
      void runCheck(check);
    },
    [checking, runCheck]
  );

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const finishTutorial = useCallback(() => setTutorialFinished(true), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteHotkey(openPalette);

  // ── Streaming send ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[], documents: DocumentAttachment[] = [], options?: SendOptions) => {
      if (streamingId) return;
      if (!text && images.length === 0 && documents.length === 0 && !options) return;

      let chatId = activeChatId;
      if (options?.editMessageId) {
        const original = await db.messages.get(options.editMessageId);
        if (!original) return;
        chatId = original.chatId;
        await db.messages.update(original.id, { content: text, images: images.length ? images : undefined, documents: documents.length ? documents : undefined });
        await db.messages.where("chatId").equals(chatId).filter((message) => message.createdAt > original.createdAt).delete();
      } else if (options?.regenerateAssistantId) {
        const original = await db.messages.get(options.regenerateAssistantId);
        if (!original) return;
        chatId = original.chatId;
        await db.messages.where("chatId").equals(chatId).filter((message) => message.createdAt >= original.createdAt).delete();
      } else {
        if (!chatId) {
          // A session is typed at creation, so the first send is what makes a
          // chat a Code session rather than a later reclassification.
          const chat =
            selectedMode === "code" ? await createSessionChat("code") : await createChat();
          chatId = chat.id;
          setActiveChatId(chatId);
          if (selectedMode === "code" && sessionNotes.trim()) {
            await setChatNotes(chatId, sessionNotes);
          }
        }
        await addMessage({
          chatId,
          role: "user",
          content: text,
          images: images.length > 0 ? images : undefined,
          documents: documents.length > 0 ? documents : undefined,
        });
        await maybeAutoTitle(chatId, text || "Attachment conversation");
      }
      if (!chatId) return;
      setActiveChatId(chatId);

      // Attached workspace files ride along as an explicit context block, so the
      // model edits the version the user actually kept rather than an earlier
      // proposal that may have had hunks rejected.
      const attachment = attached.length > 0 ? workspaceAttachment(workspaceFiles, attached) : "";

      const history = await db.messages.where("chatId").equals(chatId).sortBy("createdAt");
      const apiMessages: ApiMessage[] = history.flatMap((message): ApiMessage[] => {
        if (message.error || (message.role !== "user" && message.role !== "assistant")) return [];
        if (message.role === "user" && (message.images?.length || message.documents?.length)) {
          const parts: ApiContentPart[] = [];
          const documentText = message.documents?.map((document) => `Attachment ${document.name}:\n${document.text}`).join("\n\n");
          const textContent = [message.content, documentText].filter(Boolean).join("\n\n");
          if (textContent) parts.push({ type: "text", text: textContent });
          for (const image of message.images ?? []) parts.push({ type: "image_url", image_url: { url: image.url } });
          return [{ role: "user", content: parts }];
        }
        if (!message.content.trim()) return [];
        return [{ role: message.role, content: message.content }];
      });

      // The attachment belongs to this turn, not to the stored history, so it is
      // appended after the transcript is built and never persisted into a
      // previous user message.
      if (attachment) {
        apiMessages.push({ role: "user", content: attachment });
      }

      setModelNotice(null);
      const assistantMsg = await addMessage({ chatId, role: "assistant", content: "", model: getMode(selectedMode).engine });
      setStreamingId(assistantMsg.id);
      // Files are attached to this turn only, so the next message is not still
      // carrying a file the user has moved on from.
      if (attached.length > 0) setAttached([]);

      const controller = new AbortController();
      abortRef.current = controller;
      let sawError = false;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({
            messages: apiMessages,
            mode: selectedMode,
            searchMode,
            responseLength,
            reasoningEffort,
            notes: sessionNotes,
            verification: lastVerification ?? undefined,
          }),
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
            const evt = JSON.parse(data) as { content?: string; error?: string; model?: string; usage?: SessionUsage; search?: { used: boolean; query?: string; sources?: SearchSource[] } };
            if (evt.model) {
              await db.messages.update(assistantMsg.id, { model: evt.model });
              if (evt.model !== getMode(selectedMode).engine) setModelNotice("The model was changed automatically because the current model is experiencing a problem.");
            }
            if (evt.error) {
              sawError = true;
              await setMessageError(assistantMsg.id, evt.error);
              return;
            }
            if (evt.content) {
              full += evt.content;
              await updateMessageContent(assistantMsg.id, full);
            }
            if (evt.usage) await setMessageUsage(assistantMsg.id, evt.usage);
            if (evt.search) {
              await db.messages.update(assistantMsg.id, { searchQuery: evt.search.query, sources: evt.search.sources ?? [] });
              if (!evt.search.used && searchMode !== "off") setModelNotice("Mino checked the web but could not find a usable source.");
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
        if (!full.trim() && !sawError) await setMessageError(assistantMsg.id, "Mino returned an empty response. Try again.");

        // Only a Code session gets files and a timeline. In Auto mode the same
        // fence is an ordinary code block, and treating it as a change would put
        // review UI on top of an example snippet.
        if (selectedMode === "code" && full.trim()) {
          const parsed = parseResponse(full);
          if (parsed.files.length > 0 || parsed.steps.length > 0) {
            await setMessageFiles(
              assistantMsg.id,
              parsed.files.length > 0 ? parsed.files : undefined,
              parsed.steps.length > 0 ? parsed.steps : undefined,
              // The prose has the file blocks removed, so each file appears once
              // — as the reviewable diff — not twice.
              parsed.files.length > 0 ? parsed.prose : undefined
            );
            if (parsed.files.length > 0) {
              // The review state is deliberately NOT computed here. The message
              // has already been written, so the workspace now contains this
              // very proposal — diffing against it would compare the file with
              // itself and report no change for every file, every time. The
              // `messages` live query re-runs the effect above, which derives
              // each base from the state BEFORE its message, which is correct.
              setFilesOpen(true);
            }
          }
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) await setMessageError(assistantMsg.id, err instanceof Error ? err.message : "Something went wrong");
        if (aborted) {
          const msg = await db.messages.get(assistantMsg.id);
          if (msg && !msg.content) await db.messages.delete(assistantMsg.id);
        }
      } finally {
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [activeChatId, attached, lastVerification, reasoningEffort, responseLength, searchMode, selectedMode, sessionNotes, streamingId, workspaceFiles]
  );

  // ── Image generation ───────────────────────────────────────────────────────
  // The prompt becomes a normal user message so the image lives in the same
  // thread as everything else, and the result is stored locally like any
  // attachment. The Cloudflare key is only ever read by /api/image.
  const drawImage = useCallback(
    async (prompt: string) => {
      if (drawingId) return;
      const clean = prompt.trim();
      if (!clean) return;

      let chatId = activeChatId;
      if (!chatId) {
        const chat = await createChat();
        chatId = chat.id;
        setActiveChatId(chatId);
      }
      if (!chatId) return;
      await addMessage({ chatId, role: "user", content: clean });
      await maybeAutoTitle(chatId, clean);

      const assistantMsg = await addMessage({ chatId, role: "assistant", content: "", model: IMAGE_ENGINE });
      setDrawingId(assistantMsg.id);
      setModelNotice(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const image = await generateImage({ prompt: clean, signal: controller.signal });
        await db.messages.update(assistantMsg.id, {
          content: "",
          generatedImages: [image],
          model: IMAGE_ENGINE,
        });
        if (!imageAvailable) setImageAvailable(true);
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          await setMessageError(assistantMsg.id, err instanceof Error ? err.message : "Image generation failed");
        }
      } finally {
        setDrawingId(null);
        abortRef.current = null;
      }
    },
    [activeChatId, drawingId, imageAvailable]
  );

  const handleSend = useCallback(
    (text: string, images: ImageAttachment[], documents?: DocumentAttachment[]) => {
      if (imageMode) {
        void drawImage(text);
        return;
      }
      void sendMessage(text, images, documents);
    },
    [drawImage, imageMode, sendMessage]
  );

  const handleRegenerate = useCallback((assistantId: string) => {
    void sendMessage("", [], [], { regenerateAssistantId: assistantId });
  }, [sendMessage]);

  const handleEditMessage = useCallback((messageId: string, content: string) => {
    void sendMessage(content, [], [], { editMessageId: messageId });
  }, [sendMessage]);

  const handleCopyConversation = useCallback(async () => {
    const text = messages.map((message) => `${message.role === "user" ? "You" : "Mino"}: ${message.content}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setModelNotice("Conversation copied to your clipboard");
    } catch {
      setModelNotice("Clipboard access is unavailable in this browser");
    }
  }, [messages]);

  const isStreaming = streamingId !== null;
  // The message being drawn has no content yet, so it is kept explicitly to
  // show the drawing placeholder.
  // A check result is a message with no content at all — the output lives on
  // `verification` — so it has to be admitted here explicitly. Without this the
  // panel renders correctly but is filtered out of the thread before it is ever
  // reached, which is exactly the kind of bug that survives a code review.
  const visibleMessages = messages.filter(
    (m) =>
      m.content ||
      m.images ||
      m.generatedImages ||
      m.error ||
      m.verification ||
      m.id === drawingId
  );

  // Nothing is rendered until localStorage has been read, so a returning
  // visitor never sees the chat flash before their name is known.
  if (!hydrated) return null;

  // Maintenance replaces the page outright rather than covering it, so
  // nothing behind the notice is mounted and there is nothing to navigate to.
  if (!maintenance.resolved) return null;
  if (maintenance.active) return <MaintenanceScreen message={maintenance.message} />;

  // Entry gate: the name is what the admin console lists visitors by, so Mino
  // is not usable until one is given. There is no skip out of this screen.
  if (!displayName) {
    return (
      <div className="flex h-[100dvh] overflow-hidden bg-[#030304] text-text-body">
        <NamePrompt open onSave={handleSaveName} />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#030304] text-text-body">
      <Sidebar
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onNewCodeSession={handleNewCodeSession}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
        displayName={displayName}
      />

      <main className="app-surface relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="surface-glow pointer-events-none absolute inset-0" aria-hidden />

        <header className="safe-top relative z-20 flex h-16 shrink-0 items-center gap-3 px-4 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lift flex h-9 w-9 items-center justify-center rounded-full text-text-body transition-colors hover:bg-white/[0.06] hover:text-white md:hidden"
            aria-label="Open menu"
            data-tutorial="mobile-menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <button
            onClick={handleNewChat}
            className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-2 text-left transition-opacity hover:opacity-80 active:opacity-60"
            aria-label="Start a new Mino chat"
            title="Mino"
          >
            <MinoMark className="h-7 w-7" />
            <span className="truncate text-[17px] font-medium tracking-[-0.02em] text-white">Mino</span>
          </button>

          <div className="flex-1" />
          {/* On a phone the header only has room for the mode picker and one
              overflow button; Files, Notes, and the palette all move into that
              menu, so nothing is hidden behind a control too small to hit. */}
          {selectedMode === "code" && (
            <div className="hidden items-center gap-1 md:flex">
              {sessionNotes.trim() && (
                <button
                  type="button"
                  onClick={() => setNotesOpen(true)}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-white/[0.09] px-2.5 text-[11px] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                  title="Project notes for this session"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9ee7ff]" />
                  Notes
                </button>
              )}
              <button
                type="button"
                onClick={() => setFilesOpen((value) => !value)}
                className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors ${
                  filesOpen
                    ? "border-[#9ee7ff]/25 bg-[#9ee7ff]/[0.08] text-[#9ee7ff]"
                    : "border-white/[0.09] text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                }`}
                title="Working files"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 3v5h5" /><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7Z" />
                </svg>
                Files
                {workspaceFiles.length > 0 && (
                  <span className="rounded-full bg-white/[0.08] px-1.5 text-[9px] text-white/60">
                    {workspaceFiles.length}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Mobile overflow. A 40px target, and it is the only way to reach
              Files or Notes on a phone. */}
          {selectedMode === "code" && (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.06] md:hidden"
              aria-label="Session menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-1.5 rounded-full border border-white/[0.09] px-2.5 text-[11px] text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/80 md:flex"
            title="Command palette"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m7 15 5-5 5 5" />
            </svg>
            <span className="hidden sm:inline">Commands</span>
            <kbd className="hidden rounded border border-white/10 px-1 font-mono text-[9px] text-white/30 lg:inline">⌘K</kbd>
          </button>
          <ModeSelector selected={selectedMode} onChange={handleModeChange} available={available} />
        </header>

        {appConfig?.announcement && (
          <div
            role="status"
            className="animate-rise relative z-10 mx-4 mt-1 flex shrink-0 items-center justify-center self-center rounded-full border border-[#9ee7ff]/15 bg-[#9ee7ff]/[0.06] px-3.5 py-2 text-center text-[11px] leading-relaxed text-white/70 backdrop-blur-md md:max-w-xl"
          >
            {appConfig.announcement}
          </div>
        )}

        {modelNotice && (
          <div
            role="status"
            className="relative z-10 mx-4 mt-1 flex shrink-0 items-center justify-center gap-2 self-center rounded-full border border-white/[0.07] bg-white/[0.045] px-3.5 py-2 text-center text-[11px] leading-relaxed text-white/55 backdrop-blur-md md:max-w-xl"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#9ee7ff]" />
            <span>{modelNotice}</span>
          </div>
        )}

        {loggingError && (
          <div role="alert" className="relative z-10 mx-4 mt-1 flex shrink-0 items-center justify-center self-center rounded-full border border-red-400/20 bg-red-500/[0.08] px-3.5 py-2 text-center text-[11px] font-medium tracking-[0.08em] text-red-200/90 backdrop-blur-md animate-rise">
            LG FAILED
          </div>
        )}

        <div className="relative z-10 flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ChatThread
              messages={visibleMessages}
              streamingId={streamingId}
              drawingId={drawingId}
              isEmpty={visibleMessages.length === 0}
              onRegenerate={handleRegenerate}
              onEditMessage={handleEditMessage}
              onCopyConversation={handleCopyConversation}
              codeMode={selectedMode === "code"}
              pendingByMessage={pendingByMessage}
              onDecisionChange={handleDecisionChange}
              onToggleAttach={handleToggleAttach}
              onCopyFile={handleCopyFile}
              attached={attached}
              onDismissVerification={handleDismissVerification}
            />
            <ChatInput
              onSend={handleSend}
              disabled={isStreaming || drawingId !== null}
              onStop={stopStreaming}
              imageMode={imageMode}
              onImageModeChange={setImageMode}
              imageAvailable={imageAvailable}
            />
          </div>

          {selectedMode === "code" && filesOpen && (
            <WorkspacePanel
              open
              files={workspaceFiles}
              attached={attached}
              onToggleAttach={handleToggleAttach}
              onCopy={handleCopyFile}
              onClose={() => setFilesOpen(false)}
            />
          )}
        </div>
      </main>

      {!tutorialFinished && (
        <MinoTutorial
          sidebarOpen={sidebarOpen}
          onOpenSidebar={openSidebar}
          onFinished={finishTutorial}
        />
      )}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        searchMode={searchMode}
        onSearchModeChange={setSearchMode}
        searchAvailable={searchAvailable}
        responseLength={responseLength}
        onResponseLengthChange={handleResponseLengthChange}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={handleReasoningEffortChange}
        appearance={appearance}
        onAppearanceChange={handleAppearanceChange}
      />

      <SessionNotes
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        notes={sessionNotes}
        onSave={handleSaveNotes}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        mode={selectedMode}
        onModeChange={handleModeChange}
        onNewChat={handleNewChat}
        onNewCodeSession={handleNewCodeSession}
        onToggleNotes={() => setNotesOpen(true)}
        onToggleFiles={() => setFilesOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRunCheck={handleRunCheck}
        checks={checks}
        fileCount={workspaceFiles.length}
      />

    </div>
  );
}
