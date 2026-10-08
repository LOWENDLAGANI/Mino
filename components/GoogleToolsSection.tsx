"use client";

// ── Settings → Google tools ──────────────────────────────────────────────────
// Connect, check, and disconnect the Google account whose Calendar, Tasks,
// Sheets, Docs, and Maps Mino can act on in chat. The consent happens on
// Google's own screen; this panel only ever sees connected/not.

import { useCallback, useEffect, useState } from "react";
import { disconnectGoogle, fetchGoogleStatus, startGoogleConnect, type GoogleStatus } from "@/lib/googleStatus";

const IDLE = { available: false, connected: false, email: "", mapsAvailable: false } as GoogleStatus;

export default function GoogleToolsSection() {
  const [status, setStatus] = useState<GoogleStatus>(IDLE);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const next = await fetchGoogleStatus();
    setStatus(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The OAuth callback returns to this page with a fragment. Read it once,
  // show the outcome, and strip it so a reload does not repeat the message.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    if (hash.startsWith("#google-connected")) setNotice("Google connected. Mino can now use Calendar, Tasks, Sheets, Docs, and Maps when you ask.");
    else if (hash.startsWith("#google-error=")) {
      const message = decodeURIComponent(hash.slice("#google-error=".length));
      setNotice(message === "access_denied" ? "Google consent was cancelled." : `Google could not be connected: ${message}`);
    }
    if (hash.startsWith("#google-")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      void refresh();
    }
  }, [refresh]);

  const handleDisconnect = async () => {
    setBusy(true);
    const ok = await disconnectGoogle();
    setBusy(false);
    setNotice(ok ? "Disconnected. Mino can no longer reach your Google account." : "Disconnect failed. Try again.");
    void refresh();
  };

  return (
    <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 card-hover">
      <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-[#a9d8bb]" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" />
        </svg>
        Google tools
        {loaded && !status.available && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" title="Not configured in the deployment environment" />
        )}
      </h3>
      <p className="mb-3 text-[11px] leading-relaxed text-white/40">
        Connect a Google account and ask Mino in chat — &ldquo;what&rsquo;s on my calendar tomorrow&rdquo;, &ldquo;add a task&rdquo;, &ldquo;make a sheet of these&rdquo;. Mino acts only when you ask, and says what it did.
      </p>
      {loaded && status.connected && (
        <p className="mb-3 text-[11px] text-white/50">
          Connected{status.email ? ` as ${status.email}` : ""}.
        </p>
      )}
      {notice && <p className="mb-3 text-[11px] text-[#a9d8bb]">{notice}</p>}
      <div className="flex gap-2">
        {status.connected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={busy}
            className="rounded-lg border border-white/[0.08] px-3.5 py-2 text-[12px] font-medium text-white/70 transition-all hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            onClick={startGoogleConnect}
            disabled={busy || (loaded && !status.available)}
            className="rounded-lg bg-[#a9d8bb]/15 px-3.5 py-2 text-[12px] font-medium text-[#a9d8bb] transition-all hover:bg-[#a9d8bb]/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Connect Google
          </button>
        )}
      </div>
      {loaded && !status.available && (
        <p className="mt-2 text-[10px] text-white/30">
          The deployment needs Google OAuth variables before this can connect.
        </p>
      )}
    </section>
  );
}
