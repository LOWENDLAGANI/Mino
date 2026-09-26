"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { fetchVisitorRegistry, firebaseConfigured, type VisitorProfile } from "@/lib/firebaseHistory";

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ProviderStatus {
  available: string[];
  searchAvailable: boolean;
}

const APP_VERSION = "1.0.0";

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "off" }) {
  const toneClass =
    tone === "ok" ? "text-emerald-300/90" : tone === "warn" ? "text-amber-200/85" : "text-white/45";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.05] py-2.5 last:border-b-0">
      <span className="text-[11px] text-white/40">{label}</span>
      <span className={`text-[11px] font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

export default function AdminPanel({ open, onClose }: AdminPanelProps) {
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [visitors, setVisitors] = useState<Array<VisitorProfile & { uid: string }> | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const chatCount = useLiveQuery(() => db.chats.count(), [], undefined);
  const messageCount = useLiveQuery(() => db.messages.count(), [], undefined);
  const storageBytes = useLiveQuery(async () => {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage ?? null;
  }, [], null);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/chat")
      .then((response) => response.json())
      .then((data: ProviderStatus) => setProviders(data))
      .catch(() => setProviders({ available: [], searchAvailable: false }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { getServices } = await import("@/lib/firebaseHistory");
      const services = await getServices();
      setUid(services?.user.uid ?? null);
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setVisitors(null);
    setRegistryError(null);
    void fetchVisitorRegistry()
      .then(setVisitors)
      .catch((error: unknown) => {
        setVisitors([]);
        setRegistryError((error as { code?: string } | null)?.code ?? "unavailable");
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const modeLabel: Record<string, string> = { auto: "Mino Auto", dev: "Mino Dev" };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/75"
        style={{ backdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mino admin console"
        className="relative flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-white/[0.09] bg-[#131316] shadow-2xl shadow-black/80 animate-rise sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">Mino console</h2>
            <p className="mt-0.5 text-[10px] text-white/30">Read-only diagnostics · v{APP_VERSION}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Close console"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Providers</h3>
            {!providers ? (
              <p className="py-2 text-[11px] text-white/35">Checking…</p>
            ) : providers.available.length === 0 ? (
              <p className="py-2 text-[11px] text-amber-200/75">No API keys are configured on this deployment.</p>
            ) : (
              <div>
                {providers.available.map((mode) => (
                  <Row key={mode} label={modeLabel[mode] ?? mode} value="configured" tone="ok" />
                ))}
              </div>
            )}
            <Row
              label="Web search"
              value={providers ? (providers.searchAvailable ? "configured" : "not configured") : "…"}
              tone={providers?.searchAvailable ? "ok" : "off"}
            />
          </section>

          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Local data</h3>
            <Row label="Chats" value={chatCount === undefined ? "…" : String(chatCount)} />
            <Row label="Messages" value={messageCount === undefined ? "…" : String(messageCount)} />
            <Row
              label="Storage used"
              value={storageBytes === null || storageBytes === undefined ? "unknown" : `${(storageBytes / 1024).toFixed(0)} KB`}
            />
          </section>

          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Realtime Database</h3>
            <Row
              label="Configured"
              value={firebaseConfigured ? "yes" : "no"}
              tone={firebaseConfigured ? "ok" : "warn"}
            />
            <Row
              label="Anonymous identity"
              value={uid ? uid.slice(0, 10) : firebaseConfigured ? "signing in…" : "—"}
            />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Visitors</h3>
              {visitors && <span className="text-[10px] text-white/25">{visitors.length} named</span>}
            </div>
            {registryError ? (
              <p className="rounded-[12px] border border-amber-400/20 bg-amber-500/[0.08] p-3 text-[11px] leading-relaxed text-amber-100/90">
                Could not load visitors ({registryError}). Publish the latest database.rules.json if
                this persists.
              </p>
            ) : visitors === null ? (
              <p className="py-2 text-[11px] text-white/35">Loading…</p>
            ) : visitors.length === 0 ? (
              <p className="py-2 text-[11px] text-white/35">
                No visitors have entered a name yet.
              </p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {visitors.map((visitor) => (
                  <li
                    key={visitor.uid}
                    className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-white/85">
                        {visitor.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-[9px] text-white/25">
                        {visitor.uid.slice(0, 12)}
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] text-white/30">
                      {new Date(visitor.lastSeen).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="rounded-[14px] bg-white/[0.04] px-3.5 py-3 text-[10px] leading-relaxed text-white/35">
            This console is a convenience gate, not a security boundary. Anyone can create an anonymous
            session and read the PIN digest from the database, and the visitor list is readable by any
            signed-in visitor. Never put destructive or privileged actions here. Chat message text is
            never read back and is not shown above.
          </p>
        </div>
      </section>
    </div>
  );
}
