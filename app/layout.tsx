import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mino — AI Assistant by Minetallest",
  description:
    "Mino is a private, local-first AI assistant by Minetallest. Multi-model chat, vision, and image understanding — all stored in your browser.",
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6366f1"/><text x="16" y="22" font-family="Arial" font-size="17" font-weight="bold" fill="white" text-anchor="middle">M</text></svg>`
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}
