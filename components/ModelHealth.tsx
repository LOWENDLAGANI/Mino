"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeader } from "@/lib/firebaseHistory";

// ── Admin: model health ──────────────────────────────────────────────────────
// One row per model the deployment can reach, each with its own Test button.
//
// The point is to answer "is this specific model up?" without waiting for a
// chat to fall over. Every check is a real request to that one model — not
// through the fallback chain, because a chain that quietly answers from another
// model would report everything as online and hide the very failure the
// administrator is looking for.
//
// The panel never sees a provider name, a wire model id, or a key: the server
// sends a Mino name and an opaque id, and nothing more.

interface ModelTarget {
  id: string;
  name: string;
  role: "auto" | "version" | "backup";
}

interface ProbeResult extends ModelTarget {
  ok: boolean;
  ms: number;
  reply: string;
  error: string;
  truncated: boolean;
}

interface CheckState {
  testing: boolean;
  result?: ProbeResult;
  error?: string;
}

const ROLE_LABEL: Record<ModelTarget["role"], string> = {
  auto: "Routes Auto",
  version: "Code fallback",
  backup: "Last resort",
};

export default function ModelHealthSection() {
  const [models, setModels] = useState<ModelTarget[] | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/models", { headers: await authHeader(), cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { models?: ModelTarget[]; error?: string } | null;
      if (!response.ok) {
        setListError(data?.error ?? "Could not load the model list.");
        return;
      }
      setListError(null);
      setModels(data?.models ?? []);
    } catch {
      setListError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = useCallback(async (target: ModelTarget) => {
    setChecks((current) => ({ ...current, [target.id]: { testing: true } }));
    try {
      const response = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ id: target.id }),
      });
      const data = (await response.json().catch(() => null)) as { result?: ProbeResult; error?: string } | null;
      if (!response.ok || !data?.result) {
        // A refused check is reported on the row rather than thrown away: "the
        // key is wrong" and "the model is down" are the two things an
        // administrator most needs to tell apart, and both land here.
        const message = data?.error ?? `The check failed (HTTP ${response.status}).`;
        setChecks((current) => ({ ...current, [target.id]: { testing: false, error: message } }));
        return;
      }
      setChecks((current) => ({ ...current, [target.id]: { testing: false, result: data.result } }));
    } catch {
      setChecks((current) => ({
        ...current,
        [target.id]: { testing: false, error: "The check could not be sent." },
      }));
    }
  }, []);

  // Sequential on purpose. A burst of simultaneous checks looks like a status
  // board refreshing, but it also fires every model at once, and a rate limit
  // hit on the first provider is then indistinguishable from a real outage.
  const runAll = useCallback(async () => {
    if (!models) return;
    for (const target of models) {
      await runCheck(target);
    }
  }, [models, runCheck]);

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Models</h3>
        {models && models.length > 0 && (
          <button
            type="button"
            onClick={() => void runAll()}
            className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-white/50 transition-colors hover:border-white/20 hover:text-white"
          >
            Check all
          </button>
        )}
      </div>

      {listError ? (
        <p className="text-[11px] leading-relaxed text-white/40">{listError}</p>
      ) : models === null ? (
        <p className="text-[11px] text-white/35">Loading…</p>
      ) : models.length === 0 ? (
        <p className="text-[11px] text-white/35">No models are configured on this deployment.</p>
      ) : (
        <ul className="space-y-1.5">
          {models.map((model) => (
            <li key={model.id}>
              <ModelRow model={model} check={checks[model.id]} onTest={() => void runCheck(model)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ModelRow({
  model,
  check,
  onTest,
}: {
  model: ModelTarget;
  check?: CheckState;
  onTest: () => void;
}) {
  const testing = check?.testing === true;
  const result = check?.result;
  const failed = !testing && !result && Boolean(check?.error);

  return (
    <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <StatusDot testing={testing} ok={result?.ok} failed={failed} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-white/90">{model.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-white/30">
            {ROLE_LABEL[model.role]}
            {result ? (result.ok ? ` · ${result.ms} ms` : "") : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="shrink-0 rounded-full border border-white/[0.1] px-2.5 py-1 text-[10px] font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
        >
          {testing ? "Checking…" : "Test"}
        </button>
      </div>

      {result && (
        <p
          className={`mt-2 break-words rounded-[10px] px-2.5 py-1.5 text-[11px] leading-relaxed ${
            result.ok ? "bg-emerald-400/[0.07] text-emerald-100/80" : "bg-red-500/[0.08] text-red-200/90"
          }`}
        >
          <span className="font-semibold">{result.ok ? "Online" : "Offline"}</span>
          {result.ok ? (
            <>
              {" — "}
              {result.reply}
              {result.truncated ? " (stopped at the model's length limit)" : ""}
            </>
          ) : (
            ` — ${result.error}`
          )}
        </p>
      )}
      {!result && check?.error && (
        <p className="mt-2 rounded-[10px] bg-red-500/[0.08] px-2.5 py-1.5 text-[11px] leading-relaxed text-red-200/90">
          {check.error}
        </p>
      )}
    </div>
  );
}

function StatusDot({ testing, ok, failed }: { testing: boolean; ok?: boolean; failed: boolean }) {
  const color = testing
    ? "bg-amber-300/80 animate-pulse"
    : ok === true
      ? "bg-emerald-400"
      : failed || ok === false
        ? "bg-red-400"
        : "bg-white/20";
  const label = testing ? "Checking" : ok === true ? "Online" : ok === false || failed ? "Offline" : "Not checked yet";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} role="img" aria-label={label} />;
}
