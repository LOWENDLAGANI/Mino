import type { CodeFile, CodeStep } from "./types";

// ── Mino — reading code out of a model response ──────────────────────────────
//
// A coding assistant answers in two registers at once: prose, and actual files.
// Treating both as one undifferentiated Markdown blob is what makes a chat feel
// like a chat. So the response is parsed once, here, and the two registers are
// separated: prose stays prose, and a fenced block that names a path becomes a
// first-class file the user can review as a diff, keep, or send back.
//
// The grammar is deliberately tiny and stated in the system prompt, so parsing
// is a matter of reading what the model was told to write rather than guessing.

// Fences are collected with a line scanner rather than one regular expression.
// A regex is the obvious tool here and is wrong twice over: with the `m` flag,
// `$` matches at every line end so an unterminated block truncates after one
// line; without it, `^` only matches the start of the response so a fence after
// any prose is missed entirely. The grammar is a line-based one, so it is read
// as one.
//
// A fence closes on the first line that is exactly ``` (allowing trailing
// whitespace), which is what CommonMark does and what models actually emit.

/** Extensions we accept as "this is a file" when a block also has a path. */
const PATH_SHAPED = /[/.][\w.+-]+$/;

function looksLikePath(token: string): boolean {
  const cleaned = token.trim().replace(/^:/, "");
  if (!cleaned || cleaned.includes(" ")) return false;
  if (/^\d+$/.test(cleaned)) return false;
  return PATH_SHAPED.test(cleaned) || cleaned.includes("/");
}

interface ParsedFence {
  info: string;
  body: string;
  start: number;
  end: number;
}

function collectFences(content: string): ParsedFence[] {
  const fences: ParsedFence[] = [];
  const lines = content.split("\n");
  let offset = 0;
  const offsets: number[] = lines.map((line) => {
    const at = offset;
    offset += line.length + 1;
    return at;
  });

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith("```")) continue;

    const body: string[] = [];
    let closed = false;
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      if (/^```\s*$/.test(lines[cursor]!)) {
        closed = true;
        break;
      }
      body.push(lines[cursor]!);
    }

    const start = offsets[index]!;
    const end = closed && cursor < lines.length ? offsets[cursor]! + lines[cursor]!.length : content.length;
    fences.push({
      info: line.slice(3).trim(),
      body: body.join("\n"),
      start,
      end,
    });

    // Continue after the closing fence, or after the text if it never closed.
    index = closed ? cursor : lines.length;
  }

  return fences;
}

/**
 * Splits a fence info string into a language and an optional path.
 *
 * Accepted forms, in the order a model naturally writes them:
 *   "ts src/app.ts"      "typescript:src/app.ts"      "src/app.ts ts"
 */
function splitInfo(info: string): { language: string; path: string | null } {
  if (!info) return { language: "", path: null };

  // "path lang" — a leading token that is path-shaped and a bare word after it.
  const spaceSeparated = info.split(/\s+/).filter(Boolean);
  if (spaceSeparated.length === 2) {
    const [first, second] = spaceSeparated as [string, string];
    if (looksLikePath(first) && !looksLikePath(second)) {
      return { language: second, path: first.replace(/^:/, "") };
    }
    if (looksLikePath(second) && !looksLikePath(first)) {
      return { language: first, path: second.replace(/^:/, "") };
    }
  }

  // "lang:path" or "lang/path" — one token, a separator, then a path.
  const colon = info.match(/^([\w+#-]+)\s*:\s*(\S+)$/);
  if (colon && looksLikePath(colon[2]!)) {
    return { language: colon[1]!, path: colon[2]! };
  }

  // "lang path" where the language is a known-ish token.
  if (spaceSeparated.length === 2) {
    const [first, second] = spaceSeparated as [string, string];
    if (!looksLikePath(first) && looksLikePath(second)) {
      return { language: first, path: second.replace(/^:/, "") };
    }
  }

  // A single token that is entirely a path, e.g. "src/app.ts".
  if (spaceSeparated.length === 1 && looksLikePath(info) && !isLanguageToken(info)) {
    return { language: "", path: info.replace(/^:/, "") };
  }

  return { language: spaceSeparated[0] ?? "", path: null };
}

const LANGUAGES = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "typescript", "javascript", "json", "jsonc",
  "css", "scss", "less", "html", "xml", "svg", "md", "mdx", "markdown", "txt", "text",
  "py", "python", "rb", "ruby", "go", "rs", "rust", "java", "kt", "swift", "c", "h", "cpp",
  "cs", "php", "sh", "bash", "zsh", "shell", "yml", "yaml", "toml", "ini", "sql", "graphql",
  "prisma", "dockerfile", "env", "lua", "dart", "vue", "svelte",
]);

function isLanguageToken(token: string): boolean {
  return LANGUAGES.has(token.toLowerCase());
}

export interface ParsedResponse {
  /**
   * The response with the file blocks REMOVED, for rendering as Markdown.
   *
   * This is the important part: a file is rendered once, as a reviewable diff
   * below the prose. Leaving the fences in would show the full file twice —
   * once as a code block, once as the diff — which means scrolling past the
   * entire file to reach the part that only shows what changed.
   */
  prose: string;
  files: CodeFile[];
  steps: CodeStep[];
}

/**
 * The step list, when the model wrote one.
 *
 * The convention is a `### Plan` heading followed by `- ` lines, or a fenced
 * `plan` block with one step per line. Both are what the system prompt asks for,
 * so a missing one is normal and must not be an error.
 */
function extractSteps(content: string): CodeStep[] {
  const steps: CodeStep[] = [];

  // Fenced "plan" / "steps" block, one step per line.
  for (const fence of collectFences(content)) {
    const tag = fence.info.trim().toLowerCase();
    if (tag !== "plan" && tag !== "steps") continue;
    for (const raw of fence.body.split("\n")) {
      const label = raw.replace(/^[-*\d.)\s]+/, "").trim();
      if (label) steps.push({ label, status: "done" });
    }
    if (steps.length > 0) return steps;
  }

  // A "### Plan" section of bullet lines, read as lines for the same reason the
  // fences are: a regex over headings cannot express "until the next heading"
  // without either a multiline `$` that fires on the heading's own line, or a
  // lookahead that matches zero-width at exactly that spot.
  const lines = content.split("\n");
  const heading = /^(#{2,4})\s*(plan|steps|approach)\s*:?\s*$/i;
  const start = lines.findIndex((line) => heading.test(line));
  if (start >= 0) {
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      // Stop at the next heading or at a code fence, both of which mean the
      // plan is over.
      if (/^#{1,6}\s/.test(line) || line.startsWith("```")) break;
      const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/);
      if (bullet?.[1]) steps.push({ label: bullet[1], status: "done" });
    }
  }

  return steps;
}

export function parseResponse(content: string): ParsedResponse {
  const fences = collectFences(content);
  const files: CodeFile[] = [];
  // Spans of the file blocks, removed from the prose in one pass below.
  const fileSpans: Array<{ start: number; end: number }> = [];

  for (const fence of fences) {
    const { path, language } = splitInfo(fence.info);
    if (!path) continue;
    const body = fence.body.replace(/\n$/, "");
    files.push({
      path,
      language: language || "text",
      content: body,
      lines: body === "" ? 0 : body.split("\n").length,
    });
    fileSpans.push({ start: fence.start, end: fence.end });
  }

  return { prose: stripSpans(content, fileSpans), files, steps: extractSteps(content) };
}

/**
 * Removes the given character ranges from the text.
 *
 * Working from the end backwards keeps the earlier offsets valid, and each span
 * also swallows the newline that followed it so removing a block does not leave
 * a blank gap where it used to be.
 */
function stripSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let out = text;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const span = ordered[index]!;
    let end = span.end;
    if (out[end] === "\n") end += 1;
    out = out.slice(0, span.start) + out.slice(end);
  }
  // Collapse the runs of blank lines the removals can leave behind, so the
  // prose does not gain ragged vertical gaps between paragraphs.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The form files are re-sent in when a user attaches them to a later message.
 *
 * Re-wrapping in the same named-fence grammar means a follow-up turn sees
 * exactly what the assistant produced, so it can edit rather than re-guess. This
 * is the proposal rather than the accepted state; `workspaceAttachment` in
 * lib/workspace is what sends what the user actually kept.
 */
export function filesToAttachmentBlock(files: CodeFile[]): string {
  if (files.length === 0) return "";
  return files
    .map((file) => `Current contents of \`${file.path}\`:\n\n\`\`\`${file.language} ${file.path}\n${file.content}\n\`\`\``)
    .join("\n\n");
}
