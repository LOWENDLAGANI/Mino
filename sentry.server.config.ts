import * as Sentry from "@sentry/nextjs";

// ── Server-side error reporting ─────────────────────────────────────────────
// Inert without a DSN, exactly like the client config. This is where the
// errors that actually matter will land: an API route failing is invisible to
// the visitor beyond a generic message, and serverless `console.error` is a
// void once the logs rotate. An exception here carries the route, the status,
// and the stack — never the request body, which would contain the
// conversation.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
// PII is off by default in this SDK version — there is no `sendDefaultPii`
// to set — so user addresses and conversation text stay out unless a hook
// below deliberately puts them there, and none does.
  tracesSampleRate: 0,
  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
    }
    if (event.extra) {
      delete event.extra.messages;
      delete event.extra.content;
      delete event.extra.prompt;
      delete event.extra.memories;
    }
    return event;
  },
});
