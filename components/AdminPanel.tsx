"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import AdminControls from "./AdminControls";
import ModelHealthSection from "./ModelHealth";
import { firebaseConfigured, fetchVisitorRegistry, getServices, type VisitorProfile } from "@/lib/firebaseHistory";
import {
  getChat,
  grantSubscription,
  listChats,
  listUsers,
  revokeSubscription,
  wipeAll,
  wipeUser,
  type AdminSubscription,
} from "@/lib/firebaseAdmin";
import { PLANS, DEFAULT_PLAN, formatRinggit, planById, type PlanId } from "@/lib/plans";
import { MONTHS_OFFERED } from "@/lib/subscriptionState";

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
  subscription: AdminSubscription | null;
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
  const [confirmWipe, setConfirmWipe] = useState<null | { scope: "all" | "user"; uid?: string; label: string }>(null);
  // Whose plan is being granted, and the choices made for it. Kept as a uid so
  // the panel always reads the current record out of `users` rather than a copy
  // that goes stale the moment a grant lands.
  const [grantingUid, setGrantingUid] = useState<string | null>(null);
  // Who the owner is looking for. The list can be long, and the person a grant
  // is for is normally found by the name printed on the transfer.
  const [peopleQuery, setPeopleQuery] = useState("");
  const [grantPlan, setGrantPlan] = useState<PlanId>(DEFAULT_PLAN.id);
  const [grantMonths, setGrantMonths] = useState<number>(1);
  const [grantNote, setGrantNote] = useState("");

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
          case "revokeSubscription":
            await revokeSubscription(extra.uid!);
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
    setGrantingUid(null);
    setGrantNote("");

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

  /**
   * Hands a plan to one visitor.
   *
   * The record that comes back is what gets shown, not what was asked for, so a
   * renewal that extended the end date reports the real date rather than the
   * one this screen guessed. The buyer's browser is already listening to the
   * node this writes.
   */
  const runGrant = async (uid: string) => {
    setBusy(true);
    setError(null);
    try {
      const record = await grantSubscription(uid, grantPlan, grantMonths, grantNote);
      setUsers((current) =>
        (current ?? []).map((user) =>
          user.uid === uid
            ? {
                ...user,
                subscription: {
                  plan: record.plan,
                  grantedAt: record.grantedAt,
                  expiresAt: record.expiresAt,
                  months: record.months,
                },
              }
            : user
        )
      );
      setGrantingUid(null);
      setGrantNote("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not grant the plan.");
    } finally {
      setBusy(false);
    }
  };

  const runRevoke = async (uid: string) => {
    setBusy(true);
    setError(null);
    try {
      await revokeSubscription(uid);
      setUsers((current) =>
        (current ?? []).map((user) => (user.uid === uid ? { ...user, subscription: null } : user))
      );
      setGrantingUid(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not remove the plan.");
    } finally {
      setBusy(false);
    }
  };

  const grantingUser = grantingUid ? users?.find((user) => user.uid === grantingUid) ?? null : null;
  const subscribed = (users ?? []).filter((user) => user.subscription).length;
  // Filtering by name, by uid, or by the plan they already hold — the three
  // things an owner has in hand when a transfer needs matching to a person.
  const query = peopleQuery.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (user) =>
      !query ||
      (user.name ?? "").toLowerCase().includes(query) ||
      user.uid.toLowerCase().includes(query) ||
      (user.subscription ? planById(user.subscription.plan).name.toLowerCase().includes(query) : false)
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

              <ModelHealthSection />

              <AdminControls users={users} onError={setError} />

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">People</h3>
                  <span className="text-[10px] text-white/25">
                    {subscribed} subscribed
                  </span>
                </div>
                <input
                  value={peopleQuery}
                  onChange={(event) => setPeopleQuery(event.target.value)}
                  placeholder="Find a name to grant"
                  aria-label="Find a visitor by name"
                  className="mb-2 w-full rounded-[10px] border border-white/[0.1] bg-[#0d0d0f] px-2.5 py-2 text-[11px] text-white/85 outline-none placeholder:text-white/25 focus:border-[#4da3ff]/50"
                />
                <p className="mb-2 text-[10px] leading-relaxed text-white/30">
                  Press <span className="font-semibold text-white/60">Plan</span> beside whoever
                  paid — including someone who has never sent a message.
                </p>
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
                          {user.subscription ? (
                            <button
                              type="button"
                              onClick={() => setGrantingUid(grantingUid === user.uid ? null : user.uid)}
                              className="shrink-0 rounded-[10px] border border-[#4da3ff]/25 bg-[#4da3ff]/10 px-2 py-1.5 text-[10px] font-semibold text-[#9ee7ff]"
                              aria-label={`${planById(user.subscription.plan).name} until ${new Date(user.subscription.expiresAt).toLocaleDateString()}`}
                            >
                              {planById(user.subscription.plan).short}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setGrantingUid(grantingUid === user.uid ? null : user.uid)}
                              className="shrink-0 rounded-[10px] px-2 py-2 text-[10px] text-white/30 hover:bg-white/[0.07] hover:text-white/70"
                              aria-label={`Grant a plan to ${user.name ?? "this visitor"}`}
                            >
                              Plan
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setConfirmWipe({ scope: "user", uid: user.uid, label: user.name ?? "Unnamed visitor" })}
                            className="shrink-0 rounded-[10px] px-2 py-2 text-[10px] text-white/30 hover:bg-red-500/10 hover:text-red-300"
                            aria-label={`Delete data for ${user.name ?? "this visitor"}`}
                          >
                            Wipe
                          </button>
                        </div>

                        {grantingUid === user.uid && (
                          <GrantPanel
                            key={user.uid}
                            plan={grantPlan}
                            months={grantMonths}
                            note={grantNote}
                            busy={busy}
                            hasPlan={Boolean(grantingUser?.subscription)}
                            onPlan={setGrantPlan}
                            onMonths={setGrantMonths}
                            onNote={setGrantNote}
                            onCancel={() => setGrantingUid(null)}
                            onGrant={() => void runGrant(user.uid)}
                            onRevoke={() => void runRevoke(user.uid)}
                          />
                        )}
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
                        key={visitor.uid}
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

/**
 * The grant form for one visitor.
 *
 * A QR transfer is checked by hand, so this is the moment the payment becomes a
 * plan. The tier is chosen first and granted second on purpose: one button that
 * grants whatever is highlighted is one stray tap away from selling a month of
 * the wrong tier, and nobody can undo that for the buyer except another tap
 * here. The reference field carries whatever the banking app showed, and it is
 * shown to the buyer — that is what lets them match a transfer to a purchase
 * without asking.
 */
function GrantPanel({
  plan,
  months,
  note,
  busy,
  hasPlan,
  onPlan,
  onMonths,
  onNote,
  onCancel,
  onGrant,
  onRevoke,
}: {
  plan: PlanId;
  months: number;
  note: string;
  busy: boolean;
  hasPlan: boolean;
  onPlan: (plan: PlanId) => void;
  onMonths: (months: number) => void;
  onNote: (note: string) => void;
  onCancel: () => void;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  return (
    <div className="mt-1.5 rounded-[14px] border border-[#4da3ff]/20 bg-[#4da3ff]/[0.05] p-3">
      <p className="text-[10px] leading-relaxed text-white/45">
        Payment received? Choose the tier they paid for.
      </p>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {PLANS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={plan === item.id}
            onClick={() => onPlan(item.id)}
            className={`rounded-[10px] border px-2.5 py-2 text-left transition-colors ${
              plan === item.id
                ? "border-[#4da3ff]/60 bg-[#4da3ff]/15 text-white"
                : "border-white/[0.08] bg-white/[0.02] text-white/45 hover:border-white/20 hover:text-white/75"
            }`}
          >
            <span className="block text-[12px] font-semibold">{item.short}</span>
            <span className="block text-[10px] opacity-70">{formatRinggit(item.ringgit)}/mo</span>
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <label className="text-[10px] text-white/40" htmlFor="mino-grant-months">
          For
        </label>
        <select
          id="mino-grant-months"
          value={months}
          onChange={(event) => onMonths(Number(event.target.value))}
          className="rounded-[9px] border border-white/[0.1] bg-[#0d0d0f] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-[#4da3ff]/50"
        >
          {MONTHS_OFFERED.map((span) => (
            <option key={span} value={span}>
              {span} month{span === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </div>

      <input
        value={note}
        onChange={(event) => onNote(event.target.value)}
        placeholder="Payment reference (optional)"
        aria-label="Payment reference"
        maxLength={120}
        className="mt-2 w-full rounded-[10px] border border-white/[0.1] bg-[#0d0d0f] px-2.5 py-2 text-[11px] text-white/85 outline-none placeholder:text-white/25 focus:border-[#4da3ff]/50"
      />

      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[10px] px-2.5 py-2 text-[11px] text-white/45 hover:bg-white/[0.06] hover:text-white"
        >
          Cancel
        </button>
        {hasPlan && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className="rounded-[10px] px-2.5 py-2 text-[11px] text-red-300/70 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
          >
            Remove plan
          </button>
        )}
        <button
          type="button"
          onClick={onGrant}
          disabled={busy}
          className="ml-auto rounded-[10px] bg-[#4da3ff] px-3 py-2 text-[11px] font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Granting…" : `Grant ${planById(plan).short}`}
        </button>
      </div>
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
