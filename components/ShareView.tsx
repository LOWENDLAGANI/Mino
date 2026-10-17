"use client";

// ── The receiving end of a shared link ───────────────────────────────────────
// Read-only by construction: this page touches no database, no account and no
// chat store — everything it renders arrived inside the URL fragment, which the
// server never sees. That is why it can open for somebody with no Mino and no
// sign-in, and why the only honest thing to say on it is where the link ends.
//
// It deliberately does *not* reuse ChatThread. That component's whole job is
// sending, editing, retrying and branching against live stores, none of which
// exist here; a read-only view that looks similar but cannot reach anything is
// safer than a shared component whose props this page would have to fake.

import { useEffect, useState } from "react";
import MinoMark from "./MinoMark";
import Markdown from "./Markdown";
import { parseShareLink, type SharedChat } from "@/lib/shareLink";
import Link from "next/link";

type ViewState =
  | { status: "reading" }
  | { status: "empty" }
  | { status: "broken" }
  | { status: "ok"; chat: SharedChat };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#060a08] px-6 text-center">
      <MinoMark className="mb-5 h-10 w-10" />
      <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{title}</h1>
      <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-white/45">{body}</p>
      <Link
        href="/"
        className="mt-5 rounded-full bg-[#2f6b48] px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-[#3a7d55]"
      >
        Open Mino
      </Link>
    </div>
  );
}

export default function ShareView() {
  const [state, setState] = useState<ViewState>({ status: "reading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hash = window.location.hash;
      if (!hash || hash.length < 8) {
        if (!cancelled) setState({ status: "empty" });
        return;
      }
      const chat = await parseShareLink(hash);
      if (cancelled) return;
      setState(chat ? { status: "ok", chat } : { status: "broken" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "reading") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#060a08]">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-[#a9d8bb]/40 border-t-transparent"
          role="status"
          aria-label="Opening the shared chat"
        />
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <Notice
        title="Nothing is attached to this link"
        body="A shared Mino link carries the conversation inside it. This one arrived without one — copy the full link and try again."
      />
    );
  }

  if (state.status === "broken") {
    return (
      <Notice
        title="This link did not survive the trip"
        body="Chat apps sometimes cut long links in half. Ask for the link again, or open it by pasting the whole thing into the address bar."
      />
    );
  }

  const { chat } = state;
  return (
    <div className="min-h-[100dvh] bg-[#060a08] text-white">
      <header className="hairline-b sticky top-0 z-10 bg-[#060a08]/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5 md:px-7">
          <MinoMark className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#a9d8bb]/60">
              Shared from Mino
            </p>
            <h1 className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-white">
              {chat.t || "A conversation"}
            </h1>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-full bg-[#2f6b48] px-3.5 py-1.5 text-[11px] font-semibold text-black transition-colors hover:bg-[#3a7d55]"
          >
            Open Mino
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-5 md:px-7">
        {chat.m.map((message, index) =>
          message.r === "u" ? (              <div key={index} className="flex justify-end animate-enter">
              <div className="max-w-[88%] rounded-xl bg-white/[0.07] px-4 py-2.5 text-[13.5px] leading-relaxed text-white/85">
                <p className="whitespace-pre-wrap break-words">{message.c}</p>
              </div>
            </div>
          ) : (
            <div key={index} className="animate-enter">
              <div className="mb-1.5 flex items-center gap-2">
                <MinoMark className="h-4 w-4" />
                <span className="text-[11px] font-medium text-white/50">Mino</span>
              </div>
              <Markdown content={message.c} />
            </div>
          )
        )}

        {chat.cut && (
          <p
            role="status"
            className="rounded-lg border border-white/[0.05] bg-white/[0.025] px-3 py-2 text-center text-[11px] leading-relaxed text-white/40"
          >
            This link carries the most recent part of the conversation — links have a length
            limit, so older messages were left behind.
          </p>
        )}
      </main>

      <footer className="border-t border-white/[0.05] px-4 py-5 md:px-7">
        <p className="mx-auto max-w-3xl text-[11px] leading-relaxed text-white/30">
          This conversation travelled inside the link itself — the fragment of a URL is never
          sent to a server, so Mino holds no copy of it and nobody needs an account to read it.
          Start your own at <Link href="/" className="text-[#a9d8bb] hover:underline">mino</Link>.
        </p>
      </footer>
    </div>
  );
}
