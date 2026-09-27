// ── Mino poster typography ──────────────────────────────────────────────────
// Diffusion models cannot spell. FLUX learns what text *looks like*, not what
// letters are, so a requested headline comes back as "KESEELAMATAN" and any
// fine print is shapes that resemble tiny text. No amount of prompt wording
// fixes that.
//
// So text is never asked of the image model. The artwork is generated with
// empty space reserved, and the real words are drawn on afterwards with a text
// renderer that knows the alphabet. This module detects that a request is for a
// poster, pulls the headline out of it, and builds the artwork prompt.
//
// Everything here is best effort. If nothing looks like a poster, or no
// headline can be found, the caller generates an ordinary image and the
// behaviour is exactly what it was before.

/** Requests that want a designed layout with words on it. */
const POSTER_WORDS = [
  "poster",
  "banner",
  "flyer",
  "flier",
  "infographic",
  "advertisement",
  "ad poster",
  "social media post",
  "instagram post",
  "cover art",
  "album cover",
  "book cover",
  "title card",
  "title slide",
  "event poster",
  "notice board",
];

/** Layouts that carry text but are not quite posters. */
const SOFT_POSTER_WORDS = ["announcement", "slogan", "headline", "headline banner", "logo text", "signboard"];

export interface PosterPlan {
  /** True when the request wants words rendered on the image. */
  isPoster: boolean;
  /** The user's own words, spelled correctly, drawn over the artwork. */
  headline: string;
  /** Optional supporting line, when the request supplied one. */
  subhead: string;
  /** The artwork prompt, stripped of text requests and told to leave space. */
  artworkPrompt: string;
}

/** Phrases that ask the model to draw specific words. */
const TEXT_REQUEST = /\b(?:with|containing|that (?:says|reads)|saying|reading|bearing)\s+(?:the\s+)?(?:words?|text|title|headline|slogan)\b[^,.;]*/gi;

/** Anything that would invite the model to attempt lettering. */
const TYPOGRAPHY_HINT = /\b(?:typography|lettering|text|letters|words?|font|typeface|caption|subtitle|headline|title|slogan|watermark|signature)\b/gi;

/**
 * A quoted phrase, which is where the headline came from and must not survive
 * into the artwork prompt — the model would render it as lettering.
 */
const QUOTED_PHRASE = /["“'‘’][^"“”'‘’]{2,80}["“”'‘’]/g;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Pulls the headline out of a poster request.
 *
 * The dominant shape is a quoted phrase — `Make a poster about "keselamatan
 * jalan Raya"` — which is unambiguous and preserves the user's exact spelling,
 * which is the entire point. Failing that, a short request is treated as the
 * headline itself.
 */
function extractHeadline(request: string): string {
  const quoted = request.match(/["“'‘’]([^"“”'‘’]{2,80})["“”'‘’]/);
  if (quoted) return normalize(quoted[1]);

  // "poster about road safety" / "poster for our festival"
  const about = request.match(
    /\b(?:about|for|on|saying|reading|titled|named)\s+(?:our|the|a|an)?\s*([^,.;]{2,60})/i
  );
  if (about) return normalize(about[1]);

  return "";
}

/** Second quoted phrase, used as the subhead when both are present. */
function extractSubhead(request: string): string {
  const all = [...request.matchAll(/["“'‘’]([^"“”'‘’]{2,80})["“”'‘’]/g)];
  return all.length > 1 ? normalize(all[1][1]) : "";
}

/** Whether the request is for a layout with words on it. */
export function looksLikePoster(request: string): boolean {
  const text = request.toLowerCase();
  if (POSTER_WORDS.some((word) => text.includes(word))) return true;
  // "soft" words only count with an explicit layout cue, so a chat question
  // that happens to mention a slogan is not treated as a poster request.
  return SOFT_POSTER_WORDS.some((word) => text.includes(word)) && /\b(?:make|create|design|generate|draw)\b/.test(text);
}

/**
 * Turns a poster request into an artwork prompt plus the real words to draw.
 * Returns `isPoster: false` for ordinary requests, leaving them untouched.
 */
export function planPoster(request: string, optimizedPrompt: string): PosterPlan {
  if (!looksLikePoster(request)) {
    return { isPoster: false, headline: "", subhead: "", artworkPrompt: optimizedPrompt };
  }

  const headline = extractHeadline(request);
  if (!headline) {
    // A poster with nothing to say is just an image. Generating artwork with a
    // blank reserved area would look like a mistake, so decline the treatment.
    return { isPoster: false, headline: "", subhead: "", artworkPrompt: optimizedPrompt };
  }

  // The artwork is described by the optimized prompt, but every trace of the
  // headline and of the request for words is removed. The model must not
  // attempt lettering at all, because anything it draws has to be painted over,
  // and the literal word "poster" in the prompt is itself a strong hint to
  // render a title. Only the visual subject is left to describe.
  let artworkPrompt = optimizedPrompt
    .replace(TEXT_REQUEST, "")
    .replace(TYPOGRAPHY_HINT, "")
    .replace(QUOTED_PHRASE, " ")
    // Strip the request wrapper itself ("make a poster about ..."), since the
    // wrapper is made of layout words rather than visual description.
    .replace(/^\s*(?:please\s+)?(?:can you\s+)?(?:make|create|design|generate|draw|produce)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:poster|banner|flyer|flier|infographic|advertisement|ad|image|artwork)?\s*(?:about|for|on|of|with)?\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;]+$/, "")
    .trim();

  if (artworkPrompt.length < 12) {
    // The wrapper was the whole request, so there is no visual subject left to
    // describe. The text treatment is still worth doing over a neutral
    // background rather than dropping back to a poster full of gibberish.
    artworkPrompt = "a clean modern graphic design composition, flat colour fields, geometric shapes, subtle gradient background, generous empty space";
  }

  // Reserve the space and forbid the letters explicitly. The negative wording
  // matters as much as the reserved area — an unprompted model fills a blank
  // region with signage or watermarks on its own.
  artworkPrompt +=
    ". Designed as a poster layout with a completely empty, clean, untextured band across the upper third reserved for a headline, and a clear empty area along the bottom edge reserved for a caption line. The image must contain absolutely no text, no letters, no words, no numbers, no typography, no signage, no watermark and no signature anywhere. Pure visual artwork only.";

  return {
    isPoster: true,
    headline,
    subhead: extractSubhead(request),
    artworkPrompt,
  };
}
