// ── Share a conversation as an image ─────────────────────────────────────────
// Draws the thread onto a canvas and hands back a PNG, because a conversation
// is the one thing this app produces that people want to post — and a screenshot
// of a phone is not it: half the answer is scrolled away, the composer is in the
// frame, and the text is whatever size the device happened to be.
//
// Deliberate limits, all of them about the image staying readable:
//
//   * Only the most recent MAX_MESSAGES turns are drawn. A 200-message thread
//     makes a picture nobody can read, and the recent exchange is what the
//     sender means to show.
//   * Each message's text is capped, and the whole canvas has a hard height
//     ceiling. Browsers stop rendering absurdly tall canvases silently, and a
//     silently cut image is worse than a visible "…".
//   * Text only. Attachments and generated images become a label rather than
//     being re-encoded, so the renderer never depends on loading base64 blobs
//     back into the canvas (a failure mode that returns a transparent box).
//
// Markdown is drawn as the raw text that was written. Stripping it halfway
// would leave stray asterisks *and* lose meaning; the words are what matter.

import type { ChatMessage } from "./types";
import { displayedContent } from "./variants";

const WIDTH = 1080;
const PAD = 56;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 1600;
const MAX_HEIGHT = 9000;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BG = "#060a08";
const INK = "#eef5f0";
const DIM = "#9fb3a8";
const SAGE = "#a9d8bb";
const SAGE_DEEP = "#1f4a33";

/** Greedy word wrap using the real measuring context. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single token longer than the whole column (a URL, a path, a base64
      // blob) still has to break somewhere, or nothing after it ever draws.
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const character of word) {
        if (ctx.measureText(chunk + character).width > maxWidth && chunk) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

interface Block {
  label: string;
  labelColor: string;
  lines: string[];
  height: number;
}

function textFor(message: ChatMessage): string {
  const text = displayedContent(message).trim();
  if (text) return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
  if (message.generatedImages?.length) return `[image: ${message.generatedImages[0].prompt}]`;
  if (message.images?.length) return "[image]";
  if (message.documents?.length) return `[file: ${message.documents[0].name}]`;
  if (message.error) return `⚠ ${message.error}`;
  return "";
}

/**
 * The image for this thread, ready to download.
 *
 * Two passes: one to measure the wrapped text and settle the canvas height,
 * one to draw it. Measuring first is what stops the classic version of this
 * feature — a canvas sized before the text was wrapped, cutting off the last
 * answer mid-sentence.
 */
export async function downloadChatImage(messages: ChatMessage[], title?: string): Promise<void> {
  const chosen = messages.filter((message) => textFor(message)).slice(-MAX_MESSAGES);
  if (chosen.length === 0) throw new Error("There is nothing to share yet");

  const measureCanvas = document.createElement("canvas");
  const measure = measureCanvas.getContext("2d");
  if (!measure) throw new Error("This browser cannot draw the image");

  const contentWidth = WIDTH - PAD * 2;

  // Pass one — layout.
  measure.font = `600 26px ${FONT}`;
  const blocks: Block[] = chosen.map((message) => {
    const isUser = message.role === "user";
    measure.font = `400 26px ${FONT}`;
    const lines = wrapText(measure, textFor(message), contentWidth);
    const height = 34 /* label */ + lines.length * 38 + 40 /* gap */;
    return {
      label: isUser ? "You" : "Mino",
      labelColor: isUser ? DIM : SAGE,
      lines,
      height,
    };
  });

  const headerHeight = 190;
  const footerHeight = 96;
  let used = headerHeight + footerHeight;
  let visibleFrom = blocks.length;
  for (let index = 0; index < blocks.length; index += 1) {
    if (used + blocks[index].height > MAX_HEIGHT) break;
    used += blocks[index].height;
    visibleFrom = index + 1;
  }
  const clipped = visibleFrom < blocks.length;
  const height = Math.min(MAX_HEIGHT, Math.max(480, used + (clipped ? 64 : 0)));

  // Pass two — draw, at 2× so the text is crisp on a retina share.
  const SCALE = 2;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the image");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);

  // Header: the mark, the chat's name, and when it was shared.
  ctx.fillStyle = SAGE_DEEP;
  roundRect(ctx, PAD, 54, 56, 56, 14);
  ctx.fill();
  ctx.fillStyle = SAGE;
  ctx.font = `700 30px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("M", PAD + 28, 93);
  ctx.textAlign = "left";

  ctx.fillStyle = INK;
  ctx.font = `600 34px ${FONT}`;
  const heading = title?.trim() || "Mino";
  ctx.fillText(fit(ctx, heading, WIDTH - PAD - 140), PAD + 76, 84);
  ctx.fillStyle = DIM;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(
    `Mino · ${new Date().toLocaleDateString(undefined, { dateStyle: "long" })}`,
    PAD + 76,
    116
  );

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(PAD, 150);
  ctx.lineTo(WIDTH - PAD, 150);
  ctx.stroke();

  // Body.
  let y = 172;
  for (const block of blocks.slice(Math.max(0, visibleFrom - MAX_MESSAGES))) {
    if (y + block.height > height - footerHeight) break;
    ctx.fillStyle = block.labelColor;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(block.label, PAD, y + 26);
    ctx.fillStyle = INK;
    ctx.font = `400 26px ${FONT}`;
    let lineY = y + 34 + 26;
    for (const line of block.lines) {
      ctx.fillText(line, PAD, lineY);
      lineY += 38;
    }
    y += block.height;
  }

  if (clipped) {
    ctx.fillStyle = DIM;
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText("… continues", PAD, height - footerHeight - 8);
  }

  // Footer.
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.font = `400 20px ${FONT}`;
  ctx.fillText("Mino — a private AI assistant by Minetallest", PAD, height - 44);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not build the image");

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mino-${(title || "chat")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "chat"}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Trims text to fit one line in the header. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
