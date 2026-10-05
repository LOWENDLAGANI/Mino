import type { Metadata, Viewport } from "next";
import ServiceWorker from "@/components/ServiceWorker";
import SubscriptionCelebration from "@/components/SubscriptionCelebration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mino — AI Assistant by Minetallest",
  description:
    "Mino is a private AI assistant by Minetallest. Multi-model chat, vision, image understanding, and image generation.",
  // Without a manifest and a service worker the site is not installable, and
  // without `standalone` the installed copy opens in a browser chrome frame
  // that looks like a website rather than an app.
  manifest: "/manifest.webmanifest",
  applicationName: "Mino",
  appleWebApp: {
    capable: true,
    title: "Mino",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      // Uploaded brand logo (public/mino-logo.png) takes over once present.
      { url: "/mino-logo.png", type: "image/png" },
      // Built-in fallback so the tab icon is never empty.
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1f4a33"/><text x="16" y="22" font-family="Arial" font-size="17" font-weight="bold" fill="#eceee7" text-anchor="middle">M</text></svg>`
          ),
        type: "image/svg+xml",
      },
    ],
    apple: [
      // A square icon with no transparency: iOS composites transparency as
      // black, which would put a black box behind the logo on the home screen.
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1310",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-[100dvh]">
        {children}
        {/* Mounted here rather than in one page, because a purchase is not tied
            to a screen: whoever is granted a plan must be told about it whether
            they are in the chat, on the pricing page, or reading this sentence. */}
        <SubscriptionCelebration />
        <ServiceWorker />
      </body>
    </html>
  );
}
