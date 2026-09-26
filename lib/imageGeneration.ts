import type { GeneratedImage } from "./types";

// ── Client helper for the server-side image route ───────────────────────────
// The Cloudflare token stays on the server; the browser only ever talks to
// /api/image, exactly as it does for /api/chat.

export const DEFAULT_IMAGE_MODEL = "Mino Canvas";

/** Whether the deployment has image generation configured. */
export async function imageGenerationConfigured(): Promise<boolean> {
  try {
    const response = await fetch("/api/image", { cache: "no-store" });
    if (!response.ok) return false;
    const data = (await response.json()) as { available?: boolean };
    return Boolean(data.available);
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The generated image could not be read"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export interface GenerateImageOptions {
  prompt: string;
  signal?: AbortSignal;
  seed?: number;
}

/**
 * Generates one image and returns it as a locally storable attachment.
 * Errors carry a user-readable message taken from the server response.
 */
export async function generateImage({ prompt, signal, seed }: GenerateImageOptions): Promise<GeneratedImage> {
  const response = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, seed }),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Image generation failed (HTTP ${response.status})`);
  }

  const mime = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
  const blob = await response.blob();
  if (!blob.size) throw new Error("Mino returned an empty image. Try again.");

  return {
    url: await blobToDataUrl(blob),
    prompt,
    mime,
    model: response.headers.get("X-Mino-Image-Model") ?? DEFAULT_IMAGE_MODEL,
    createdAt: Date.now(),
  };
}

/** Filename used when an image is downloaded from the thread. */
export function imageDownloadName(image: GeneratedImage): string {
  const stamp = new Date(image.createdAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const extension = image.mime.includes("webp") ? "webp" : image.mime.includes("jpeg") ? "jpg" : "png";
  return `mino-image-${stamp}.${extension}`;
}
