# Mino — Vercel environment variables

The complete list of environment variables this app reads, and nothing it does not.
Every entry below was verified against the source (`grep process.env` across
`app/`, `lib/`, `components/` and the config files), so if a variable is not on
this page, the code does not use it.

**33 variables total** — 10 of them public (build-time) and 23 read on the server.
Ten are needed for the app to be usable at all; the rest each unlock one feature
and can be added later.

> ## ⚠️ Read this before you paste anything
>
> **Variables beginning `NEXT_PUBLIC_` are baked into the JavaScript bundle at
> build time.** Changing one in the Vercel dashboard does **nothing** until the
> next deploy. If you edit one, press **Redeploy** — otherwise you will spend an
> hour wondering why the change did not take.
>
> The other 23 are read on the server at request time, so those *do* apply
> immediately, no redeploy needed.

---

## Tier 1 — set these before the first deploy

Without these the site builds and loads, but nothing works: no accounts, no
cloud history, and every model returns "Mino isn't connected to a model yet."

### Firebase (7) — accounts, cloud history, admin console

Get these from the Firebase console → **Project settings → General → Your apps**
→ the web app (`</>` icon). If you have no web app yet, add one.

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | The *web* API key. Public by design — it identifies the project, not a user. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | e.g. `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Realtime Database URL. Both `firebaseio.com` and the newer `firebasedatabase.app` work. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | |

> **Also required, and not a Vercel variable:** publish `database.rules.json` to
> the Firebase console → **Realtime Database → Rules**. The app holds no service
> account, so the rules are the *only* thing enforcing access. Until they are
> published, chat sync and the paywall both silently fall back to local-only /
> free. Keep the address inside the rules matching `MINO_ADMIN_EMAIL` below.

### Model keys (3) — at least one is mandatory

Every mode falls back across these in order. Set one and you have a working
assistant; set all three and Auto gets genuinely resilient.

| Variable | Feeds | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Auto mode, first choice | |
| `GEMINI_API_KEY` | Auto fallback, **all of Code mode** | Code mode never crosses vendors — without this, Code mode cannot answer at all. |
| `GROQ_API_KEY` | Last-resort fallback | |

### Deployment (1)

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Your production origin, **no trailing slash**, e.g. `https://mino-ai.vercel.app`. Drives share previews, `sitemap.xml` and `robots.txt`. Without it Open Graph URLs resolve against `localhost` and every shared link renders with no image. |

### Administrator (1)

| Variable | Notes |
| --- | --- |
| `MINO_ADMIN_EMAIL` | The one address allowed into the admin console and exempt from the paywall. **Must exactly match** the address hard-coded in `database.rules.json` (`myrealmetvreal@gmail.com` in the committed copy) or every admin write is refused by the rules. |

---

## Tier 2 — add when you want the feature

Each block is independent. Skip one and only its own feature is unavailable —
the app shows a setup note rather than breaking.

### Web search (1)

| Variable | Where to get it |
| --- | --- |
| `TAVILY_API_KEY` | tavily.com — free tier is enough |

Powers the composer's Auto/On search and the source links under answers.

### Image generation (2)

| Variable | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → API Tokens. Needs `Workers AI → Read`. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → right-hand sidebar on any account page |

### Google tools — Calendar, Tasks, Sheets, Docs, Maps (5)

| Variable | Notes |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud console → Credentials → OAuth 2.0 Client ID (type: **Web application**) |
| `GOOGLE_CLIENT_SECRET` | Same screen |
| `GOOGLE_REDIRECT_URI` | **Must be exactly** `https://<your-domain>/api/google/callback`, and the identical URI must be listed in the Google OAuth client's *Authorized redirect URIs*. One character of mismatch = a silent failure. |
| `GOOGLE_ENCRYPTION_KEY` | Generate with `openssl rand -hex 32`. Encrypts the consent cookie at rest. Rotating it force-disconnects everyone — which is the intended way to revoke access. |
| `GOOGLE_MAPS_API_KEY` | Optional on its own: enables Maps directions **without** the full OAuth setup. Enable the *Maps JavaScript API* in Google Cloud. |

### Web Push (3) — all or nothing

The notification bell checks all three; if **any** is missing, push is simply
off and the bell does not appear. There is no partial state to debug.

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Generate the pair with `bunx web-push generate-vapid-keys` |
| `WEB_PUSH_PRIVATE_KEY` | The private half of the same pair |
| `WEB_PUSH_SUBJECT` | A contact for the push service: `mailto:you@example.com` or an `https:` URL |

### Mino Azure — the Gradio Space (4)

Serves Azure mode from Mino's own model instead of a vendor. Leave all four
empty and Azure mode shows "not available on this deployment" — which is the
correct state for most deployments.

| Variable | Notes |
| --- | --- |
| `MINO_HF_SPACE` | The Space id, e.g. `user/space-name` |
| `MINO_HF_TOKEN` | Hugging Face access token with read scope |
| `MINO_HF_TIMEOUT_MS` | Optional. Defaults to `120000` (2 min). Raise it if the Space cold-starts slowly. |
| `MINO_HF_PROMPT_BUDGET` | Optional. Defaults to `12000` chars of prompt. |

---

## Tier 3 — strongly recommended, both optional

### Shared rate limiting (2)

Without these the rate limiter runs **per instance**: it resets on every cold
start and does not add up across concurrent instances. That makes it a speed
bump, not a limit. Set both and every instance shares one counter, so "30
requests a minute" actually means 30.

Free tier at upstash.com is far more than enough.

| Variable |
| --- |
| `UPSTASH_REDIS_REST_URL` |
| `UPSTASH_REDIS_REST_TOKEN` |

### Error monitoring — Sentry (4)

Leave all four empty and Sentry is **inert**: the SDK initialises disabled,
makes no network calls, and the build is unchanged. Set the DSN and errors from
both browser and server start being reported, with conversation content
stripped before it leaves the machine.

The Sentry wrapper in `next.config.mjs` is also gated on the DSN, so a build
with no DSN skips source-map injection entirely — faster, and it will not
exhaust a small build machine.

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | From Sentry → Project → Settings → Client Keys (DSN) |
| `SENTRY_ORG` | Your Sentry org slug |
| `SENTRY_PROJECT` | The project slug |
| `SENTRY_AUTH_TOKEN` | For source-map upload at build time. Generate under Settings → Auth Tokens. **Sentry only** — never a Vercel-facing secret. |

---

## Copy-paste block

The 12 Tier 1 variables, ready to fill in:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
OPENROUTER_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
NEXT_PUBLIC_SITE_URL=
MINO_ADMIN_EMAIL=
```

In Vercel: **Project → Settings → Environment Variables**. Paste each as its own
row. Mark the four non-`NEXT_PUBLIC_` values in that block (`OPENROUTER_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, `MINO_ADMIN_EMAIL`) — and everything from
Tier 2 and 3 — as **Sensitive**, so they never appear in logs or the
deployment UI. The eight `NEXT_PUBLIC_` ones cannot be hidden: they ship in
the browser bundle by design, which is why none of them may be a secret.

---

## Plan limits worth knowing

`/api/chat` declares `maxDuration = 120`, `/api/image` declares `60`, and
`/api/memory` declares `20`. On a Vercel plan that caps function duration below
120 s, long generations will be cut off — the app recovers by handing the
partial answer to a second model, but if you see truncated replies on every long
answer, this is why.

---

## Nothing to set

`NODE_ENV` and `NEXT_RUNTIME` are read by the code but set automatically by
Vercel and Next.js. Do not add them.
