// ── Usage statistics ─────────────────────────────────────────────────────────
// Turns the per-visitor daily counters the chat route already writes into the
// numbers the console chart draws. Pure on purpose: the aggregation is the
// part that can quietly lie — a union counted as a sum, a day dropped — and a
// test can catch that in a way a screenshot never will.

export interface UsageDayInput {
  day: string;
  /** Every visitor with any activity that day, however small. */
  uids: string[];
  chat?: number;
  image?: number;
  auto?: number;
  code?: number;
  self?: number;
}

export interface UsageSummary {
  /** Distinct visitors per day, oldest first — the bar chart's data. */
  dau: Array<{ day: string; users: number }>;
  /** Distinct visitors across the last seven days, for the WAU headline. */
  wau: number;
  /** The most recent day's visitor count, or 0 when there is no history. */
  latestUsers: number;
  latestDay: string | null;
  totals: { chat: number; image: number };
  /** How the messages split by mode, largest first. */
  modes: Array<{ mode: "auto" | "code" | "self"; count: number }>;
}

const WAU_WINDOW_DAYS = 7;

/**
 * Aggregates raw per-day rows into the console's view.
 *
 * WAU is a union of ids, not a sum of dailies: the same person visiting four
 * days in a week is one weekly active user, and a summed chart would report
 * four — the oldest and most reliable way to make an app look bigger than it is.
 */
export function summarizeUsage(days: UsageDayInput[], now = Date.now()): UsageSummary {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const dau = sorted.map((row) => ({ day: row.day, users: row.uids.length }));

  const today = new Date(now).toISOString().slice(0, 10);
  const cutoff = new Date(now - (WAU_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const weekly = new Set<string>();
  for (const row of sorted) {
    if (row.day >= cutoff && row.day <= today) {
      for (const uid of row.uids) weekly.add(uid);
    }
  }

  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const totals = { chat: 0, image: 0 };
  const modeCounts: Record<"auto" | "code" | "self", number> = { auto: 0, code: 0, self: 0 };
  for (const row of sorted) {
    totals.chat += row.chat ?? 0;
    totals.image += row.image ?? 0;
    modeCounts.auto += row.auto ?? 0;
    modeCounts.code += row.code ?? 0;
    modeCounts.self += row.self ?? 0;
  }
  const modes = (Object.entries(modeCounts) as Array<[keyof typeof modeCounts, number]>)
    .filter(([, count]) => count > 0)
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count);

  return {
    dau,
    wau: weekly.size,
    latestUsers: latest?.uids.length ?? 0,
    latestDay: latest?.day ?? null,
    totals,
    modes,
  };
}
