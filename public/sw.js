// ── Mino service worker ─────────────────────────────────────────────────────
// This exists so the site is installable as an app and opens something
// sensible when the network is gone. It is deliberately NOT a caching layer
// for the application itself.
//
// A service worker that caches build output is a stale-code bug waiting to
// happen: Next.js serves content-hashed chunks and long-lived immutable
// assets, so an old cache entry can survive a deploy and pair a new HTML
// document with an old JavaScript bundle. The failure is silent and looks
// like the app randomly breaking for a subset of visitors.
//
// So every request goes to the network first, and only the few files that
// make an installed app look and behave like an app are cached:
//
//   - the manifest and icons, so the installed shell still has its artwork
//   - the navigation fallback, used only when the network genuinely fails
//
// Streaming chat responses under /api are never touched at all. Intercepting
// an in-flight SSE stream is the fastest way to break replies, and there is
// nothing here worth caching about them.

const VERSION = "mino-shell-v2";
const SHELL_CACHE = VERSION;

// Only the artwork. The document and its JavaScript are always fetched fresh.
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/mino-logo.png",
];

const OFFLINE_DOCUMENT = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b1310" />
    <title>Mino</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        background: #060a08;
        color: #8ba396;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex; align-items: center; justify-content: center;
        text-align: center; padding: 2rem; letter-spacing: -0.01em;
      }
      img { width: 64px; height: 64px; object-fit: contain; margin-bottom: 1.25rem; }
      h1 { color: #eef5f0; font-size: 1.05rem; font-weight: 600; margin: 0 0 0.5rem; }
      p { margin: 0; font-size: 0.875rem; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div>
      <img src="/mino-logo.png" alt="" />
      <h1>You are offline</h1>
      <p>Mino needs a connection to answer.<br />Reopen the app when you are back online.</p>
    </div>
  </body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A missing icon must not fail the whole install, so each asset is
      // added individually and its absence is tolerated.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Notifications ──────────────────────────────────────────────────────────
// The only reason the push API is usable at all: a subscription is granted
// against a worker, and the worker is what actually displays the notification.
//
// The payload is allowed to be malformed — a push from a service we do not
// control is untrusted input — so every field falls back to something sensible
// and a body that is not JSON still produces a notification rather than a
// silent failure.
self.addEventListener("push", (event) => {
  let payload = { title: "Mino", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Plain-text push: show the text itself.
    try {
      if (event.data) payload.body = event.data.text();
    } catch {
      // Nothing readable in it; the default title still shows.
    }
  }

  event.waitUntil(
    self.registration.showNotification(String(payload.title || "Mino"), {
      body: String(payload.body || ""),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: String(payload.url || "/") },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus what is already open before opening a second copy: two Mino
        // tabs is two answers streaming at each other.
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow(url);
      })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Chat, image generation, and config are all live and must never be served
  // from a cache — a replayed answer or a stale key state is worse than an
  // error the user can see and retry.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations fall back to a small offline document when the network is
  // unreachable, so an installed app never shows a browser error page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => new Response(OFFLINE_DOCUMENT, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
    return;
  }

  // Everything else: network first, and only fall back to the cache for the
  // artwork this worker owns. Application code is never served from a cache.
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((hit) => hit ?? Response.error())
    )
  );
});