// ── Mino image utilities — canvas-based client-side compression ─────────────
// Resizes to fit within 1024×1024 and re-encodes to JPEG (quality 0.8)
// BEFORE the base64 payload is sent, to save bandwidth and API credits.

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;

export interface CompressResult {
  /** base64 data URL of the compressed JPEG */
  dataUrl: string;
  width: number;
  height: number;
  /** compressed size in bytes (approx.) */
  size: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image file"));
    img.src = src;
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Compress an image File entirely client-side:
 * 1. Read as data URL
 * 2. Draw onto a canvas scaled to fit within MAX_DIMENSION
 * 3. Re-encode as image/jpeg at JPEG_QUALITY
 */
export async function compressImage(file: File): Promise<CompressResult> {
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Fill background so transparent PNGs become white instead of black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const compressed = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const base64Length = compressed.length - (compressed.indexOf(",") + 1);
  const size = Math.floor(base64Length * (3 / 4)); // approx decoded byte size

  return { dataUrl: compressed, width, height, size };
}

/** Compress a batch of files, returning per-file successes and error messages. */
export async function compressFiles(
  files: File[]
): Promise<{ results: CompressResult[]; errors: string[] }> {
  const results: CompressResult[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      errors.push(`${file.name}: not an image`);
      continue;
    }
    try {
      results.push(await compressImage(file));
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return { results, errors };
}

/** Compact byte formatting for UI chips (e.g. "182 KB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
