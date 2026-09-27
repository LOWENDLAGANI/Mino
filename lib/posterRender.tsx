// ── Mino poster text rendering ───────────────────────────────────────────────
// Draws real words over generated artwork. See lib/posterText.ts for why the
// image model is never asked to spell anything.
//
// The renderer is `next/og`, which bundles its own font file. That matters:
// sharp renders SVG text through the host's fontconfig, and a host with no
// fonts installed silently produces a blank image with a success status —
// which is exactly the failure this approach exists to avoid. `next/og` carries
// its own font, so the result does not depend on what is installed on Vercel.

import { ImageResponse } from "next/og";
import sharp from "sharp";

/** Keeps the words off the very edge on a phone-sized image. */
const MARGIN_RATIO = 0.07;

/**
 * Wraps a headline so long words cannot overflow the width.
 *
 * Satori measures text but does not break words for us, and a single long word
 * at a large font size silently overflows the canvas and gets clipped.
 */
function wrapWords(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    // A single word too long for a line is hard-split rather than clipped.
    if (word.length > maxCharsPerLine) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxCharsPerLine) {
        lines.push(word.slice(i, i + maxCharsPerLine));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Picks a font size that fits the headline into the reserved band.
 *
 * Estimated from character count rather than measured, because the exact glyph
 * widths are not known until satori lays the text out.
 *
 * The size is searched from large to small and stops at `minSize`, which is
 * still comfortably readable. Shrinking below that to make a long headline fit
 * on one or two lines is the wrong trade — the poster just looks empty and the
 * words cannot be read, which is the exact problem this module exists to solve.
 * A long headline is allowed to use more lines instead.
 */
function fitHeadline(text: string, width: number, bandHeight: number): { size: number; lines: string[] } {
  const usableWidth = width * (1 - MARGIN_RATIO * 2);
  const maxSize = Math.round(width * 0.085);
  const minSize = Math.max(18, Math.round(width * 0.035));
  const lineHeight = 1.12;

  // Widest a line may be, expressed in characters at the current size. A
  // character is about 0.52em wide in a bold sans face.
  const charsAt = (size: number) => Math.max(6, Math.floor(usableWidth / (size * 0.52)));
  const fits = (size: number) => {
    const lines = wrapWords(text, charsAt(size));
    const needed = lines.length * size * lineHeight;
    return needed <= bandHeight ? { lines } : null;
  };

  for (let size = maxSize; size > minSize; size -= 2) {
    const attempt = fits(size);
    if (attempt) return { size, lines: attempt.lines };
  }
  // Nothing fit: use the minimum size and let it wrap to as many lines as the
  // band can physically hold, which the renderer will lay out without clipping.
  return { size: minSize, lines: wrapWords(text, charsAt(minSize)) };
}

/** Renders the headline/subhead as a transparent RGBA layer. */
async function renderTextLayer(
  width: number,
  height: number,
  headline: string,
  subhead: string
): Promise<Buffer> {
  const bandHeight = Math.round(height * 0.3);
  const { size, lines } = fitHeadline(headline, width, bandHeight);
  const subSize = Math.max(11, Math.round(size * 0.42));
  const subLines = subhead ? wrapWords(subhead, Math.max(10, Math.floor((width * 0.8) / (subSize * 0.55)))) : [];

  const layer = await new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          width: "100%",
          height: "100%",
          background: "transparent",
          paddingTop: Math.round(height * 0.06),
          paddingLeft: Math.round(width * MARGIN_RATIO),
          paddingRight: Math.round(width * MARGIN_RATIO),
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            fontSize: size,
            fontWeight: 800,
            color: "#ffffff",
            lineHeight: 1.12,
            textAlign: "center",
            // A soft shadow so white text stays readable over a light
            // artwork, which the model picks without being told to.
            textShadow: "0 2px 12px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.9)",
          }}
        >
          {lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
        {subLines.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: Math.round(height * 0.02),
              fontSize: subSize,
              fontWeight: 600,
              color: "#f2f2f7",
              lineHeight: 1.25,
              textAlign: "center",
              textShadow: "0 1px 8px rgba(0,0,0,0.9)",
            }}
          >
            {subLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>
    ),
    { width, height }
  );

  return Buffer.from(await layer.arrayBuffer());
}

/**
 * Composites the real headline onto generated artwork.
 *
 * Returns the original buffer untouched if anything goes wrong, because a
 * poster with imperfect lettering is still worth far more to the user than an
 * error: the artwork is good and the failure is recoverable by retrying.
 */
export async function renderPoster(
  artwork: Buffer,
  headline: string,
  subhead: string
): Promise<Buffer> {
  try {
    const base = sharp(artwork, { failOn: "none" });
    const meta = await base.metadata();
    const width = meta.width && meta.width > 0 ? meta.width : 1024;
    const height = meta.height && meta.height > 0 ? meta.height : 1024;

    const layer = await renderTextLayer(width, height, headline, subhead);
    const text = await sharp(layer).png().toBuffer();

    return await base
      .composite([{ input: text, top: 0, left: 0 }])
      .png()
      .toBuffer();
  } catch (error) {
    console.warn(`[posterRender] falling back to unlettered artwork: ${error instanceof Error ? error.message : error}`);
    return artwork;
  }
}
