import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Read from the CSS variables rather than hardcoded, so a colour used
        // by both themes follows the appearance instead of staying light on a
        // dark screen. Only opaque use of these is expected: an opacity
        // modifier cannot be applied to a variable Tailwind cannot parse.
        accent: "var(--accent)",
        "accent-dim": "color-mix(in srgb, var(--accent) 80%, #000000)",
        canvas: "var(--bg)",
        raised: "var(--bg-raised)",
        hover: "var(--bg-hover)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        "text-hi": "var(--text-hi)",
        "text-body": "var(--text)",
        "text-mid": "var(--text-mid)",
        "text-low": "var(--text-low)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.75)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.25s ease-out both",
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
        shimmer: "shimmer 1.8s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
