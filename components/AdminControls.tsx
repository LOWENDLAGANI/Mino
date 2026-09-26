"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CONFIG, subscribeAppConfig, type AppConfig } from "@/lib/appConfig";
import { saveAppConfig } from "@/lib/firebaseAdmin";
import type { AdminUser } from "@/lib/firebaseAdmin";

// ── Runtime controls ────────────────────────────────────────────────────────
// These are enforced by the server, not by this screen. A switch here closes
// the door for everyone including anyone running a modified bundle; the
// console only writes the setting down.

interface AdminControlsProps {
  users: AdminUser[] | null;
  onError: (message: string | null) => void;
}

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-white/[0.14] bg-white/[0.07]" : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]"
      }`}
    >
      <span className="text-[13px] font-medium text-white/90">{label}</span>
      <span
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#6f5bea]" : "bg-white/15"
        }`}
      >
        <span
          className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: `translateX(${checked ? 19 : 3}px)` }}
        />
      </span>
    </button>
  );
}

function CapField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <span className="text-[13px] font-medium text-white/90">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={9999}
          value={value}
          onChange={(event) => onChange(Math.max(0, Math.trunc(Number(event.target.value) || 0)))}
          className="w-16 rounded-[8px] border border-white/10 bg-black/30 px-2 py-1 text-right text-[13px] text-white outline-none focus:border-white/25"
        />
        <span className="text-[10px] text-white/30">0 = no limit</span>
      </span>
    </label>
  );
}

export default function AdminControls({ users, onError }: AdminControlsProps) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // The same public read every visitor uses, so the console shows what is
  // actually in force rather than what was last saved from this tab.
  useEffect(() => subscribeAppConfig((next) => {
    setConfig(next);
    setAnnouncement(next.announcement);
  }), []);

  const save = useCallback(
    async (next: AppConfig) => {
      setSaving(true);
      onError(null);
      try {
        await saveAppConfig(next);
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not save controls");
        // Re-read so a refused write cannot leave the console showing a
        // setting that is not actually in force.
        subscribeAppConfig((next) => {
          setConfig(next);
          setAnnouncement(next.announcement);
        })();
      } finally {
        setSaving(false);
      }
    },
    [onError]
  );

  const toggle = (key: "chatEnabled" | "imageEnabled" | "searchEnabled") => (value: boolean) => {
    void save({ ...config, [key]: value });
  };

  const setCap = (key: "dailyChatCap" | "dailyImageCap") => (value: number) => {
    void save({ ...config, [key]: value });
  };

  const commitAnnouncement = () => void save({ ...config, announcement: announcement.slice(0, 200) });

  const toggleBan = (uid: string) => {
    const banned = config.bannedUids.includes(uid);
    void save({
      ...config,
      bannedUids: banned ? config.bannedUids.filter((entry) => entry !== uid) : [...config.bannedUids, uid],
    });
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Controls</h3>
        {saving ? (
          <span className="text-[10px] text-white/35">Saving…</span>
        ) : saved ? (
          <span className="text-[10px] text-emerald-300/80">Saved</span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Switch label="Chat" checked={config.chatEnabled} onChange={toggle("chatEnabled")} />
        <Switch label="Image generation" checked={config.imageEnabled} onChange={toggle("imageEnabled")} />
        <Switch label="Web search" checked={config.searchEnabled} onChange={toggle("searchEnabled")} />
      </div>

      <div className="mt-3 space-y-1.5">
        <CapField label="Daily messages" value={config.dailyChatCap} onChange={setCap("dailyChatCap")} />
        <CapField label="Daily images" value={config.dailyImageCap} onChange={setCap("dailyImageCap")} />
      </div>

      <div className="mt-3">
        <label className="block text-[13px] font-medium text-white/90">Announcement</label>
        <div className="mt-1.5 flex gap-2">
          <input
            value={announcement}
            maxLength={200}
            onChange={(event) => setAnnouncement(event.target.value)}
            onBlur={commitAnnouncement}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="Shown to everyone. Empty hides it."
            className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/25 focus:border-white/25"
          />
          <button
            type="button"
            onClick={commitAnnouncement}
            className="shrink-0 rounded-[10px] bg-white/[0.1] px-3 py-2 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.16]"
          >
            Set
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Banned</h4>
          <span className="text-[10px] text-white/25">{config.bannedUids.length}</span>
        </div>
        {users && users.length > 0 ? (
          <ul className="space-y-1">
            {users.map((user) => {
              const banned = config.bannedUids.includes(user.uid);
              return (
                <li key={user.uid} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-[10px] px-2 py-1.5 text-[12px] text-white/70">
                    {user.name ?? "Unnamed visitor"}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleBan(user.uid)}
                    className={`shrink-0 rounded-[9px] px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
                      banned
                        ? "bg-white/[0.08] text-white/60 hover:bg-white/[0.14]"
                        : "bg-red-500/15 text-red-200/90 hover:bg-red-500/25"
                    }`}
                  >
                    {banned ? "Unban" : "Ban"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-2 text-[11px] text-white/30">No visitors to ban yet.</p>
        )}
      </div>
    </section>
  );
}
