import * as Sentry from "@sentry/nextjs";

// ── Client-side error reporting ─────────────────────────────────────────────
// Inert without a DSN: every call below is a no-op when SENTRY_DSN is unset,
// so a deployment that has not set one pays nothing for having this file — no
// network calls, no bundle weight beyond the SDK, and no build failure.
//
// Mino had no monitoring at all, which meant the only way to learn a visitor's
// session was broken was for them to say so. The trade this sets up is the
// usual one for a chat product: enough context to reproduce a crash, without
// shipping the conversation itself. `beforeSend` strips anything that looks
// like message text, and `sendDefaultPii` stays off so IP addresses and user
// agents are not attached by default.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
// PII is off by default in this SDK version — there is no `sendDefaultPii`
// to set — so user addresses and conversation text stay out unless a hook
// below deliberately puts them there, and none does.
  // A chat stream is a long chain of small updates; a single thrown error in
  // the middle of one is one incident, not many. Breadcrumbs are kept short so
  // the trail still points at the cause rather than drowning it.
  maxBreadcrumbs: 50,
  tracesSampleRate: 0,
  beforeSend(event) {
    // Never let a user's conversation leave the browser inside an error
    // payload. Request bodies and extra context are dropped; the stack trace
    // and the route are what make an error fixable.
    if (event.request) delete event.request.data;
    if (event.extra) {
      delete event.extra.messages;
      delete event.extra.content;
      delete event.extra.prompt;
    }
    return event;
  },
});
