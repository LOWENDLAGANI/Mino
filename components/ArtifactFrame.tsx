"use client";

// ── Artifact preview ─────────────────────────────────────────────────────────
// A complete HTML document is worth showing rendered, not just highlighted —
// Mino Code is asked for whole files precisely so the result is runnable.
//
// The frame is sandboxed with `allow-scripts` and *without* `allow-same-origin`.
// That combination gives the document a unique opaque origin: it can run its own
// JavaScript, but it cannot touch this page, its cookies, its localStorage, or
// IndexedDB where every chat lives. Scripted preview without that separation
// would mean running a model-authored page with full access to the reader's
// conversation history.

export default function ArtifactFrame({ html }: { html: string }) {
  return (
    <iframe
      // `srcDoc` rather than a src: the document never leaves the browser, and
      // there is no route to serve it from.
      srcDoc={html}
      sandbox="allow-scripts"
      title="Preview of the generated page"
      className="h-72 w-full border-0 bg-white"
    />
  );
}
