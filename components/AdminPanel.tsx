"use client";

import { useCallback, useEffect, useState } from "react";
import { firebaseConfigured, fetchVisitorRegistry, type VisitorProfile } from "@/lib/firebaseHistory";

// ── Admin console ────────────────────────────────────────────────────────────
// Chat data is fetched from /api/admin, which verifies the PIN server-side and
// reads with the Admin SDK. Nothing sensitive is ever requested from the
// browser against the Realtime Database directly.

interface AdminUser {
  uid: string;
  name: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  chats: number;
  messages: number;
}
interface AdminChat {
  chatId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
interface AdminMessage {
  role: "user" | "assistant";
  content: string;
  model: string | null;
  createdAt: number;
  error: string | null;
}

type View = { name: "users" } | { name: "chats"; uid: string; label: string } | { name: "chat"; uid: string; chatId: string; title: string };

const PROVIDER_LABEL: Record<string, string> = { auto: "Mino Auto", dev: "Mino Dev" };

function when(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export default function AdminPanel({
  open,
  onClose,
  digest,
  browserMismatch = false,
}: {
  open: boolean;
  onClose: () => void;
  digest: string;
  browserMismatch?: boolean;
}) {
  const [view, setView] = useState<View>({ name: "users" });
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [chats, setChats] = useState<AdminChat[] | null>(null);
  const [chat, setChat] = useState<{ title: string; messages: AdminMessage[] } | null>(null);
  const [providers, setProviders] = useState<{ available: string[]; searchAvailable: boolean } | null>(null);
  const [named, setNamed] = useState<Array<VisitorProfile & { uid: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState<null | { scope: "all" | "user"; uid?: string; label: string }>(null);

  const call = useCallback(
    async (action: string, extra: Record<string, string> = {}) => {
      setBusy(true);
      setError(null);
      setDiagnostics(null);
      try {
        const response = await fetch("/api/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-mino-digest": digest },
          body: JSON.stringify({ action, ...extra }),
        });
        const data = await response.json();
        if (!response.ok) {
          setDiagnostics(data?.diagnostics ?? null);
          throw new Error(data?.error ?? `Request failed (${response.status}).`);
        }
        return data;
      } finally {
        setBusy(false);
      }
    },
    [digest]
  );

  const goHome = useCallback(() => {
    setView({ name: "users" });
    setChats(null);
    setChat(null);
    setConfirmWipe(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    goHome();
    setUsers(null);
    setNamed(null);
    setError(null);
    setConfirmWipe(null);

    void call("listUsers")
      .then((data) => setUsers(data.users as AdminUser[]))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load users."));
    void fetch("/api/chat")
      .then((response) => response.json())
      .then((data) => setProviders(data))
      .catch(() => setProviders(null));
    void fetchVisitorRegistry()
      .then(setNamed)
      .catch(() => setNamed([]));

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, call, goHome, onClose]);

  const openChats = (user: AdminUser) => {
    setView({ name: "chats", uid: user.uid, label: user.name ?? user.uid.slice(0, 12) });
    setChats(null);
    void call("listChats", { uid: user.uid })
      .then((data) => setChats(data.chats as AdminChat[]))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load chats."));
  };

  const openChat = (uid: string, item: AdminChat) => {
    setView({ name: "chat", uid, chatId: item.chatId, title: item.title });
    setChat(null);
    void call("getChat", { uid, chatId: item.chatId })
      .then((data) => setChat({ title: data.title, messages: data.messages as AdminMessage[] }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the chat."));
  };

  const runWipe = async () => {
    if (!confirmWipe) return;
    setBusy(true);
    setError(null);
    try {
      if (confirmWipe.scope === "all") {
        await call("wipeAll");
        setUsers([]);
        setNamed([]);
      } else {
        await call("wipeUser", { uid: confirmWipe.uid! });
        setUsers((current) => (current ?? []).filter((user) => user.uid !== confirmWipe.uid));
        setNamed((current) => (current ?? []).filter((entry) => entry.uid !== confirmWipe.uid));
      }
      setConfirmWipe(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Wipe failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      {/* Not dismissible on an outside tap: it would throw away the drill-down
          position. Use the back arrow or the close button. */}
      <div className="absolute inset-0 cursor-default bg-black/75" style={{ backdropFilter: "blur(6px)" }} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mino admin console"
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-white/[0.09] bg-[#131316] shadow-2xl shadow-black/80 animate-rise sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="flex min-w-0 items-center gap-1.5">
            {view.name !== "users" && (
              <button type="button" onClick={goHome} className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/50 hover:bg-white/[0.08] hover:text-white" aria-label="Back">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
            )}
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
              {view.name === "users" ? "Mino console" : view.name === "chats" ? view.label : view.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white" aria-label="Close console">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {error && (
          <div className="mx-5 mt-3 rounded-[12px] border border-red-400/20 bg-red-500/[0.08] px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-red-200/95">{error}</p>
            {browserMismatch && (
              <p className="mt-2 text-[10px] leading-relaxed text-red-200/70">
                The browser itself does not see the PIN you just entered. The stored digest and
                your PIN disagree, so the value in the database is not what you think it is.
              </p>
            )}
            {diagnostics && <DiagnosticsBlock diagnostics={diagnostics} />}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {view.name === "users" && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="People" value={users?.length} />
                <Stat label="Chats" value={users?.reduce((sum, user) => sum + user.chats, 0)} />
                <Stat label="Messages" value={users?.reduce((sum, user) => sum + user.messages, 0)} />
              </div>

              {providers && (
                <section>
                  <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Providers</h3>
                  <p className="text-[11px] text-white/45">
                    {providers.available.length === 0
                      ? "No API keys configured"
                      : providers.available.map((mode) => PROVIDER_LABEL[mode] ?? mode).join(" · ")}
                    {providers.searchAvailable ? " · web search" : ""}
                  </p>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">People</h3>
                {users === null ? (
                  <p className="py-2 text-[11px] text-white/35">Loading…</p>
                ) : users.length === 0 ? (
                  <p className="py-2 text-[11px] text-white/35">No conversations have been logged yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {users.map((user) => (
                      <li key={user.uid} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openChats(user)}
                          className="min-w-0 flex-1 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                        >
                          <span className="block truncate text-[12px] font-medium text-white/85">{user.name ?? "Unnamed visitor"}</span>
                          <span className="mt-0.5 block text-[10px] text-white/30">
                            {user.chats} chat{user.chats === 1 ? "" : "s"} · {user.messages} message{user.messages === 1 ? "" : "s"} · {when(user.lastSeen)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmWipe({ scope: "user", uid: user.uid, label: user.name ?? user.uid.slice(0, 12) })}
                          className="shrink-0 rounded-[10px] px-2 py-2 text-[10px] text-white/30 hover:bg-red-500/10 hover:text-red-300"
                          aria-label={`Delete data for ${user.name ?? user.uid}`}
                        >
                          Wipe
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Names given</h3>
                  <span className="text-[10px] text-white/25">{named?.length ?? 0}</span>
                </div>
                <p className="text-[10px] leading-relaxed text-white/30">
                  Read live from the browser database. {firebaseConfigured ? "Firebase is configured." : "Firebase is not configured."}
                </p>
              </section>

              <div className="rounded-[16px] border border-red-400/15 bg-red-500/[0.05] p-3.5">
                <h3 className="text-[11px] font-semibold text-red-200/90">Danger zone</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-red-200/60">
                  Deletes every logged conversation and every saved name. The admin PIN is kept so you can still sign in.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmWipe({ scope: "all", label: "all logged data" })}
                  className="mt-2.5 w-full rounded-[10px] bg-red-500/20 px-3 py-2 text-[11px] font-semibold text-red-200 transition-colors hover:bg-red-500/30"
                >
                  Wipe all user data
                </button>
              </div>
            </div>
          )}

          {view.name === "chats" && (
            <>
              <p className="mb-3 text-[10px] text-white/30">Chats from this device</p>
              {chats === null ? (
                <p className="py-2 text-[11px] text-white/35">Loading…</p>
              ) : chats.length === 0 ? (
                <p className="py-2 text-[11px] text-white/35">No chats logged for this person.</p>
              ) : (
                <ul className="space-y-1">
                  {chats.map((item) => (
                    <li key={item.chatId}>
                      <button
                        type="button"
                        onClick={() => openChat(view.uid, item)}
                        className="w-full rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <span className="block truncate text-[12px] font-medium text-white/85">{item.title}</span>
                        <span className="mt-0.5 block text-[10px] text-white/30">{when(item.updatedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {view.name === "chat" && (
            <>
              {chat === null ? (
                <p className="py-2 text-[11px] text-white/35">Loading…</p>
              ) : chat.messages.length === 0 ? (
                <p className="py-2 text-[11px] text-white/35">This chat has no stored messages.</p>
              ) : (
                <ul className="space-y-3 pb-2">
                  {chat.messages.map((message, index) => (
                    <li
                      key={`${message.createdAt}-${index}`}
                      className={`rounded-[14px] border px-3 py-2.5 ${
                        message.role === "user"
                          ? "border-[#9ee7ff]/15 bg-[#9ee7ff]/[0.05]"
                          : "border-white/[0.07] bg-white/[0.03]"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${message.role === "user" ? "text-[#9ee7ff]/75" : "text-white/40"}`}>
                          {message.role === "user" ? "User" : "Mino"}
                        </span>
                        {message.role === "assistant" && message.model && (
                          <span className="text-[9px] text-white/25">{message.model}</span>
                        )}
                        <span className="ml-auto text-[9px] text-white/25">{when(message.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-white/80">{message.content}</p>
                      {message.error && <p className="mt-1.5 text-[10px] text-red-300/80">Error: {message.error}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {confirmWipe && (
          <div className="border-t border-white/[0.07] bg-black/30 px-5 py-3.5">
            <p className="text-[11px] leading-relaxed text-white/60">
              Permanently delete {confirmWipe.label}? This cannot be undone.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={() => setConfirmWipe(null)} className="flex-1 rounded-[10px] px-3 py-2 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white">
                Cancel
              </button>
              <button type="button" onClick={() => void runWipe()} disabled={busy} className="flex-1 rounded-[10px] bg-red-500 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50">
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DiagnosticsBlock({ diagnostics }: { diagnostics: Record<string, unknown> }) {
  const entries = Object.entries(diagnostics).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-black/30 px-2 py-2 font-mono text-[10px] text-red-200/70">
      {entries.map(([key, value]) => (
        <div key={key} className="break-all">
          <span className="opacity-60">{key}:</span> {String(value)}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-2 py-2.5">
      <div className="text-[17px] font-semibold tracking-[-0.02em] text-white">{value ?? "…"}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-[0.1em] text-white/30">{label}</div>
    </div>
  );
}
