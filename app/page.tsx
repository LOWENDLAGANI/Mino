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
import NotificationNag from "@/components/NotificationNag";
import NamePrompt from "@/components/NamePrompt";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import { loadDisplayName, saveDisplayName } from "@/lib/visitorName";
import { syncVisitorProfile } from "@/lib/firebaseHistory";
import { bindGoogleAccount, loadAccountName } from "@/lib/account";
import { describeLinkError, greetingName, isDismissed, normalizeName } from "@/lib/accountState";
import {
  db,
  createChat,
  addMessage,
  maybeAutoTitle,
  loadSelectedMode,
  saveSelectedMode,
} from "@/lib/db";
import { DEFAULT_MODE_ID, getMode, IMAGE_ENGINE, type ModeId } from "@/lib/models";
import { resolveMode } from "@/lib/paywallState";
import { useSubscription } from "@/lib/useSubscription";
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
import {
  authHeader,
  firebaseConfigured,
  getServices,
  loadChatsFromAccount,
  syncFirebaseHistory,
} from "@/lib/firebaseHistory";
import { subscribeAppConfig, type AppConfig } from "@/lib/appConfig";
import { displayedContent, retireCurrentAnswer } from "@/lib/variants";
import { TempThread, type MessageInput } from "@/lib/tempChat";
import { dueFirst, isDue, type ScheduledMessage } from "@/lib/scheduler";
import { purgeTrash } from "@/lib/trash";
import { parseRetrySeconds } from "@/lib/rateLimit";

/** The chat id a temporary thread uses. It is never a row in the database — it
    exists only so the send path has one variable to address either kind of
    chat by, and it can never collide with a real id, which is a uuid. */
const TEMP_CHAT_ID = "temporary";
import { useMaintenance } from "@/lib/useMaintenance";
import SplashScreen from "@/components/SplashScreen";
import InstallPrompt from "@/components/InstallPrompt";
import MemorySuggestions from "@/components/MemorySuggestions";
import NotesPrompt from "@/components/NotesPrompt";
import {
  dismissSuggestions,
  loadSuggestionEnabled,
  requestMemorySuggestions,
  shouldSuggest,
  suggestionsDismissed,
} from "@/lib/memorySuggestions";

// ── Mino — main client orchestration: modes, streaming, chats ────────────────

interface SessionUsage {
  prompt: number;
  completion: number;
  total: number;
}

interface SendOptions {
  editMessageId?: string;
  regenerateAssistantId?: string;
  /** A queued message fires into the chat it was written from, whatever is
      on screen at the time. */
  chatId?: string;
  /** The mode and search setting it was scheduled under, so an answer queued
      from Code mode is still answered by Code mode. */
  mode?: ModeId;
  searchMode?: SearchMode;
  /** The queue row to consume once the send is actually under way. */
  scheduledId?: string;
}

export default function HomePage() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ModeId>(DEFAULT_MODE_ID);
  const [available, setAvailable] = useState<ModeId[]>([DEFAULT_MODE_ID, "code"]);
  // What this visitor has paid for, read live. Drives which modes may be picked
  // and what the composer is allowed to do, so the paywall and the pricing page
  // cannot disagree about the same person.
  const { ready: planReady, planId } = useSubscription();
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [resolvingAccount, setResolvingAccount] = useState(true);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
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
  // Epoch ms until the server has asked the composer to hold off, set from the
  // wait the server itself names in a 429 — never guessed locally.
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const maintenance = useMaintenance();
  const abortRef = useRef<AbortController | null>(null);
  // ── Temporary chat ─────────────────────────────────────────────────────────
  // A conversation that is never written down: not to IndexedDB, and therefore
  // not to the account either, since everything uploaded to Firebase starts as
  // a local row. The thread lives in this component and in this ref — nothing
  // else is allowed to keep a copy.
  const [temporary, setTemporary] = useState(false);
  const tempThreadRef = useRef(new TempThread());
  const [tempMessages, setTempMessages] = useState<ChatMessage[]>([]);

  /** Publishes the thread to React after any change, so the screen follows a
      message being written exactly as it follows one read from the database. */
  const publishTemp = useCallback(() => {
    setTempMessages(tempThreadRef.current.list());
  }, []);

  const endTemporary = useCallback(() => {
    tempThreadRef.current.clear();
    setTempMessages([]);
    setTemporary(false);
  }, []);

  const startTemporary = useCallback(() => {
    abortRef.current?.abort();
    setStreamingId(null);
    tempThreadRef.current.clear();
    setTempMessages([]);
    setActiveChatId(null);
    setModelNotice(null);
    setTemporary(true);
    setSidebarOpen(false);
  }, []);

  const toggleTemporary = useCallback(() => {
    if (temporary) endTemporary();
    else startTemporary();
  }, [endTemporary, startTemporary, temporary]);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryRunRef = useRef(0);

  const messages = useLiveQuery(
    async () => {
      if (!activeChatId) return [] as ChatMessage[];
      return db.messages.where("chatId").equals(activeChatId).sortBy("createdAt");
    },
    [activeChatId],
    [] as ChatMessage[]
  );

  const chats = useLiveQuery(() => db.chats.orderBy("updatedAt").reverse().toArray(), [], []);

  // The send-later queue, read live so chips appear and vanish exactly as the
  // rows do. Oldest appointment first — that is also the order they fire in.
  const scheduled = useLiveQuery(
    () => db.scheduled.orderBy("sendAt").toArray(),
    [],
    [] as ScheduledMessage[]
  );

  // Memories ride along with every request, so this is read live from Dexie
  // rather than copied into state: a second browser writing to the same
  // account must be able to change what the next answer is built on without
  // this page knowing about it in advance.
  const memorySnapshot = useLiveQuery(() => db.memories.toArray(), [], []);

  // Facts Mino noticed by itself and is offering, kept apart from the list
  // until the user accepts. Offered, never stored — see MemorySuggestions.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [checkingMemory, setCheckingMemory] = useState(false);

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

  // A name typed on this device is the authority, and a linked account brings
  // both the name and the chat history with it. This runs on every visit rather
  // than only on sign-in, so a conversation written on a phone while this
  // browser was closed is here the next time it is opened.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const settle = () => {
      if (!cancelled) setResolvingAccount(false);
    };

    if (!firebaseConfigured) {
      settle();
      return;
    }

    void (async () => {
      try {
        const services = await getServices();
        // Nobody, or an anonymous visitor: there is no account to ask.
        if (cancelled || !services?.user || services.user.isAnonymous) {
          settle();
          return;
        }

        // The chats that belong to this account are pulled on every visit, not
        // only at the moment of sign-in: a phone that wrote history while this
        // browser was closed has to be able to hand it over on the next open.
        // The name is a separate question and only asked when this browser has
        // none, so a guest is never made to wait on a database read.
        if (!cancelled) await loadChatsFromAccount();
        if (!cancelled && !loadDisplayName()) {
          const accountName = await loadAccountName();
          if (!cancelled && accountName) setDisplayName(saveDisplayName(accountName));
        }
      } catch {
        // No account, no rule for one, or offline. Local data stands.
      } finally {
        settle();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated]);

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

  /**
   * The optional Google door on the name screen.
   *
   * It resolves a name the same way every other entry point does — the account's
   * own name first, Google's second — and hands it to `handleSaveName`, so the
   * gate is never entered by a different route than the text field. A successful
   * sign-in that produced no usable name is reported rather than waved through:
   * letting someone in with no name would break the one thing the name is for.
   */
  const handleGoogleEntry = useCallback(async () => {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const result = await bindGoogleAccount();
      if (result.outcome === "dismissed") return;
      // Whatever the account already holds is adopted before this device's own
      // history is written over the top of it, so the two are merged rather
      // than one replacing the other.
      await loadChatsFromAccount();
      const accountName = await loadAccountName();
      const resolved = normalizeName(
        greetingName(loadDisplayName(), accountName, result.view.name)
      );
      if (!resolved) {
        setGoogleError(
          "You are signed in, but no name came with it. Type a name above to continue."
        );
        return;
      }
      handleSaveName(resolved);
    } catch (cause: unknown) {
      if (isDismissed(cause)) return;
      console.error("[Mino] Google entry failed", cause);
      setGoogleError(describeLinkError(cause));
    } finally {
      setGoogleBusy(false);
    }
  }, [handleSaveName]);

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

  // A stored preference can outlive the plan that unlocked it: somebody who used
  // Azure and lets it lapse must not be left sitting on a mode they can no longer
  // send, with the composer refusing every message. Auto is always open, so
  // there is always somewhere to land — and this only ever moves them *out* of
  // a locked mode, never into one.
  useEffect(() => {
    if (!planReady) return;
    const open = resolveMode(selectedMode, available, planId);
    if (open !== selectedMode) {
      setSelectedMode(open);
      saveSelectedMode(open);
    }
  }, [planReady, planId, available, selectedMode]);

  // Switching modes is not a mid-conversation toggle. Code mode is pinned to the
  // Mino V3/V2/V1 family for code-generation accuracy, and continuing a chat
  // written by one model under another would blend two different answers into
  // one thread. So picking a mode that declares `separateSession` starts a fresh
  // session instead of reinterpreting the current one.
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
    // A new chat is a chat you meant to keep, so a temporary thread ends here
    // rather than silently turning into one that is written down.
    if (temporary) endTemporary();
  }, [endTemporary, temporary]);

  const handleSelectChat = useCallback((chatId: string) => {
    abortRef.current?.abort();
    setStreamingId(null);
    setActiveChatId(chatId);
    setSidebarOpen(false);
    setModelNotice(null);
    if (temporary) endTemporary();
  }, [endTemporary, temporary]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Send later ─────────────────────────────────────────────────────────────
  const handleSchedule = useCallback(
    (text: string, images: ImageAttachment[], documents: DocumentAttachment[], sendAt: number) => {
      const item: ScheduledMessage = {
        id: crypto.randomUUID(),
        // A temporary thread is never written down, so there is no chat to
        // come back to; the message fires into a fresh one instead.
        chatId: temporary ? null : activeChatId,
        content: text,
        images: images.length > 0 ? images : undefined,
        documents: documents.length > 0 ? documents : undefined,
        mode: selectedMode,
        searchMode,
        sendAt,
        createdAt: Date.now(),
      };
      void db.scheduled.add(item).catch((error: unknown) => {
        console.error("[Mino] Could not queue the message", error);
      });
    },
    [activeChatId, searchMode, selectedMode, temporary]
  );

  const handleCancelScheduled = useCallback((id: string) => {
    void db.scheduled.delete(id);
  }, []);

  // Turning the server's own refusal into a countdown the composer can show.
  // Anything without a named wait in it is a plain error and changes nothing.
  const noteRateLimit = useCallback((message: string) => {
    const seconds = parseRetrySeconds(message);
    if (seconds) setRateLimitUntil(Date.now() + seconds * 1000);
  }, []);

  // The countdown ends by clearing itself, so the composer's one-second tick
  // stops with it instead of running for the rest of the session.
  useEffect(() => {
    if (!rateLimitUntil) return;
    if (rateLimitUntil <= Date.now()) {
      setRateLimitUntil(null);
      return;
    }
    const timer = setTimeout(() => setRateLimitUntil(null), rateLimitUntil - Date.now() + 300);
    return () => clearTimeout(timer);
  }, [rateLimitUntil]);

  // Expired trash is dropped on arrival, so thirty-day-old conversations do
  // not sit in the Trash overlay waiting to be noticed.
  useEffect(() => {
    void purgeTrash().catch(() => undefined);
  }, []);

  // Settings → Your data wiped everything while this page was open; the view
  // follows the data back to an empty thread.
  useEffect(() => {
    const onWiped = () => handleNewChat();
    window.addEventListener("mino:data-wiped", onWiped);
    return () => window.removeEventListener("mino:data-wiped", onWiped);
  }, [handleNewChat]);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const finishTutorial = useCallback(() => setTutorialFinished(true), []);

  // ── Where a message is written ─────────────────────────────────────────────
  // One set of calls for both kinds of chat, so the send path below has no
  // `if (temporary)` in it. A temporary message goes to the in-memory thread and
  // nowhere else; a real one goes to Dexie, and the account sync picks it up
  // there exactly as it always has.
  const appendMessage = useCallback(
    async (input: MessageInput): Promise<ChatMessage> => {
      if (!temporary) return addMessage(input);
      const message = tempThreadRef.current.append(input);
      publishTemp();
      return message;
    },
    [publishTemp, temporary]
  );

  const patchMessage = useCallback(
    async (id: string, changes: Partial<ChatMessage>): Promise<void> => {
      if (!temporary) {
        await db.messages.update(id, changes);
        return;
      }
      tempThreadRef.current.patch(id, changes);
      publishTemp();
    },
    [publishTemp, temporary]
  );

  const writeContent = useCallback(
    async (id: string, content: string): Promise<void> => patchMessage(id, { content }),
    [patchMessage]
  );
  const markError = useCallback(
    async (id: string, error: string): Promise<void> => patchMessage(id, { error }),
    [patchMessage]
  );
  const writeUsage = useCallback(
    async (
      id: string,
      usage: { prompt: number; completion: number; total: number }
    ): Promise<void> => patchMessage(id, { usage }),
    [patchMessage]
  );

  const readMessage = useCallback(
    async (id: string): Promise<ChatMessage | undefined> =>
      temporary ? tempThreadRef.current.get(id) : db.messages.get(id),
    [temporary]
  );

  /** Throws away the turns after the one being edited or regenerated, which is
      what both of those actions mean. */
  const dropFromMessage = useCallback(
    async (
      chatId: string,
      id: string,
      createdAt: number,
      inclusive: boolean
    ): Promise<void> => {
      if (!temporary) {
        await db.messages
          .where("chatId")
          .equals(chatId)
          .filter((message) => (inclusive ? message.createdAt >= createdAt : message.createdAt > createdAt))
          .delete();
        return;
      }
      tempThreadRef.current.dropFrom(id, inclusive);
      publishTemp();
    },
    [publishTemp, temporary]
  );

  /** The conversation so far, in the order the model must read it.

      The chat to read is passed in rather than taken from `activeChatId`: the
      first message of a new chat is sent before React has re-rendered, so that
      state still holds the previous value — or nothing at all — and reading it
      here would hand the server an empty transcript. */
  const threadHistory = useCallback(
    async (chatId: string): Promise<ChatMessage[]> => {
      if (temporary) return tempThreadRef.current.list();
      return db.messages.where("chatId").equals(chatId).sortBy("createdAt");
    },
    [temporary]
  );

  /**
   * Turns the current answer into a variant and empties the row for the next
   * one — which is what retry and edit now mean. The old answer stays readable
   * (see lib/variants.ts) instead of being deleted with the row, because it is
   * the answer the new one is being judged against.
   *
   * Only the text moves across. Sources, usage, truncation and any error belong
   * to the answer being replaced; carrying them over would show the new
   * answer's controls above the old answer's evidence.
   *
   * Returns false for a row with nothing in it — an answer that never started
   * is not a branch, it is a row to cut.
   */
  const branchAnswer = useCallback(
    async (message: ChatMessage): Promise<boolean> => {
      if (!message.content) return false;
      await patchMessage(message.id, {
        content: "",
        variants: retireCurrentAnswer(message),
        variantIndex: undefined,
        error: undefined,
        truncated: undefined,
        sources: undefined,
        searchQuery: undefined,
        usage: undefined,
        model: getMode(selectedMode).display,
      });
      return true;
    },
    [patchMessage, selectedMode]
  );

  // ── Streaming send ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[], documents: DocumentAttachment[] = [], options?: SendOptions) => {
      if (streamingId) return;
      if (!text && images.length === 0 && documents.length === 0 && !options) return;

      // A queued message is consumed only now, once the send is committed:
      // a schedule that could not fire (a busy tab) stays in the queue rather
      // than silently disappearing with it.
      if (options?.scheduledId) await db.scheduled.delete(options.scheduledId);

      // A schedule carries the settings it was written under, so it fires as
      // the person who queued it meant it — not as whoever is on screen now.
      const activeMode = options?.mode ?? selectedMode;
      const activeSearch = options?.searchMode ?? searchMode;

      let chatId: string | null = temporary ? TEMP_CHAT_ID : activeChatId;
      // The chat to fire into is the one the schedule was made from.
      if (options?.chatId) chatId = options.chatId;
      // The row the new answer streams into. Normally a fresh message; when a
      // retry or an edit turns the old reply into a branch point, it is that
      // reply — emptied above, with the previous answer kept beside it.
      let reuseId: string | null = null;
      if (options?.editMessageId) {
        const original = await readMessage(options.editMessageId);
        if (!original) return;
        chatId = original.chatId;
        await patchMessage(original.id, { content: text, images: images.length ? images : undefined, documents: documents.length ? documents : undefined });
        // The reply to the wording being replaced is what an edit is compared
        // against, so it is found before the cut, turned into a variant, and
        // reused as the home of the new answer. The two then sit on one row
        // behind one stepper rather than as two answers that read as one.
        const previousReply = (await threadHistory(chatId)).find(
          (message) => message.createdAt > original.createdAt && message.role === "assistant"
        );
        if (previousReply && (await branchAnswer(previousReply))) {
          await dropFromMessage(chatId, previousReply.id, previousReply.createdAt, false);
          reuseId = previousReply.id;
        } else {
          await dropFromMessage(chatId, original.id, original.createdAt, false);
        }
      } else if (options?.regenerateAssistantId) {
        const original = await readMessage(options.regenerateAssistantId);
        if (!original) return;
        chatId = original.chatId;
        // An answer worth keeping becomes a variant; an empty one has nothing
        // to keep and is cut the way it always was.
        const branched = await branchAnswer(original);
        await dropFromMessage(chatId, original.id, original.createdAt, !branched);
        if (branched) reuseId = original.id;
      } else {
        if (!chatId) {
          const chat = await createChat();
          chatId = chat.id;
          setActiveChatId(chatId);
        }
        await appendMessage({
          chatId,
          role: "user",
          content: text,
          images: images.length > 0 ? images : undefined,
          documents: documents.length > 0 ? documents : undefined,
        });
        // A temporary thread has no row to carry a title, so there is nothing
        // to name.
        if (!temporary) await maybeAutoTitle(chatId, text || "Attachment conversation");
      }
      if (!chatId) return;
      if (!temporary) setActiveChatId(chatId);

      const history = await threadHistory(chatId);
      const apiMessages: ApiMessage[] = history.flatMap((message): ApiMessage[] => {
        if (message.error || (message.role !== "user" && message.role !== "assistant")) return [];
        // What the reader is looking at is what the model continues from: if
        // somebody stepped back to an earlier answer and then writes, the next
        // reply has to follow that one, not a version only the database knows.
        const text = displayedContent(message);
        if (message.role === "user" && (message.images?.length || message.documents?.length)) {
          const parts: ApiContentPart[] = [];
          const documentText = message.documents?.map((document) => `Attachment ${document.name}:\n${document.text}`).join("\n\n");
          const textContent = [text, documentText].filter(Boolean).join("\n\n");
          if (textContent) parts.push({ type: "text", text: textContent });
          for (const image of message.images ?? []) parts.push({ type: "image_url", image_url: { url: image.url } });
          return [{ role: "user", content: parts }];
        }
        if (!text.trim()) return [];
        return [{ role: message.role, content: text }];
      });

      // The attachment belongs to this turn, not to the stored history, so it is
      // appended after the transcript is built and never persisted into a
      // previous user message.
      setModelNotice(null);
      // The Mino name is stored rather than a provider id, so nothing vendor-
      // specific ends up in the local database or in an exported backup.
      const assistantMsg: ChatMessage =
        (reuseId ? await readMessage(reuseId) : undefined) ??
        (await appendMessage({ chatId, role: "assistant", content: "", model: getMode(activeMode).display }));
      setStreamingId(assistantMsg.id);

      const controller = new AbortController();
      abortRef.current = controller;
      let sawError = false;

      // Asks the server which durable facts this exchange revealed.
      //
      // Run against a counter rather than a boolean because a slow extraction
      // must not be able to overwrite a newer one: answering again while the
      // first check is still in flight is ordinary, and the later answer's
      // suggestions are the ones on screen.
      const considerMemory = async (history: ApiMessage[], answer: string) => {
        const run = ++memoryRunRef.current;
        const source = [...history].reverse().find((message) => message.role === "user");
        const userText = typeof source?.content === "string" ? source.content : "";
        if (
          !shouldSuggest({
            userText,
            memories: memorySnapshot,
            enabled: loadSuggestionEnabled(),
            dismissed: suggestionsDismissed(),
          })
        ) {
          return;
        }
        setSuggestions([]);
        setCheckingMemory(true);
        const found = await requestMemorySuggestions({
          userText,
          answer,
          memories: memorySnapshot,
          authorization: await authHeader(),
        });
        if (run !== memoryRunRef.current) return;
        setCheckingMemory(false);
        setSuggestions(found);
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({
            messages: apiMessages,
            // Sent with every request because memory applies to every answer.
            // The server re-validates this rather than trusting the page.
            memories: memorySnapshot,
            mode: activeMode,
            searchMode: activeSearch,
            responseLength,
            reasoningEffort,
            // Lets the Google tools interpret "tomorrow at 3" in the user's
            // own time zone. Read from the browser, validated server-side.
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          const message = payload?.error || `Mino request failed (HTTP ${res.status})`;
          noteRateLimit(message);
          throw new Error(message);
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
            const evt = JSON.parse(data) as { content?: string; error?: string; model?: string; truncated?: boolean; usage?: SessionUsage; search?: { used: boolean; query?: string; sources?: SearchSource[] } };
            if (evt.model) {
              await patchMessage(assistantMsg.id, { model: evt.model });
              if (evt.model !== getMode(activeMode).display) setModelNotice("The model was changed automatically because the current model is experiencing a problem.");
            }
            if (evt.error) {
              // The server refuses inside the stream as well as before it, so
              // the countdown is read from both places.
              noteRateLimit(evt.error);
              sawError = true;
              await markError(assistantMsg.id, evt.error);
              return;
            }
            if (evt.truncated) {
              // Recorded on the message so it survives a reload. Without it the
              // only trace that an answer was cut short is gone once the tab is
              // closed, and the half-file still looks finished.
              await patchMessage(assistantMsg.id, { truncated: true });
            }
            if (evt.content) {
              full += evt.content;
              await writeContent(assistantMsg.id, full);
            }
            if (evt.usage) await writeUsage(assistantMsg.id, evt.usage);
            if (evt.search) {
              await patchMessage(assistantMsg.id, { searchQuery: evt.search.query, sources: evt.search.sources ?? [] });
              if (!evt.search.used && activeSearch !== "off") setModelNotice("Mino checked the web but could not find a usable source.");
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
        if (!full.trim() && !sawError) await markError(assistantMsg.id, "Mino returned an empty response. Try again.");

        // Whether anything here is worth remembering is decided after the
        // answer, on the user's machine, by a request they never wait for. It
        // only ever produces an offer — nothing is stored until a tap.
        if (full.trim() && !sawError) void considerMemory(apiMessages, full);

      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) await markError(assistantMsg.id, err instanceof Error ? err.message : "Something went wrong");
        if (aborted) {
          // A cancelled answer that never wrote a word leaves an empty bubble
          // behind, so it is taken out of whichever store holds it.
          const msg = await readMessage(assistantMsg.id);
          if (msg && !msg.content) {
            if (temporary) {
              tempThreadRef.current.drop(assistantMsg.id);
              publishTemp();
            } else {
              await db.messages.delete(assistantMsg.id);
            }
          }
        }
      } finally {
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [activeChatId, appendMessage, branchAnswer, dropFromMessage, markError, memorySnapshot, noteRateLimit, patchMessage, publishTemp, readMessage, reasoningEffort, responseLength, searchMode, selectedMode, streamingId, temporary, threadHistory, writeContent, writeUsage]
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

      let chatId: string | null = temporary ? TEMP_CHAT_ID : activeChatId;
      if (!chatId) {
        const chat = await createChat();
        chatId = chat.id;
        setActiveChatId(chatId);
      }
      if (!chatId) return;
      await appendMessage({ chatId, role: "user", content: clean });
      if (!temporary) {
        await maybeAutoTitle(chatId, clean);
        setActiveChatId(chatId);
      }

      const assistantMsg = await appendMessage({ chatId, role: "assistant", content: "", model: IMAGE_ENGINE });
      setDrawingId(assistantMsg.id);
      setModelNotice(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const image = await generateImage({ prompt: clean, signal: controller.signal });
        await patchMessage(assistantMsg.id, {
          content: "",
          generatedImages: [image],
          model: IMAGE_ENGINE,
        });
        if (!imageAvailable) setImageAvailable(true);
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          const message = err instanceof Error ? err.message : "Image generation failed";
          noteRateLimit(message);
          await markError(assistantMsg.id, message);
        }
      } finally {
        setDrawingId(null);
        abortRef.current = null;
      }
    },
    [activeChatId, appendMessage, drawingId, imageAvailable, markError, noteRateLimit, patchMessage, temporary]
  );

  // ── The queue firing ──────────────────────────────────────────────────────
  // This tab is the sender: the effect wakes at the earliest appointment and
  // fires the oldest due message, one answer at a time. The row is consumed by
  // sendMessage itself once the send is under way, so a schedule that could not
  // fire is retried on the next tick instead of being lost.
  const scheduleFiringRef = useRef(false);
  const firedScheduleRef = useRef<Set<string>>(new Set());
  const [scheduleTick, setScheduleTick] = useState(0);

  useEffect(() => {
    if (scheduled.length === 0) return;
    const nowMs = Date.now();
    const due = scheduled
      .filter((item) => isDue(item, nowMs) && !firedScheduleRef.current.has(item.id))
      .sort(dueFirst);
    if (due.length === 0) {
      // Sleep until the earliest appointment, capped so a clock that moved
      // backwards still gets re-checked within the minute.
      const wait = Math.max(500, Math.min(scheduled[0].sendAt - nowMs + 100, 60_000));
      const timer = setTimeout(() => setScheduleTick((n) => n + 1), wait);
      return () => clearTimeout(timer);
    }
    // One answer at a time: the queue waits for whatever is on screen, and for
    // a temporary thread to end first — a scheduled message is always written
    // down, which a temporary chat never is.
    if (streamingId || drawingId || scheduleFiringRef.current) return;
    if (temporary) {
      endTemporary();
      return;
    }
    const item = due[0];
    firedScheduleRef.current.add(item.id);
    if (firedScheduleRef.current.size > 50) {
      firedScheduleRef.current = new Set([...firedScheduleRef.current].slice(-50));
    }
    scheduleFiringRef.current = true;
    void sendMessage(item.content, item.images ?? [], item.documents ?? [], {
      chatId: item.chatId ?? undefined,
      mode: item.mode,
      searchMode: item.searchMode,
      scheduledId: item.id,
    })
      .catch(() => undefined)
      .finally(() => {
        scheduleFiringRef.current = false;
        setScheduleTick((n) => n + 1);
      });
  }, [scheduled, scheduleTick, streamingId, drawingId, temporary, endTemporary, sendMessage]);

  const handleSend = useCallback(
    (text: string, images: ImageAttachment[], documents?: DocumentAttachment[]) => {
      // Someone who has sent a message has decided Mino is worth a second
      // look, which is the earliest the install prompt can be justified. It
      // arrives as a custom event because the prompt decides for itself
      // whether to ask — this page only reports what happened.
      window.dispatchEvent(new Event("mino:engage"));
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

  /** Which answer is on screen for a message that has more than one. */
  const handleSwitchVariant = useCallback(
    (messageId: string, index: number | null) => {
      // A pointer change and nothing else — the stored answer is untouched, so
      // browsing back through previous answers cannot rewrite the transcript.
      // `undefined` rather than `null` because that is what removes the field
      // from the row, and "no index" is the live answer.
      void patchMessage(messageId, { variantIndex: index ?? undefined });
    },
    [patchMessage]
  );

  // The conversation on screen: a temporary thread has no database rows to read,
  // so it is read from memory instead.
  const threadMessages = temporary ? tempMessages : messages;

  const handleCopyConversation = useCallback(async () => {
    const text = threadMessages.map((message) => `${message.role === "user" ? "You" : "Mino"}: ${message.content}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setModelNotice("Conversation copied to your clipboard");
    } catch {
      setModelNotice("Clipboard access is unavailable in this browser");
    }
  }, [threadMessages]);

  const isStreaming = streamingId !== null;
  // The message being drawn has no content yet, so it is kept explicitly to
  // show the drawing placeholder.
  // A check result is a message with no content at all — the output lives on
  // `verification` — so it has to be admitted here explicitly. Without this the
  // panel renders correctly but is filtered out of the thread before it is ever
  // reached, which is exactly the kind of bug that survives a code review.
  const visibleMessages = threadMessages.filter(
    (m) => m.content || m.images || m.generatedImages || m.error || m.id === drawingId
  );

  // Nothing is rendered until localStorage has been read, so a returning
  // visitor never sees the chat flash before their name is known.
  if (!hydrated) return null;

  // Maintenance replaces the page outright rather than covering it, so
  // nothing behind the notice is mounted and there is nothing to navigate to.
  if (!maintenance.resolved) return null;
  if (maintenance.active) {
    return (
      <>
        <MaintenanceScreen message={maintenance.message} />
        <SplashScreen />
      </>
    );
  }

  // A signed-in person arriving on a new browser has a name Mino already knows
  // and this one has not read yet. Holding the gate for that single read is the
  // difference between being greeted by name and being asked to type it again.
  // It settles on the first failure too, so a deployment with no account
  // service, or one offline, is never stuck here.
  if (hydrated && resolvingAccount) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#060a08] text-text-body">
        <MinoMark className="h-8 w-8 animate-pulse" />
        <SplashScreen />
      </div>
    );
  }

  // Entry gate: the name is what the admin console lists visitors by, so Mino
  // is not usable until one is given. There is no skip out of this screen.
  if (!displayName) {
    return (
      <div className="flex h-[100dvh] overflow-hidden bg-[#060a08] text-text-body">
        <NamePrompt
          open
          onSave={handleSaveName}
          onGoogle={handleGoogleEntry}
          googleAvailable={firebaseConfigured}
          googleBusy={googleBusy}
          googleError={googleError}
        />
        <SplashScreen />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#060a08] text-text-body">
      <Sidebar
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        temporary={temporary}
        onToggleTemporary={toggleTemporary}
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
            <span className="truncate text-[17px] font-medium tracking-[-0.02em] text-white">
              {temporary ? "Temporary chat" : "Mino"}
            </span>
          </button>

          {temporary && (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.045] px-2.5 py-1 text-[11px] text-white/55 sm:inline-flex">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              Not saved
            </span>
          )}

          <div className="flex-1" />
          <ModeSelector
            selected={selectedMode}
            onChange={handleModeChange}
            available={available}
            planId={planId}
          />
        </header>

        {appConfig?.announcement && (
          <div
            role="status"
            className="animate-rise relative z-10 mx-4 mt-1 flex shrink-0 items-center justify-center self-center rounded-full border border-[#a9d8bb]/15 bg-[#a9d8bb]/[0.06] px-3.5 py-2 text-center text-[11px] leading-relaxed text-white/70 backdrop-blur-md md:max-w-xl"
          >
            {appConfig.announcement}
          </div>
        )}

        {modelNotice && (
          <div
            role="status"
            className="relative z-10 mx-4 mt-1 flex shrink-0 items-center justify-center gap-2 self-center rounded-full border border-white/[0.07] bg-white/[0.045] px-3.5 py-2 text-center text-[11px] leading-relaxed text-white/55 backdrop-blur-md md:max-w-xl"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#a9d8bb]" />
            <span>{modelNotice}</span>
          </div>
        )}

        {loggingError && (
          <div role="alert" className="relative z-10 mx-4 mt-1 flex shrink-0 items-center justify-center self-center rounded-full border border-red-400/20 bg-red-500/[0.08] px-3.5 py-2 text-center text-[11px] font-medium tracking-[0.08em] text-red-200/90 backdrop-blur-md animate-rise">
            LG FAILED
          </div>
        )}

        {/* Checked on every visit: subscribed browsers see nothing, everyone
            else is asked until they are. */}
        <NotificationNag />

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ChatThread
              messages={visibleMessages}
              streamingId={streamingId}
              drawingId={drawingId}
              isEmpty={visibleMessages.length === 0}
              onRegenerate={handleRegenerate}
              onEditMessage={handleEditMessage}
              onCopyConversation={handleCopyConversation}
              onSwitchVariant={handleSwitchVariant}
            />
            <MemorySuggestions
              suggestions={suggestions}
              checking={checkingMemory}
              syncAvailable={firebaseConfigured}
              onStopSuggesting={() => {
                dismissSuggestions();
                setSuggestions([]);
              }}
              onHide={() => setSuggestions([])}
            />
            <ChatInput
              onSend={handleSend}
              disabled={isStreaming || drawingId !== null}
              onStop={stopStreaming}
              imageMode={imageMode}
              onImageModeChange={setImageMode}
              imageAvailable={imageAvailable}
              syncAvailable={firebaseConfigured}
              onSchedule={handleSchedule}
              scheduled={scheduled}
              onCancelScheduled={handleCancelScheduled}
              rateLimitUntil={rateLimitUntil}
            />
          </div>

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
        displayName={displayName}
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

      {/* Branding splash — a fresh visit to the home page only, once per
          session. It sits above the app while this page finishes loading. */}
      <SplashScreen />

      {/* Install prompt — mobile only, and only once Mino has been used. */}
      <InstallPrompt />

      {/* Developer notes — shows a newly published note once per reader, then
          never again until the next one is published. */}
      <NotesPrompt />
    </div>
  );
}
