import * as Sentry from "@sentry/nextjs";

// ── Edge runtime error reporting ────────────────────────────────────────────
// Inert without a DSN, like its siblings. The edge runtime is where Next
// executes middleware; there is none in Mino today, so this file exists to
// keep the instrumentation's import from throwing if one is ever added, and
// to hold the same no-PII policy if it is.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
// PII is off by default in this SDK version — there is no `sendDefaultPii`
// to set — so user addresses and conversation text stay out unless a hook
// below deliberately puts them there, and none does.
  tracesSampleRate: 0,
});
