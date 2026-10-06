"use client";

// ── Settings → Notifications ─────────────────────────────────────────────────
// The whole section is written around one rule: every failure says what is
// actually wrong. A notification toggle that silently does nothing — no keys,
// a blocked permission, a dev build with no service worker — is indistinguishable
// from a broken product, so each of those gets its own sentence here.

import { useCallback, useEffect, useState } from "react";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  pushServerStatus,
  pushSupported,
  sendTestPush,
} from "@/lib/push";

type Reason = "missing-keys" | "unsupported" | "denied" | "no-worker" | "subscribe-failed" | string;

function reasonFor(reason: Reason): string {
  switch (reason) {
    case "missing-keys":
      return "This deployment has no push keys yet — see below.";
    case "unsupported":
      return "This browser cannot receive notifications.";
    case "denied":
      return "Notifications are blocked for this site in your browser settings.";
    case "no-worker":
      return "The app shell is still loading — try again in a moment.";
    default:
      return "Could not turn notifications on. Try once more.";
  }
}

export default function PushSettings() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSupported(pushSupported());
    const [status, subscription] = await Promise.all([pushServerStatus(), currentPushSubscription()]);
    setConfigured(status.configured);
    setActive(Boolean(subscription));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (active) {
        await disablePush();
        setActive(false);
        setNotice("Notifications are off.");
        return;
      }
      const result = await enablePush();
      if (result.ok) {
        setActive(true);
        setNotice("Notifications are on. Send a test to see one.");
      } else {
        setNotice(reasonFor(result.error));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await sendTestPush();
      if (result.ok) {
        setNotice("Test notification sent to this device.");
      } else if (result.error === "missing-keys") {
        setNotice("This deployment has no push keys yet — see below.");
      } else {
        setNotice("Could not send. Press Turn on again to re-subscribe.");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-semibold text-white">Notifications</h3>
      <p className="mb-2.5 text-[11px] leading-relaxed text-white/40">
        Alerts from the installed app — a renewal reminder when your plan is close to ending,
        and news the owner publishes. Mino checks on every visit and asks until this browser is
        subscribed; only this browser is ever contacted.
      </p>

      {configured === false && (
        <div className="mb-2.5 rounded-[14px] border border-amber-300/15 bg-amber-400/[0.05] px-3 py-2.5">
          <p className="text-[11px] font-semibold text-amber-100/90">Server keys missing</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-white/45">
            Notifications need three keys in the deployment:{" "}
            <code className="text-white/70">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>,{" "}
            <code className="text-white/70">WEB_PUSH_PRIVATE_KEY</code> and{" "}
            <code className="text-white/70">WEB_PUSH_SUBJECT</code> (a mailto: address). Generate
            a pair with <code className="text-white/70">bunx web-push generate-vapid-keys</code>{" "}
            and add them in Keys/API keys.
          </p>
        </div>
      )}

      {!supported && configured !== false && (
        <p className="mb-2.5 rounded-[14px] border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-[11px] leading-relaxed text-white/45">
          This browser does not support notifications. The installed app on a phone does.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy || configured === false || !supported}
          className={`flex-1 rounded-[14px] border px-3 py-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            active
              ? "border-[#2f6b48]/50 bg-[#2f6b48]/15 text-white"
              : "border-white/[0.08] bg-white/[0.03] text-white/65 hover:bg-white/[0.06] hover:text-white"
          }`}
          aria-pressed={active}
        >
          {busy && !active ? "Working…" : active ? "✓ Notifications on" : "Turn on notifications"}
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={busy || !active}
          className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[12px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send test
        </button>
      </div>

      {notice && (
        <p className="animate-rise mt-2 text-[11px] leading-relaxed text-white/55">{notice}</p>
      )}
    </section>
  );
}
