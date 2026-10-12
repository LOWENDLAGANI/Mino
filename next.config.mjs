import { withSentryConfig } from "@sentry/nextjs/config";

// ── Security headers ────────────────────────────────────────────────────────
// Applied to every response from one place rather than per route, so a new API
// route cannot forget them.
//
// The CSP is deliberately the permissive-but-bounded kind rather than a
// nonce-based one. Mino's own markup ships from 'self'; the restrictions that
// buy real safety here are the *boundaries*: nothing may be framed by a third
// party, no form may post anywhere unexpected, and the app may only talk to
// the two services it actually uses (its own origin, Firebase auth, and
// Firebase's database). An injected script from another origin is blocked
// outright; an injected inline script is not, which is the accepted trade
// until the artifact preview — an <iframe srcdoc> that inherits this policy and
// would break under 'strict-dynamic' — is served from a separate origin.
//
// Firebase's Realtime Database is reached over both https and wss, and newer
// projects use *.firebasedatabase.app rather than *.firebaseio.com, so both
// hosts are named. The Google sign-in popup needs accounts.google.com in
// frame-src and googleapis.com in script-src. Dropping any of these turns into
// a silent auth failure, which is exactly the kind of breakage that survives a
// code review.
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline' for scripts is required by Next's hydration bootstrap, and
  // for styles because the app sets inline style attributes from React.
  // googleapis.com is required for Google Sign-In and Google Tools (Calendar, Tasks, etc.)
  "script-src 'self' 'unsafe-inline' https://apis.google.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebaseio.com wss://*.firebasedatabase.app https://apis.google.com https://accounts.google.com",
  "frame-src 'self' https://accounts.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Only meaningful over https; browsers ignore it over http, so it is safe to
  // always send.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Camera and microphone are used by the composer (photo capture, voice
    // input) so they stay on for this origin only. Everything else the app has
    // no business asking for is switched off.
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Sentry wraps the config only when it is actually configured.
//
// This is a build-time switch, not a runtime one. The wrapper injects the
// client/server/edge config and rewrites every module for source maps, which
// roughly triples peak memory during `next build`. Doing that on every build —
// including the ones for a deployment that will never report an error — costs
// minutes and can exhaust a small build machine for nothing. So the wrapper is
// applied only when a DSN is present, which is exactly the condition under
// which reporting can happen at all.
//
// The consequence is worth stating plainly: with no DSN set, error reporting is
// off, and that is the whole point. With one set, the wrapper activates and
// stack traces resolve via uploaded source maps.
const sentryEnabled = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: !process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Uploaded as release artefacts rather than served from the app, so the
      // public bundle is unchanged.
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      widenClientFileUpload: true,
      hideSourceMaps: true,
      disableLogger: true,
    })
  : nextConfig;
