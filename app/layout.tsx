import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mino — AI Assistant by Minetallest",
  description:
    "Mino is a private, local-first AI assistant by Minetallest. Multi-model chat, vision, and image understanding — all stored in your browser.",
  icons: {
    icon: [
      // Uploaded brand logo (public/mino-logo.png) takes over once present.
      { url: "/mino-logo.png", type: "image/png" },
      // Built-in fallback so the tab icon is never empty.
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#7c7cf4"/><text x="16" y="22" font-family="Arial" font-size="17" font-weight="bold" fill="#0a0a0b" text-anchor="middle">M</text></svg>`
          ),
        type: "image/svg+xml",
      },
    ],
    apple: [{ url: "/mino-logo.png", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-[100dvh]">{children}</body>
    </html>
  );
}
