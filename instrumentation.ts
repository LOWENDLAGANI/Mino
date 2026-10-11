import * as Sentry from "@sentry/nextjs";

// ── Runtime instrumentation ─────────────────────────────────────────────────
// Next.js calls this once per runtime (Node and Edge) before anything else
// runs, which is the only place server-side Sentry can be initialised early
// enough to catch a startup failure. The `onRequestError` hook is what turns
// an unhandled Route Handler exception into a report rather than a 500 with
// no trace attached to it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
