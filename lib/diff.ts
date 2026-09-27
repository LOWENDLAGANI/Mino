// ── Mino — a small line diff, used to show code changes as reviewable hunks ──
//
// The project has no diff dependency, and it does not need one: this computes a
// standard LCS line diff, which is enough to turn two versions of a text file
// into the +/- hunks a reviewer actually reads. It is deliberately dependency
// free and pure, so the same function runs on the client while a file is being
// accepted or rejected.

export type DiffKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the original file, when the line exists there. */
  oldLine?: number;
  /** 1-based line number in the new file, when the line exists there. */
  newLine?: number;
}

export interface Hunk {
  id: string;
  /** "@@ -12,7 +12,9 @@" style header, kept verbatim for display. */
  header: string;
  lines: DiffLine[];
  /** Line range in the original file, for the "old 12–18" label. */
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  // Drop a single trailing newline so "a\n" and "a" diff as the same file, but
  // keep interior blank lines.
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Longest common subsequence over lines.
 *
 * The matrix is O(n·m) in memory, which is fine for a source file and for the
 * generated files this app holds. A very large file is capped so a pathological
 * input cannot lock the browser; past the cap the result degrades to a plain
 * remove-all/add-all, which is honest about the change even when it is coarse.
 */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const rows = a.length;
  const cols = b.length;
  const table = new Uint32Array((rows + 1) * (cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * (cols + 1) + j] =
        a[i] === b[j]
          ? table[(i + 1) * (cols + 1) + (j + 1)]! + 1
          : Math.max(table[(i + 1) * (cols + 1) + j]!, table[i * (cols + 1) + (j + 1)]!);
    }
  }
  return table;
}

/** Guard rail so a generated file cannot blow the main thread. */
const MAX_DIFF_CELLS = 4_000_000;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  if (a.length === 0 && b.length === 0) return [];
  if ((a.length + 1) * (b.length + 1) > MAX_DIFF_CELLS) {
    return [
      ...a.map((text) => ({ kind: "remove" as const, text })),
      ...b.map((text) => ({ kind: "add" as const, text })),
    ];
  }

  const cols = b.length + 1;
  const table = lcsTable(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i]!, oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + (j + 1)]!) {
      out.push({ kind: "remove", text: a[i]!, oldLine: i + 1 });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j]!, newLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: "remove", text: a[i]!, oldLine: i + 1 });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: "add", text: b[j]!, newLine: j + 1 });
    j += 1;
  }

  return out;
}

/**
 * Group a line diff into hunks with `context` unchanged lines around each run
 * of changes, matching how a unified diff is read.
 */
export function toHunks(lines: DiffLine[], context = 3): Hunk[] {
  const changedIndexes = lines
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) return [];

  // Merge change positions that are closer than 2·context into one hunk, so a
  // pair of nearby edits is shown as a single block rather than two.
  const ranges: Array<{ from: number; to: number }> = [];
  for (const index of changedIndexes) {
    const last = ranges[ranges.length - 1];
    if (last && index - last.to <= context * 2) {
      last.to = index;
    } else {
      ranges.push({ from: index, to: index });
    }
  }

  return ranges.map(({ from, to }, hunkIndex) => {
    const start = Math.max(0, from - context);
    const end = Math.min(lines.length - 1, to + context);
    const slice = lines.slice(start, end + 1);
    const oldNums = slice.filter((line) => line.oldLine != null).map((line) => line.oldLine!);
    const newNums = slice.filter((line) => line.newLine != null).map((line) => line.newLine!);
    const oldStart = oldNums[0] ?? 0;
    const oldCount = oldNums.length;
    const newStart = newNums[0] ?? 0;
    const newCount = newNums.length;

    return {
      id: `hunk-${hunkIndex + 1}`,
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines: slice,
      oldStart,
      oldCount,
      newStart,
      newCount,
    };
  });
}

/** Counts shown in a diff summary bar. */
export interface DiffStats {
  added: number;
  removed: number;
  /** Hunk count, which is what a reviewer actually approves. */
  hunks: number;
}

export function diffStats(hunks: Hunk[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added += 1;
      if (line.kind === "remove") removed += 1;
    }
  }
  return { added, removed, hunks: hunks.length };
}

/** Guess a language from a file path, for syntax highlighting. */
export function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    md: "markdown",
    mdx: "markdown",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    sh: "bash",
    bash: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    sql: "sql",
  };
  return map[ext] ?? "text";
}

/** A short, human label for a path: the last two segments. */
export function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}
