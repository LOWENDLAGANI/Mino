# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, and markdown rendering — all chat data lives in your browser (IndexedDB), never on a server.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats, messages, and image attachments are stored client-side in IndexedDB via Dexie (no 5MB localStorage quota issues)
- **Two modes** — **Auto** routes every message to the best model via OpenRouter's `openrouter/auto`; **Dev** uses Google Gemini, tuned for code & technical work. Each is powered by its own server-side API key, with automatic fallback if one is missing.
- **Secure API keys** — keys are only ever read server-side in the `/api/chat` Route Handler
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

### API keys

Mino has two modes, each with its own key. **The site never breaks if one (or both) is missing** — it shows a friendly notice in chat and falls back to whichever key exists.

Set either (or both) via `process.env` — locally in `.env.local`, or in Vercel → Settings → Environment Variables:

| Variable | Mode | Provider |
|---|---|---|
| `OPENROUTER_API_KEY` | **Auto** | OpenRouter `openrouter/auto` — universal router that picks the best model per message |
| `GEMINI_API_KEY` | **Dev** | Google Gemini (`gemini-3.8-flash` via the OpenAI-compatible endpoint) |

Get keys: [openrouter.ai/keys](https://openrouter.ai/keys) · [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

Resilience behavior:
- Requested mode's key missing → Mino uses the other configured key; the chat keeps working.
- Provider outage, rejected request, or rate limit before streaming starts → Mino automatically retries the other configured provider.
- Both providers unavailable → the conversation shows the provider name, HTTP status, and a safe diagnostic instead of the generic “Mino hit an error” message.
- No keys at all → chat UI still works and displays a setup notice in the conversation instead of an error page.

## Deploying to Vercel

No database or runtime configuration needed — push the repo to Vercel and add the environment variables listed above (one is enough). `/api/chat` runs as a Node.js Route Handler; the rest is static.

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

All conversations and attachments are stored exclusively in your browser's IndexedDB. Nothing is persisted server-side; only the current request payload is proxied to the selected provider (OpenRouter or Google Gemini).
