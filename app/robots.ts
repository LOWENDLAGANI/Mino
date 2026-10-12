import type { MetadataRoute } from "next";

// Generated rather than static so the sitemap's URL and the robots entry can
// never drift apart: both read the same environment variable, and a deployment
// on a custom domain produces a matching pair without anyone editing a file in
// /public. The static public/robots.txt remains as the fallback for hosts that
// do not run the App Router's metadata routes.
const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || "https://example.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: "/api/",
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
