import { NextRequest } from "next/server";

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

/** Free models cap the side length; keeping the default modest also cuts latency. */
const DEFAULT_WIDTH = 768;
const DEFAULT_HEIGHT = 768;
const MAX_SIDE = 1024;
const MAX_PROMPT_LENGTH = 900;

const ALLOWED_MODELS = new Set([
  DEFAULT_MODEL,
  "@cf/black-forest-labs/flux-1-dev",
  "@cf/stabilityai/stable-diffusion-xl-base-1.0",
]);

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

/** Cloudflare requires both sides to be a positive multiple of 8. */
function sanitizeSide(value: unknown, fallback: number): number {
  const requested = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  const clamped = Math.min(Math.max(requested, 256), MAX_SIDE);
  return Math.max(8, Math.round(clamped / 8) * 8);
}

function errorMessage(status: number, detail: string): string {
  // Cloudflare answers 7000 for any path that matches no model, and reports it
  // with a 400 rather than a 404. The usual causes are a wrong account ID or a
  // model slug that was percent-encoded, so name them instead of echoing.
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
  return Response.json({ available: imageConfig() !== null });
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

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "`prompt` is required" }, { status: 400 });
  }

  const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;

  const payload: Record<string, unknown> = {
    prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
    width: sanitizeSide(body.width, DEFAULT_WIDTH),
    height: sanitizeSide(body.height, DEFAULT_HEIGHT),
  };
  if (typeof body.seed === "number" && Number.isFinite(body.seed)) payload.seed = Math.trunc(body.seed);
  if (typeof body.steps === "number" && Number.isFinite(body.steps)) payload.steps = body.steps;

  let response: Response;
  try {
    response = await fetch(
      // The model slug is part of the route, not a query value: its slashes
      // must reach Cloudflare literally. Percent-encoding it yields
      // "No route for that URI" (error 7000), because the encoded name
      // matches no model. It is safe unescaped because ALLOWED_MODELS above
      // is the only thing that can ever reach this line.
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/${model}`,
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
  // A malformed or blocked upstream answer arrives as JSON with a 200, which
  // would otherwise be forwarded as a broken image.
  if (!contentType.startsWith("image/")) {
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    return Response.json(
      { error: `Cloudflare returned no image (${contentType || "unknown type"}).${detail ? ` ${detail}` : ""}` },
      { status: 502 }
    );
  }

  // The bytes are passed through untouched; the client turns them into a data
  // URL so the result can be stored locally alongside the chat message.
  return new Response(await response.arrayBuffer(), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Mino-Image-Model": model,
    },
  });
}
