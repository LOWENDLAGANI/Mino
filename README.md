# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, and markdown rendering — all chat data lives in your browser (IndexedDB), never on a server.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats, messages, and image attachments are stored client-side in IndexedDB via Dexie (no 5MB localStorage quota issues)
- **Two modes** — **Mino Auto** routes every message to the best available model; **Mino Dev** uses Mino 3.8, tuned for code and technical work. Each mode is powered by its own server-side API key, with automatic fallback if one is missing.
- **Secure API keys** — keys are only ever read server-side in the `/api/chat` Route Handler
- **Strict persona** — the Mino system prompt is prepended server-side to *every* completion request; the client cannot bypass it
- **Multimodal** — attach images via file picker, drag-and-drop, or clipboard paste; compressed client-side on `<canvas>` (max 1024px, JPEG q0.8) before upload
- **Streaming** — real-time word-by-word responses over Server-Sent Events
- **Web search** — Mino can automatically search for current or time-sensitive answers, with source links shown in the response; the composer also supports Auto, On, and Off modes
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
| `OPENROUTER_API_KEY` | **Mino Auto** | Universal routing that picks the best available model per message |
| `GEMINI_API_KEY` | **Mino Dev** | Mino 3.8 model access via the compatible endpoint |
| `TAVILY_API_KEY` | **Web search** | Enables automatic current-web search and source links |

Get keys from the providers linked in your deployment environment. The product UI always identifies models as Mino Auto or Mino 3.8.

Resilience behavior:
- Requested mode's key missing → Mino uses the other configured key; the chat keeps working.
- Provider outage or rate limit before streaming starts → Mino retries stable Mino 3.7 and Mino 3.6 fallbacks, then the other configured route as needed, with a small automatic model-change notice in the chat header.
- Both providers unavailable → the conversation shows the provider name, HTTP status, and a safe diagnostic instead of the generic “Mino hit an error” message.
- No keys at all → chat UI still works and displays a setup notice in the conversation instead of an error page.
- Web search key missing → Mino keeps answering without web context and the composer shows a setup state instead of failing the chat.

## Deploying to Vercel

No database or runtime configuration needed — push the repo to Vercel and add the environment variables listed above (one is enough). `/api/chat` runs as a Node.js Route Handler; the rest is static.

## Project structure

```
app/
  api/chat/route.ts    # SSE streaming proxy with server-side keys, web search, and Mino persona
  layout.tsx           # Root layout, dark theme
  page.tsx             # Main chat orchestration: state, streaming, model switching
  globals.css          # Tailwind + Mino dark blue design system
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
  webSearch.ts         # Server-side current-web search and source formatting
  types.ts             # Shared TypeScript types
```

## Privacy

All conversations and attachments are stored exclusively in your browser's IndexedDB. Nothing is persisted server-side; only the current request payload is proxied to the selected route. When web search is enabled, the current question is sent to the search service to retrieve source context for that request.
