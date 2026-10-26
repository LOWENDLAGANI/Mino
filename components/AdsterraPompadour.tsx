import Script from "next/script";

/**
 * Adsterra Pompadour popunder ad — head script.
 *
 * The Adsterra dashboard gives a single script URL for the Pompadour format.
 * Adsterra's instructions say to paste it right before the closing </head> tag.
 * This component renders that script in the page <head> so it loads on every
 * route, and it renders nothing when the env var is absent.
 *
 * `data-cfasync="false"` is the value Adsterra's generated code carries; it
 * tells Cloudflare's optimizer not to async the tag, which some popunder
 * loaders need to open their window at the right moment.
 */
export default function AdsterraPompadour() {
  const src = process.env.NEXT_PUBLIC_ADSTERRA_POMPADOUR_SRC;

  if (!src) return null;

  return (
    <Script
      id="adsterra-pompadour"
      strategy="beforeInteractive"
      data-cfasync="false"
      src={src}
    />
  );
}
