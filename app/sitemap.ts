import type { MetadataRoute } from "next";

// ── Sitemap ─────────────────────────────────────────────────────────────────
// Every page here is static and public. The API routes are deliberately absent:
// they are not crawlable, and listing them would advertise the deployment's
// control surface to anything that reads this file.
//
// The base URL comes from NEXT_PUBLIC_SITE_URL because a sitemap with relative
// or localhost entries is worse than none — a crawler that reads it would
// index a URL nobody can visit. When the variable is missing the entries fall
// back to a placeholder origin, which is wrong but harmless: the file is only
// fetched by a crawler, and a crawler that finds a placeholder will simply move
// on rather than penalise the site.
const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || "https://example.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/plus`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/notes`, lastModified, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/donate`, lastModified, changeFrequency: "monthly", priority: 0.4 },
    // /share and /notes/[id] are per-conversation and per-note, generated at
    // request time, so they cannot be enumerated here. They carry their own
    // canonical tags and are reached from the app, not from a crawl.
  ];
}
