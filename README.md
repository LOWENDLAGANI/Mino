# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, markdown rendering, automatic anonymous cloud history, and no account required.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats and messages load only from the current browser’s IndexedDB via Dexie; Firebase Realtime Database is used only to log chat text under the anonymous user identity
- **Two modes** — **Mino Auto** routes every message to the best available model; **Mino Dev** uses Mino 3.8, tuned for code and technical work. Each mode is powered by its own server-side API key, with automatic fallback if one is missing.
- **Secure API keys** — keys are only ever read server-side in the `/api/chat` Route Handler
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

3. In Firebase Console → Realtime Database → Rules, paste the contents of `database.rules.json` and publish. The rules deny all reads of chat data and allow writes only under the signed-in anonymous user’s UID. The two exceptions are `admin/pinHash`, which a signed-in visitor may read and may create once, and `admin/registry`, which lists visitor names. Reading conversations is deliberately not permitted by any rule — it happens server-side (see **Admin console**).

### Admin console

Clicking the Mino logo **on the About page** ten times within a couple of seconds opens a PIN prompt. A correct PIN opens a read-only console showing which providers are configured, local chat/message counts, storage used, the anonymous Firebase identity, and the list of visitors who have given Mino a name.

**There is no manual Firebase setup.** The first time the prompt opens, Mino checks whether a PIN already exists. If not, it shows a setup form, and saving it creates `admin/pinHash` in the Realtime Database for you — the browser hashes the PIN with Web Crypto and only the digest is written. The database rule permits that creation exactly once (`!data.exists()`), so the digest can never be silently replaced afterwards. To start over, delete the `admin/pinHash` node in the Firebase console.

Only the rules still need publishing once. Failures are diagnosed on screen rather than in a console, because the panel is usually opened on a phone: the prompt names the specific cause — unpublished rules, missing `NEXT_PUBLIC_FIREBASE_*` values, anonymous sign-in disabled, an offline device, a PIN that already exists — and prints the raw Firebase error code underneath so it can be reported. A **Retry** button re-runs the check without closing the dialog.

Five wrong attempts trigger a one-minute cooldown.

**This is a convenience gate, not a security boundary.** Anyone can create an anonymous Firebase session and read the digest from the database, and whoever reaches the setup screen first becomes the administrator. The PIN check that guards *logged chat data*, however, does run on the server — see below.

### Reading logged chats (server-side)

Browsing conversations, listing people, and wiping data all go through `app/api/admin/route.ts`. That route verifies the PIN against the stored digest **on the server** and reads the database with the Firebase Admin SDK, which is not subject to Realtime Database rules. The browser never requests chat data directly, so the write-only rules on `users/$uid` stay intact and no visitor can read anyone's conversations.

The trade-off is that the Admin SDK needs a service account. Generate one at Firebase → Project settings → Service accounts → Generate new private key, then add these to the deployment environment and redeploy:

| Variable | Value |
|---|---|
| `FIREBASE_ADMIN_PROJECT_ID` | the `project_id` field from the JSON |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | the `client_email` field from the JSON |
| `FIREBASE_ADMIN_PRIVATE_KEY` | the `private_key` field |

Pasting a PEM key into a dashboard is easy to get wrong, and a mangled one fails as the opaque `Failed to parse private key`. The server therefore rebuilds the key before use: it strips surrounding quotes, expands JSON-escaped `\n` and double-escaped `\\n`, takes only the first block if the value was pasted twice, and re-wraps the base64 body at 64 characters. A key whose line breaks were dropped on paste therefore still works.

The trailing `=` padding is treated as part of the key rather than as decoration. A service-account key is a DER structure whose length is rarely a multiple of 3, so its base64 body nearly always ends in `==`, and OpenSSL rejects a PEM whose last quantum is missing that padding even when the key is otherwise perfect. The server keeps padding that arrived intact and re-derives it from the body length when a paste lost it, so a stored length that is not a multiple of 4 is not by itself an error.

What the rebuilder cannot repair is real damage: a body whose length falls outside 1620–1628 has lost or gained base64 characters, and that key must be copied again from the JSON. If the console reports `privateKey: …` in its diagnostics, that line describes the shape it actually received without revealing the key.

Until those are set, `/api/admin` returns a clear "not configured" message and the console shows that instead of data. The client-side PIN setup in `lib/adminPin.ts` is unaffected and still works.

## Visitor names

On first visit Mino asks what to call you. The name is stored in that browser's `localStorage` only, so it is never asked again on the same device, and it is written to Realtime Database at `admin/registry/{uid}` alongside the first- and last-seen timestamps so the console can list visitors.

That registry is names and timestamps **only**. Logged chat text under `users/{uid}/chats` is read exclusively by the server-side admin API, never by the browser, so opening the console does not expose anyone's conversations to a visitor.

Note that `admin/registry` is still readable by any signed-in visitor, since Realtime Database rules cannot verify that someone knows the PIN. The names list in the console comes from the server API as well, but the underlying node is not private on its own — move the name into the same server-gated namespace if that matters.

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

Add the Firebase variables above and paste `database.rules.json` into the Firebase Realtime Database Rules editor to enable automatic logging. `/api/chat` remains a Node.js Route Handler; Firebase is initialized only in the browser when configured. If Firebase is not configured, the app remains local-only.

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
  AdminGate.tsx        # Ten-tap logo trigger, first-run setup, and PIN prompt
  AdminPanel.tsx       # Diagnostics console: people, chats, messages, wipes
  api/admin/route.ts   # Server-side admin API: PIN check + Admin SDK reads and wipes
  about/page.tsx       # Public About page: logo, creator, date, progress
  MinoMark.tsx         # Brand mark (renders /public/mino-logo.png with SVG fallback)
  ModelSelector.tsx    # Navbar model dropdown
  Markdown.tsx         # react-markdown + Prism + copy button
lib/
  db.ts                # Dexie schema, chat/message ops, backup, persona prompt
  imageUtils.ts        # Canvas compression (1024px, JPEG q0.8)
  models.ts            # Model catalog + token estimator
  webSearch.ts         # Server-side current-web search and source formatting
  firebaseHistory.ts   # Anonymous write-only Firebase chat logging
  adminPin.ts          # Client-side SHA-256 PIN setup and verification
  adminServer.ts       # Server-side admin client, PIN check, and database access
  visitorName.ts       # Local display name storage
  useAdminTaps.ts      # Ten-tap gesture shared by the header and sidebar logos
  settings.ts           # Local response, instruction, and appearance preferences
  types.ts             # Shared TypeScript types
database.rules.json    # Realtime Database rules for anonymous-user isolation and the admin digest
```

## Privacy

Conversations and attachments are loaded only from the current browser’s IndexedDB. If Firebase logging is configured, chat text and metadata are also written to the signed-in anonymous device identity, but the database is not read by the app. No account or email is required. When web search is enabled, the current question is sent to the search service to retrieve source context for that request.
