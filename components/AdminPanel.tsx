"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import AdminControls from "./AdminControls";
import ModelHealthSection from "./ModelHealth";
import { firebaseConfigured, fetchVisitorRegistry, getServices, type VisitorProfile } from "@/lib/firebaseHistory";
import {
  appendAdminAudit,
  createRedeemCode,
  deleteRedeemCode,
  getChat,
  listAdminAudit,
  listChats,
  listRedeemCodes,
  listUsageHistory,
  listUsers,
  setRedeemCodeActive,
  wipeAll,
  wipeUser,
  type AdminAuditEntry,
  type UsageHistoryDay,
} from "@/lib/firebaseAdmin";
import { summarizeUsage } from "@/lib/usageStats";
import { isValidCode, normalizeCode, type RedeemCode } from "@/lib/redeemState";

// ── Admin console ────────────────────────────────────────────────────────────
// Reads and wipes go straight to the Realtime Database from the browser. Access
// is granted by `database.rules.json` to one Auth UID, and Firebase enforces
// that on every call, so the console holds no credential of its own and the
// deployment environment holds no service-account key.

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

type View =
  | { name: "users" }
  | { name: "codes" }
  | { name: "chats"; uid: string; label: string }
  | { name: "chat"; uid: string; chatId: string; title: string };

const PROVIDER_LABEL: Record<string, string> = { auto: "Mino Auto", code: "Mino Code" };

function when(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export default function AdminPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
  // The grant ledger, and whether writing to it failed. The two are separate
  // on purpose: a rules file that predates `admin/audit` refuses the write, and
  // that must never be reported as "the grant failed" when the grant landed.
  const [audit, setAudit] = useState<AdminAuditEntry[] | null>(null);
  const [auditBroken, setAuditBroken] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState<null | { scope: "all" | "user"; uid?: string; label: string }>(null);
  // Who the owner is looking for. The list can be long, and the person a code
  // was handed to is normally found by the name printed on the transfer.
  const [peopleQuery, setPeopleQuery] = useState("");

  // Signing out must actually empty the screen. The gate only watches the
  // session while its own dialog is open, so a sign-out triggered from inside
  // the panel would otherwise leave every loaded conversation on display. This
  // covers that path and a sign-out in another tab, and clears what was read
  // rather than only hiding it.
  useEffect(() => {
    if (!open) return;
    let unsubscribe = () => {};
    let cancelled = false;
    void getServices()
      .then((services) => {
        if (!services || cancelled) return;
        unsubscribe = onAuthStateChanged(services.auth, (user) => {
          if (user) return;
          setUsers(null);
          setChats(null);
          setChat(null);
          setNamed(null);
          onClose();
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open, onClose]);

  const call = useCallback(
    async (action: string, extra: Record<string, string> = {}): Promise<Record<string, unknown>> => {
      setBusy(true);
      setError(null);
      setDiagnostics(null);
      try {
        switch (action) {
          case "listUsers":
            return { users: await listUsers() };
          case "listChats":
            return { chats: await listChats(extra.uid!) };
          case "getChat":
            return await getChat(extra.uid!, extra.chatId!);
          case "wipeUser":
            await wipeUser(extra.uid!);
            return { ok: true };
          case "wipeAll":
            await wipeAll();
            return { ok: true };
          default:
            throw new Error("Unknown action.");
        }
      } catch (cause: unknown) {
        const code = (cause as { code?: string })?.code ?? "";
        if (code === "app/permission-denied") {
          setDiagnostics({ auth: "the signed-in account is not the administrator" });
        }
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    []
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
    setAudit(null);
    setAuditBroken(false);

    void call("listUsers")
      .then((data) => setUsers(data.users as AdminUser[]))
      .catch((e: unknown) => {
        console.error("[mino] Failed to list users", e);
        setError(e instanceof Error ? e.message : "Could not load users.");
      });
    void fetch("/api/chat")
      .then((response) => response.json())
      .then((data) => setProviders(data))
      .catch((e: unknown) => {
        console.error("[mino] Failed to fetch chat config", e);
        setProviders(null);
      });
    void fetchVisitorRegistry()
      .then(setNamed)
      .catch((e: unknown) => {
        console.error("[mino] Failed to fetch visitor registry", e);
        setNamed([]);
      });
    void listAdminAudit()
      .then(setAudit)
      .catch((e: unknown) => {
        console.error("[mino] Failed to list admin audit", e);
        setAudit([]);
      });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, call, goHome, onClose]);

  const openChats = (user: AdminUser) => {
    setView({ name: "chats", uid: user.uid, label: user.name ?? "Unnamed visitor" });
    setChats(null);
    void call("listChats", { uid: user.uid })
      .then((data) => setChats(data.chats as AdminChat[]))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load chats."));
  };

  const openChat = (uid: string, item: AdminChat) => {
    setView({ name: "chat", uid, chatId: item.chatId, title: item.title });
    setChat(null);
    void call("getChat", { uid, chatId: item.chatId })
      .then((data) => setChat({ title: String(data.title), messages: data.messages as AdminMessage[] }))
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

  // Filtering by name or by uid — the two things an owner has in hand when a
  // person needs finding in a long list.
  const query = peopleQuery.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (user) =>
      !query ||
      (user.name ?? "").toLowerCase().includes(query) ||
      user.uid.toLowerCase().includes(query)
  );

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
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-white/[0.09] bg-[#141f1a] shadow-2xl shadow-black/80 animate-rise sm:rounded-[28px]"
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
              {view.name === "users"
                ? "Mino console"
                : view.name === "codes"
                  ? "Dew codes"
                  : view.name === "chats"
                    ? view.label
                    : view.title}
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

              {/* Every control about money lives behind this one door. The
                  console's first screen is about people and traffic; codes and
                  the ledger are a different job with a different rhythm, and
                  mixing them meant a wipe button sat three pixels from the
                  thing a sale depends on. */}
              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                    Dew
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setView({ name: "codes" })}
                  className="w-full rounded-[14px] border border-[#2f6b48]/25 bg-[#2f6b48]/10 px-3.5 py-3 text-left transition-colors hover:bg-[#2f6b48]/15"
                >
                  <span className="block text-[12px] font-semibold text-[#a9d8bb]">
                    Redeem codes and history
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-white/40">
                    Every message and picture is billed in Dew, so this is where a manual top-up
                    becomes a word the buyer can type — and where those words, once made, can be
                    switched off or read back.
                  </span>
                </button>
              </section>

              <UsageSection />

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

              <ModelHealthSection />

              <AdminControls users={users} onError={setError} />

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">People</h3>
                </div>
                <input
                  value={peopleQuery}
                  onChange={(event) => setPeopleQuery(event.target.value)}
                  placeholder="Find a name"
                  aria-label="Find a visitor by name"
                  className="mb-2 w-full rounded-[10px] border border-white/[0.1] bg-[#0e1613] px-2.5 py-2 text-[11px] text-white/85 outline-none placeholder:text-white/25 focus:border-[#2f6b48]/50"
                />
                {users === null ? (
                  <p className="py-2 text-[11px] text-white/35">Loading…</p>
                ) : users.length === 0 ? (
                  <p className="py-2 text-[11px] leading-relaxed text-white/35">
                    Nobody has visited yet. Anyone who opens Mino and gives a name appears here,
                    whether or not they have ever sent a message.
                  </p>
                ) : visible.length === 0 ? (
                  <p className="py-2 text-[11px] text-white/35">No one matches “{peopleQuery}”.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {visible.map((user) => (
                      <li key={user.uid}>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openChats(user)}
                            className="min-w-0 flex-1 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                          >
                            <span className="block truncate text-[13px] font-semibold text-white/90">{user.name ?? "Unnamed visitor"}</span>
                            <span className="mt-0.5 block text-[10px] text-white/30">
                              {user.chats} chat{user.chats === 1 ? "" : "s"} · {user.messages} message{user.messages === 1 ? "" : "s"} · {when(user.lastSeen)}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmWipe({ scope: "user", uid: user.uid, label: user.name ?? "Unnamed visitor" })}
                            className="shrink-0 rounded-[10px] px-2 py-2 text-[10px] text-white/30 hover:bg-red-500/10 hover:text-red-300"
                            aria-label={`Delete data for ${user.name ?? "this visitor"}`}
                          >
                            Wipe
                          </button>
                        </div>

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
                {named === null ? (
                  <p className="py-2 text-[11px] text-white/35">Loading…</p>
                ) : named.length === 0 ? (
                  <p className="py-2 text-[11px] text-white/35">No one has entered a name yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {named.map((visitor) => (
                      <li
                        key={visitor.uid ?? ""}
                        className="flex items-center justify-between gap-2 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-[12px] font-medium text-white/85">
                          {visitor.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-white/30">{when(visitor.lastSeen)}</span>
                      </li>
                    ))}
                  </ul>
                )}
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

          {view.name === "codes" && (
            <div className="space-y-5">
              <p className="text-[10px] leading-relaxed text-white/35">
                Pay as you go: a code is a word carrying Dew. The buyer types it on the top-up page
                and the balance follows — the amount is read from the code itself, never from the
                claim, so nothing a caller writes can decide what they receive.
              </p>

              <CodesSection
                onLogged={(entry) => setAudit((current) => [entry, ...(current ?? [])])}
                onLedgerError={() => setAuditBroken(true)}
              />

              <AuditSection entries={audit} broken={auditBroken} />
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
                          ? "border-[#a9d8bb]/15 bg-[#a9d8bb]/[0.05]"
                          : "border-white/[0.07] bg-white/[0.03]"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${message.role === "user" ? "text-[#a9d8bb]/75" : "text-white/40"}`}>
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

/**
 * The redeem codes the owner has made.
 *
 * A code is a word carrying Dew, handed to a buyer instead of a direct transfer.
 * It is the piece that makes a manual sale work at a distance: the buyer gets
 * something they can hold onto and type themselves, and the owner is not typing
 * amounts into somebody's account over a phone call.
 *
 * The switch is the reason a code is not just deleted. A word that has been
 * posted publicly and is being resold has to be stoppable *now*, and somebody
 * who switched one off by accident should be able to bring it back without
 * retyping it. Switching off also reaches people who already claimed it — the
 * server re-checks on every request — which is the behaviour an owner expects
 * from the word "terminate" and is why it is a switch rather than a convenience.
 *
 * Every action is written to the ledger through `onLogged`; a rules file that
 * refuses `admin/audit` reports through `onLedgerError` instead of pretending
 * the code itself failed.
 */
function CodesSection({
  onLogged,
  onLedgerError,
}: {
  onLogged: (entry: AdminAuditEntry) => void;
  onLedgerError: () => void;
}) {
  const [codes, setCodes] = useState<RedeemCode[] | null>(null);
  const [word, setWord] = useState("");
  // What the new code carries: a positive Dew amount, and nothing else.
  const [dewAmount, setDewAmount] = useState<number>(100);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setCodes(await listRedeemCodes());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the codes.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const normalized = normalizeCode(word);
  // Checked before saving, because a two-letter code is one guess away from
  // everybody's, and it would be created happily otherwise.
  const wordProblem = word.trim() === "" ? null : !isValidCode(word) ? "Use at least 4 letters or numbers." : null;

  /** Appends to the ledger, reporting a refusal rather than swallowing it. */
  const log = async (entry: Omit<AdminAuditEntry, "id">) => {
    const written = await appendAdminAudit(entry).catch((cause) => {
      console.error("[mino] Failed to write audit entry", cause);
      onLedgerError();
      return null;
    });
    if (written) onLogged(written);
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      await createRedeemCode({ code: word, dew: dewAmount, note });
      await log({
        at: Date.now(),
        action: "createCode",
        code: normalized,
        dew: dewAmount,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setWord("");
      setNote("");
    });

  const toggle = (existing: RedeemCode) =>
    run(async () => {
      await setRedeemCodeActive(existing.code, !existing.active);
      await log({ at: Date.now(), action: "toggleCode", code: existing.code, active: !existing.active });
    });

  const remove = (existing: RedeemCode) =>
    run(async () => {
      await deleteRedeemCode(existing.code);
      await log({ at: Date.now(), action: "deleteCode", code: existing.code, dew: existing.dew });
    });

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Redeem codes</h3>
        <span className="text-[10px] text-white/25">{codes?.length ?? 0}</span>
      </div>
      <p className="text-[10px] leading-relaxed text-white/30">
        A word you choose, carrying an amount of Dew. The buyer types it on the top-up page and the
        balance follows. Switching one off stops it for everyone, including anyone who already used it.
      </p>

      <div className="mt-2 rounded-[12px] border border-white/[0.06] bg-white/[0.03] p-3">
        <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-white/35" htmlFor="code-word">
          The word
        </label>
        <input
          id="code-word"
          value={word}
          onChange={(event) => setWord(event.target.value)}
          placeholder="MINO-TOPUP"
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-[10px] border border-white/[0.08] bg-black/25 px-3 py-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-white placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-white/25"
        />
        {wordProblem ? (
          <p className="mt-1 text-[10px] text-amber-300/80">{wordProblem}</p>
        ) : normalized ? (
          <p className="mt-1 text-[10px] text-white/30">
            Saves as <span className="font-semibold tracking-[0.08em] text-white/60">{normalized}</span>
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {[25, 100, 500, 1000].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setDewAmount(amount)}
              className={`rounded-[9px] px-2.5 py-1.5 text-[11px] font-medium transition ${
                dewAmount === amount ? "bg-white/15 text-white" : "bg-white/[0.04] text-white/55 hover:bg-white/[0.09]"
              }`}
            >
              {amount}
            </button>
          ))}
          <span className="text-[10px] text-white/25">Dew</span>
        </div>

        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note for yourself (optional)"
          className="mt-2 w-full rounded-[10px] border border-white/[0.08] bg-black/25 px-3 py-2 text-[12px] text-white placeholder:text-white/25"
        />

        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || !isValidCode(word)}
          className="mt-2 w-full rounded-[10px] bg-white/10 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-white/[0.16] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Create code"}
        </button>
      </div>

      {error ? <p className="mt-1.5 text-[11px] text-red-200/90">{error}</p> : null}

      {codes === null ? (
        <p className="py-2 text-[11px] text-white/35">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="py-2 text-[11px] text-white/35">No codes yet. Make one above.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {codes.map((code) => {
            return (
              <li
                key={code.code}
                className="flex items-center justify-between gap-2 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold tracking-[0.08em] text-white/85">
                    {code.code}
                    {!code.active ? <span className="ml-2 text-[10px] font-normal text-red-300/80">off</span> : null}
                  </p>
                  <p className="text-[10px] text-white/35">💧 {code.dew} Dew</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => void toggle(code)}
                    disabled={busy}
                    className="rounded-[9px] bg-white/[0.06] px-2.5 py-1.5 text-[11px] text-white/75 transition hover:bg-white/[0.12] disabled:opacity-40"
                  >
                    {code.active ? "Terminate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(code)}
                    disabled={busy}
                    className="rounded-[9px] px-2.5 py-1.5 text-[11px] text-red-200/70 transition hover:bg-red-500/15 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The traffic the caps are counted against, drawn rather than tabulated.
 *
 * DAU is a bar chart because a trend is the thing a single number hides — a
 * quiet week and a dead product look identical in a count. WAU is a union of
 * real visitor ids across seven days, never a sum of dailies.
 */
function UsageSection() {
  const [days, setDays] = useState<UsageHistoryDay[] | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listUsageHistory(60)
      .then((rows) => {
        if (!cancelled) setDays(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setDays([]);
          setBroken(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = summarizeUsage(days ?? []);
  const chart = summary.dau.slice(-30);
  const peak = Math.max(1, ...chart.map((row) => row.users));

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Usage</h3>
        <span className="text-[10px] text-white/25">{days === null ? "…" : `${summary.dau.length} days`}</span>
      </div>

      {broken && (
        <p className="mb-2 rounded-[10px] border border-amber-300/15 bg-amber-400/[0.06] px-2.5 py-2 text-[10px] leading-relaxed text-amber-100/85">
          Usage counters could not be read. The chat route keeps writing them; this is a
          database read the current rules refused.
        </p>
      )}

      {days !== null && summary.dau.length === 0 ? (
        <p className="py-1 text-[11px] leading-relaxed text-white/35">
          No usage recorded yet. Counters appear here from the first message the server
          answers.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Today" value={summary.latestUsers} />
            <Stat label="This week" value={summary.wau} />
            <Stat label="Messages" value={summary.totals.chat} />
            <Stat label="Images" value={summary.totals.image} />
          </div>

          {chart.length > 0 && (
            <div className="mt-3 rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-3 pb-2 pt-3">
              <div className="flex h-16 items-end gap-[3px]" role="img" aria-label="Daily active visitors, last 30 days">
                {chart.map((row) => (
                  <span
                    key={row.day}
                    title={`${row.day}: ${row.users} visitor${row.users === 1 ? "" : "s"}`}
                    className="min-w-0 flex-1 rounded-t bg-[#2f6b48]/70 transition-colors hover:bg-[#a9d8bb]/70"
                    style={{ height: `${Math.max(4, Math.round((row.users / peak) * 100))}%` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[9px] text-white/25">
                <span>{chart[0]?.day.slice(5)}</span>
                <span>daily visitors · peak {peak}</span>
                <span>{chart[chart.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
          )}

          {summary.modes.length > 0 && (
            <div className="mt-3 space-y-1">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                Messages by mode
              </h4>
              {summary.modes.map((row) => {
                const max = summary.modes[0]?.count ?? 1;
                return (
                  <div key={row.mode} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-[10px] uppercase text-white/40">{row.mode}</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <span
                        className="block h-full rounded-full bg-[#a9d8bb]/50"
                        style={{ width: `${Math.max(3, Math.round((row.count / max) * 100))}%` }}
                      />
                    </span>
                    <span className="w-12 shrink-0 text-right text-[10px] text-white/50">
                      {row.count.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AuditSection({
  entries,
  broken,
}: {
  entries: AdminAuditEntry[] | null;
  broken: boolean;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
          History
        </h3>
        <span className="text-[10px] text-white/25">
          {entries === null ? "…" : entries.length}
        </span>
      </div>

      {broken && (
        <p className="mb-2 rounded-[10px] border border-amber-300/15 bg-amber-400/[0.06] px-2.5 py-2 text-[10px] leading-relaxed text-amber-100/85">
          The database rules in use do not cover <code>admin/audit</code>, so history could not be
          written. The codes themselves worked. Publish <code>admin/audit</code> rules to record them.
        </p>
      )}

      {entries === null ? (
        <p className="py-1 text-[11px] text-white/35">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="py-1 text-[11px] leading-relaxed text-white/35">
          Nothing recorded yet. Every code made, switched off or deleted lands here with the note
          you typed.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => {
            // An entry written before the migration still has its old shape;
            // it is shown raw rather than dropped, because a ledger that
            // hides what it cannot classify is a ledger with holes in it.
            const off = entry.action === "deleteCode" || (entry.action === "toggleCode" && entry.active === false);
            const label =
              entry.action === "createCode"
                ? "Made"
                : entry.action === "deleteCode"
                  ? "Deleted"
                  : entry.action === "toggleCode"
                    ? off
                      ? "Off"
                      : "On"
                    : entry.action;
            const tone = off
              ? "bg-red-500/15 text-red-300"
              : entry.action === "createCode"
                ? "bg-[#2f6b48]/20 text-[#a9d8bb]"
                : "bg-white/[0.07] text-white/70";
            return (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tone}`}
                >
                  {label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] tracking-[0.06em] text-white/85">
                    {entry.code ?? "—"}
                  </span>
                  <span className="block text-[10px] leading-relaxed text-white/35">
                    {entry.dew ? `💧 ${entry.dew} Dew` : ""}
                    {entry.note ? ` · ${entry.note}` : ""}
                    {` · ${when(entry.at)}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DiagnosticsBlock({ diagnostics }: { diagnostics: Record<string, unknown> }) {
  const entries = Object.entries(diagnostics).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-black/30 px-2 py-2 font-mono text-[10px] text-red-200/70">
      {entries.map(([key, value]) => (
        <div key={key} className="break-all">
          <span className="opacity-60">{key}:</span>{" "}
          {typeof value === "object" && value !== null ? (
            // Nested detail, e.g. the private-key shape. Stringifying it
            // directly would print a useless "[object Object]".
            <span>
              {"{"}
              {Object.entries(value as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(", ")}
              {"}"}
            </span>
          ) : (
            String(value)
          )}
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
