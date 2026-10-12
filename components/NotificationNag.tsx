"use client";

// ── The every-visit notification check ──────────────────────────────────────
// Notifications are not a setting the visitor is expected to find: the app
// checks on every visit whether this browser can receive them and is actually
// subscribed, and asks — in one line, with one tap — until it is. The check
// re-runs each visit because a subscription is fragile: clearing site data,
// revoking permission, or a deployment that just gained its push keys all
// leave a browser silently unsubscribed, which is exactly the state a
// once-ever prompt never recovers from.
//
// Permission is never requested by itself. The prompt is the visit; the tap
// is the visitor's.

import { useCallback, useEffect, useState } from "react";
import {
  currentPushSubscription,
  enablePush,
  pushServerStatus,
  pushSupported,
} from "@/lib/push";

export default function NotificationNag() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!pushSupported()) return;
      const [status, subscription] = await Promise.all([
        pushServerStatus(),
        currentPushSubscription(),
      ]);
      if (cancelled) return;
      // Subscribed, or the deployment cannot send — neither is a question worth
      // asking again on this visit.
      if (!status.configured || subscription) return;
      setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await enablePush();
      if (result.ok) {
        setShow(false);
        return;
      }
      if (result.error === "missing-keys") {
        setProblem("This deployment has no push keys yet — see Settings → Notifications.");
      } else if (result.error === "denied") {
        setProblem("Notifications are blocked for this site. Allow them from the address bar, then reload.");
      } else {
        setProblem("Could not turn notifications on — try once more.");
      }
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!show) return null;

  return (
    <div
      role="status"
      className="animate-rise relative z-10 mx-4 mt-1 flex shrink-0 items-center gap-3 self-start rounded-2xl border border-[#a9d8bb]/15 bg-[#a9d8bb]/[0.06] px-3.5 py-2.5 text-left backdrop-blur-md sm:self-center md:max-w-xl"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-[#a9d8bb]"
        aria-hidden
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-white/85">Turn on notifications</p>
        <p className="text-[11px] leading-relaxed text-white/50">
          Mino checks every visit — renewal reminders and news only reach a subscribed browser.
        </p>
        {problem && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-amber-200/80">{problem}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => void enable()}
          disabled={busy}
          className="rounded-full bg-[#2f6b48] px-3 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-[#35744f] disabled:opacity-50"
        >
          {busy ? "Enabling…" : "Turn on"}
        </button>
        <button
          type="button"
          onClick={() => setShow(false)}
          disabled={busy}
          className="rounded-full px-2.5 py-1.5 text-[11.5px] text-white/45 transition-colors hover:text-white/80 disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
