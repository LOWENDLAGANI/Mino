# Mino

A private, local-first AI assistant by **Minetallest**. Multi-model chat with vision, streaming responses, markdown rendering, automatic anonymous cloud history, and no account required.

Built with **Next.js 15 (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS**, and **Dexie.js**.

## Features

- **Zero-login persistence** — chats and messages live in the current browser’s IndexedDB via Dexie; when Firebase is configured they are also written to Realtime Database under the signed-in identity, and an account holder gets them back on any other browser they sign in from
- **Optional Google account** — Mino works with just a name. Binding a Google account from the welcome screen or Settings is a migration that keeps the same UID, so the chats and the name carry to another browser. It grants no administrator access and shares no code path with the console
- **Two modes** — **Mino Auto** routes every message to the best available model; **Mino Code** uses Mino V3, tuned for code and technical work. Each mode is powered by its own server-side API key, with automatic fallback if one is missing. Picking Code always opens a **separate session**, so a code conversation is never continued under a different model's answers.
- **Mino Azure** — Mino's own model, served from a Gradio Space on Hugging Face. It needs no vendor key, is never used to answer a Code question, and never silently replaces the model a user chose (see [Mino Azure](#mino-azure-the-gradio-space)). **It is part of Mino Lunar** — see [The paywall](#the-paywall)
- **Mino's own model names** — the product never shows a vendor or a vendor's version numbers. Users see **Mino V1**, **Mino V2**, and **Mino V3** (the oldest, middle, and newest model), and **Mino Auto** for the router. The wire-level provider names stay server-side.
- **Code you can copy** — in Code mode every file arrives as a code block labelled with its path (`` ```ts src/lib/thing.ts ``) and a **Copy** button, so it pastes straight into a local editor. The model is asked for complete files rather than fragments, because a partial file gives the reader no way to tell what was left out.
- **Secure API keys** — provider keys are only ever read server-side in the `/api/chat` Route Handler; the admin console holds no service-account credential at all
- **Strict persona** — the Mino system prompt is prepended server-side to *every* completion request and the client cannot bypass it. Because a prompt is an instruction rather than a guarantee, every streamed token is additionally passed through a server-side identity guard that rewrites *self-referential* vendor claims ("I am Gemini", "I was created by Google", "I'm powered by GPT-4") into Mino. The guard is deliberately scoped: vendor names in ordinary answers ("Gemini changed its pricing", "compare Gemini with Claude") are left untouched, so Mino never misattributes or confuses legitimate content
- **Multimodal** — attach images via the phone camera, file picker, drag-and-drop, or clipboard paste; compressed client-side on `<canvas>` (max 1024px, JPEG q0.8) before upload
- **Streaming** — real-time word-by-word responses over Server-Sent Events
- **Web search** — Mino stays off for general knowledge questions and searches when you explicitly request it or say an answer may be wrong, with source links shown in the response; the composer supports Auto, On, and Off modes
- **Markdown + code** — syntax-highlighted code blocks (Prism) with per-block copy button
- **Chat management** — pin and rename chats, retry/edit-and-resend, copy chats, source history, voice input, and text/code file attachments
- **Send later** — the composer's clock queues a message (five minutes, thirty, an hour, tomorrow morning, or any datetime) and this open tab fires it when the time comes, oldest first, under the mode and search setting it was written with; queued messages sit as cancellable chips above the composer
- **Rate limits you can see** — a server refusal is parsed for the wait it names and becomes a live countdown in the composer; *Queue until then* holds the message behind the wait and sends it when the wait lifts
- **Read aloud** — every finished answer has a speaker button that reads it in the browser's own voice; code blocks are announced rather than spelled out, link targets are dropped, and moving away stops the speech
- **Trash** — deleting a chat parks it for thirty days on the device (never synced), restorable or permanently deleted from the sidebar's toolbar, with expired entries dropped on start
- **Image gallery** — every image made or sent, in one grid behind the sidebar's icon, each jumping back to its conversation
- **Palette search** — the sidebar's search is an icon (or Ctrl/Cmd+K) opening a palette across chat titles and messages, instead of a section that takes over the rail
- **Token counts per message** — each answer shows what it cost, with the prompt/completion split on hover
- **Your data** — Settings → *Your data* exports a backup and erases everything — local tables, logged chats, usage, push subscriptions — behind a two-tap button that deliberately keeps the plan
- **Web push that survives a reload** — notification subscriptions are stored under the account rather than the tab, deduplicated by endpoint, and the console's **Push** button broadcasts to every persisted subscriber
- **Memory** — up to 20 short facts about you, sent with every request, written by you from the `+` menu or **offered** by Mino under the chat for you to approve. Always visible in Settings, always editable, and never extended by the model on its own (see [Memory](#memory))
- **Settings** — a single panel in the sidebar for web search mode, response length, reasoning effort (low/medium/high, default low), and dark/light appearance; the composer's `+` menu stays limited to per-message tools

## Getting started

```bash
bun install
bun run dev
```

Open http://localhost:3000. `bun run test` runs the unit tests.

### API keys

Mino has two modes, each with its own key. **The site never breaks if one (or both) is missing** — it shows a friendly notice in chat and falls back to whichever key exists.

Set either (or both) via `process.env` — locally in `.env.local`, or in Vercel → Settings → Environment Variables:

| Variable | Mode | Provider |
|---|---|---|
| `OPENROUTER_API_KEY` | **Mino Auto** | Universal routing that picks the best available model per message |
| `GEMINI_API_KEY` | **Mino Code** | Serves Mino V3 / V2 / V1 (Gemini 3.8 / 3.7 / 3.6) via the compatible endpoint |
| `GROQ_API_KEY` | **Fallback** | Last-resort provider used by Auto when no Mino model is available |
| `TAVILY_API_KEY` | **Web search** | Enables explicit web research and source links |
| `CLOUDFLARE_ACCOUNT_ID` | **Image generation** | Cloudflare account that hosts the Workers AI model |
| `CLOUDFLARE_API_TOKEN` | **Image generation** | API token with the *Workers AI: Read* permission |
| `MINO_ADMIN_EMAIL` | **Admin controls** | The administrator's address, matching the one in `database.rules.json` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **Web push** | Public half of the VAPID pair — inlined into the browser bundle at build, so it must be set *before* the deploy |
| `WEB_PUSH_PRIVATE_KEY` | **Web push** | Private half — read only inside `/api/push`, never reaches the browser |
| `WEB_PUSH_SUBJECT` | **Web push** | A `mailto:` (or `https:`) contact for the push service, e.g. `mailto:you@example.com` |

All three push keys are read from `process.env` like everything else, so on Vercel they live in **Settings → Environment Variables**: set all three and deploy. The two `WEB_PUSH_*` values are read at request time (changing them needs no rebuild), but `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is baked into the bundle during the build — add or change it *before* the deploy, or the browser half stays stale. Generate a pair with `bunx web-push generate-vapid-keys`. Until all three exist, `GET /api/push` reports `configured: false` and Settings → Notifications says so instead of pretending.

### Mino Azure (the Gradio Space)

Mino's own model lives on a Hugging Face Space behind Gradio and is offered to
users as a third mode, **Mino Azure**. It needs no vendor key at all, which is why
it is the only mode that still answers on a deployment with nothing else
configured.

| Variable | Purpose |
|---|---|
| `MINO_HF_SPACE` | Space id, e.g. `Minetallest/Mino`. Defaults to `Minetallest/Mino`. Set to `off` to remove Mino Azure from the deployment entirely |
| `MINO_HF_TOKEN` | Optional. A read-only Hugging Face token — needed for a private Space, and worth setting for a ZeroGPU one, because it draws on your own GPU quota instead of the small anonymous pool |
| `MINO_HF_TIMEOUT_MS` | Optional. How long one call may take before it is reported as a Space that stopped answering. Defaults to `120000` |
| `MINO_HF_PROMPT_BUDGET` | Optional. Characters of conversation sent to the Space. Defaults to `12000` |

To get a token: Hugging Face → **Settings → Access Tokens → Create new token**
(fine-grained, read-only). Nothing else is needed — the Space is public.

**How it is called.** `lib/gradioSpace.ts` is the only file that knows the Space
exists. The Space takes a single `prompt` string and answers with one finished
string rather than a token stream, so the conversation is flattened into a
transcript (`System: …` then `User:` / `Assistant:` turns) and the reply is handed
back shaped like an OpenAI SSE response. Everything downstream — the identity
filter, the truncation check, the fallback chain, the client — then behaves
exactly as it does for every other provider, with no special case anywhere else.

**Where it sits in the chain.** Self mode is the Space and nothing else: someone
who picked Mino's own model did not agree to be answered by a vendor if it is
down. Code mode excludes it entirely, because code written by a different model
family is a different answer. Auto reaches it last, as the one model guaranteed
to belong to the deployment.

**Three things the Space cannot do for itself**, all handled in the adapter:

- **It never reports a cut-off answer.** It caps its own generation and then
  claims it finished, so a reply stopped at the cap is indistinguishable from a
  complete one. The adapter reads the shape of the answer — an unclosed code
  fence, or a tail that cannot end a sentence — and emits the `length` finish
  reason, which is the signal the chat route already uses to mark a message
  truncated and say so in the thread. The test is deliberately narrow, because
  marking a finished answer as broken is the more expensive mistake.
- **A stalled feed never ends.** A ZeroGPU Space that is asleep queues the job
  behind the allocation, and a worker that dies simply closes the stream. Both
  are bounded by `MINO_HF_TIMEOUT_MS` and reported as a retryable message.
- **The prompt would overflow silently.** The transcript is budgeted, and a long
  thread loses its oldest turns rather than its newest question, with the loss
  stated in the prompt rather than hidden.

### Automatic Firebase logging

When Firebase is configured, Mino automatically signs in with a hidden anonymous identity and writes local chat text to that identity’s Realtime Database namespace. The Realtime Database rules grant that identity a read **only on its own `users/$uid` node**, so a client can pull its own history back — which is what makes a phone’s conversations appear on a computer signed in with the same Google account — while still being unable to read anybody else’s logs. Chats are merged as a union rather than a replace, and a deletion is recorded so a sync cannot resurrect it.

**Pulling requires one rule to be published.** `users/$uid/chats` grants `.read` to its owner alongside the write. A deployment that has not republished `database.rules.json` keeps the previous write-only behaviour, and `loadChatsFromAccount` returns null rather than emptying the local database — chats then stay on the device, which is the old, safe behaviour rather than a broken one.

To enable automatic logging:

1. Create a Firebase project, create a **Realtime Database**, and enable **Anonymous** under Authentication → Sign-in method. Enable **Google** there too if you want the optional account binding in **Settings → Account** to work; without it, Mino still works with a name alone and simply hides the option.
2. Add a Web app in Firebase and provide these variables in the Freebuff Keys/API keys UI or your deployment environment:

`NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_DATABASE_URL`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`

3. In Firebase Console → Realtime Database → Rules, paste the contents of `database.rules.json` and publish. The rules deny all reads of chat data and allow writes only under the signed-in user’s UID. The single exception is the administrator’s UID, which is also granted read and write so the console can work (see **Admin console**).

### Admin console

Clicking the Mino logo **on the About page** ten times within a couple of seconds opens a sign-in prompt. Signing in with the administrator's Google account opens a read-only console showing which providers are configured, local chat/message counts, storage used, the signed-in identity, and the list of visitors who have given Mino a name. It also draws the **DAU/WAU trend chart** from the per-visitor daily counters (`usage/`), with the message and image totals and the mode breakdown beside it, and a **Push** button that broadcasts an announcement to every persisted web-push subscriber.

**There is no PIN and no service account.** Access is granted by the Realtime Database rules themselves, which name a single Firebase Auth UID:

```json
"users": {
  ".read": "auth != null && auth.token.email === 'ADMIN_EMAIL'",
  ".write": "auth != null && auth.token.email === 'ADMIN_EMAIL'",
  "$uid": { ".write": "auth != null && auth.uid === $uid" }
}
```

Realtime Database rules cascade downward and cannot be revoked by deeper rules, so those two grants cover every chat of every visitor. Every other signed-in visitor matches no `.read` rule anywhere except on their own `users/$uid` node, which they alone can read. Firebase evaluates the condition on every read and write, so nothing in the client bundle is a security boundary — patching it would gain an attacker nothing.

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

A wiped user loses `users/{uid}`, `admin/registry/{uid}` and `subscriptions/{uid}`; a full wipe clears all three trees. `.validate` rules are not evaluated on delete, so neither operation is blocked by the schema checks.

## Subscriptions (Mino Mini and Mino Lunar)

**Mino is paid for by QR transfer, and the subscription is granted by hand.** There is no payment gateway and no webhook: a buyer sends RM 10 (Mini) or RM 15 (Lunar) to the DuitNow QR on `/plus`, the owner sees the money arrive, and the owner grants the plan from the admin console. `lib/plans.ts` holds both tiers — price, features, QR — and nothing else hardcodes them.

**You must be signed in before the QR opens.** A plan belongs to an *account*, not to a browser, so that it survives losing the device — which means `/plus` puts a Google sign-in in front of the payment QR. A signed-out browser that presses **Get Mini / Get Lunar** gets the sign-in gate first; a browser that has never sent a message, installed the app, or changed phones still finds the plan waiting, and the grant always lands on an identity that can be identified. The account is *bound* to the anonymous identity the browser already has (`linkWithPopup`), so the UID does not change and nothing already logged under it moves.

It is a requirement, not an upsell, and the pricing page says so before anyone presses the button. A deployment with no Firebase configured has no accounts and no database to record a grant in, so it takes no subscription at all and says why.

**How a grant is made.** In the admin console, under **People**, press **Plan** beside the person who paid, choose the tier, choose the length, optionally type the reference their banking app showed, and press **Grant**. The tier is chosen first and granted second on purpose: one button that grants whatever is highlighted is one stray tap away from selling the wrong tier. The same panel offers **Remove plan**, and each subscriber's tier is shown on their row.

The length is any number of days: the named spans the pricing page sells (a day, a week, a month, 3 months, a year) as buttons, plus −/+ and a free day count for the span nobody sells — somebody who paid for six weeks gets six weeks. It is deliberately not a calendar: a grant is a length, not a date.

The People list is everyone who has ever been here, **including people who have never sent a message** — the person you most often need to grant to is one who opened `/plus`, scanned the QR, transferred and left, and they exist only in `admin/registry`. Search by name with the field above the list.

## Durations and pricing

A subscription is stored as **a number of days**, which is the whole model. A day is now the shortest thing that can be bought, and storing "months" would have made that unrepresentable the moment anybody bought one.

| | A day | A month | A year |
|---|---|---|---|
| **Mino Mini** | RM 1 | RM 10 | RM 100 |
| **Mino Lunar** | RM 1.50 | RM 15 | RM 150 |

Prices live in `lib/plans.ts` as `terms` on each plan, and everything follows from them — the pricing page's length buttons, the amount printed next to the QR, the receipt in the success dialog, and the renewal sentence. The monthly price is a plan's headline (`ringgit`) and is what a renewal quotes.

Thirty-day months and 365-day years, not calendar arithmetic. A buyer who starts on the 31st loses a day, and that is stated on the button rather than hidden: the exact end date is printed on the pricing page and again in the dialog that follows the payment. A year is ten months, because nobody should have to be talked into one.

A subscription granted before durations existed carries `months` and no `days`; those records are read back as thirty-day months, which is exactly what they were granted as.

## The paywall

**The paywall is one table.** `FEATURE_MIN_PLAN` in `lib/paywallState.ts` maps each gated capability to the cheapest plan that opens it, and everything else is derived from it:

| Capability | Free | Mini | Lunar |
|---|---|---|---|
| Auto and Code modes, attachments, history, web search | ✓ | ✓ | ✓ |
| Advanced reasoning, image creation | — | ✓ | ✓ |
| **Mino Azure** — Mino's own model | — | — | ✓ |

Every row is something Mino actually does, and every row marked as paid is enforced in the route handlers. `FEATURES` in `lib/plans.ts` carries an `enforced` flag and a test refuses to let anything be sold as paid without a matching entry in the paywall — a row for a feature the product does not have is not marketing, it is something a buyer pays money to discover.

**Mino Azure is Lunar's.** Nobody on the free tier or on Mini can pick it. The mode stays *visible* in the selector with a padlock and what it would take — a mode that silently disappears is a question nobody asks out loud — and pressing it goes to the pricing page, so somebody locked out of Azure sees the whole table rather than a one-line refusal.

A lapsed plan leaves the user somewhere they can still write: if the stored preference is a mode this plan no longer opens, it is moved out of it (Auto is always open). It only ever moves them *out* of a locked mode, never into one.

### Enforced on the server

**The client gate is advisory; the route handler is the boundary.** `lib/paywallState.ts` decides what the page shows — the padlock, the sentence, where the button leads — and all of that runs on a device the person controls, so it is kept for the interface and trusted for nothing. The decision that counts is made in `lib/paywallServer.ts`, called from `app/api/chat/route.ts` and `app/api/image/route.ts`.

The rule is that the server never believes the client about money:

- **The plan comes from the database.** `lib/serverPlan.ts` reads `subscriptions/{uid}` and hands the route a plan or nothing. There is no code path that accepts a plan from the request body, a header, or a query string, so a caller who edits the bundle to claim Lunar gains nothing. A test fails if one ever appears.
- **Identity is the server's own.** The uid comes from `verifyCaller`, which checks the Firebase ID token with Google; the plan read forwards that same token, so `database.rules.json` judges it exactly as it would for the browser. There is still no service account, and reading somebody else's plan is refused by the rules rather than by a check here.
- **A failed read is no plan.** An unconfigured deployment, an unpublished rules file, or a database that is briefly unreachable all resolve to *free*, never to *allowed*. The one outage in which the paywall could be tested is not the one in which it disappears.
- **The administrator is exempt**, derived from the verified identity, so the person who grants plans can still see what they open.

Refusals name what is missing and where to go, reusing the wording the lock badge already shows, so the sentence in the chat is the sentence on the pricing page. Reasoning is the one setting that is **clamped** rather than refused when it was not explicitly asked for: Code mode defaults one notch above plain chat, and a free user's default is lowered to what their plan allows instead of the request being turned away. An *explicit* request for a paid setting is refused outright.

## Redeem codes

**A code is a word the owner chooses, carrying a plan and a length.** It is the piece that makes a hand-checked sale work at a distance: the buyer gets something they can hold onto and type themselves, instead of the owner copying dates into somebody's account over a phone call. Codes are made in the console's **Redeem codes** section, switched on and off there, and redeemed on `/plus` under *Got a code?*.

**The claim carries no plan.** This is the whole design. A claim node contains the code name and a timestamp and nothing else; the plan and the duration are read from the code record itself, by the server, at the moment the plan is enforced. If the claim said `plan: "lunar"` then anything able to write a claim could write itself a plan, and the enforcement above would be reading a value the visitor controls. So the visitor chooses a word and nothing more. `tests/redeem.test.ts` fails if `plan`, `days` or an expiry ever appear in a claim.

**A code is a switch, not a deletion.** Switching one off stops it for everyone — *including somebody who already claimed it*, because the server re-checks `active` on every request rather than trusting the claim to have been made while the code was on. That is what makes the console's *Terminate* mean what an owner expects it to mean, and it is why termination is enforced in two places:

- the rules refuse the **write** of a claim against a code that is off, so a modified client cannot claim one at all;
- the server re-checks on **every request**, so a claim made before the switch stops counting too.

One check without the other leaves a hole. Rules alone keep honouring claims made earlier; the server alone lets the claim be written and only refuses to honour it.

**Codes cannot be listed.** `codes/$code` is readable only by somebody signed in, and only when they already know the word — the parent is not readable, so there is no way to enumerate them. Words are normalized to upper case with no spaces, so `mino-lunar` and `MINO LUNAR` are one code rather than two a buyer can be given by mistake, and a word shorter than four characters is refused before it can be created.

**A code does not expire and is not counted.** Its whole lifetime is the owner's switch. There is deliberately no "redeemed N times" limit: counting would need a write to `codes/`, which the rules reserve for the administrator, and the deployment holds no service account to do it another way. A counter stuck at zero beside a console reading `0/1 used` would be a control that looks real and does nothing, and a "used up" refusal nothing could ever reach is worse than having no such state. One word, one shared plan, and **Terminate** the moment a word starts being resold — which is the moment that actually matters.

**Redeeming and paying stack.** A claimed code and a paid grant are combined rather than ranked against each other, and the **higher tier always wins** — somebody redeeming a Lunar code while holding Mini must not land back on Mini because Mini happens to run longer. Same tier takes the later end date, so a renewal adds to a buyer rather than replacing what they had.

## Visitor names

**What the buyer sees.** The grant writes `subscriptions/{uid}` — the node their browser is already subscribed to — so a tab that is open shows **Payment received** the moment it is written, with the plan, what they paid, how long it was for, when it was activated, the exact date it ends, and the payment reference. If they were not on the site, it is waiting on their next visit. **It is shown exactly once**, and afterwards it never appears again for that grant; a renewal is a new grant and is announced once in turn.

**The pricing page knows what you already have.** A visitor holding an active plan is shown it at the top with a tick and its full receipt — plan, length, price, days left, exact end date — and the plans they could move to are laid out underneath as an upgrade, listing exactly what each one adds. The buy button then reads *Add a month of Mini* rather than *Get Mini*, because buying the plan you already hold is how time gets added to it, and the days are added to what is left.

**The dialog closes only on its button.** No backdrop click, no Escape, no outside tap. This is the one screen somebody has to read, and an accidental dismissal is how someone misses that their money landed and waits a day to ask about it.

**Why the record lives outside `users/`.** The rules grant a visitor `.write` on their own `users/$uid` node so their chats can be logged, and a Realtime Database grant cannot be revoked by a deeper rule. A subscription stored there could therefore be written by the person it describes. `subscriptions/` is a separate top-level tree: the administrator reads and writes it, each visitor reads only their own record, and the single thing a visitor may write is `subscriptions/$uid/ack` — the number of the grant they have already been shown.

| Node | Read | Write |
|---|---|---|
| `subscriptions/$uid` | the owner **and** its owner | the owner only |
| `subscriptions/$uid/ack` | the owner | **its owner**, and the owner |

A grant carries an `announcementId` that goes up by one on every grant. The dialog is owed whenever that number is higher than the one the person has acknowledged — recorded in the database *and* in this browser's `localStorage`, so "after that don't show again" holds even on a deployment whose rules have not been republished, and on a second browser that has never seen the grant.

**Rules that must be published.** The `subscriptions` block in `database.rules.json`. Until it is, granting still works for the administrator but a visitor's read is refused, so nobody is shown a plan they have not been given, and the acknowledgement never lands.

**Expiry and renewal.** A grant lasts the number of days it was for. Granting the same tier again while it is still running **adds** to the date it already ends on, so a renewal never discards time that was paid for. Switching tier starts from today — there is no proration, and quietly carrying Mini's remaining days into a Lunar charge would invent a discount nobody agreed to. An expired grant is treated as no grant: no dialog, no paywall, and the person is shown as free in the console.

## Visitor names

On first visit Mino asks what to call you. The name is stored in that browser's `localStorage` only, so it is never asked again on the same device, and it is written to Realtime Database at `admin/registry/{uid}` alongside the first- and last-seen timestamps so the console can list visitors.

That registry is names and timestamps **only**. Logged chat text under `users/{uid}/chats` is read by the server-side admin API and by the browser **only on the visitor's own node**, so opening the console does not expose anyone's conversations to a visitor, and no visitor can read another visitor's.

Note that `admin/registry` is readable by the administrator through the console; ordinary visitors can write their own entry but cannot read the node.

## Accounts (optional)

**Using Mino requires no account, and that has not changed.** A name and a chat history in your own browser is a complete Mino. Google sign-in is a second door, never a condition of entry.

**Where to use it.** The welcome screen offers “Continue with Google” under the name field, and **Settings → Account** has the same action at any time. A deployment with no `NEXT_PUBLIC_FIREBASE_*` values hides both — a button that cannot work is worse than an absence nobody misses.

**Binding is a migration, not a copy.** Mino signs every first-time visitor in anonymously, which creates a real Firebase account with a UID. Binding calls `linkWithPopup`, which attaches the Google credential to *that* account rather than creating a new one, so **the UID does not change**. Everything already logged under it — the chats, the registry entry — stays exactly where it is. No chat is moved, re-uploaded, or duplicated, and the migration cannot half-finish, because there is no transfer to interrupt.

**If the account already exists elsewhere**, `linkWithPopup` is refused with `auth/credential-already-in-use`. That is not a dead end: Mino signs into the existing account instead, pulls that account's chats into this browser, and then writes this device's own chats up onto it. The merge is a **union**, never a replace — either device can hold conversations the other has never seen, and a replace would silently delete one of them. Where the same message exists on both sides the newer `updatedAt` wins, and attachments (images, documents, generated images) are never uploaded at all, so the copy that has them is the only copy that keeps them.

**Detaching** signs out and back in anonymously, rather than unlinking the Google provider. Firebase deletes an account that has had no sign-in provider for a while, so unlinking the only one would quietly discard the history. Detaching leaves the account intact for the next browser that signs into it.

**The name and the chats both follow you.** The name is written to `users/{uid}/profile`, a node the owner alone can read, so signing in on a new browser greets you by the name you already chose instead of asking again. The chats are read back from `users/{uid}/chats`, which the owner can read alone, and the pull runs on **every** visit rather than only at sign-in — so a phone that wrote history while the computer was closed hands it over the next time the computer is opened. Precedence is fixed and deliberate: **a name typed on this device always wins**, then the account's saved name, and only then the name Google holds. That last one is the only name Mino never asked you for, so it is the one least entitled to represent you.

That profile node needs **one extra rule published** — a read on `users/$uid/profile` for its owner — before cross-browser names work. Until then, and on any failure, Mino falls back to the local name and says nothing. Binding itself does not depend on it.

**This is not the administrator's account.** The console is reached by tapping the logo ten times, and the two share nothing but the Firebase project. Binding grants a token and nothing else: elevation is decided entirely by `database.rules.json` naming one address, so there is no client-side copy of who the administrator is and no sign-in path from this feature to the console — including for the person who owns it. `lib/account.ts` never imports `lib/firebaseAdmin.ts` and never touches `admin/`, which a test enforces.

The browser creates a hidden anonymous Firebase session and logs chat titles, text, model metadata, and sources. Images and document contents stay in the local Dexie cache because base64 image payloads can make database writes unnecessarily large. Clearing local data does not load or restore chats from the database; use the Firebase console if you need to remove logged data.

Get keys from the providers linked in your deployment environment. The product UI only ever shows Mino names — Mino Auto, Mino V1, Mino V2, Mino V3 — and never a provider or a provider's version number.

Resilience behavior:
- **Mino Code is single-family.** Every automatic fallback stays inside the Mino V3 → V2 → V1 chain. OpenRouter and Groq are excluded from its chain entirely: a code answer produced by a different model family is a different answer, so a clear error is better than silently changing families mid-task. The `GROQ_API_KEY` fallback therefore applies to Auto only, and `GET /api/chat` no longer reports Code as available on the strength of a Groq key.
- Auto mode's requested key missing → Mino uses the other configured key; the chat keeps working.
- Provider outage or rate limit before streaming starts → Mino retries the stable Mino V2 and Mino V1 fallbacks, then the other configured route as needed, with a small automatic model-change notice in the chat header.
- Auto mode, every Mino model exhausted → Mino falls back to the Groq provider (`GROQ_API_KEY`) with its own quota, so a capacity outage on the primary route does not break the chat. Its fallback models are all comparable-tier rather than progressively weaker, because a last line of defence should still be worth reading.
- Model rejects the chosen reasoning effort → the same request is retried once without `reasoning_effort` before that provider is given up on, so an unsupported value can never take a conversation down.
- All providers unavailable → the conversation shows the provider name, HTTP status, and a safe diagnostic instead of the generic “Mino hit an error” message.
- No keys at all → chat UI still works and displays a setup notice in the conversation instead of an error page.
- Web search key missing → Mino keeps answering without web context and the composer shows a setup state instead of failing the chat.

## Deploying to Vercel

Environment variables live in **Vercel → Settings → Environment Variables** for the project, and the app reads every one of them from `process.env` — the provider keys, the Firebase config, and the three Web push keys above. Set them all before the first deploy; the `NEXT_PUBLIC_*` values are inlined at build time, so changing one requires a redeploy rather than a restart.

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

The console can change how the live site behaves without a redeploy: **maintenance mode**, kill switches for chat, image generation and web search; an announcement banner shown to every visitor; daily per-device caps on messages and images; and banning a device, with a reason and a length.

**Maintenance mode** replaces every page with a notice carrying a reason you write, and the routes refuse every request, so it holds for a modified client as well as the page. The administrator is deliberately exempt — otherwise the switch would lock its own owner out and there would be no way back. To get in during maintenance: **tap the logo on the notice ten times** and sign in with Google; the console opens over the notice and the switch is turned off from there. The logo is the only thing on the screen that does anything, which is the point.

**A ban is a record, not just a refusal.** Banning a device asks for a reason and a length — permanent, or a number of days that expires by itself — and keeps who banned it, when, and until when. The console shows all of it under **Banned**, expired entries kept as the history of what was decided rather than deleted the moment they lift. The visitor who is refused reads the same reason and the same end date, because a refusal nobody can interpret is how a mistaken ban turns into a support problem. The administrator is exempt from their own list, exactly as from maintenance mode. Bans made before reasons and lengths existed are read as permanent bans with no reason, so an existing deployment keeps every ban it had with no migration.

**These are enforced on the server, not in the browser.** `/api/chat` and `/api/image` read the settings on every request and refuse before any provider is called, so the switches hold even for someone running a modified bundle. That works without giving the deployment a service account:

- `config/` has a **public read**, which is what lets a route handler read the settings with no credential at all. The page also asks the server whether it is the administrator, so the maintenance notice is never shown to the person who can lift it.
- Writing `config/` is refused to everyone except the administrator's address, and the console's save goes through `/api/admin/config`, which verifies the caller's Firebase ID token and then performs the write *with that same token* — so `database.rules.json` makes the final decision, not the route.
- `MINO_ADMIN_EMAIL` tells the server which address to expect. It must match the address in the rules, and a mismatch surfaces as a refused write rather than a silent success.

After changing the rules in `database.rules.json`, **publish them in the Firebase console** (Realtime Database → Rules), or the server will keep reading the old permissions.

Two limits worth knowing:

- **Configuring a ban or a cap makes identity mandatory.** The identity checks read `if (identity && ...)`, which on its own would mean a caller who simply omits the `Authorization` header has no identity, skips every check, and is waved through — turning both controls into decoration removable with one header. So once either is configured, a caller that cannot be identified is refused. With no ban in force and no cap set, anonymous callers are allowed as before. Only bans still in force count: one that has expired stops enforcing and stops demanding identification, and the administrator is exempt from the ban list, derived from the verified identity like every other decision here.
- **Caps are approximate.** Each request reads the counter and writes it back, which two simultaneous requests can race on, so a burst can exceed the cap slightly. Closing that needs a transaction the REST API cannot express, and an approximate cap is a better trade than no cap.
- **A cap is per device, not per person.** It follows the anonymous Firebase identity in that browser, so clearing site data or using a private window starts a new allowance.
- **Today's counters are shown in the console**, per visitor and in total. They are the numbers the caps are counted against, so they are also the quickest way to see that the caps are counting at all rather than silently doing nothing.

If `config/` cannot be read, every default is permissive: the app keeps working rather than locking everyone out.

### Rate limiting

Both routes are limited per minute — 30 messages, 8 images — keyed by the verified uid where there is one and by the forwarded client address otherwise. This is the backstop for the case the per-device caps cannot cover: with no ban list and no cap configured, anyone can post and spend the deployment's provider quota, and the attacker controls their own device, so a device-scoped control would not help. It is in-process and therefore per instance, which is enough to blunt a casual flood and not enough to stop a determined one; making it exact needs a shared store this project does not have.

**The client counts it down.** The composer reads the wait out of the server's own refusal message ("Please wait 12s and try again") and shows it as seconds ticking down, holding the send button until the wait expires; *Queue until then* files the message behind the wait and sends it when it lifts. The number is never guessed locally — an error with no named wait in it starts no countdown at all.

### Untrusted content

Search excerpts are third-party text and are injected into the system prompt, so the prompt labels them as untrusted reference material and instructs the model to report on instructions found in a page rather than follow them. This reduces the risk of prompt injection; it does not eliminate it, because no prompt-level defence is a guarantee.

**The reader is told which part came from the web.** An answer built on search sources carries a visible notice that page text is untrusted input — shown under the sources in the thread and again in the source history — so nobody has to take the prompt's word for which sentences arrived from somebody else's page.

## Memory

Mino remembers up to **20 short facts** about you and sends them with every request, so an answer knows who it is answering without you re-explaining. The list is a flat document, not a retrieval index: the whole thing goes into the system prompt, which is why twenty is a hard cap — past that, stale entries start contradicting each other and the list itself becomes the reason an answer is wrong.

**You can write one.** The composer's `+` menu has **Remember this**, and Settings → **What Mino remembers** lists, edits, and deletes everything.

**Mino can also offer one.** After an answer, a small *Worth remembering* banner appears under the chat with up to three facts a model noticed in the exchange. Nothing is written until you tap **Remember**; **Not now** hides that batch and **Don't suggest this** stops Mino asking on this browser. The setting is off in one place — the checkbox in Settings.

The division is the whole design. A model is good at noticing that someone shipping a Next.js app in March said so in passing; it is bad at knowing whether they meant it. Let it store what it infers and you get memories you never held, applied without question. So the model reads and the user decides, and both paths write through the same guard:

- **Nothing is stored unprompted.** A suggestion is offered, never applied.
- **Instruction-shaped text is refused** by `normalizeMemoryText` — at the server too, not only in the page — because a memory is the one piece of user text that lands inside the system prompt, where the user cannot override it. "Always answer in Spanish" is a legitimate memory and survives; "ignore your instructions" is not a fact about anybody.
- **No secrets, no inference.** The extractor is instructed to return nothing it did not hear, and to treat a password, key, token, address, or phone number as not worth keeping.
- **Duplicate facts are refused**, case-insensitively, before you are even asked.
- **The list is always visible and always editable**, and *Forget everything* wipes it on every device.

Extraction runs **after** the answer is on screen, on the small models (`lib/memoryExtractor.ts`, Groq → Gemini → OpenRouter in that order), with an 8-second budget and its own rate-limit bucket so it can never spend a message's allowance or delay an answer. If no text key is configured, or every call fails, it resolves to no suggestions — which is the correct answer to all of those.

Memories are stored in Dexie and mirrored to `users/$uid/memory`, so they follow the account once `database.rules.json` is published. Until then they are local to the browser.

## Branding

Drop a transparent-background logo at `public/mino-logo.png`. Every brand mark in the app (sidebar header, top bar, empty state, message avatars, quick tour) renders that file, and the browser tab / Apple touch icon use it too. The path is configurable through the `src` prop on `components/MinoMark.tsx`; if the file is missing or fails to load, the app falls back to the built-in sparkle mark so nothing ever renders broken.

## Project structure

```
app/
  api/chat/route.ts    # SSE streaming proxy with server-side keys, web search, and Mino persona
  api/image/route.ts   # Cloudflare Workers AI image generation with a server-side token
  api/memory/route.ts  # Proposes durable facts from one exchange; stores nothing
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
  MemoryPanel.tsx      # What Mino remembers: list, edit, wipe, suggestion toggle
  MemorySuggestions.tsx  # The "Worth remembering" offer under the chat
  AdminGate.tsx        # Ten-tap logo trigger and administrator sign-in
  AdminPanel.tsx       # Diagnostics console: people, chats, messages, wipes
  about/page.tsx       # Public About page: logo, creator, date, progress
  MinoMark.tsx         # Brand mark (renders /public/mino-logo.png with SVG fallback)
  ModelSelector.tsx    # Navbar model dropdown
  Markdown.tsx         # react-markdown + Prism + copy buttonlib/
  db.ts                # Dexie schema, chat/message ops, backup, persona prompt
  imageUtils.ts        # Canvas compression (1024px, JPEG q0.8)
  models.ts            # Model catalog + token estimator
  gradioSpace.ts       # Server only: the one file that talks to Mino's Gradio Space
  webSearch.ts         # Server-side current-web search and source formatting
  appConfig.ts         # Runtime control settings, shared by client and server
  serverControl.ts     # Server-side enforcement: config read, token verify, usage
  promptOptimizer.ts   # Stage 1: rewrites user text into a descriptive image prompt
  memory.ts            # Memory model: limits, injection guard, prompt rendering, Dexie CRUD
  memorySuggestions.ts # Suggestion parsing, gating, and the /api/memory fetch
  memoryExtractor.ts   # Server only: asks a small model which facts an exchange revealed
  posterText.ts        # Poster detection, headline extraction, text-free artwork prompt
  posterRender.tsx     # Draws the real headline over the artwork (next/og + sharp)
  imageGeneration.ts   # Client helper for the Cloudflare Workers AI image route
  firebaseHistory.ts   # Two-way chat sync, memory sync, visitor profile writes
  firebaseAdmin.ts     # Rules-gated admin reads and wipes, plus admin sign-in
  visitorName.ts       # Local display name storage
  useAdminTaps.ts      # Ten-tap gesture shared by the header and sidebar logos
  settings.ts          # Local response, instruction, and appearance preferences
  types.ts             # Shared TypeScript types
database.rules.json    # Realtime Database rules for anonymous-user isolation and the admin UID
```

## Privacy

Conversations and attachments are loaded only from the current browser’s IndexedDB. If Firebase logging is configured, chat text and metadata are also written to the signed-in anonymous device identity, but the database is not read by the app. No account or email is required. When web search is enabled, the current question is sent to the search service to retrieve source context for that request.

**The eraser is in Settings → *Your data*.** It clears everything the browser holds — chats, messages, folders, memories, queued schedules, trash — and removes this identity's nodes from the database (chat history, visitor registry, usage counters, push subscriptions) with the visitor's own token, so no credential and no administrator are involved. One thing it deliberately keeps: the subscription, because a paid plan belongs to the person rather than to the chat history. Ordinary deletions are gentler: a deleted chat goes to **Trash** first and stays recoverable on that device for thirty days.

## Dependency hygiene

`bun audit` is clean. The 14.x line carried a long tail of advisories — two of them critical — most of which applied to features Mino does not use, since there is no middleware, no `next/image`, no Server Actions and no rewrites. Two did apply: denial of service through App Router server components, and cache poisoning in RSC responses. Mino now runs the maintained 15.5 backport line rather than waiting for those to age out.

`postcss` and `prismjs` are pinned by `overrides`, because they arrive as transitives of Next and the syntax highlighter at versions with published advisories. Both are build-time or render-time libraries rather than reachable server surface, but there is no reason to carry a known advisory in a public beta.
