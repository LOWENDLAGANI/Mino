"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighterBase } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";

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

const components = {
  code(props: { className?: string; children?: ReactNode }) {
    const { className, children } = props;
    const match = /language-(\w+)/.exec(className ?? "");
    const codeText = extractText(children).replace(/\n$/, "");

    if (!match) {
      return <code className={className}>{children}</code>;
    }

    return (
      <div className="code-block">
        <div className="code-block-header">
          <span className="code-block-lang">{match[1]}</span>
          <CopyButton text={codeText} />
        </div>
        <SyntaxHighlighter
          language={match[1]}
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
