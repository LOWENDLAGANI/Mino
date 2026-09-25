# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, markdown rendering, optional anonymous cloud history, and no account required.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats, messages, and image attachments are stored client-side in IndexedDB via Dexie; Firebase sync is optional and uses an anonymous Firebase identity, not a user account
- **Two modes** — **Mino Auto** routes every message to the best available model; **Mino Dev** uses Mino 3.8, tuned for code and technical work. Each mode is powered by its own server-side API key, with automatic fallback if one is missing.
- **Secure API keys** — keys are only ever read server-side in the `/api/chat` Route Handler
- **Strict persona** — the Mino system prompt is prepended server-side to *every* completion request; the client cannot bypass it
- **Multimodal** — attach images via file picker, drag-and-drop, or clipboard paste; compressed client-side on `<canvas>` (max 1024px, JPEG q0.8) before upload
- **Streaming** — real-time word-by-word responses over Server-Sent Events
- **Web search** — Mino stays off for general knowledge questions and searches when you explicitly request it or say an answer may be wrong, with source links shown in the response; the composer supports Auto, On, and Off modes
- **Markdown + code** — syntax-highlighted code blocks (Prism) with per-block copy button
- **Chat management** — pin and rename chats, retry/edit-and-resend, copy chats, source history, quick prompt presets, response-length control, custom instructions, voice input, and text/code file attachments

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
| `TAVILY_API_KEY` | **Web search** | Enables explicit web research and source links |

### Optional Firebase history

Mino remains fully local-first without Firebase. To sync chat text and metadata for an anonymous device identity:

1. Create a Firebase project, enable Firestore, and enable **Anonymous** under Authentication → Sign-in method.
2. Add a Web app in Firebase and provide these variables in the Freebuff Keys/API keys UI or your deployment environment:

`NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`

3. Deploy `firestore.rules` with the Firebase CLI. The rules allow each anonymous Firebase user to access only that user’s chat documents.

The browser creates a hidden anonymous Firebase session and syncs chat titles, text, model metadata, and sources. Images and document contents stay in the local Dexie cache because base64 image payloads can exceed Firestore’s document limit. Clearing local data does not delete the remote anonymous history; use the Firebase console if you need to remove it.

Get keys from the providers linked in your deployment environment. The product UI always identifies models as Mino Auto or Mino 3.8.

Resilience behavior:
- Requested mode's key missing → Mino uses the other configured key; the chat keeps working.
- Provider outage or rate limit before streaming starts → Mino retries stable Mino 3.7 and Mino 3.6 fallbacks, then the other configured route as needed, with a small automatic model-change notice in the chat header.
- Both providers unavailable → the conversation shows the provider name, HTTP status, and a safe diagnostic instead of the generic “Mino hit an error” message.
- No keys at all → chat UI still works and displays a setup notice in the conversation instead of an error page.
- Web search key missing → Mino keeps answering without web context and the composer shows a setup state instead of failing the chat.

## Deploying to Vercel

No database is required for local-only use. To enable optional history sync, add the Firebase variables above and deploy the included `firestore.rules`. `/api/chat` remains a Node.js Route Handler; Firebase is initialized only in the browser when configured.

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

Conversations and attachments are stored locally in IndexedDB. If Firebase history is configured, chat text and metadata are also synced to the signed-in anonymous device identity; no account or email is required. When web search is enabled, the current question is sent to the search service to retrieve source context for that request.
