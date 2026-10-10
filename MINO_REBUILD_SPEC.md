# Mino — Complete Product & Rebuild Specification (1:1)

> **Purpose of this document.** Everything needed to rebuild Mino exactly — every
> screen, every rule, every data shape, every edge case — so that an AI or a human
> developer can reproduce it without reading the source first. Written to be handed
> to an **Android app AI** or an **Android developer**, but complete enough for a
> web rebuild too.
>
> Source repository: `LOWENDLAGANI/Mino` (branch `main`). Read `README.md` in the
> repo for the author's own rationale; this document is the *specification*.

---

## 1. What Mino is

**Mino** is a private, **local-first AI chat assistant** by **Minetallest**. It is:

- **Zero-login**: it works with just a display name typed on first visit. Chats live
  in the device's local database. No account is required, ever.
- **Multi-mode chat** with streaming answers, markdown, vision (image attachments),
  voice input, file attachments, and a strict "Mino" persona that is never allowed to
  reveal which vendor model is behind it.
- **Optionally account-bound**: a Google sign-in can be linked (migrated, not copied)
  to the anonymous identity so history and name follow the user across devices.
- **Freemium**: free tier, plus two paid plans (**Mino Mini**, **Mino Lunar**) paid by
  QR transfer and granted manually by the owner, or by a **redeem code**.
- **An admin console** hidden behind ten taps on the logo, giving runtime control of
  the live site (kill switches, caps, bans, maintenance, announcements, push, plans,
  redeem codes, notes, model health).
- **A PWA**: installable, with a splash screen, service worker and Web Push.

Tagline-level positioning: *a private, local-first AI assistant with no account required.*

### 1.1 Non-negotiable product invariants

These are the rules the whole codebase is built around. A rebuild that breaks any of
them is not 1:1.

1. **No vendor name ever reaches the user.** Not on screen, not in stored messages,
   not in exported backups, not in error text. Users only ever see **Mino Auto**,
   **Mino Code**, **Mino V1/V2/V3**, **Mino Azure**, **Mino Canvas**.
2. **The client is never trusted for money.** Plan/entitlement is read server-side
   from the database with a server-verified identity. The client gate exists only to
   draw padlocks.
3. **The system prompt is server-side and cannot be replaced.** Client-supplied
   `system` messages are discarded. Every streamed token passes an identity filter.
4. **No service account, ever.** Firebase is accessed either from the browser under
   published rules, or from the server via public reads + the caller's own ID token.
5. **Everything degrades to "still works".** Missing keys produce friendly in-chat
   setup notices, never error pages.
6. **Model identity is honest.** A truncated answer is always marked and explained;
   a fallback model re-labels the message; an answer is never silently swapped family.

---

## 2. Stack

### 2.1 Web implementation (the reference build)

| Layer | Technology |
|---|---|
| Framework | **Next.js 15.5.26** (App Router), `runtime = "nodejs"` route handlers only |
| UI | **React 19**, TypeScript 5, client components (`"use client"`) |
| Styling | **Tailwind CSS 3.4** + one global stylesheet with CSS variables |
| Local DB | **Dexie 4** over IndexedDB (6 tables, schema versions 1→4) |
| Cloud DB | **Firebase Realtime Database** (client SDK) + anonymous auth |
| Streaming | **Server-Sent Events** over `fetch` |
| Markdown | `react-markdown` 9 + `remark-gfm` + `react-syntax-highlighter` (Prism) |
| Animation | `framer-motion` (listed) + CSS keyframe classes (`animate-rise`, `animate-pop`, `animate-breathe`, `animate-sheen`, `animate-blink`, `animate-blink`) |
| Images | `sharp` (server poster compositing), client `<canvas>` compression |
| Push | `web-push` (VAPID) + service worker `public/sw.js` |
| Package mgr | **bun** (`bun.lock`) |

Scripts (`package.json`):

```
dev     next dev -H 0.0.0.0 -p ${PORT:-3000}
build   next build
start   next start -H 0.0.0.0 -p ${PORT:-3000}
lint    next lint
test    bunx tsx tests/<each test file, chained with &&>   (16 files)
typecheck  tsc --noEmit
```

### 2.2 Android mapping (what the same feature becomes)

The **backend does not change**. An Android app is a *new client* for the same
Next.js API. Map each web primitive to its Android equivalent:

| Web concept | Android equivalent |
|---|---|
| Dexie/IndexedDB `mino-db` | **Room** (SQLite) with the same 6 tables and columns |
| `localStorage` keys (`mino:*`) | **DataStore Preferences** (or SharedPreferences) — keep the *same key names* |
| SSE via `fetch().body.getReader()` | `OkHttp`/Ktor streaming, or `okhttp-sse`; parse `data: ` lines identically |
| `AbortController` | `Call.cancel()` / `Job.cancel()` |
| Firebase Web SDK anonymous + Google `linkWithPopup` | Firebase Android SDK: `signInAnonymously()`, `linkWithCredential()` |
| Realtime Database client SDK | Same SDK, same rules — **the rules file is unchanged** |
| Service Worker + `beforeinstallprompt` | n/a — a native app replaces installability |
| Web Push (VAPID + `web-push`) | **FCM**; keep `/api/push` but add an FCM path, or drop Web Push entirely |
| Web Speech (`webkitSpeechRecognition`) | `SpeechRecognizer` (`android.speech`), one utterance, append transcript |
| `speechSynthesis` (read aloud) | `TextToSpeech`, with the same code/link sanitising rules |
| `<canvas>` image compression | `BitmapFactory` + `Bitmap.compress(JPEG, 80)` with max side 1024 |
| Drag-and-drop / paste files | `ACTION_GET_CONTENT` / `ACTION_PICK` / camera intent (`MediaStore`) |
| `navigator.share` | Android share sheet (`Intent.ACTION_SEND`) |
| Clipboard API | `ClipboardManager` |
| Browser back / `router.push` | Navigation Compose + back handler |
| `<details>` dropdown, overlays, modals | Compose `DropdownMenu` / `Dialog` / modal bottom sheet |
| `window.open(dataUrl)` on image tap | Full-screen image viewer activity/dialog |
| PWA manifest icons | App icons (use `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) |
| Splash: `sessionStorage` flag | Shown once per app *launch* (process), same blur/dissolve |
| `speech`, `clipboard`, `camera` permissions | `RECORD_AUDIO`, `CAMERA` (or photo picker = no permission), `POST_NOTIFICATIONS` |

**Do not** reimplement the paywall, identity, rate limiting or admin checks on the
device — they are server-enforced, and a native client must send the same
`Authorization: Bearer <Firebase ID token>` header.

---

## 3. Repository map

```
app/
  page.tsx                  Main chat screen (1,247 lines) — all orchestration
  layout.tsx                Root layout, dark theme, fonts, metadata
  globals.css               Design tokens + light-mode inversion + prose styles
  loading.tsx / error.tsx / not-found.tsx
  about/page.tsx            Public About page (logo 10-tap admin trigger lives here)
  plus/page.tsx             Pricing page (plans, terms, QR, redeem, receipts)
  donate/page.tsx           Donation page (QR + bank details + presets)
  notes/page.tsx            "News from developers" feed
  notes/[id]/page.tsx       Single note
  share/page.tsx            Read-only shared-chat viewer (data in URL fragment)
  api/chat/route.ts         SSE chat proxy (896 lines) — the heart of the backend
  api/image/route.ts        Image generation (prompt optimise → FLUX → poster text)
  api/memory/route.ts       Memory-suggestion extraction (proposes, never stores)
  api/plan/route.ts         Effective plan for the caller (same resolver as enforcement)
  api/push/route.ts         Push subscribe/unsubscribe/send + admin broadcast
  api/admin/config/route.ts GET status / PUT runtime controls (admin only)
  api/admin/models/route.ts GET model targets / POST live health probe (admin only)
  api/google/auth|callback|status|disconnect/route.ts   Google OAuth for tools
components/                 47 components (see §6)
lib/                        70 modules: types, DB, providers, paywall, sync, etc.
tests/                      16 unit test files (pure logic only, run with tsx)
database.rules.json         Firebase Realtime Database rules (must be published)
public/                     icons, manifest, sw.js, logo, splash images, donate QR
```

Key `lib/` modules and their one-line responsibility:

| Module | Responsibility |
|---|---|
| `types.ts` | Shared types: `Chat`, `ChatMessage`, `Memory`, `SearchSource`, attachments |
| `db.ts` | Dexie schema, chat/message CRUD, folders, full-text search, backup/restore |
| `models.ts` | **Client-safe** mode catalog (`auto`/`code`/`self`), display-name filter |
| `modelEngines.ts` | **Server-only** wire model ids ↔ Mino names |
| `providers.ts` | **Server-only** endpoints, keys, ordered fallback chains |
| `systemPrompt.ts` / `codePrompt.ts` | **Server-only** persona prompts |
| `identity.ts` | **Server-only** streaming identity filter + provider-detail scrubber |
| `gradioSpace.ts` | **Server-only** the one file that talks to the Hugging Face Space |
| `webSearch.ts` | Tavily search + when-to-search heuristics + context formatting |
| `memory.ts` / `memoryExtractor.ts` / `memorySuggestions.ts` | Memory model, guard, extraction |
| `paywallState.ts` / `paywallServer.ts` | Client lock UI / server entitlement |
| `plans.ts` / `durations.ts` | Plan catalogue, pricing, terms |
| `subscriptionState.ts` / `subscription.ts` / `useSubscription.ts` | Grant parsing, celebration, live hook |
| `redeem*.ts` / `serverRedeem.ts` | Redeem codes client + server |
| `serverControl.ts` / `appConfig.ts` | Config read, token verify, rate limit, bans, caps, usage |
| `firebaseHistory.ts` / `firebaseAdmin.ts` | Two-way chat sync / rules-gated admin reads |
| `account.ts` / `accountState.ts` | Google binding (link/merge/detach) |
| `googleAuth.ts` / `googleTools.ts` | OAuth session + Calendar/Tasks/Sheets/Docs/Maps actions |
| `scheduler.ts` / `trash.ts` / `variants.ts` / `tempChat.ts` | Send-later, trash, answer variants, temporary chat |
| `promptOptimizer.ts` / `posterText.ts` / `posterRender.tsx` | Image pipeline stages |
| `shareLink.ts` / `shareImage.ts` | Share-as-URL and share-as-image |
| `tts.ts` / `rateLimit.ts` / `useSmoothText.ts` | Read-aloud, countdown parsing, typing animation |
| `settings.ts` / `visitorName.ts` / `notes.ts` / `push.ts` | Preferences, name, dev notes, push |

---

## 4. Architecture & security model

### 4.1 The client/server split

```
┌──────────────── Android / Web client ────────────────┐
│ local DB (Room/Dexie)  ·  preferences  ·  UI          │
│ sends: Authorization: Bearer <Firebase ID token>      │
└───────────────┬───────────────────────────────────────┘
                │ HTTPS JSON + SSE
┌───────────────▼───────────────────────────────────────┐
│ Next.js route handlers (Node.js)                      │
│  /api/chat  /api/image  /api/memory  /api/plan        │
│  /api/push  /api/admin/*  /api/google/*               │
│  · verifies the token → uid, email, googleLinked      │
│  · reads config/ from RTDB (public read, no credential)│
│  · reads subscriptions/{uid} with the caller's token  │
│  · calls providers with server-side keys              │
└───────────────┬───────────────────────────────────────┘
                │
   OpenRouter · Gemini · Groq · HF Gradio Space · Cloudflare AI · Tavily · Google APIs
                │
┌───────────────▼───────────────────────────────────────┐
│ Firebase Realtime Database, governed by               │
│ database.rules.json (published by the owner)          │
└───────────────────────────────────────────────────────┘
```

### 4.2 Identity

- Every first-time visitor is signed in **anonymously** → a real Firebase UID.
- The UID is used for: chat sync namespace, visitor registry, usage counters, bans,
  daily caps, push subscriptions, subscriptions, redeem claims.
- The **admin** is decided *only* by `database.rules.json` naming one email address
  (`ADMIN_EMAIL` placeholder in the repo file, currently set). There is no PIN, no
  service account, no client-side copy of who the admin is.
- `verifyCaller(authorization)` calls Identity Toolkit `accounts:lookup` and returns
  `{ uid, email, googleLinked }` or `null`. `googleLinked` is true only when
  `providerUserInfo` contains `google.com` (guest sessions cannot use Google tools).

### 4.3 Database rule surface (`database.rules.json`)

| Path | Read | Write |
|---|---|---|
| `config/` | **public** (`true`) | admin email only |
| `usage/$uid` | owner **and** admin | owner |
| `admin/` | admin | admin |
| `admin/registry/$uid` | admin | owner (validates `name`, `firstSeen`, `lastSeen`, name ≤ 40) |
| `push/subscriptions/$uid` | owner or admin | owner or admin |
| `codes/` | admin | admin |
| `codes/$code` | **any signed-in user** (so a known word is readable; parent not readable ⇒ unenumerable) | admin (validates `code,plan,days,active,createdAt`) |
| `redeems/$uid` | owner | owner |
| `redeems/$uid/$code` | owner | owner, but **only if `codes/$code.active === true`**, claim carries **only** `{code, claimedAt}` |
| `subscriptions/` | admin | admin |
| `subscriptions/$uid` | owner **and** admin | admin only (validates `plan,grantedAt,expiresAt,announcementId`) |
| `subscriptions/$uid/ack` | owner | **owner** (and admin) |
| `users/` | admin | admin |
| `users/$uid` | **false** | owner |
| `users/$uid/chats` | owner | owner (chat node validates `id,title,createdAt,updatedAt,messages`) |
| `users/$uid/profile` | owner | owner (validates `name`, ≤ 40) |
| `users/$uid/memory` | owner | owner (validates `id,text,createdAt,updatedAt`, text 1–200 chars) |

> `subscriptions` is a **separate top-level tree** precisely because a visitor has a
> blanket `.write` on `users/$uid`, and RTDB grants cannot be revoked deeper. A
> subscription stored under `users/` could be written by the person it describes.

### 4.4 Public runtime config

`config/` (public read) is the `AppConfig` object. Defaults are **permissive** — if
unreadable, the app keeps working.

```ts
interface AppConfig {
  chatEnabled: boolean;         // default true
  imageEnabled: boolean;        // default true
  searchEnabled: boolean;       // default true
  googleToolsEnabled: boolean;  // default true (absent ⇒ true)
  announcement: string;         // "" hides the banner; max 200 chars
  notesTitle: string;           // default "News From Developers", max 60
  notes: DevNote[];             // dev news feed
  dailyChatCap: number;         // 0 = unlimited
  dailyImageCap: number;        // 0 = unlimited
  bans: BanRecord[];            // keyed map or legacy string array
  maintenanceEnabled: boolean;  // default false
  maintenanceMessage: string;   // default "Mino is down for maintenance. Please check back soon.", max 300
  updatedAt: number;
}
interface BanRecord { uid; reason (≤200); bannedAt; expiresAt: number|null; bannedBy (≤120); }
```

Server caches this for **5 s** (`invalidateConfig()` is called after an admin write).

### 4.5 Order of checks in `/api/chat` and `/api/image`

1. Parse body (400 on bad JSON / empty `messages`).
2. `verifyCaller` → identity; `readConfig()`.
3. **Maintenance** → refuse unless admin.
4. **Kill switch** (`chatEnabled` / `imageEnabled`).
5. **Rate limit** — in-process, per minute: **30 messages**, **8 images**, **20 memory**;
   keyed by uid when identified, else by client address. Message text:
   `Too many messages at once. Please wait {n}s and try again.` /
   `Too many images at once. Please wait {n}s and try again.`
6. **`identityGate`** — if a ban *or* an active cap is configured, an unidentified
   caller is refused (so omitting `Authorization` is not an escape hatch). Expired
   bans stop enforcing. Admin is exempt from bans.
7. **Paywall** — *before* the daily cap, deliberately, so an unentitled caller never
   burns an allowance slot on being refused. Admin exempt.
8. **Daily cap consumption** — read-modify-write of `usage/{uid}/{YYYY-MM-DD}`
   (keys `chat`, `image`, plus `auto`/`code`/`self` mode counters for the console).
9. Provider call.

A **failed plan read is always "free", never "allowed"**.

### 4.6 Refusal sentence formats

- Rate limit: `Too many messages at once. Please wait {n}s and try again.` (client
  parses the integer → live countdown; a message with **no** number starts no countdown).
- Daily cap: `Mino's daily limit of {n} messages has been reached on this device. It resets tomorrow.`
- Maintenance: the admin's `maintenanceMessage`.
- Kill switch: `Mino is paused right now. Please try again shortly.`
- Ban: `banMessage(ban)` — reason + end date, the same text the console shows.
- Paywall: `lockNoticeFor(...)` text (see §12), or the paused-plan sentence:
  `Your Mino plan is on hold right now. The time you paid for is saved and will pick up where it left off — message the person who runs this Mino to continue it.`
- Image paywall returns **HTTP 402** (payment missing, not forbidden).

---

## 5. Design system

### 5.1 Colour tokens (copy verbatim)

Dark (default), on `:root`:

```css
--bg:#0b1310;  --bg-raised:#111a16;  --bg-hover:#17221c;  --bg-elevated:#1a2520;
--line:rgba(233,245,236,.08);  --line-strong:rgba(233,245,236,.14);
--text-hi:#eef5f0;  --text:#cddfd4;  --text-mid:#8ba396;  --text-low:#5d7167;
--accent:#6ec294;  --accent-soft:rgba(110,194,148,.15);
--azure:#5b9bd5;   --azure-soft:rgba(91,155,213,.15);
--code:#e08e6b;    --code-soft:rgba(224,142,107,.15);
```

Light (`.light` / `html.light`), "warm off-white paper", same sage family:

```css
--bg:#f4f1e9;  --bg-raised:#fffdf7;  --bg-hover:#eae5d9;  --bg-elevated:#ffffff;
--line:rgba(46,62,48,.11);  --line-strong:rgba(46,62,48,.2);
--text-hi:#16281c;  --text:#33453a;  --text-mid:#6b7d71;  --text-low:#9ba89e;
--accent:#2f6b48;  --accent-soft:rgba(47,107,72,.12);
--azure:#2c5aa0;   --azure-soft:rgba(44,90,160,.12);
--code:#8a4f2a;    --code-soft:rgba(138,79,42,.12);  --on-accent:#f7f5ee;
```

Hard-coded brand colours used throughout the components:

| Token | Value | Use |
|---|---|---|
| Page background | `#060a08` | the outermost chat screen |
| Sidebar background | `#080d0a` | fixed rail, 292 px wide |
| App surface | gradient + radial glow (`.app-surface`, `.surface-glow`) | main column |
| Composer shell | `#1a2620` @ 95 %, radius **26 px**, shadow `0 18px 55px rgba(0,0,0,.38)` | input bar |
| Popover/menu bg | `#141f1a` @98 % or `#121c18` @98 %, radius 24–26 px, `backdrop-blur-xl` | menus, dialogs |
| Primary button | `#2a6142`, hover `#35744f`, glow shadow `0 8px 24px rgba(63,125,92,.35)` | Send |
| Mint accent | `#a9d8bb` (and `#2f6b48` fills) | active states, badges, chips |
| Code mode | `#e08e6b` | badge/icon/border |
| Azure mode | `#5b9bd5` | badge/icon/border |
| Auto mode | `#6ec294` / `#2f6b42` | badge/icon/border |
| Danger | red-400/500 at 6–15 % opacity | errors, delete |

Light mode is implemented in the web build by **inverting utility classes**
(`html.light .text-white { color:#16281c !important }`, `[class*="bg-white/"] →
rgba(46,62,48,.055)`, etc.). On Android: define two `ColorScheme` sets with these
exact values; do **not** try to replicate the class-inversion hack.

### 5.2 Typography & shape

- Font: **Inter** (`ui-sans-serif` fallback stack). Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas`.
- Text sizes actually used: chat body **15 px**, composer **16 px** (17 px ≥ md — 16 px
  deliberately prevents iOS/Android keyboard zoom), sidebar title **13 px**, section
  labels **11 px** uppercase with `0.12em` tracking, big empty-state headline
  **38 px** mobile / 54 px sm / 62 px lg with `-0.045em` tracking.
- Radii: chat bubbles `22 px` (user bubble `rounded-br-md`), chips/buttons fully round
  (`rounded-full`), cards `16–28 px`, menus `24–26 px`.
- Sidebar: fixed `292 px`, full height, hairline right border. On mobile it is an
  off-canvas drawer with a `black/65` + blur scrim.
- Top bar: `h-16` (64 px), hamburger (mobile only), logo + title, temporary-chat chip,
  spacer, mode selector.

### 5.3 Motion

| Class | Effect |
|---|---|
| `animate-rise` | fade-in-up, 0.25 s ease-out |
| `animate-pop` | scale-in for menus/dialogs |
| `animate-breathe` | gentle pulse (drawing placeholder, "New" badge) |
| `animate-sheen` | slow diagonal highlight sweep on the Lunar/donate rows |
| `animate-blink` | 3 typing dots, staggered 0.18 s |
| `stream-cursor` | gradient caret appended to the last paragraph while streaming |
| splash | image blurs + dissolves, once per browser session |

### 5.4 Theme & appearance rule

Appearance is `dark` (default) or `light`, persisted, and also sets the browser
`theme-color` meta: **dark `#0b1310`, light `#fbf9f2`**. On Android set the system
bar colour accordingly.

---

## 6. Screens & navigation

```
App entry
 ├─ SplashScreen (once per session)  over everything
 ├─ Name gate ──────────────────► NamePrompt (no skip; required)
 ├─ Maintenance screen ─────────► MaintenanceScreen (if config.maintenanceEnabled)
 └─ Main chat shell
      ├─ Sidebar (drawer on mobile / static rail ≥ md)
      │    ├─ New chat, Temporary chat toggle
      │    ├─ Toolbar: Search · Gallery · Trash(badge) · Import · Settings
      │    ├─ Promotional rows: "Mino Lunar" → /plus · "Support Mino" → /donate
      │    ├─ Folder chips (+ Folder, active chip has × to delete folder)
      │    ├─ Chat list (pinned first, timeAgo, hold/right-click menu)
      │    └─ Footer: Export · Import · Clear(2-tap) · avatar+name · News · About
      ├─ Header: menu · logo+title · "Not saved" chip · ModeSelector
      ├─ Banners: announcement · modelNotice · LG FAILED · NotificationNag
      ├─ ChatThread  (+ MemorySuggestions above composer)
      └─ ChatInput (composer)
 Overlays/panels:
   SettingsPanel (bottom-sheet ≤ sm, centered dialog ≥ sm)
   SearchOverlay (Ctrl/Cmd+K) · TrashOverlay · GalleryOverlay
   Remember-this dialog · Schedule menu · Tools(+) menu
   PayQrDialog, SubscribeGate, SubscriptionCelebration, PlanExpiryBanner
   InstallPrompt · MinoTutorial (first run) · NotesPrompt (once per note)
 Standalone routes: /about  /plus  /donate  /notes  /notes/[id]  /share
```

### 6.1 Startup sequence (exact)

1. Render nothing until local preferences hydrate (`hydrated`) — never flash the chat
   before the name is known.
2. If maintenance resolved-active → `MaintenanceScreen` only (nothing behind it).
3. If account resolution in progress → full-screen pulsing logo loader (settles on
   first failure too, so no-Firebase/offline never hangs).
4. If no display name → `NamePrompt` (no skip).
5. Otherwise → main shell.

Extra first-visit overlays: splash (`sessionStorage`), `MinoTutorial` until finished
(`mino:tutorial` = done), `InstallPrompt` (mobile only, once per visit, only after the
first sent message — the page dispatches `mino:engage` on send), `NotesPrompt`
(once per published note id).

### 6.2 NamePrompt

- Title/greeting, one text field (max 40), **Save** — required to use the app.
- Optional **Continue with Google** (only if Firebase configured): `bindGoogleAccount()`
  → name resolution precedence: **local name → account name → Google name**; if sign-in
  succeeded but no name resolved, show:
  `You are signed in, but no name came with it. Type a name above to continue.`
- Name is stored in `localStorage["mino:display-name"]` and written to
  `admin/registry/{uid}` with `firstSeen`/`lastSeen`.

### 6.3 Header details

- Logo/title tap = **new chat**.
- In temporary mode the title becomes **"Temporary chat"** and a clock chip reads
  **"Not saved"**.
- `ModeSelector` (right): summary button showing the active mode's display name +
  chevron; opens a 320 px radiogroup panel with three cards, each with icon, name,
  tagline, three bullet features, and either a check, an availability dot, or a padlock.

| Mode id | `name` | `display` (what the button and cards print) | Tagline | Bullets | Colour | Separate session |
|---|---|---|---|---|---|---|
| `auto` | Auto | **Mino Auto** | Best for everyday tasks | Smart model selection · Balanced speed & quality · Great for general questions | emerald | no |
| `code` | Code | **Code** | Built for developers | File-aware code blocks · Technical precision · Fresh session per task | orange | **yes** |
| `self` | Azure | **Mino Azure** | Mino's own model | Independent AI assistant · Created by Minetallest · Exclusive to Mino | azure | **yes** |

(`blurb` in the data model: `Best available model` / `Mino V3 · V2 · V1 only` /
`Mino's own model`. The in-message badge renders as **Mino Auto**, **Mino Code** or
**Mino Azure** with a coloured dot: emerald / `#e08e6b` / `#5b9bd5`.)

- Picking a `separateSession` mode **aborts any stream, clears the active chat,
  closes the drawer and exits image mode** — it starts a fresh session rather than
  continuing a conversation under a different model.
- On mount the selector probes `GET /api/chat` and dispatches `mino:availability`
  with `{ available, searchAvailable }`.
- Locked mode → padlock + plan name, tap routes to `/plus`.
- Stored preference that a lapsed plan no longer opens is moved **out** to the first
  open mode (never *into* a locked one); Auto is always open.

### 6.4 Sidebar chat list

- Sorted by `updatedAt` desc, then **pinned floated to top**.
- Row: `◆` pin marker · title (truncate) · relative time (`now`, `5m`, `3h`, `4d`,
  then `MMM d`). Hover reveals time.
- **Hold 450 ms** (or right-click, or keyboard ContextMenu/Shift+F10) opens a labelled
  menu: **Pin/Unpin · Move to folder · Rename · Delete**. Pointer drift > 8 px cancels
  the hold; the tap that ends a hold only closes the menu.
- Rename is inline: Enter/blur commits, Escape cancels.
- **Delete** → writes a local delete marker, syncs the deletion, moves the chat to
  Trash (30 days), and resets the view if it was active.
- Folder menu: `No folder`, each folder, `+ New folder…` (creating from a chat's menu
  also files that chat).
- Folder filter chips: All + one per folder; active folder chip has an `×` that
  removes the folder **and returns its chats to unfiled** (never deletes chats).
- Header of the list: `RECENT` (or folder name), scheduled-count badge, `+ Folder`.
- Empty copy: `Your conversations will appear here.` / folder: `Nothing in this folder
  yet. Hold a chat to move it here.`

### 6.5 Sidebar footer

- `Export` → downloads `mino-backup-YYYY-MM-DD.json`; notice `Backup saved to your downloads`.
- `Import` → JSON file; success `Imported {n} chats · {m} messages`;
  failure `Import failed: {reason}`.
- `Clear` → two-tap confirm (`Confirm?`, auto-reverts after 4 s) → wipes local DB
  (messages, chats, folders, scheduled, trash), records a wipe marker *before* the
  local wipe, notice `All data cleared`, resets to a new chat.
- Avatar circle with the name's initial (gradient `#c9e6d4 → #4a8a67 → #1f4a33`),
  the display name, and links **News** (`/notes`) and **About** (`/about`).

### 6.6 Chat thread

- Scroll container, `max-w-3xl`, auto-scroll only when already within 120 px of the
  bottom.
- Top action row (right-aligned, 10 px text): **Share link · Share image · Copy chat ·
  Sources (n) · Copy links** (the last two only when sources exist). Notices appear
  inline and expire (3–4 s).
  - **Share link**: compresses the conversation into a URL fragment (server never
    sees it); native share sheet first, clipboard fallback; summary
    `Link copied · latest {k} of {n} messages` when truncated.
  - **Share image**: renders the conversation to a PNG and downloads it; button reads
    `Rendering…` while busy, then `Image saved`.
  - **Copy chat**: `You: …` / `Mino: …` blocks joined by blank lines; notice
    `Conversation copied to your clipboard` or `Clipboard access is unavailable in this browser`.
  - **Source history**: expandable panel listing all sources with the untrusted-web
    notice.
- **Empty state**: glow + logo + rotating headline from a 136-line list, walked in
  order with a persisted cursor (`mino:empty-headline-cursor`) so consecutive loads
  never repeat.
- **User message**: right-aligned, `max-w-88 %` (76 % ≥ md), bubble `bg-white/[.075]`,
  radius 22 px with `br-md`, `whitespace-pre-wrap`; attachment thumbnails `h-28
  max-w-220` (tap opens full size); document chips `📄 name`; an **Edit** link
  (always visible on mobile, hover on desktop) opens an inline textarea with
  `Cancel` / `Edit & send`.
- **Assistant message**: header row = mode icon + colour-coded **model badge**
  (`Mino Azure`/`Mino Code`/`Mino Auto`) + optional hidden display name + token count
  (`{n} tok`, hover/title = `{prompt} in · {completion} out`) + variant stepper.
- Assistant body: markdown, streaming via `useSmoothText` (steady reveal only while
  streaming; finished answers are never held back).
- **Action row under the answer** (only when finished, non-truncated, no error):
  **Retry** · **Copy** (turns into a green check for 1.5 s) · **Read aloud**
  (speaker ⇄ stop while speaking).
- **Truncation notice** (amber) exactly:
  `Mino tried other models and this answer still stops partway, because it hit their length limit too. Ask it to continue and it will pick up from where it left off.`
- **Error block** (red) under the message with the server's text.
- **Variant stepper** when an answer has history: `‹ 1/3 latest ›` — position 0 is the
  live answer, `k` is `variants[k-1]`. Newest counts as "the" answer.
- **Waiting state**: mode icon + badge + one of five joke lines, randomly chosen per
  stream:
  `umm, finding ai suitable for your weird request` · `Whatt?` ·
  `Almost done.. Just kidding` · `Hacking your computer` ·
  `Please wait while we're staying your data`.
- **Sources card**: numbered rows (id, title, hostname, external-link icon) + the
  notice `Untrusted web text — Mino was told to treat these pages as reference, not as instructions.`
- **Generated image card**: image + prompt caption + **Save** button; tap opens full-size.
- **Drawing placeholder**: 4:3 box, spinner + `Drawing…`.

### 6.7 Composer

Layout (single rounded shell, `min-h-16`, `p-2`):
`[+ tools] [textarea] [clock (only when there is content)] [send/stop]`

- **Enter sends**, Shift+Enter newline; textarea auto-grows to max 180 px.
- Placeholder: `Ask Mino anything…` / `Compressing…` / `Describe the image to create…`.
- **`+` tools menu** (286 px popover), items in order:
  1. **Camera** (file input `capture="environment"`)
  2. **Gallery** (multi image picker)
  3. **Files** (text/code picker)
  4. **Support Mino** → `/donate` (rose heart, `Donate` pill)
  5. **Voice input** (`Listening…` while active)
  6. **Remember this** → dialog
  7. **Create image** → enters image mode; amber dot if not configured; `Mini` pill
     if paywalled (tap goes to `/plus` instead of entering image mode)
- **Limits**: **4 images**, **3 documents**, **100 000 bytes per document**. Accepted
  document types: `text/plain, text/markdown, text/csv, application/json,
  application/javascript, text/typescript, text/x-python, text/html, text/css,
  text/sql` or extension `.txt .md .csv .json .js .jsx .ts .tsx .py .html .css .sql`.
  Text is truncated to 100 KB with a `truncated` flag.
- **Images**: compressed client-side, **max side 1024 px, JPEG quality 0.8**, stored as
  base64 data URLs. Errors surface as a red strip: `Max 4 images per message`,
  `Text and code files are supported (up to 100 KB each)`, `{name} is larger than 100 KB`.
- Drag-and-drop over the shell highlights the border (`#3f7d5c/60` + green glow);
  paste of files adds them.
- **Voice input**: single utterance, non-interim, `navigator.language`, appends
  `" " + transcript` to existing text. Unavailable → `Voice input is not supported in
  this browser` / failure → `Voice input could not be started`.
- **Send later (clock)** — only when there is content and not in image mode:
  presets `In 5 minutes`, `In 30 minutes`, `In 1 hour`, `Tomorrow 9:00`, plus a
  `datetime-local` picker with floor = now + 60 s and a **Set** button. Footer note:
  `Fires from this tab while it is open — keep it open if the timing matters.`
- **Rate-limit banner** (amber): clock icon + `Rate limited — you can send again in {n}s.`
  + **Queue until then** button (queues the message for `limit + 1 s`).
- **Scheduled chips** row above the composer: clock + relative/absolute time + preview
  (max 110 px) + `×` to cancel; horizontally scrollable.
- **Image-mode strip**: icon + `Image` + `×` to exit; attachments are hidden and cannot
  be sent with an image request.
- **Send/Stop**: circular 48 px. Enabled state = `#2a6142` filled; disabled = ghost.
  While streaming it becomes a **Stop** (square) button.
- Desktop-only credit line: `Created by Minetallest · ♥ Support Mino` (→ `/donate`).

### 6.8 `+` → "Remember this" dialog

Bottom-sheet card, max-w-sm: title `What should Mino remember?`, body
`One short sentence about you. Mino uses it in every conversation until you remove it.`,
textarea (max `MEMORY_TEXT_LIMIT` = 200 chars, placeholder
`I work mostly in TypeScript and React`), amber notice on rejection, buttons
**Remember** (gradient `#a9d8bb → #1f4a33`) and **Cancel**. Saving also mirrors the
memory to the account when Firebase is configured.

### 6.9 Settings panel

Sections, in order:

1. **Account** (`AccountSection`) — display name + Google binding (sign in/detach);
   hidden entirely if Firebase is not configured.
2. **Your data** (`DataControls`) — Export backup / Erase everything (two-tap),
   **keeps the subscription**; clears local tables and this identity's DB nodes
   (chats, registry, usage, push subscriptions) using the visitor's own token.
3. **What Mino remembers** (`MemoryPanel`) — full list (never summarised), inline
   edit/delete, `Forget everything`, and a "let Mino suggest memories" checkbox.
4. **Web search** — 3-up segmented: **Auto** (`Smart search when needed`) /
   **On** (`Search every message`) / **Off** (`Never search`). Amber dot when no
   search key; buttons disabled when unavailable.
5. **Response length** — radio rows: **Short** `Lead with the answer` ·
   **Balanced** `Default amount of detail` · **Detailed** `Thorough with examples`.
6. **Reasoning effort** — 3-up: **Low** `Fastest, cheapest` · **Medium** `Thinks a
   little harder` · **High** `Slowest, most careful`. `medium`/`high` are paywalled
   (`Mini+` shown, padlock, tap routes to `/plus`).
7. **Appearance** — 2-up cards with sun/moon preview: `dark` | `light`.
8. **Google tools** (`GoogleToolsSection`) — Connect / status / Disconnect; guests see
   "Sign in with Google" instead of "Connect".
9. **Notifications** (`PushSettings`) — subscribe/unsubscribe with an explicit reason
   sentence for every failure (not configured / permission blocked / no service
   worker / not subscribed).

Escape closes; backdrop tap closes; it is a bottom sheet on phones, a centered
`max-w-lg` dialog on desktop.

---

## 7. Data model

### 7.1 Local database (`mino-db`, Dexie/IndexedDB → Room/SQLite)

Schema versions 1→4 (each added as a new version so existing installs upgrade):

| Table | Indexes | Row shape |
|---|---|---|
| `chats` | `id, updatedAt, pinned, folder` | `Chat` |
| `messages` | `id, chatId, createdAt` | `ChatMessage` |
| `memories` | `id, createdAt` | `Memory` |
| `folders` | `id, name` | `ChatFolder` |
| `scheduled` | `id, sendAt` | `ScheduledMessage` |
| `trash` | `id, deletedAt` | `TrashEntry` |

```ts
interface Chat {
  id: string;            // uuid
  title: string;         // "New chat" until auto-titled
  createdAt: number;     // epoch ms
  updatedAt: number;     // epoch ms — drives list order
  pinned?: boolean;
  folder?: string;       // ChatFolder.id, absent = unfiled
}

type Role = "user" | "assistant" | "system";   // system is never accepted from a client

interface ChatMessage {
  id: string;
  chatId: string;
  role: Role;
  content: string;                       // live answer text ("" while streaming)
  images?: ImageAttachment[];            // user-attached, base64 JPEG data URLs
  generatedImages?: GeneratedImage[];    // produced by Mino Canvas
  documents?: DocumentAttachment[];
  model?: string;                        // ALWAYS a Mino name (see §8)
  searchQuery?: string;
  sources?: SearchSource[];
  usage?: { prompt: number; completion: number; total: number };
  truncated?: boolean;                   // model hit output limit — must be shown
  error?: string;
  variants?: string[];                   // earlier answers, newest previous first
  variantIndex?: number;                 // absent/0 = live, k = variants[k-1]
  createdAt: number;
  updatedAt?: number;
}

interface ImageAttachment  { url: string /* data:image/jpeg;base64,… */; name: string; size: number; }
interface GeneratedImage   { url: string; prompt: string; mime: string; model: string; createdAt: number; }
interface DocumentAttachment { name: string; size: number; text: string; truncated?: boolean; }
interface SearchSource     { id: string; title: string; url: string; snippet: string; publishedDate?: string; }

interface ChatFolder  { id: string; name: string /* ≤32, trimmed, unique case-insensitive */; createdAt: number; }
interface Memory      { id: string; text: string /* one sentence ≤200 */; createdAt: number; updatedAt: number; }

interface ScheduledMessage {
  id: string;
  chatId: string | null;   // null → a new chat is created when it fires
  content: string;
  images?: ImageAttachment[];
  documents?: DocumentAttachment[];
  mode: ModeId;            // captured at queue time
  searchMode: SearchMode;  // captured at queue time
  sendAt: number;          // epoch ms
  createdAt: number;
}

interface TrashEntry {
  id: string;              // original chat id
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  folder?: string;
  messages: ChatMessage[]; // full copy, device-local only
  deletedAt: number;       // 30-day retention: TRASH_RETENTION_MS = 30*86400000
}
```

**Derived/behavioural rules**

- `uid()` = `crypto.randomUUID()` with a timestamp+random fallback.
- Auto-title: from the **first user message**, whitespace-collapsed, truncated at
  **42 chars + `…`**; only while the title is still `New chat`.
- `deleteChat` runs in a transaction (messages then chat).
- Folders: name max **32**, collapses whitespace, returns an existing folder on a
  case-insensitive name clash; deleting a folder re-files its chats to unfiled.
- Filing a chat does **not** touch `updatedAt`.
- Full-text search: case-insensitive substring over the **displayed** variant,
  newest-first, **limit 30**, minimum query length 2, snippet radius **46** chars each
  side with `…` ellipses. Scans the whole store in memory (deliberately local).
- Backup file: `{ app:"mino", version:1, exportedAt:ISO, chats:[], messages:[] }`.
  Restore bounds: **≤ 2000 chats, ≤ 50 000 messages**, else
  `That backup is too large to restore`; invalid shape → `Invalid Mino backup file`.
  Restore is `bulkPut` (whole-file replace semantics).
- Variants: `MAX_VARIANTS = 8`. Retry/edit **retire** the current answer into
  `variants` (only text moves — sources, usage, truncation, error stay with the
  answer being replaced) and reuse the row. An empty answer is cut, not branched.

### 7.2 Preferences (`localStorage` → DataStore) — keep the exact key names

| Key | Values | Default |
|---|---|---|
| `mino:selected-mode` | `auto` \| `code` (legacy `dev` accepted) | `auto` |
| `mino:display-name` | string ≤40 | — (gate until set) |
| `mino:response-length` | `short` \| `balanced` \| `detailed` | `balanced` |
| `mino:reasoning-effort` | `low` \| `medium` \| `high` | `low` |
| `mino:appearance` | `dark` \| `light` | `dark` |
| `mino:memory-suggest` | `on` \| `off` | on |
| `mino:memory-suggest-off` | `1` when "Don't suggest this" pressed | — |
| `mino:subscription-ack` | highest acknowledged `announcementId` | `0` |
| `mino:deleted-chats` | JSON of local delete markers | `[]` |
| `mino:first-seen` | epoch ms | — |
| `mino:empty-headline-cursor` | int index into the headline list | 0 |
| `mino:splash-seen` | session flag | — |
| `mino:tutorial` | `done` | — |
| `mino:install-asked` | per-visit flag | — |
| `mino:sw-ready` | service-worker ready flag | — |
| `mino:notes-seen` | JSON array of seen note ids | `[]` |
| `mino:push-device-id` | device id for push | — |
| `mino:availability` | written by the availability probe event | — |
| `mino:engage` | event name (first send) | — |
| `mino:data-wiped` | event name fired after "Your data" erase | — |
| `mino:custom-instructions` | **legacy — actively deleted** on load | — |

### 7.3 Firebase (Realtime Database) layout

```
config/                          AppConfig (public read)
usage/{uid}/{YYYY-MM-DD}/         { chat, image, auto, code, self } daily counters
admin/registry/{uid}/            { name, firstSeen, lastSeen }
admin/audit/{key}                audit entries
push/subscriptions/{uid}/        { endpoint, keys… } push subscriptions
codes/{word}/                    { code, plan, days, active, createdAt }
redeems/{uid}/{word}/            { code, claimedAt }   ← no plan, no days, ever
subscriptions/{uid}/             Subscription (see §12)
subscriptions/{uid}/ack/         int  ← the ONLY thing a visitor may write here
users/{uid}/chats/{chatId}/      { id, title, createdAt, updatedAt, messages }
users/{uid}/profile/             { name }
users/{uid}/memory/{id}/         { id, text, createdAt, updatedAt }
```

Chat sync is a **union, never a replace**; deletions are recorded so a sync cannot
resurrect a chat; images/attachments are **never uploaded** (base64 is too big) — they
stay local, so the copy that has them keeps them. Sync runs **debounced 900 ms** after
any local change, and chats are **pulled on every visit** (not only at sign-in).
If `users/$uid/chats` read is refused (rules not republished) the pull returns null
and local data is left alone.

---

## 8. Modes, models and the name firewall

### 8.1 Mode catalog (client-visible, `lib/models.ts`)

```ts
type ModeId = "auto" | "code" | "self";
DEFAULT_MODE_ID = "auto"
IMAGE_ENGINE = "mino-canvas"   // label shown for generated images: "Mino Canvas"
```

### 8.2 Wire models (server-only, `lib/modelEngines.ts`)

| Mino name | Wire id |
|---|---|
| Mino Auto | `openrouter/auto` |
| Mino V3 | `gemini-3.8-flash` |
| Mino V2 | `gemini-3.7-flash` |
| Mino V1 | `gemini-3.6-flash` |
| Mino Azure | `mino-self` (the Gradio Space) |
| Mino Canvas | `mino-canvas` |

`toMinoName()` is the only bridge outward and can only emit a Mino name; anything
unrecognised → `Mino`. `getModelDisplayName()` filters stored values with
`/^Mino(?: Auto| Self| Azure| Canvas| V\d+)?$/` (legacy `Mino Self` still accepted) and
falls back to `Mino` — this is what renders and what lands in exported backups.

### 8.3 Fallback chains (`lib/providers.ts`)

| Requested | Chain (in order) | Notes |
|---|---|---|
| `auto` | OpenRouter `openrouter/auto` → Gemini 3.8 → 3.7 → 3.6 → Groq `openai/gpt-oss-120b` → `llama-3.3-70b-versatile` → `openai/gpt-oss-20b` → **Space** | Groq is Auto-only fallback; Space is the last resort because it always belongs to this deployment |
| `code` | Gemini 3.8 → 3.7 → 3.6 | **Single family.** OpenRouter/Groq/Space excluded entirely |
| `self` | Gradio Space only | Never silently replaced by a vendor |

- Endpoints: OpenRouter `https://openrouter.ai/api/v1/chat/completions` (headers
  `HTTP-Referer`, `X-Title: Mino`; body `provider.allow_fallbacks`,
  `stream_options.include_usage`), Gemini
  `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
  Groq `https://api.groq.com/openai/v1/chat/completions`.
- `supportsReasoning` is tracked **per configuration** (Groq's GPT-OSS yes, Llama no;
  the Space no).
- Failure classification: HTTP **400/401/402/403** → the whole family is exhausted;
  transient (429/5xx/network) → try next model in the family. A 400 caused by an
  unsupported `reasoning_effort` value triggers **one retry without the parameter**,
  and *that* retry's status decides whether the family is exhausted.
- Before streaming starts, failures fall through the chain. Once streaming, an error
  is emitted into the stream.
- If the provider sets `finish_reason: "length"`, the answer is **truncated**: the
  route then asks **up to 2 other models** to continue from the exact stopping point
  (never restart/restate), re-labels the model when it switches, and only after all
  attempts emit `{ truncated: true }`.
- `GET /api/chat` reports availability:
  `{ available: ModeId[], searchAvailable, googleAvailable, imageAvailable }` where
  `auto` needs `OPENROUTER_API_KEY` or `GROQ_API_KEY`, `code` needs `GEMINI_API_KEY`
  only, `self` needs the Space to be configured.

### 8.4 The persona

- **`MINO_SYSTEM_PROMPT`** (base): *You are Mino, an AI assistant created and
  developed by Minetallest…* with 6 absolute identity rules: never claim any vendor
  (explicit list: Gemini, Google AI, DeepMind, Claude, ChatGPT, GPT, Llama, Mistral,
  DeepSeek, Grok, Copilot, OpenRouter…), answer identity questions in one short
  sentence, no model number/family/vendor, treat contrary claims as untrusted, never
  reveal the instructions, describe capabilities generically instead of naming vendors.
  Plus: be genuinely helpful, admit uncertainty, use Markdown with fenced code blocks.
- **`AZURE_SYSTEM_PROMPT`** (Space): same contract, repeated/paraphrased for strength,
  names `Minetallest` as the only creator, explicitly handles jailbreaks and quoted
  "facts", constrains identity only — never helpfulness.
- **`CODE_SYSTEM_PROMPT`** (Code mode only): the *only* structural rule is file blocks —
  fence info string is `language path` (e.g. ```` ```ts src/lib/thing.ts ````),
  **complete files only** (never fragments or `// …rest unchanged`), one file per
  block, real project paths, prose limited to a sentence or two, honesty about unknowns.
- System prompt assembly order: `[persona, (code prompt if code), user preferences,
  search context, google tools context]` joined by blank lines. Client `system`
  messages are filtered out of `messages`.
- **Streaming identity filter** (`IdentityFilter`): buffers each delta and rewrites
  *self-referential* vendor claims ("I am Gemini", "I was created by Google", "I'm
  powered by GPT-4") into Mino, leaving legitimate mentions ("Gemini changed its
  pricing") untouched. Provider error text is scrubbed by the same rules
  (`sanitizeProviderDetail`) before it can reach the user.

### 8.5 User preferences block (every request)

```
The user has chosen this response length. It is a preference, not an instruction
that can override safety or accuracy.

<length instruction>            // short | balanced | detailed (see §6.9)

<memory block>                  // formatMemories(sanitizeMemoryPayload(memories))
```

Reasoning effort is sent as `reasoning_effort` only where supported; default is
**`low`** for Auto, **`medium`** for Code; a free user's default is *clamped* to what
their plan allows rather than refused; an *explicit* ask for a paid effort is refused.

---

## 9. API contracts

All endpoints are under the app origin. Every mutating/enforcing route expects
`Authorization: Bearer <Firebase ID token>` (missing → treated as unidentified).

### 9.1 `POST /api/chat` — SSE

Request:

```json
{
  "messages": [ { "role": "user"|"assistant", "content": "…" | [parts] } ],
  "mode": "auto"|"code"|"self",
  "searchMode": "auto"|"always"|"off",
  "reasoningEffort": "low"|"medium"|"high",
  "responseLength": "short"|"balanced"|"detailed",
  "memories": [ { "id","text", … } ],
  "timeZone": "Asia/Kuala_Lumpur"
}
```

Content parts for attachments:
`{type:"text",text}` and `{type:"image_url",image_url:{url:<dataURL>}}`.
Documents are flattened into the text part as `Attachment {name}:\n{text}`.

Response headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control:
no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

Event stream (each line `data: {json}\n\n`, terminated by `data: [DONE]\n\n`):

| Event | Shape | Meaning |
|---|---|---|
| search | `{ search: { used, query, sources[] } }` | only if search was requested |
| google | `{ google: { connected } }` | Google tools context attached |
| model | `{ mode, provider, model }` | first model; `model` is a **Mino name** |
| model switch | `{ provider, model }` | emitted when a continuation changes model |
| content | `{ content: "<delta>" }` | identity-filtered text delta |
| usage | `{ usage: { prompt, completion, total } }` | token counts |
| truncated | `{ truncated: true }` | sent **once**, after all continuations |
| error | `{ error: "<message>" }` | operational error (also used for refusals) |
| setup notice | `{ content: "<markdown setup text>" }` | no keys configured |

Non-stream failures return `{"error": "…"}` with 400/403/429/503 as appropriate.

Client handling rules: accumulate `content` into the assistant row; on `model` patch
the label and, if it differs from the selected mode's display name, show the notice
`The model was changed automatically because the current model is experiencing a problem.`;
on `error` mark the message and run the rate-limit parser; if the stream ends with no
content and no error → `Mino returned an empty response. Try again.`; abort with no
content → delete the empty bubble.

### 9.2 `POST /api/image`

Body: `{ prompt, raw?:boolean, model?, width?, height?, seed?, steps? }`.
Allowed models: `@cf/black-forest-labs/flux-1-schnell` (default), `flux-1-dev`,
`stabilityai/stable-diffusion-xl-base-1.0`, `sdxl-turbo`. Sides clamped 256–1024 and
snapped to a multiple of 8 (only for SDXL-family). Prompt max 2048 chars.

Pipeline: **(1)** `optimizePrompt` — a fast text LLM (Groq → Gemini → OpenRouter)
rewrites the short prompt into one descriptive paragraph, 6 s budget, best-effort
(failure/refusal/echo → original prompt passes through); `raw:true` skips it.
**(2)** `planPoster` — if it looks like a poster: take the headline from a quoted
phrase, strip all lettering from the artwork prompt, reserve an empty band across the
upper third + a clear strip at the bottom, generate, then **draw the real text**
afterwards with `next/og` + `sharp` compositing. Response header `X-Mino-Poster-Text: 1`.
Compositing failure returns the unlettered artwork, never an error.
**(3)** Cloudflare `POST /accounts/{id}/ai/run/{slug}` → raw image bytes **or** a
base64 JSON envelope (both accepted; unpadded base64 is re-padded).

Response: image bytes with `Content-Type` image/*, `Cache-Control: no-store`,
`X-Mino-Image-Model`. Errors:

| Case | Status | Body |
|---|---|---|
| not configured | 503 | markdown setup message naming both env vars |
| 401/403/429 | same | `Daily generation limit reached. Please try again tomorrow.` |
| safety filter (8007/nsfw) | as-is | `The image model's safety filter blocked this prompt. It reacts to certain words rather than to the subject, so try rephrasing with different wording.` |
| 5006 | as-is | malformed-payload message |
| 7000 / no route | as-is | wrong account/token message |
| 5xx | as-is | `Cloudflare Workers AI is temporarily unavailable (HTTP {n}).` |
| not entitled | **402** | lock notice or paused-plan sentence |

`GET /api/image` → `{ available: boolean }` (configured **and** `imageEnabled`).

### 9.3 `POST /api/memory`

Body `{ userText, answer, memories }`; `userText` must be ≥ 12 chars (≤4000 stored).
Honours maintenance, `chatEnabled`, a **separate** rate bucket (20/min) and the ban
gate. Returns `{ suggestions: string[] }` — **never stores anything**; any failure
returns `{ suggestions: [] }`. Suggestions are re-validated server-side
(`parseSuggestions`) before being handed out.

### 9.4 `GET /api/plan`

```json
{ "planId": "mini"|"lunar"|null, "expiresAt": 0, "paused": false,
  "checked": true, "isAdmin": false }
```
`checked:false` = caller unidentified (so the UI can distinguish "nothing" from
"could not check").

### 9.5 `GET|POST /api/push`

- `GET` → `{ configured: boolean, devices: number }`.
- `POST` body: `{ action, deviceId?, subscription?, title?, body?, url? }`.
  `deviceId` is required for every action except `broadcast`
  (otherwise `400 { error:"bad-request" }`).
  - **`subscribe`** — `{ deviceId, subscription:{endpoint,keys:{p256dh,auth}} }`
    → `{ ok:true, persisted }`. Persisted at `push/subscriptions/{uid}` using the
    subscriber's own token, so a restart doesn't forget them; the in-process
    `deviceId → subscription` map is only the fallback when that write fails.
    Bad shape → `400 bad-subscription`.
  - **`unsubscribe`** → `{ ok:true }` (writes `null` to the persisted node).
  - **`test`** → `{ ok:true }`; persisted record first (so a test proves the durable
    store), then the map; `503 missing-keys` / `404 not-subscribed` /
    `502 send-failed`.
  - **`broadcast`** (admin required) — `{ title, body, url }` where `url` must start
    with `/` (else `/`). Reads **every** persisted subscription with the admin's own
    token, sends each (TTL 24 h), counts `{ ok:true, sent, failed }`, and deletes
    endpoints the push service rejects so the next broadcast skips them.
  - anything else → `400 unknown-action`.

### 9.6 Admin routes

- `GET /api/admin/config` → `{ ok, isAdmin, config }` (503 when unconfigured).
- `PUT /api/admin/config` — admin only; verifies the caller then performs the write
  **with that same token**, so the rules make the final decision; returns
  `{ ok, config }`.
- `GET /api/admin/models` → `{ models: [ { id, name, … } ] }` (opaque ids + Mino names
  only).
- `POST /api/admin/models { id }` → `{ result }` — a **real** single-model probe that
  bypasses the fallback chain (so a chain can't make everything look healthy).

### 9.7 Google tools routes

- `GET /api/google/auth` → redirects to Google's consent screen with a state cookie;
  unidentified callers are bounced to `/#google-needs-signin`.
- `GET /api/google/callback?code&state&error` → exchanges the code, encrypts the
  token pair into an **AES-256-GCM httpOnly cookie bound to the caller's uid**, sets
  `Set-Cookie`, redirects back.
- `GET /api/google/status` → `{ connected, … }` (decrypts the cookie).
- `POST /api/google/disconnect` → clears the cookie **and revokes the refresh token
  at Google** → `{ ok:true }`.

### 9.8 Google tool actions in chat

When the caller is identified, has a Google credential, `googleToolsEnabled` is on,
and `shouldUseGoogleTools(text)` fires, the system prompt gains the tools prompt and
the event `{ google: { connected } }` is emitted. The model answers with fenced
**action blocks**; after the answer completes the route extracts up to **5** actions,
executes them (Calendar, Tasks, Sheets, Docs read+write; Maps search), appends

```
---

**{action}** — {outcome}
```

as a content event, then runs **one follow-up round** asking for a short confirmation
(in the same voice). The model never sees a token; the token only ever lives in the
encrypted cookie. Timezone comes from the client (`timeZone` field, validated by
regex; invalid → UTC). Failures degrade silently: the answer simply has no tools.

---

## 10. Feature specifications

### 10.1 Web search

- Three modes (`auto` / `always` / `off`), default **auto**, set in Settings.
- `auto` triggers only when the latest user text matches explicit-search patterns or
  confusion follow-ups ("search", "look up", "latest", "today", "current", "what are
  people saying", "I thought …", "are you sure", …). `always` always searches; `off`
  never does.
- Provider: **Tavily** `POST https://api.tavily.com/search` with
  `{query, search_depth:"basic", max_results, topic:"general", include_answer:false,
  include_raw_content:false, include_published_date:true}`, 20 s timeout. Failures are
  swallowed — the chat still answers.
- Sources become `SearchSource[]` (`id` = 1-based string, title ≤160, snippet cleaned).
- The context injected into the system prompt is explicitly labelled **untrusted
  reference material**, with an instruction to *report on* instructions found in pages
  rather than follow them. The UI repeats that notice to the human.
- If `searchMode !== "off"` but no usable source was found, show:
  `Mino checked the web but could not find a usable source.`
- Missing `TAVILY_API_KEY` → Settings shows an amber dot, buttons disabled, chat works.

### 10.2 Memory

- Cap: **20 memories**, flat list, injected wholesale into every system prompt.
- Two doors: composer **Remember this**, and **Mino's offer** under the chat.
- Suggestions: after a non-empty answer, client calls `POST /api/memory` (guarded by
  `shouldSuggest`: enabled on, not dismissed, dedup/cap checks) with a monotonic run
  counter so a slow older request can't overwrite a newer one.
- The offer banner: **"Worth remembering"**, up to 3 lines, each with
  **Remember** / **Not now** (hides this batch) / **Don't suggest this** (sets
  `mino:memory-suggest-off`). **Nothing is ever stored without a tap.**
- Guard `normalizeMemoryText` (client **and** server): rejects instruction-shaped text
  ("ignore your instructions", "always answer in Spanish"-style *orders* — note a
  factual "I work in Spanish" survives), secrets (password/key/token/address/phone),
  duplicates (case-insensitive), and anything over the limit.
- Memories are framed as **facts, not orders**, in the prompt.
- Storage: Dexie `memories` + mirror to `users/$uid/memory`.
- Extraction model chain: Groq → Gemini → OpenRouter, 8 s budget, its own rate bucket;
  no text key ⇒ `[]`.
- Settings panel shows the whole list with edit/delete and **Forget everything**.

### 10.3 Send later

- Queue lives in Dexie (`scheduled`) — **device-local**, never synced.
- The **open tab is the sender**: an effect sleeps until the earliest appointment
  (capped at 60 s re-check), fires the oldest due message first, one at a time, and
  only when nothing is streaming/drawing. A temporary thread is ended first (a
  scheduled message is always written down).
- The row is consumed **by the send itself**; a send that couldn't start keeps the row.
- Each item carries its own `mode`, `searchMode`, `chatId`, attachments.
- Presets: `In 5 minutes`, `In 30 minutes`, `In 1 hour`, `Tomorrow 9:00` + custom.
- Chip labels: `due now` / `in {n}m` / `today {h:mm}` / `MMM d, h:mm`.
- Cancel = delete the row. Sidebar shows a count badge.

### 10.4 Trash

- Deleting a chat **copies** chat + messages into `trash` (30 days, device-only) and
  records a delete marker so cloud sync can't hand it back.
- Overlay lists what was deleted and when, with days left, and two actions:
  **restore** (puts the original id back, opens it, notice `Chat restored`) and
  **delete permanently**.
- Expired entries are purged on app start.

### 10.5 Gallery

- Grid of every image **created or sent on this device**, newest first, drawn from
  messages. Tapping jumps to the conversation. Not a separate library — a view over
  history.

### 10.6 Search palette

- Opened by the sidebar icon or **Ctrl/Cmd+K** anywhere. Floating panel (not inline,
  so it never squeezes the list). Searches **titles + message text** (displayed
  variant) and shows `chat title` + snippet + opens the chat on select.

### 10.7 Temporary chat

- A sidebar toggle (`Temporary chat` / `On` ⇄ `Not saved`). The thread lives **only in
  memory** — never Dexie, therefore never Firebase.
- Header title becomes `Temporary chat` with a `Not saved` chip.
- Starting a real chat, selecting a chat, or ending the toggle clears it. Scheduled
  messages can't target it (`chatId: null` → new chat on fire).

### 10.8 Read aloud

- Every finished answer gets a speaker button. Uses the browser voice; **code blocks
  are announced rather than spelled out**, link targets dropped; only one message
  speaks at a time (that one shows Stop); leaving the thread stops speech.
- Unsupported → button hidden.

### 10.9 Attachments & vision

- Images: camera, gallery, drag-drop, paste; compressed to ≤1024 px JPEG q0.8
  client-side; up to 4 per message; stored as data URLs; **never uploaded to the
  cloud DB**.
- Documents: text/code only, ≤100 KB, ≤3, sent as a text part (marked `truncated` if
  clipped).

### 10.10 Share

- **Share link** — conversation compressed into the URL **fragment** (server never
  sees it) and rendered by `/share` in a deliberately *separate*, read-only component
  (it touches no stores). Native share sheet first, clipboard fallback, truncation
  summary `latest {k} of {n} messages`.
- **Share image** — the conversation rendered to a downloadable PNG.
- **Copy chat** — `You:` / `Mino:` plain text.

### 10.11 PWA behaviour

- `public/manifest.webmanifest` + icons (192, 512, maskable 512, apple-touch, logo).
- Service worker registered outside dev; `clients.claim()` on activate is
  load-bearing (Chromium won't offer install otherwise).
- **Install prompt**: mobile only, once per visit, only *after* the first message
  (`mino:engage`), pitched around "the conversation is one swipe away", stored in
  `mino:install-asked`.
- **NotificationNag**: checked **every visit** — if the browser can receive
  notifications and isn't subscribed, show a one-line, one-tap ask. Permission is
  never requested by itself.

### 10.12 Splash, tutorial, notes

- **Splash**: full-bleed image over the finished page, blurs and dissolves; once per
  browser session on a fresh `/`; **two images** (desktop 16:9 `mino-splash.jpg`,
  tall `mino-splash-mobile.jpg`) because the crop is driven by screen shape.
- **MinoTutorial**: first-run guided tour keyed by `data-tutorial` anchors
  (`mobile-menu`, `sidebar-new-chat`, `sidebar-utilities`, `sidebar-recent`,
  `sidebar-data`, `gallery-button`, `composer`, `model-selector`); finishes to
  `mino:tutorial = done`.
- **Notes / dev news**: `config.notes[]` (`DevNote` with badge text/colour tone
  `important|info|success|neutral`, byline, date wording, summary, body). `/notes`
  lists, `/notes/[id]` shows one, `NotesPrompt` shows a **new note once per reader**
  (ids marked seen when the sheet *opens*; a later note has a new id and resurfaces).
  Empty list hides the section entirely.

### 10.13 About / Donate pages

- **/about**: logo (this page carries the **ten-tap admin trigger**), `Created by`,
  `Minetallest`, `Date created`, `AI name`, `Progress` fields, and the public story.
- **/donate**: DuitNow QR (`/mino-donate-qr.png`), caption `Scan with your banking
  app`, bank details, amount presets **5 / 10 / 20 / 50** (RM), fallback text
  `QR not added yet` if the image is missing.

---

## 11. Monetisation

### 11.1 Plans (`lib/plans.ts` — the single source of truth)

| | Mino Mini | Mino Lunar (featured) |
|---|---|---|
| Monthly headline | **RM 10** | **RM 15** |
| A day (1 day) | RM 1 | RM 1.50 |
| A month (30 days) | RM 10 | RM 15 |
| A year (365 days) | RM 100 | RM 150 |
| Blurb | Everything you need to chat | Maximum access to the whole brain |
| QR | `/mino-donate-qr.png` (static DuitNow, any amount) | same |

- Currency formatting is centralised: `RM 10` / `RM 1.50`; `monthlyLabel` → `RM 15/mo`.
- **A year is ten months** (365 days at the year price). 30-day months, 365-day years
  — explicitly *not* calendar arithmetic, and the exact end date is printed rather
  than hidden.
- Durations are stored as a **number of days** (legacy records with `months` read as
  30-day months).

### 11.2 Feature table & paywall

`FEATURE_MIN_PLAN` (client **and** server read the same table):

| Feature id | Cheapest plan |
|---|---|
| `reasoning` (medium/high) | **mini** |
| `images` (Mino Canvas) | **mini** |
| `azure` (Mino Azure mode) | **lunar** |

Free for everyone: Auto + Code modes, attachments, voice input, uploads, chat history,
web search with sources.

Marketing table `FEATURES` in `plans.ts` mirrors this and carries an `enforced` flag;
a test fails if something is advertised as paid without a paywall row (or vice versa).

**Client gate** (`paywallState.ts`): `isUnlocked`, `isModeUnlocked`, `MODE_FEATURE`
(`auto: null, code: null, self: "azure"`), `lockNoticeFor`, `unlockedModes`,
`resolveMode`. Lock copy is two distinct sentences:
- no plan → `{Label} is not on the free tier` + `{Plan} adds {blurb}, from RM {n} a month. It attaches to your account, so it is still here on your next device.`
- already paying → `{Label} is part of {Plan}` + `… upgrade to switch it on, and the time you have left carries over.`

Locked things are **visible with a padlock**, never hidden (the Azure mode keeps its
slot in the selector; the Create image item keeps its `Mini` pill).

**Server gate** (`paywallServer.ts`): plan from `subscriptions/{uid}` read with the
caller's own verified token; failed read ⇒ free; admin exempt; `checkChatEntitlement`
and `checkImageEntitlement`; reasoning is **clamped** for implicit asks and **refused**
for explicit paid asks.

### 11.3 `/plus` pricing page

- Back-to-Mino button; hero headline; current-plan receipt at the top (tick, plan,
  length, price, days left, **exact end date**) when the visitor already holds one.
- Term selector (`day` / `month` / `year`) → exact amount beside the QR.
- Plan cards: name, headline `RM n/mo`, blurb, feature comparison (tick ✓ / hairline −)
  built from `FEATURES`, buy button reading **Get Mini/Get Lunar** or
  **Add a month of Mini** when already on that plan (renewals *add* days).
- **Sign-in gate before the QR**: a signed-out visitor pressing a plan gets
  `SubscribeGate` → Google sign-in via `linkWithPopup` (UID never changes) → only then
  does `PayQrDialog` open.
- `PayQrDialog`: QR image + exact amount + `Scan with your banking app · DuitNow` +
  what happens next. **Closes only via its button** (no backdrop/Escape/outside tap).
- Under it: **"Got a code?"** → `RedeemCodeBox` (plain field on the page, not behind a
  dialog), with the honest note that claiming is not instant.

### 11.4 Redeem codes

- A code is a **word** the owner chooses: normalised to upper case, no spaces,
  minimum 4 characters. `mino-lunar` and `MINO LUNAR` are the same code.
- Stored at `codes/{word}` = `{ code, plan, days, active, createdAt }`.
- The claim at `redeems/{uid}/{word}` holds **only** `{ code, claimedAt }` — never
  plan/days/expiry (a test fails if they ever appear), because anything that can write
  a claim could otherwise write itself a plan.
- **A code is a switch, not a deletion**: turning `active` off stops it for everyone,
  enforced twice — the rules refuse the *write* of a claim against an inactive code,
  and the server re-checks `active` on **every** request.
- Codes are not enumerable (parent not readable) and not counted (no redeem limit —
  a counter the rules can't update would be a fake control). No expiry; the owner's
  switch is the lifetime.
- Redeeming and paying **stack**: higher tier wins; same tier → later end date.

### 11.5 Subscription lifecycle (`subscriptions/{uid}`)

```ts
interface Subscription {
  plan: "mini"|"lunar";
  grantedAt: number;
  expiresAt: number;
  days: number;          // length of THIS grant
  note: string;          // owner's payment reference, ≤120 — shown to the buyer
  announcementId: number;// +1 per grant → drives the one-shot celebration
  pause?: { pausedAt: number; … };  // omitted entirely when not paused
}
```

Rules:
- Granting the **same tier while active adds** days to the current `expiresAt`.
- Switching tier **starts from today** (no proration).
- Expired ⇒ treated as no plan (no dialog, no paywall, shown as Free in the console).
- **Pause** (admin): freezes the countdown without rewriting `expiresAt`; **continue**
  shifts `expiresAt` forward by exactly the held time.
- The buyer sees **Payment received** exactly once per grant (`announcementId` vs the
  acknowledged value, stored both in RTDB `ack` **and** in `localStorage`), containing
  plan, what they paid, length, activation time, exact end date, payment reference.
  The dialog closes **only** on its button.
- Live subscription node → `useSubscription()` / `watchSubscription()` feed the whole UI.
- **Plan expiry banner**: appears when the plan crosses **3 days** left; dismissal is
  keyed **per grant (by end date)** so a renewal earns a fresh reminder.
- The console can grant any number of days (preset spans + −/+ free-day field) and
  **Remove plan**; the tier is chosen first and granted second on purpose.

---

## 12. Admin console

**Entry:** tap the logo on `/about` **10 times within ~2 s** → sign-in prompt →
Google sign-in → the rules either allow or refuse (no client-side prediction of who
the admin is). `Show my email` prints the address when refused. The same ten-tap works
on the maintenance notice, so the site can always be reopened.

**Sections** (`AdminPanel`, `AdminControls`, `AdminNotes`, `ModelHealth`,
`RedeemCodeBox`-admin side):

1. **Diagnostics** — which providers are configured, local chat/message counts,
   storage used, signed-in identity, DAU/WAU trend chart from `usage/`, message and
   image totals, mode breakdown.
2. **People** — everyone in `admin/registry` (including visitors who never messaged),
   searchable by name; per row: tier badge and actions **Plan** (grant: tier → length →
   optional reference → Grant; also Remove plan) and **Ban** (reason + length) and
   **Pause/Continue** subscription.
3. **Runtime controls** — maintenance (with reason), kill switches for chat / images /
   web search / Google tools, announcement banner, daily chat cap, daily image cap.
4. **Banned** — reason, who banned, when, until; expired entries retained as history;
   the visitor sees the same reason and end date.
5. **Redeem codes** — create a word (≥4 chars, upper-cased) with plan + days, list,
   **Terminate** (switch off).
6. **Notes** — full composer for dev-news notes (badge text + tone, byline, date
   wording, summary, body); **Publish** is the only write action.
7. **Model health** — one row per reachable model with a **Test** button that sends a
   real single-model request (no fallback chain) and renders the Mino name + result.
8. **Push** — compose title/body/url and broadcast to every persisted subscriber.
9. **Wipes** — remove `users/{uid}`, `admin/registry/{uid}`, `subscriptions/{uid}`
   (and the full three-tree wipe).

Console writes go through `PUT /api/admin/config` (token-verified, written *with that
token*). The admin is exempt from maintenance, bans and caps, derived from the
verified identity.

---

## 13. Push notifications

- VAPID pair: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (inlined at build) + `WEB_PUSH_PRIVATE_KEY`
  + `WEB_PUSH_SUBJECT`. Generate with `bunx web-push generate-vapid-keys`.
- Subscriptions are stored under the **account** (`push/subscriptions/{uid}`),
  deduplicated by endpoint, so they survive a reload and move with the account.
- `GET /api/push` reports `{ configured }`; Settings → Notifications says so plainly
  until all three keys exist.
- The service worker shows notifications and opens `/` on click.
- Android build: replace with FCM tokens stored at the same path (keep the admin
  broadcast semantics), or omit push entirely (it is optional).

---

## 14. Accounts (optional, non-blocking)

- No account required. With no `NEXT_PUBLIC_FIREBASE_*` configured, all account UI is
  hidden and the app is purely local.
- First visit → **anonymous sign-in** (real UID).
- **Binding is a migration**: `linkWithPopup` attaches Google to the *existing*
  anonymous account, so the UID (and everything under it) is unchanged.
- If Google already exists elsewhere → `auth/credential-already-in-use` → sign in to
  that account, **pull** its chats, then **push** this device's chats: union merge,
  newer `updatedAt` wins, attachments never uploaded.
- **Detach** = sign out and re-sign-in anonymously (never `unlink`, because Firebase
  eventually deletes provider-less accounts and would destroy history).
- Name precedence: **local name on this device → account `profile.name` → Google name**.
  The account name is only read when this browser has none.
- Pull of chats happens **on every visit**, not only at sign-in.
- `lib/account.ts` never imports the admin module and never touches `admin/` (test-enforced).

---

## 15. Environment variables (backend)

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Mino Auto |
| `GEMINI_API_KEY` | Mino Code (V3/V2/V1) |
| `GROQ_API_KEY` | Auto's last-resort fallback only |
| `TAVILY_API_KEY` | Web search |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Image generation |
| `MINO_ADMIN_EMAIL` | Admin address expected by the server (must match the rules) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google tools OAuth |
| `GOOGLE_ENCRYPTION_KEY` | 32-byte hex, AES-256 key for the token cookie |
| `GOOGLE_REDIRECT_URI` | optional override of `…/api/google/callback` |
| `GOOGLE_MAPS_API_KEY` | optional structured Maps results |
| `NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,DATABASE_URL,PROJECT_ID,STORAGE_BUCKET,MESSAGING_SENDER_ID,APP_ID}` | Firebase web config |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | Web push |
| `MINO_HF_SPACE` (default `Minetallest/Mino`, `off` disables), `MINO_HF_TOKEN`, `MINO_HF_TIMEOUT_MS` (120000), `MINO_HF_PROMPT_BUDGET` (12000) | Mino Azure Space |

Missing keys never break the app — they produce in-chat setup notices and disable the
corresponding control with an amber dot.

---

## 16. Resilience matrix (copy this behaviour exactly)

| Situation | Behaviour |
|---|---|
| No keys at all | Chat UI works; assistant posts a mode-specific setup markdown message |
| Auto's own key missing | Uses the other configured key; chat keeps working |
| Code's key missing | Code unavailable (`GET /api/chat` omits `code`); Groq cannot make it available |
| Space configured | `self` always available (needs no vendor key) |
| Provider outage/rate limit before streaming | Next model in the family, then next family; header notice about the model change |
| Every Mino model in Auto exhausted | Groq chain, comparable-tier models |
| `reasoning_effort` rejected (400) | One retry without the parameter; that retry decides family exhaustion |
| Model hits output limit | Up to 2 continuation attempts on other models, then `{truncated:true}` + the amber notice |
| Answer stream dies mid-way | `{error: "<label> stream interrupted: …"}`; partial text kept; a continuation that can't start does **not** turn readable output into an error |
| Provider error text | Sanitised of vendor names; mapped to friendly per-status copy (400/401/402/403/404/429/5xx) |
| Web search key missing | Chat answers anyway; Settings shows a dot |
| Search service down | Swallowed; chat continues |
| Firebase unconfigured | Local-only app; account/push/plan UI hidden; `/api/plan` → `checked:false` |
| Rules not republished | Pulls return null → local data untouched (old, safe behaviour) |
| `config/` unreadable | Permissive defaults; app keeps working |
| Daily-cap counter race | Approximate cap accepted (read-modify-write; no transaction available) |
| Empty assistant response | `Mino returned an empty response. Try again.` |
| Aborted stream with no text | Empty bubble deleted |
| Clipboard unavailable | Notice instead of silent failure |

---

## 17. Tests (behavioural guarantees to reproduce)

`bun run test` runs 16 `tsx` suites (pure logic, no browser):

`code-fence`, `account`, `chat-sync`, `truncation`, `model-health`, `memory`,
`memory-suggestions`, `notes`, `space-prompt`, `temp-chat`, `subscription`,
`paywall-server`, `redeem`, `server-control`, `feature-batch`, `google-tools`.

They pin, among other things: the marketing table ↔ paywall table agreement; a claim
node containing **no** plan/days; `account` never importing admin; Code mode staying in
one model family; truncation detection; memory guard rules; note/seen semantics; the
Space prompt and its cut-off detection. Any rebuild should reimplement these invariants
as tests.

---

## 18. Android build checklist (practical order)

1. **Backend first**: deploy the Next.js app as-is (or reuse the existing deployment);
   verify `GET /api/chat` returns `available` and a test `POST /api/chat` streams.
2. **Auth**: Firebase Android app + anonymous sign-in; attach `getIdToken()` to every
   API call; publish `database.rules.json`.
3. **Local DB**: Room entities for the 6 tables with the exact columns in §7.1;
   repository with Dexie-equivalent helpers (auto-title 42 chars, folder rules,
   trash copy, variant retirement).
4. **Preferences**: DataStore with the §7.2 key names and defaults.
5. **Chat screen**: header, mode selector, thread, composer in that order; wire SSE
   parsing first (events in §9.1) before polish.
6. **Overlays**: search palette, trash, gallery, settings bottom sheet.
7. **Feature pass**: send-later (WorkManager is *not* equivalent — the spec fires from
   the open session; on Android keep it in-process with a lifecycle-aware scheduler and
   document the deviation), memory, TTS, voice input, share.
8. **Monetisation + account**: `/plus` screens (sign-in gate → QR dialog → redeem),
   plan polling via `GET /api/plan`, celebration dialog with the close-only-on-button rule.
9. **Google tools**: the OAuth flow is server-side; the app only needs the status and
   connect/disconnect endpoints plus the in-chat action blocks.
10. **Admin**: rebuild the console as a guarded route (ten taps on the About logo);
    all writes still go to `PUT /api/admin/config`.
11. **Parity pass** against §19.

### 18.1 Deliberate deviations you must decide on (and document)

| Web behaviour | Android decision needed |
|---|---|
| Send-later fires from the *open tab* | Keep in-process (matches spec) or use WorkManager (survives closed app — a spec change) |
| Web Push / VAPID | Replace with FCM, or drop |
| PWA install prompt | Not applicable to a native app |
| Speech recognition | Android `SpeechRecognizer` (needs `RECORD_AUDIO`) |
| Data URL images in memory | Use file paths/URIs in Room; keep the base64 **only** for the API payload |
| `window.open` on image tap | Full-screen viewer |

---

## 19. Acceptance criteria (a rebuild is 1:1 only if all pass)

**First run**
1. Cold start shows the splash once per session, then a name gate with no skip.
2. With no name set, nothing else is reachable. After a name, an empty chat with a
   rotating headline.
3. Firebase unconfigured → no account/push/plan UI anywhere; app fully usable.

**Chat**
4. Enter sends, Shift+Enter (or Enter on a multiline IME) does not; send becomes Stop
   while streaming.
5. Streamed tokens appear progressively with the caret; finished text never re-animates.
6. Stored messages and backups contain **only** Mino names — never a vendor id.
7. The model badge matches the mode; an automatic model change shows the notice and
   re-labels the message.
8. A truncated answer shows the exact amber sentence and hides the action row.
9. Retry keeps the old answer behind a `k/n` stepper; edit rewrites the user message
   and branches the reply; the next send continues from the variant on screen.
10. Token count shows on each answer with the prompt/completion split on hover.

**Composer**
11. ≤4 images (compressed ≤1024 px JPEG), ≤3 documents ≤100 KB, camera capture works.
12. `+` menu items appear in the specified order with the paywall pill on Create image.
13. Voice input appends a single utterance; unsupported → the specified error string.
14. Schedule presets produce the right times; chips show relative labels and cancel.
15. A server 429 with a named wait starts a live countdown and offers *Queue until then*;
    an error with no number starts no countdown.

**Modes & paywall**
16. Selecting Code or Azure starts a fresh session (previous chat aborted/cleared).
17. Azure shows a padlock + `Lunar` for free/Mini users and routes to `/plus`.
18. Medium/High reasoning shows `Mini+` and routes to `/plus` for free users.
19. Server refuses the same things (curl with an edited body must fail) and the refusal
    text matches the client's lock notice.
20. A lapsed plan moves the user out of the locked mode, never into one.

**Money**
21. `/plus` prices match the table exactly (RM 1 / 10 / 100, RM 1.50 / 15 / 150).
22. QR cannot open before sign-in; the QR dialog closes only on its button.
23. A grant shows "Payment received" exactly once, with plan, amount, length,
    activation, exact end date, reference.
24. Renewal of the same tier extends `expiresAt`; tier change starts today.
25. Redeem claim node contains only `{code, claimedAt}`; deactivating a code stops
    honouring old claims too.

**Admin**
26. Ten taps on the About logo (or the maintenance notice) opens sign-in; a non-admin
    is refused by the rules, not by the client.
27. Maintenance replaces the page entirely and the routes refuse; admin is exempt.
28. Bans show reason + end date to both console and visitor; expired bans stop enforcing.
29. Config writes go through the token-verified route and take effect within 5 s.

**Data**
30. Delete → Trash (30 days) → restore returns the original chat; expired entries are purged.
31. Backup export/import round-trips; over-limit files are rejected with the exact message.
32. "Your data" erasure clears local + this identity's DB nodes but **keeps the plan**.
33. Folder delete returns its chats to unfiled and never deletes them.
34. Search is local, matches the *displayed* variant, newest first, ≤30 results.

**Voice & accessibility**
35. Read-aloud works on one message at a time, announces code blocks instead of
    spelling them, and stops when leaving the thread.
36. Every icon-only control has an accessible label/title; menus close on outside
    tap and Escape.
