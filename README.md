# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, markdown rendering, automatic anonymous cloud history, and no account required.

Built with **Next.js 15 (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats and messages load only from the current browser’s IndexedDB via Dexie; Firebase Realtime Database is used only to log chat text under the anonymous user identity
- **Two modes** — **Mino Auto** routes every message to the best available model; **Mino Code** uses Mino 3.8, tuned for code and technical work. Each mode is powered by its own server-side API key, with automatic fallback if one is missing. Picking Code always opens a **separate session**, so a code conversation is never continued under a different model's answers.
- **Code sessions, not code chat** — a Code session keeps the *files* as its state, not just the transcript:
  - **Reviewable diffs** — a proposed file is diffed against the version already in the session and split into hunks, each with its own **Accepted / Rejected** toggle. A rejected hunk contributes its original lines and drops its new ones, so the file you end up with is a real file, not a record that a change was declined. Each file renders **once**, as the diff: the file block is stripped from the prose (`prose` on the message) rather than being shown again as a code block above it
  - **Copy out** — every file card has a **Copy** button that yields the *resolved* contents, rejections already applied, so it pastes cleanly into a local editor. The Files panel copies per file too
  - **Derivation, not a second store** — hunk decisions are written onto the message, and the current contents of every file are derived from them. A rejection therefore survives a reload instead of quietly reverting on the next turn
  - **Working files panel** — the session's accepted files, openable inline, each with a copy and a per-file *attach* toggle
  - **Project notes** — stack, conventions, paths, and things to avoid, written once and sent with every request in the session, so Mino stops re-asking
  - **Step timeline** — the plan Mino declares up front, shown as a checklist rather than more prose to read
  - **Real verification** — `/api/verify` runs the repository's own `typecheck` / `lint` / `test` / `build` scripts and returns their unmodified output. The result is recorded as a message in the thread, so the output is visible where the conversation can refer to it and survives a reload, and it is fed back on the next turn. Mino reacts to an actual compiler, not to its own confidence
  - **Command palette** — ⌘K for modes, new sessions, panels, and running a check

**On a phone**, Code mode is built for the small screen rather than shrunk to fit it: the Files panel becomes a bottom sheet (a 340px column would leave the thread too narrow to read a diff), the diff drops one of its two line-number gutters and keeps a 30–32px thumb target on every toggle, the header collapses to a single 40px overflow button, and both textareas use a 16px font so iOS Safari does not zoom the page on focus. The palette's keyboard hints are desktop-only — a touch user taps the row.
- **Secure API keys** — provider keys are only ever read server-side in the `/api/chat` Route Handler; the admin console holds no service-account credential at all
- **Strict persona** — the Mino system prompt is prepended server-side to *every* completion request and the client cannot bypass it. Because a prompt is an instruction rather than a guarantee, every streamed token is additionally passed through a server-side identity guard that rewrites *self-referential* vendor claims ("I am Gemini", "I was created by Google", "I'm powered by GPT-4") into Mino. The guard is deliberately scoped: vendor names in ordinary answers ("Gemini changed its pricing", "compare Gemini with Claude") are left untouched, so Mino never misattributes or confuses legitimate content
- **Multimodal** — attach images via the phone camera, file picker, drag-and-drop, or clipboard paste; compressed client-side on `<canvas>` (max 1024px, JPEG q0.8) before upload
- **Streaming** — real-time word-by-word responses over Server-Sent Events
- **Web search** — Mino stays off for general knowledge questions and searches when you explicitly request it or say an answer may be wrong, with source links shown in the response; the composer supports Auto, On, and Off modes
- **Markdown + code** — syntax-highlighted code blocks (Prism) with per-block copy button
- **Chat management** — pin and rename chats, retry/edit-and-resend, copy chats, source history, voice input, and text/code file attachments
- **Settings** — a single panel in the sidebar for web search mode, response length, reasoning effort (low/medium/high, default low), and dark/light appearance; the composer's `+` menu stays limited to per-message tools

## Getting started

```bash
bun install
bun run dev
```

Open http://localhost:3000. `bun run test` runs the code-session tests.

### API keys

Mino has two modes, each with its own key. **The site never breaks if one (or both) is missing** — it shows a friendly notice in chat and falls back to whichever key exists.

Set either (or both) via `process.env` — locally in `.env.local`, or in Vercel → Settings → Environment Variables:

| Variable | Mode | Provider |
|---|---|---|
| `OPENROUTER_API_KEY` | **Mino Auto** | Universal routing that picks the best available model per message |
| `GEMINI_API_KEY` | **Mino Code** | Mino 3.8 / 3.7 / 3.6 access via the compatible endpoint |
| `GROQ_API_KEY` | **Fallback** | Last-resort provider used by Auto when every Gemini model is unavailable |
| `TAVILY_API_KEY` | **Web search** | Enables explicit web research and source links |
| `CLOUDFLARE_ACCOUNT_ID` | **Image generation** | Cloudflare account that hosts the Workers AI model |
| `CLOUDFLARE_API_TOKEN` | **Image generation** | API token with the *Workers AI: Read* permission |
| `MINO_ADMIN_EMAIL` | **Admin controls** | The administrator's address, matching the one in `database.rules.json` |

`/api/verify` needs no key of its own — it runs the scripts this repository already defines, and `GET /api/verify` reports which of `typecheck`, `lint`, `test`, and `build` actually exist so the palette only ever offers real ones.

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
  ".read": "auth != null && auth.token.email === 'ADMIN_EMAIL'",
  ".write": "auth != null && auth.token.email === 'ADMIN_EMAIL'",
  "$uid": { ".write": "auth != null && auth.uid === $uid" }
}
```

Realtime Database rules cascade downward and cannot be revoked by deeper rules, so those two grants cover every chat of every visitor. Every other signed-in visitor matches no `.read` rule anywhere and keeps the write-only access they had before. Firebase evaluates the condition on every read and write, so nothing in the client bundle is a security boundary — patching it would gain an attacker nothing.

### Setting up the administrator

The administrator is your Google account, and the rules name it by email address. One file holds the answer: the `ADMIN_EMAIL` placeholder in `database.rules.json`. Nothing is hardcoded in the app.

1. Enable **Google** under Firebase → Authentication → Sign-in method.
2. Open the logo's ten-tap prompt and sign in with Google. It will be refused, which is expected — the rules do not name you yet. **Show my email** prints the address.
3. Replace the `'ADMIN_EMAIL'` placeholder in `database.rules.json` with your address.
4. Publish `database.rules.json` in the Firebase console (Realtime Database → Rules).

That is the whole setup. The prompt never tries to predict who the administrator is; it signs you in and attempts a real read, letting Firebase answer, so the rules cannot drift out of step with a copy of the address baked into the bundle.

Because the app already signs visitors in anonymously, signing in with Google **links** the two identities and carries any existing anonymous data over to the new account, so chat logging continues uninterrupted. Other visitors are unaffected: each device has its own anonymous id, and none of them are claimed.

The address is readable in the published rules, which is harmless — knowing it does not let anyone authenticate as you — but the Google account itself should have MFA enabled, since it is now the only thing standing between an attacker and every logged conversation. The only way to change the administrator is to replace the address and publish again.

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

### How Code mode reads a response

The UI is a coding surface, so it needs more than prose to render. `lib/codeSession.ts` parses each Code response into two registers: the prose, and any fenced block whose info string names a path (```` ```ts src/lib/thing.ts ````), which becomes a first-class file. Bare-language blocks stay ordinary code blocks, so an illustrative snippet is never mistaken for a change.

`lib/diff.ts` is a dependency-free LCS line diff producing standard +/- hunks with context, and `lib/workspace.ts` derives the session's accepted file state from the stored per-hunk decisions. Both are covered by `bun run test` (`tests/code-session.test.ts`), because these are the two places where a subtle mistake is invisible until it has already corrupted a user's file.

Resilience behavior:
- **Mino Code is Gemini-only.** Every automatic fallback stays inside the Mino 3.8 → 3.7 → 3.6 family. OpenRouter and Groq are excluded from its chain entirely: a code answer produced by a different model family is a different answer, so a clear error is better than silently changing families mid-task. The `GROQ_API_KEY` fallback therefore applies to Auto only, and `GET /api/chat` no longer reports Code as available on the strength of a Groq key.
- Auto mode's requested key missing → Mino uses the other configured key; the chat keeps working.
- Provider outage or rate limit before streaming starts → Mino retries stable Mino 3.7 and Mino 3.6 fallbacks, then the other configured route as needed, with a small automatic model-change notice in the chat header.
- Auto mode, every Gemini model exhausted → Mino falls back to the Groq provider (`GROQ_API_KEY`) with its own quota, so a Google capacity outage does not break the chat. Its fallback models are all comparable-tier (GPT-OSS 120B, Llama 3.3 70B, GPT-OSS 20B) rather than progressively weaker, because a last line of defence should still be worth reading.
- Model rejects the chosen reasoning effort → the same request is retried once without `reasoning_effort` before that provider is given up on, so an unsupported value can never take a conversation down.
- All providers unavailable → the conversation shows the provider name, HTTP status, and a safe diagnostic instead of the generic “Mino hit an error” message.
- No keys at all → chat UI still works and displays a setup notice in the conversation instead of an error page.
- Web search key missing → Mino keeps answering without web context and the composer shows a setup state instead of failing the chat.

## Deploying to Vercel

Add the Firebase variables above and publish `database.rules.json` in the Firebase Realtime Database Rules editor to enable automatic logging. `/api/chat` remains a Node.js Route Handler; Firebase is initialized only in the browser when configured. If Firebase is not configured, the app remains local-only. No service account or `FIREBASE_ADMIN_*` variable is needed.

## Image generation

Mino can also draw. The composer's `+` menu has a **Create image** item, which switches the composer into image mode: the prompt is sent to `/api/image`, which runs a two-stage pipeline and returns the finished image. The result is stored in the same local Dexie database as the rest of the thread, so images survive a reload exactly like chat history.

**Stage 1 — prompt optimization.** Short text like *"a girl named Mino"* is weak input for a diffusion model, so `lib/promptOptimizer.ts` first rewrites it through a fast text LLM (Groq → Gemini → OpenRouter, whichever keys the deployment has) with a strict system instruction: return **one** descriptive paragraph adding physical detail, setting, lighting, and an art style, and nothing else — no preamble, no quotes, no lists. The stage is best effort by design: it has a 6s budget, and if no text model is configured, the call fails, or the model returns a refusal or an echo of the input, the user's original prompt is passed through unchanged so image generation keeps working. Sending `"raw": true` in the request body skips it entirely for callers who already wrote a full prompt.

**Stage 2 — image generation.** The optimized string goes straight to **Cloudflare Workers AI** (`@cf/black-forest-labs/flux-1-schnell`). Workers AI returns raw image bytes, which the route captures as a buffer and returns to the browser with the correct `image/png` content type. The pre-existing handling of Cloudflare's base64 JSON envelope is kept, because which of the two shapes arrives is a property of the model rather than of the request.

**Errors.** A rate limit (HTTP 429) or a rejected API token (401/403) both return `{"error": "Daily generation limit reached. Please try again tomorrow."}`. They are indistinguishable from the outside — both mean no image right now — and the specific cause is written to the server log instead of leaking to the client. Other failures (malformed payload, unknown model, upstream outage, empty image) keep their own specific messages.

### Posters and readable text

**A diffusion model cannot spell.** FLUX learns what text *looks like*, not what letters are, so a requested headline comes back as `KESEELAMATAN` and any fine print is shapes that resemble tiny text. No prompt wording fixes this; it is a property of the architecture, not a setting.

So text is never asked of the image model. When a request looks like a poster (`lib/posterText.ts`), Mino:

1. **Extracts the headline** from the user's own words — a quoted phrase is used verbatim, which is what makes the spelling correct. If no headline can be found, the request is generated as an ordinary image, because a poster with nothing to say is just a blank area.
2. **Strips the text out of the artwork prompt** and reserves an empty band across the upper third plus a clear strip along the bottom, with an explicit instruction that the image contain no lettering at all.
3. **Draws the real words afterwards** (`lib/posterRender.ts`) by rendering a transparent text layer with `next/og` and compositing it over the returned bytes with `sharp`.

The text layer is rendered by `next/og` rather than by sharp's own SVG text support, and that is deliberate. sharp renders SVG text through the host's fontconfig, and a host with no fonts installed produces a **blank image with a success status** — no error, no warning, just missing letters. `next/og` bundles its own font file, so the result cannot depend on what happens to be installed on the host. Responses also carry `X-Mino-Poster-Text: 1` so the client can tell drawn text from generated pixels.

If compositing fails for any reason, the unlettered artwork is returned rather than an error — imperfect lettering is worth more than no image, and the failure is recoverable by retrying.

The default model is `@cf/black-forest-labs/flux-1-schnell`, which is covered by Cloudflare's free allocation, so image generation costs the deployment nothing beyond that allowance.

Setup, in the Cloudflare dashboard:

1. Create or pick a Cloudflare account and copy its **Account ID** from the dashboard sidebar.
2. Create an API token under **My Profile → API Tokens → Create Custom Token** with the **Workers AI: Read** permission (plus the *Account Settings: Read* permission that Cloudflare requires alongside it).
3. Add both values in Vercel → Settings → Environment Variables, and redeploy.

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | The account that owns the Workers AI model |
| `CLOUDFLARE_API_TOKEN` | Token with Workers AI read access |

The token is only ever read inside `/api/image`; it never reaches the browser. Like every other provider, image generation is optional — if the two variables are missing the route answers with a setup message, the **Create image** item explains that the key is needed, and the rest of the app is unaffected.

## Admin controls

The console can change how the live site behaves without a redeploy: **maintenance mode**, kill switches for chat, image generation and web search; an announcement banner shown to every visitor; daily per-device caps on messages and images; and banning a device outright.

**Maintenance mode** replaces every page with a notice carrying a reason you write, and the routes refuse every request, so it holds for a modified client as well as the page. The administrator is deliberately exempt — otherwise the switch would lock its own owner out and there would be no way back. To get in during maintenance: **tap the logo on the notice ten times** and sign in with Google; the console opens over the notice and the switch is turned off from there. The logo is the only thing on the screen that does anything, which is the point.

**These are enforced on the server, not in the browser.** `/api/chat` and `/api/image` read the settings on every request and refuse before any provider is called, so the switches hold even for someone running a modified bundle. That works without giving the deployment a service account:

- `config/` has a **public read**, which is what lets a route handler read the settings with no credential at all. The page also asks the server whether it is the administrator, so the maintenance notice is never shown to the person who can lift it.
- Writing `config/` is refused to everyone except the administrator's address, and the console's save goes through `/api/admin/config`, which verifies the caller's Firebase ID token and then performs the write *with that same token* — so `database.rules.json` makes the final decision, not the route.
- `MINO_ADMIN_EMAIL` tells the server which address to expect. It must match the address in the rules, and a mismatch surfaces as a refused write rather than a silent success.

After changing the rules in `database.rules.json`, **publish them in the Firebase console** (Realtime Database → Rules), or the server will keep reading the old permissions.

Two limits worth knowing:

- **Configuring a ban or a cap makes identity mandatory.** The identity checks read `if (identity && ...)`, which on its own would mean a caller who simply omits the `Authorization` header has no identity, skips every check, and is waved through — turning both controls into decoration removable with one header. So once either is configured, a caller that cannot be identified is refused. With no ban list and no cap set, anonymous callers are allowed as before.
- **Caps are approximate.** Each request reads the counter and writes it back, which two simultaneous requests can race on, so a burst can exceed the cap slightly. Closing that needs a transaction the REST API cannot express, and an approximate cap is a better trade than no cap.
- **A cap is per device, not per person.** It follows the anonymous Firebase identity in that browser, so clearing site data or using a private window starts a new allowance.
- **Today's counters are shown in the console**, per visitor and in total. They are the numbers the caps are counted against, so they are also the quickest way to see that the caps are counting at all rather than silently doing nothing.

If `config/` cannot be read, every default is permissive: the app keeps working rather than locking everyone out.

### Rate limiting

Both routes are limited per minute — 30 messages, 8 images — keyed by the verified uid where there is one and by the forwarded client address otherwise. This is the backstop for the case the per-device caps cannot cover: with no ban list and no cap configured, anyone can post and spend the deployment's provider quota, and the attacker controls their own device, so a device-scoped control would not help. It is in-process and therefore per instance, which is enough to blunt a casual flood and not enough to stop a determined one; making it exact needs a shared store this project does not have.

### Untrusted content

Search excerpts are third-party text and are injected into the system prompt, so the prompt labels them as untrusted reference material and instructs the model to report on instructions found in a page rather than follow them. This reduces the risk of prompt injection; it does not eliminate it, because no prompt-level defence is a guarantee.

## Branding

Drop a transparent-background logo at `public/mino-logo.png`. Every brand mark in the app (sidebar header, top bar, empty state, message avatars, quick tour) renders that file, and the browser tab / Apple touch icon use it too. The path is configurable through the `src` prop on `components/MinoMark.tsx`; if the file is missing or fails to load, the app falls back to the built-in sparkle mark so nothing ever renders broken.

## Project structure

```
app/
  api/chat/route.ts    # SSE streaming proxy with server-side keys, web search, and Mino persona
  api/image/route.ts   # Cloudflare Workers AI image generation with a server-side token
  api/admin/config/    # Administrator-only writes for the runtime controls
  layout.tsx           # Root layout, dark theme
  page.tsx             # Main chat orchestration: state, streaming, model switching
  globals.css          # Tailwind + Mino dark blue design system
components/
  Sidebar.tsx          # IndexedDB chat history, backup/restore
  ChatThread.tsx       # Streaming message list, markdown, image rendering
  ChatInput.tsx        # Input bar, image picker, drag & drop, paste
  NamePrompt.tsx       # First-visit display name prompt
  AboutLogo.tsx        # About page logo carrying the ten-tap admin trigger
  SettingsPanel.tsx    # Web search, response length, reasoning effort, appearance
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
  appConfig.ts         # Runtime control settings, shared by client and server
  serverControl.ts     # Server-side enforcement: config read, token verify, usage
  promptOptimizer.ts   # Stage 1: rewrites user text into a descriptive image prompt
  posterText.ts        # Poster detection, headline extraction, text-free artwork prompt
  posterRender.tsx     # Draws the real headline over the artwork (next/og + sharp)
  imageGeneration.ts   # Client helper for the Cloudflare Workers AI image route
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

## Dependency hygiene

`bun audit` is clean. The 14.x line carried a long tail of advisories — two of them critical — most of which applied to features Mino does not use, since there is no middleware, no `next/image`, no Server Actions and no rewrites. Two did apply: denial of service through App Router server components, and cache poisoning in RSC responses. Mino now runs the maintained 15.5 backport line rather than waiting for those to age out.

`postcss` and `prismjs` are pinned by `overrides`, because they arrive as transitives of Next and the syntax highlighter at versions with published advisories. Both are build-time or render-time libraries rather than reachable server surface, but there is no reason to carry a known advisory in a public beta.
