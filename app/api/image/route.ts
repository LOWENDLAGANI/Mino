import { NextRequest } from "next/server";
import { consumeUsage, readConfig, verifyCaller } from "@/lib/serverControl";

// ── Mino image generation — Cloudflare Workers AI ───────────────────────────
//   CLOUDFLARE_ACCOUNT_ID → Cloudflare account holding the Workers AI model
//   CLOUDFLARE_API_TOKEN  → API token with "Workers AI: Read" permission
//
// The free tier of Workers AI covers this model, so image generation costs the
// deployment nothing. The token never reaches the browser: the client posts a
// prompt to this route and receives finished image bytes back.
//
// Like the chat route, the app stays usable when the keys are missing — the
// route answers with a clear setup message instead of failing the request.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Free-tier text-to-image model. Fast, no per-call cost on the free plan. */
const DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell";

const MAX_PROMPT_LENGTH = 2048;

/**
 * Each model's input schema, which differs. Sending a field a model does not
 * declare is a hard 400 (error 5006), not a silently ignored extra, so the
 * payload is built per model rather than from one shared shape.
 *
 * flux-1-schnell accepts only a prompt and a step count, and picks its own
 * output size. SDXL and the DreamShaper family do take width and height.
 */
interface ModelSpec {
  slug: string;
  acceptsDimensions: boolean;
  maxSteps?: number;
}

const ALLOWED_MODELS: Record<string, ModelSpec> = {
  "@cf/black-forest-labs/flux-1-schnell": { slug: DEFAULT_MODEL, acceptsDimensions: false, maxSteps: 8 },
  "@cf/black-forest-labs/flux-1-dev": { slug: "@cf/black-forest-labs/flux-1-dev", acceptsDimensions: false, maxSteps: 8 },
  "@cf/stabilityai/stable-diffusion-xl-base-1.0": {
    slug: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    acceptsDimensions: true,
  },
  "@cf/stabilityai/sdxl-turbo": { slug: "@cf/stabilityai/sdxl-turbo", acceptsDimensions: true },
};

const MAX_SIDE = 1024;

interface ImageRequestBody {
  prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
}

function imageConfig(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  return accountId && token ? { accountId, token } : null;
}

const DEFAULT_WIDTH = 768;
const DEFAULT_HEIGHT = 768;

/** SDXL and friends require both sides to be a positive multiple of 8. */
function sanitizeSide(value: unknown, fallback: number): number {
  const requested = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  const clamped = Math.min(Math.max(requested, 256), MAX_SIDE);
  return Math.max(8, Math.round(clamped / 8) * 8);
}

function errorMessage(status: number, detail: string): string {
  // Cloudflare answers 7000 for any path that matches no model, and reports it
  // with a 400 rather than a 404. The usual causes are a wrong account ID or a
  // model slug that was percent-encoded, so name them instead of echoing.
  if (detail.includes("5006") || detail.toLowerCase().includes("unevaluated properties")) {
    return "The image model rejected the request as malformed (error 5006). This is a bug in the route's payload, not something wrong with the prompt.";
  }
  if (detail.includes("7000") || detail.toLowerCase().includes("no route for that uri")) {
    return "Cloudflare does not recognise that image model for this account. Check `CLOUDFLARE_ACCOUNT_ID`, and make sure `CLOUDFLARE_API_TOKEN` belongs to the same account.";
  }
  if (status === 401 || status === 403) {
    return "The Cloudflare API token was rejected. Check that `CLOUDFLARE_API_TOKEN` is valid and has the Workers AI read permission.";
  }
  if (status === 404) {
    return `Cloudflare could not find the image model. Check \`CLOUDFLARE_ACCOUNT_ID\` and the model name.${detail ? ` (${detail})` : ""}`;
  }
  if (status === 429) {
    return "The Cloudflare free-tier image quota is used up for today. Try again tomorrow.";
  }
  if (status >= 500) {
    return `Cloudflare Workers AI is temporarily unavailable (HTTP ${status}). Please try again shortly.`;
  }
  return `Cloudflare Workers AI failed (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

/** Reports whether image generation is configured, without exposing any value. */
export async function GET(): Promise<Response> {
  const controls = await readConfig();
  return Response.json({ available: imageConfig() !== null && controls.imageEnabled });
}

export async function POST(req: NextRequest): Promise<Response> {
  const config = imageConfig();
  if (!config) {
    return Response.json(
      {
        error:
          "**Image generation isn't connected yet.** Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the Vercel deployment environment to enable it.",
      },
      { status: 503 }
    );
  }

  let body: ImageRequestBody;
  try {
    body = (await req.json()) as ImageRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Enforced here rather than in the client, so the image switch and the image
  // cap hold even for a visitor running a modified bundle.
  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);
  const controls = await readConfig();
  if (!controls.imageEnabled) {
    return Response.json({ error: "Image generation is turned off right now." }, { status: 503 });
  }
  if (identity && controls.bannedUids.includes(identity.uid)) {
    return Response.json({ error: "This device is not allowed to use Mino." }, { status: 403 });
  }
  if (identity && controls.dailyImageCap > 0) {
    const { used, allowed } = await consumeUsage(authorization, identity.uid, "image");
    if (!allowed) {
      return Response.json({ error: "Mino could not verify this device. Please try again shortly." }, { status: 403 });
    }
    if (used > controls.dailyImageCap) {
      return Response.json(
        { error: `Mino's daily limit of ${controls.dailyImageCap} images has been reached on this device. It resets tomorrow.` },
        { status: 429 }
      );
    }
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "`prompt` is required" }, { status: 400 });
  }

  const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
  const spec = ALLOWED_MODELS[requestedModel] ?? ALLOWED_MODELS[DEFAULT_MODEL];

  const payload: Record<string, unknown> = { prompt: prompt.slice(0, MAX_PROMPT_LENGTH) };
  // Schnell has no width/height in its schema, and a model rejects the whole
  // request with "Additional or unevaluated properties" if they are sent.
  if (spec.acceptsDimensions) {
    payload.width = sanitizeSide(body.width, DEFAULT_WIDTH);
    payload.height = sanitizeSide(body.height, DEFAULT_HEIGHT);
  }
  if (typeof body.seed === "number" && Number.isFinite(body.seed)) payload.seed = Math.trunc(body.seed);
  if (typeof body.steps === "number" && Number.isFinite(body.steps)) {
    const max = spec.maxSteps ?? 50;
    payload.steps = Math.min(Math.max(Math.trunc(body.steps), 1), max);
  }

  let response: Response;
  try {
    response = await fetch(
      // The model slug is part of the route, not a query value: its slashes
      // must reach Cloudflare literally. Percent-encoding it yields
      // "No route for that URI" (error 7000), because the encoded name
      // matches no model. It is safe unescaped because ALLOWED_MODELS above
      // is the only thing that can ever reach this line.
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/${spec.slug}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: req.signal,
      }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return Response.json(
      { error: "Could not reach Cloudflare Workers AI. Check the deployment's network access and try again." },
      { status: 502 }
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    return Response.json({ error: errorMessage(response.status, detail) }, { status: response.status });
  }

  const contentType = response.headers.get("content-type") ?? "";

  // Workers AI answers an image model in one of two shapes, and which one
  // arrives is a property of the model, not of the request: some return the
  // bytes directly with an image content type, and the FLUX models return a
  // JSON envelope carrying the picture as a base64 string. Both are valid, so
  // both are accepted rather than assuming the first.
  if (contentType.startsWith("image/")) {
    return new Response(await response.arrayBuffer(), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Mino-Image-Model": spec.slug,
      },
    });
  }

  const raw = (await response.text().catch(() => "")).trim();
  let base64: string | null = null;
  let mime = "image/png";
  try {
    const parsed = JSON.parse(raw) as {
      result?: { image?: string } | string;
      error?: { message?: string };
    };
    if (typeof parsed.result === "string") {
      base64 = parsed.result;
    } else if (parsed.result && typeof parsed.result.image === "string") {
      base64 = parsed.result.image;
      // FLUX answers JPEG; a bare string with no envelope is PNG on the
      // models that use that shape.
      if (base64.startsWith("/9j/")) mime = "image/jpeg";
    }
  } catch {
    base64 = null;
  }

  if (!base64) {
    return Response.json(
      {
        error: `Cloudflare returned no image (${contentType || "unknown type"}).${raw ? ` ${raw.slice(0, 300)}` : ""}`,
      },
      { status: 502 }
    );
  }

  // Workers AI base64 is occasionally unpadded; Buffer is strict about that
  // and silently truncates, so the padding is restored before decoding.
  const padded = base64.length % 4 === 0 ? base64 : base64 + "=".repeat(4 - (base64.length % 4));
  let bytes: Buffer;
  try {
    bytes = Buffer.from(padded, "base64");
  } catch {
    return Response.json({ error: "Cloudflare returned an image that could not be decoded." }, { status: 502 });
  }
  if (!bytes.length) {
    return Response.json({ error: "Cloudflare returned an empty image. Try again." }, { status: 502 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
      "X-Mino-Image-Model": spec.slug,
    },
  });
}
