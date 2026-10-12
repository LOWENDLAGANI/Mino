// ── Mino — reading the file name out of a code fence ─────────────────────────
//
// Mino Code is told to name the file it is writing, so a block arrives as
// ```` ```ts src/lib/thing.ts ````. Showing that name above the block is the
// whole difference between code someone can paste into their editor and code
// they have to work out where it belongs.
//
// This is deliberately tiny and separate from the renderer, because it is the
// one piece of Code mode left and it is easy to get subtly wrong: a path-shaped
// token has to be told apart from a language, or every plain ```ts block would
// be labelled "ts" as though it were a file called "ts".

/** Whether a token looks like a file path rather than a language. */
function isPathLike(token: string): boolean {
  return token.includes("/") || /\.[a-z0-9]+$/i.test(token);
}

export interface FenceInfo {
  /** The language for syntax highlighting. */
  language: string;
  /** The file name the model attached, when it attached one. */
  path: string | null;
}

export function parseFenceInfo(info: string): FenceInfo {
  const trimmed = info.trim();
  if (!trimmed) return { language: "", path: null };

  const parts = trimmed.split(/\s+/).filter(Boolean);

  // "src/app/page.tsx ts" and "ts src/app/page.tsx" — path first or path last.
  if (parts.length >= 2) {
    if (isPathLike(parts[0]!) && !isPathLike(parts[1]!)) {
      return { language: parts.slice(1).join(" "), path: parts[0]! };
    }
    if (isPathLike(parts[parts.length - 1]!) && !isPathLike(parts[0]!)) {
      return { language: parts.slice(0, -1).join(" "), path: parts[parts.length - 1]! };
    }
  }

  // "ts:src/app/page.tsx"
  const colon = trimmed.match(/^([\w+#-]+)\s*:\s*(\S+)$/);
  if (colon && isPathLike(colon[2]!)) return { language: colon[1]!, path: colon[2]! };

  // A lone path with no language, e.g. "src/app/page.tsx".
  if (parts.length === 1 && isPathLike(parts[0]!)) return { language: "", path: parts[0]! };

  // An ordinary language, e.g. "ts", "python", "bash".
  return { language: parts[0] ?? "", path: null };
}
