# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, and markdown rendering — all chat data lives in your browser (IndexedDB), never on a server.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats, messages, and image attachments are stored client-side in IndexedDB via Dexie (no 5MB localStorage quota issues)
- **Multi-provider models** — Anthropic Claude 3.5 Sonnet (default), OpenAI GPT-4o, Google Gemini 2.0 Flash, DeepSeek R1, via [OpenRouter](https://openrouter.ai)
- **Secure API key** — the OpenRouter key is only ever read server-side in the `/api/chat` Route Handler
- **Strict persona** — the Mino system prompt is prepended server-side to *every* completion request; the client cannot bypass it
- **Multimodal** — attach images via file picker, drag-and-drop, or clipboard paste; compressed client-side on `<canvas>` (max 1024px, JPEG q0.8) before upload
- **Streaming** — real-time word-by-word responses over Server-Sent Events
- **Markdown + code** — syntax-highlighted code blocks (Prism) with per-block copy button
- **Chat management** — sidebar history, auto-titled chats, JSON backup export/import, clear-all-data

## Getting started

```bash
bun install
bun run dev
```

Open http://localhost:3000.

### API key

The app needs an OpenRouter API key, read from `process.env.OPENROUTER_API_KEY`:

- **Local dev** — create a `.env.local` file in the project root:
  ```
  OPENROUTER_API_KEY=your_key_here
  ```
- **Vercel** — add `OPENROUTER_API_KEY` in Project → Settings → Environment Variables.

Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

## Deploying to Vercel

No database or runtime configuration needed — push the repo to Vercel and set the single environment variable above. `/api/chat` runs as a Node.js Route Handler; the rest is static.

## Project structure

```
app/
  api/chat/route.ts    # SSE streaming proxy to OpenRouter (server-side key + persona)
  layout.tsx           # Root layout, dark theme
  page.tsx             # Main chat orchestration: state, streaming, model switching
  globals.css          # Tailwind + dark Slate/Zinc design system
components/
  Sidebar.tsx          # IndexedDB chat history, backup/restore
  ChatThread.tsx       # Streaming message list, markdown, image rendering
  ChatInput.tsx        # Input bar, image picker, drag & drop, paste
  ModelSelector.tsx    # Navbar model dropdown
  Markdown.tsx         # react-markdown + Prism + copy button
lib/
  db.ts                # Dexie schema, chat/message ops, backup, persona prompt
  imageUtils.ts        # Canvas compression (1024px, JPEG q0.8)
  models.ts            # Model catalog + token estimator
  types.ts             # Shared TypeScript types
```

## Privacy

All conversations and attachments are stored exclusively in your browser's IndexedDB. Nothing is persisted server-side; only the current request payload is proxied to OpenRouter.
