# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, markdown rendering, automatic anonymous cloud history, and no account required.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats and messages load only from the current browser’s IndexedDB via Dexie; Firebase Realtime Database is used only to log chat text under the anonymous user identity
- **Two modes** — **Mino Auto** routes every message to the best available model; **Mino Dev** uses Mino 3.8, tuned for code and technical work. Each mode is powered by its own server-side API key, with automatic fallback if one is missing.
- **Secure API keys** — provider keys are only ever read server-side in the `/api/chat` Route Handler; the admin console holds no service-account credential at all
- **Strict persona** — the Mino system prompt is prepended server-side to *every* completion request and the client cannot bypass it. Because a prompt is an instruction rather than a guarantee, every streamed token is additionally passed through a server-side identity guard that rewrites *self-referential* vendor claims ("I am Gemini", "I was created by Google", "I'm powered by GPT-4") into Mino. The guard is deliberately scoped: vendor names in ordinary answers ("Gemini changed its pricing", "compare Gemini with Claude") are left untouched, so Mino never misattributes or confuses legitimate content
- **Multimodal** — attach images via the phone camera, file picker, drag-and-drop, or clipboard paste; compressed client-side on `<canvas>` (max 1024px, JPEG q0.8) before upload
- **Streaming** — real-time word-by-word responses over Server-Sent Events
- **Web search** — Mino stays off for general knowledge questions and searches when you explicitly request it or say an answer may be wrong, with source links shown in the response; the composer supports Auto, On, and Off modes
- **Markdown + code** — syntax-highlighted code blocks (Prism) with per-block copy button
- **Chat management** — pin and rename chats, retry/edit-and-resend, copy chats, source history, voice input, and text/code file attachments
- **Settings** — a single panel in the sidebar for web search mode, response length, custom instructions, and dark/light appearance; the composer's `+` menu stays limited to per-message tools

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
| `GROQ_API_KEY` | **Fallback** | Last-resort provider used when every Gemini model is unavailable |
| `TAVILY_API_KEY` | **Web search** | Enables explicit web research and source links |

### Automatic Firebase logging

When Firebase is configured, Mino automatically signs in with a hidden anonymous identity and logs local chat text to that identity’s Realtime Database namespace. Previous chats are loaded only from the current browser’s local Dexie database; Mino never reads chat history back from Firebase. The Realtime Database rules are write-only, so the client cannot read another user’s logs or use the database as chat history.

To enable automatic logging:

1. Create a Firebase project, create a **Realtime Database**, and enable **Anonymous** under Authentication → Sign-in method.
2. Add a Web app in Firebase and provide these variables in the Freebuff Keys/API keys UI or your deployment environment:

`NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_DATABASE_URL`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`

3. In Firebase Console → Realtime Database → Rules, paste the contents of `database.rules.json` and publish. The rules deny all reads of chat data and allow writes only under the signed-in user’s UID. The single exception is the administrator’s UID, which is also granted read and write so the console can work (see **Admin console**).

### Admin console

Clicking the Mino logo **on the About page** ten times within a couple of seconds opens a sign-in prompt. Signing in with the administrator's Google account opens a read-only console showing which providers are configured, local chat/message counts, storage used, the signed-in identity, and the list of visitors who have given Mino a name.

**There is no PIN and no service account.** Access is granted by the Realtime Database rules themselves, which name a single Firebase Auth UID:

```json
"users": {
  ".read": "auth != null && auth.uid === 'ADMIN_UID'",
  ".write": "auth != null && auth.uid === 'ADMIN_UID'",
  "$uid": { ".write": "auth != null && auth.uid === $uid" }
}
```

Realtime Database rules cascade downward and cannot be revoked by deeper rules, so those two grants cover every chat of every visitor. Every other signed-in visitor matches no `.read` rule anywhere and keeps the write-only access they had before. Firebase evaluates the condition on every read and write, so the check in the UI is only there to decide which screen to show — patching the client would gain an attacker nothing.

### Setting up the administrator

1. Open the logo's ten-tap prompt and sign in with Google. Because the app already signs visitors in anonymously, Firebase **links** the two identities and carries any existing anonymous data over to the new UID, so chat logging continues uninterrupted. The prompt shows the resulting UID so you can copy it.
2. Paste that UID into `ADMIN_UID` in `lib/firebaseAdmin.ts` and into the `'ADMIN_UID'` placeholder in `database.rules.json`.
3. Publish `database.rules.json` in the Firebase console (Realtime Database → Rules).

An anonymous UID cannot be used: Firebase assigns those at random, so they cannot be hardcoded. The UID is readable in the published rules, which is harmless — knowing it does not let anyone authenticate as you — but the Google account itself should have MFA enabled, since it is now the only thing standing between an attacker and every logged conversation.

The old `admin/pinHash` node is unused and can be deleted from the Firebase console.

### Reading and wiping logged chats

Browsing conversations, listing people, and wiping data all go through `lib/firebaseAdmin.ts`, which calls the Realtime Database directly from the browser under those rules. There is no API route and no server-side credential: the deployment environment holds no `FIREBASE_ADMIN_*` variables and never needs a key pasted into a dashboard.

A wiped user loses `users/{uid}` and `admin/registry/{uid}`; a full wipe clears both trees. `.validate` rules are not evaluated on delete, so neither operation is blocked by the schema checks.

## Visitor names

On first visit Mino asks what to call you. The name is stored in that browser's `localStorage` only, so it is never asked again on the same device, and it is written to Realtime Database at `admin/registry/{uid}` alongside the first- and last-seen timestamps so the console can list visitors.

That registry is names and timestamps **only**. Logged chat text under `users/{uid}/chats` is read exclusively by the server-side admin API, never by the browser, so opening the console does not expose anyone's conversations to a visitor.

Note that `admin/registry` is readable by the administrator through the console; ordinary visitors can write their own entry but cannot read the node.

The browser creates a hidden anonymous Firebase session and logs chat titles, text, model metadata, and sources. Images and document contents stay in the local Dexie cache because base64 image payloads can make database writes unnecessarily large. Clearing local data does not load or restore chats from the database; use the Firebase console if you need to remove logged data.

Get keys from the providers linked in your deployment environment. The product UI always identifies models as Mino Auto or Mino 3.8.

Resilience behavior:
- Requested mode's key missing → Mino uses the other configured key; the chat keeps working.
- Provider outage or rate limit before streaming starts → Mino retries stable Mino 3.7 and Mino 3.6 fallbacks, then the other configured route as needed, with a small automatic model-change notice in the chat header.
- Every Gemini model exhausted → Mino falls back to the Groq provider (`GROQ_API_KEY`) with its own quota, so a Google capacity outage does not break the chat.
- All providers unavailable → the conversation shows the provider name, HTTP status, and a safe diagnostic instead of the generic “Mino hit an error” message.
- No keys at all → chat UI still works and displays a setup notice in the conversation instead of an error page.
- Web search key missing → Mino keeps answering without web context and the composer shows a setup state instead of failing the chat.

## Deploying to Vercel

Add the Firebase variables above and publish `database.rules.json` in the Firebase Realtime Database Rules editor to enable automatic logging. `/api/chat` remains a Node.js Route Handler; Firebase is initialized only in the browser when configured. If Firebase is not configured, the app remains local-only. No service account or `FIREBASE_ADMIN_*` variable is needed.

## Branding

Drop a transparent-background logo at `public/mino-logo.png`. Every brand mark in the app (sidebar header, top bar, empty state, message avatars, quick tour) renders that file, and the browser tab / Apple touch icon use it too. The path is configurable through the `src` prop on `components/MinoMark.tsx`; if the file is missing or fails to load, the app falls back to the built-in sparkle mark so nothing ever renders broken.

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
  NamePrompt.tsx       # First-visit display name prompt
  AboutLogo.tsx        # About page logo carrying the ten-tap admin trigger
  SettingsPanel.tsx    # Web search, response length, custom instructions, appearance
  AdminGate.tsx        # Ten-tap logo trigger and administrator sign-in
  AdminPanel.tsx       # Diagnostics console: people, chats, messages, wipes
  about/page.tsx       # Public About page: logo, creator, date, progress
  MinoMark.tsx         # Brand mark (renders /public/mino-logo.png with SVG fallback)
  ModelSelector.tsx    # Navbar model dropdown
  Markdown.tsx         # react-markdown + Prism + copy buttonlib/
  db.ts                # Dexie schema, chat/message ops, backup, persona prompt
  imageUtils.ts        # Canvas compression (1024px, JPEG q0.8)
  models.ts            # Model catalog + token estimator
  webSearch.ts         # Server-side current-web search and source formatting
  firebaseHistory.ts   # Anonymous write-only Firebase chat logging
  firebaseAdmin.ts     # Rules-gated admin reads and wipes, plus admin sign-in
  visitorName.ts       # Local display name storage
  useAdminTaps.ts      # Ten-tap gesture shared by the header and sidebar logos
  settings.ts          # Local response, instruction, and appearance preferences
  types.ts             # Shared TypeScript types
database.rules.json    # Realtime Database rules for anonymous-user isolation and the admin UID
```

## Privacy

Conversations and attachments are loaded only from the current browser’s IndexedDB. If Firebase logging is configured, chat text and metadata are also written to the signed-in anonymous device identity, but the database is not read by the app. No account or email is required. When web search is enabled, the current question is sent to the search service to retrieve source context for that request.
