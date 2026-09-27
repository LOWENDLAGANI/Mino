"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighterBase } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { parseFenceInfo } from "@/lib/codeFence";

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
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as unknown as Record<string, unknown>)) {
    const el = node as unknown as { props?: { children?: ReactNode } };
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

const SyntaxHighlighter = SyntaxHighlighterBase as unknown as React.FC<HighlighterProps>;

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
    const highlight = language || "text";

    return (
      <div className="code-block">
        <div className="code-block-header">
          {/* The filename leads, because that is what tells the reader which
              file to paste it into. The language is a quiet hint beside it. */}
          {path ? (
            <span className="code-block-file" title={path}>
              {path}
            </span>
          ) : (
            <span className="code-block-lang">{highlight}</span>
          )}
          {path && language && <span className="code-block-lang">{language}</span>}
          <span className="flex-1" />
          <CopyButton text={codeText} />
        </div>
        <SyntaxHighlighter
          language={highlight}
          style={oneDark}
          customStyle={{ margin: 0, background: "transparent", fontSize: 13 }}
          codeTagProps={{ style: { fontFamily: "inherit" } }}
        >
          {codeText}
        </SyntaxHighlighter>
      </div>
    );
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
