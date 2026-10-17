"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighterBase } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { parseFenceInfo } from "@/lib/codeFence";
import ArtifactFrame from "./ArtifactFrame";

// ── Markdown renderer with syntax-highlighted code blocks + copy button ─────
//
// `PrismLight` rather than the full `Prism`: the full build bundles a grammar
// for every language Prism knows — a few hundred of them, most of which this
// app will never be handed — and every one of them lands in the visitor's first
// download. The light build ships none and registers only the ones below.
//
// The set is deliberately "languages a coding assistant actually emits", plus
// the markup and config formats that turn up in answers constantly. Anything
// outside it still renders, just as plain text: Prism falls back rather than
// failing, so an unfamiliar language costs a little colour and nothing else.
// That is the right trade against carrying a grammar nobody has asked for.
//
// `registerLanguage` reads each grammar's own exported name and aliases rather
// than the first argument, so registering `typescript` also serves `ts`, and
// `bash` also serves `sh` and `shell`.
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
// Prism names the markup grammar `markup`; its aliases are html, xml, svg,
// mathml, ssml, atom and rss, so this one import serves every tag soup a
// model writes. There is no `xml.js` to import — that was the trap.
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import r from "react-syntax-highlighter/dist/esm/languages/prism/r";
import perl from "react-syntax-highlighter/dist/esm/languages/prism/perl";
import lua from "react-syntax-highlighter/dist/esm/languages/prism/lua";
import scala from "react-syntax-highlighter/dist/esm/languages/prism/scala";

for (const grammar of [
typescript, tsx, jsx, javascript, python, bash, json, css, markup, yaml, sql, rust, go, java, c, cpp, csharp, php, ruby, swift, kotlin, markdown, docker, diff, graphql, powershell, toml, r, perl, lua, scala,
]) {
  const name = (grammar as { displayName?: string; name?: string }).displayName ??
    (grammar as { name?: string }).name ??
    "";
  SyntaxHighlighterBase.registerLanguage(name, grammar);
}

// ── Markdown renderer with syntax-highlighted code blocks + copy button ─────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <button onClick={handleCopy} className="copy-btn" type="button" aria-label="Copy code">
      {copied ? (
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l4 4L19 6" />
          </svg>
          Copied
        </span>
      ) : "Copy"}
    </button>
  );
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node && node !== null) {
    const el = node as { props?: { children?: ReactNode } };
    return extractText(el.props?.children);
  }
  return "";
}

interface HighlighterProps {
  language?: string;
  style?: Record<string, React.CSSProperties>;
  customStyle?: React.CSSProperties;
  codeTagProps?: { style?: React.CSSProperties };
  children?: string;
}

const SyntaxHighlighter: React.FC<HighlighterProps> = SyntaxHighlighterBase as unknown as React.FC<HighlighterProps>;

/**
 * Whether this fence is a whole web page rather than a snippet.
 *
 * The test is deliberately strict: the language has to be html (or the file
 * named `.html`) *and* the contents have to open like a document. Highlighting
 * a `<div>` as a live preview would render a fragment with no styling and look
 * broken, which is worse than not offering a preview at all.
 */
function isArtifactDocument(language: string, path: string | null | undefined, code: string): boolean {
  const looksLikeHtml = language === "html" || Boolean(path && path.toLowerCase().endsWith(".html"));
  if (!looksLikeHtml) return false;
  return /^\s*(<!doctype html|<html[\s>])/i.test(code);
}

/**
 * One fenced block, with the Preview/Code toggle when it is a whole document.
 *
 * This is a component rather than a branch inside `components.code` on purpose:
 * the toggle is state, and `components.code` also renders inline code, where
 * calling a hook conditionally would be an invalid hook call.
 */
function CodeBlock({
  language,
  path,
  codeText,
}: {
  language: string;
  path?: string | null;
  codeText: string;
}) {
  const [showPreview, setShowPreview] = useState(true);
  const artifact = isArtifactDocument(language, path, codeText);
  const highlight = language || "text";

  return (
    <div className="code-block">
      <div className="code-block-header">
        {path ? (
          <span className="code-block-file" title={path}>
            {path}
          </span>
        ) : (
          <span className="code-block-lang">{artifact ? "artifact" : highlight}</span>
        )}
        {path && language && <span className="code-block-lang">{language}</span>}
        <span className="flex-1" />
        {artifact && (
          <button
            type="button"
            onClick={() => setShowPreview((value) => !value)}
            className="copy-btn"
            aria-label={showPreview ? "Show the code" : "Show the preview"}
          >
            {showPreview ? "Code" : "Preview"}
          </button>
        )}
        <CopyButton text={codeText} />
      </div>
      {artifact && showPreview ? (
        <ArtifactFrame html={codeText} />
      ) : (
        <SyntaxHighlighter
          language={highlight}
          style={oneDark}
          customStyle={{ margin: 0, background: "transparent", fontSize: 13 }}
          codeTagProps={{ style: { fontFamily: "inherit" } }}
        >
          {codeText}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

/**
 * Splits a fence info string into a language and an optional file path.
 *
 * The model is asked to name the file it is writing — ```` ```ts src/lib/thing.ts ```` —
 * because a code block with no filename cannot be pasted anywhere useful. Both
 * orders are accepted since either reads naturally, and anything that is not
 * path-shaped is treated as a plain language so an ordinary snippet still works.
 */
const components = {
  code(props: { className?: string; children?: ReactNode }) {
    const { className, children } = props;
    // react-markdown hands the entire fence info string back in the class as
    // `language-<info>`, so a named file arrives as `language-ts src/a.ts`.
    // The capture therefore takes everything after the prefix rather than just
    // the language token — matching only `[\w-]` would stop at the space and
    // drop the filename, which is the one part that matters.
    const match = /language-([\s\S]*)$/.exec(className ?? "");
    const codeText = extractText(children).replace(/\n$/, "");

    if (!match) {
      return <code className={className}>{children}</code>;
    }

    const { language, path } = parseFenceInfo(match[1] ?? "");

    return <CodeBlock language={language} path={path} codeText={codeText} />;
  },
  a(props: { href?: string; children?: ReactNode }) {
    const { href, children } = props;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

export default function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
