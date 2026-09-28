// ── Mino identity guard (server only) ────────────────────────────────────────
// The vendor names below must never reach a browser, so this module is
// imported by server routes only. It lives outside app/api/chat/route.ts so the
// admin model-health probe can scrub a provider's reply and error text with
// exactly the same rules the chat uses, rather than keeping a second, weaker
// copy of the vendor list that the two could drift apart on.

// A system prompt is a strong instruction, not a guarantee: models can still
// name their underlying provider when a user asks directly. Every streamed token
// therefore passes through this rewrite before it reaches the client.
//
// It is deliberately scoped to SELF-REFERENCE only. A blanket vendor-name filter
// would corrupt legitimate answers ("Gemini changed its pricing", "compare Gemini
// with Claude") and make Mino look wrong, so a vendor name is only rewritten when
// the sentence is Mino claiming to be, or having been built by, that vendor.

/**
 * A vendor/model name, optionally carrying a version and tier.
 *
 * This covers the model makers *and* the inference hosts. The Groq fallback
 * serves Llama and GPT-OSS, and a model can just as easily name the thing it is
 * being served by ("I'm Groq", "running on Ollama"), so the hosts are listed
 * alongside the labs. Because every rewrite below is anchored to a
 * self-referential frame, naming them here cannot corrupt an ordinary answer
 * about a vendor.
 */
const VENDOR = String.raw`(?:google\s+deepmind|google\s+ai(?:\s+studio)?|open\s?ai|vertex\s+ai|openrouter|anthropic|deepmind|copilot|google|gemini|claude|chat\s?gpt|gpt|llama|lama|mistral|deepseek|grok|command\s?r|groq|ollama|together(?:\s*ai)?|fireworks|replicate|hugging\s?face|deepinfra|cerebras|sambanova|nscale|novita|perplexity|sonar|qwen|kimi|moonshot|nvidia|cohere)(?:[-\s]*\d+(?:\.\d+)*[a-z]*)?(?:[-\s]+(?:flash|pro|ultra|mini|max|turbo|sonnet|opus|haiku))?`;

const CREATOR_NAMES = String.raw`(?:google(?:\s+deepmind)?|open\s?ai|anthropic|meta|mistral|deepmind|xai|minetallest)`;

type Rewrite = { pattern: RegExp; replace: (...args: string[]) => string };

/** Strips any trailing auxiliary so a rewritten subject reads naturally. */
function bareSubject(subject: string): string {
  return subject.replace(/\s*(?:'m|’m|'s|is|are|am|was|were|been)\s*$/i, "").trim();
}

function asMino(subject: string): string {
  const base = bareSubject(subject);
  if (/^mino$/i.test(base)) return "Mino";
  if (/^i$/i.test(base)) return "I am Mino";
  if (/^it$/i.test(base)) return "It is Mino";
  return `${base} is Mino`;
}

function withTense(subject: string, aux: string, verb: string, tail: string): string {
  const was = /was|were|been/i.test(aux);
  const link = was ? "was" : verb === "is" ? "" : "is";
  return `${subject} ${link} ${verb} ${tail}`.replace(/\s{2,}/g, " ").trim();
}

const IDENTITY_REWRITES: Rewrite[] = [
  // "I am Gemini", "I'm not ChatGPT", "My answer: I'm Gemini 3.8 Flash".
  {
    pattern: new RegExp(
      String.raw`\b(I\s*(?:'m|’m|am|was|are|'s\s+been|have\s+been|have\s+always\s+been|identify\s+as|answer\s+as|introduce\s+myself\s+as|go\s+by|operate\s+as|run\s+as))\s+((?:not\s+|never\s+|just\s+|really\s+|actually\s+|still\s+|simply\s+|always\s+|only\s+)*)(?:an?\s+|the\s+)?${VENDOR}'?s?(?=\W|$)`,
      "gi"
    ),
    // A negated claim ("I'm not Gemini") is dropped rather than flipped, so it
    // never turns into a false "I'm not Mino".
    replace: (_m, subject, filler) => {
      const kept = filler.replace(/^(?:(?:not|never)\s+)+/i, "");
      return `${subject} ${kept}Mino`.replace(/\s{2,}/g, " ");
    },
  },
  // "I was created by Google", "I'm built by OpenAI" → Mino's real creator.
  {
    pattern: new RegExp(
      String.raw`\b(I\s*(?:'m|am|was|have\s+been))\s+(created|developed|made|built|designed|trained)\s+by\s+(?:an?\s+|the\s+)?${CREATOR_NAMES}\b`,
      "gi"
    ),
    replace: (_m, subject, verb) => `${subject} ${verb} by Minetallest`,
  },
  // "I'm Gemini 3.8 Flash, made by Google DeepMind" — the attribution trails a
  // first-person clause, so it only counts when an "I" leads the same sentence.
  {
    pattern: new RegExp(
      String.raw`(\bI\b[^.!?\n]{0,160}?)[,;]\s*(?:and\s+|then\s+|also\s+)?(?:was\s+|were\s+|been\s+|has\s+been\s+)?(?:created|developed|made|built|designed|trained|powered)\s+(?:by|on)\s+(?:an?\s+|the\s+)?${CREATOR_NAMES}\b`,
      "gi"
    ),
    replace: (_m, clause) => `${clause}, created by Minetallest`,
  },
  // "I'm powered by OpenRouter", "I run on GPT-4", "Mino is hosted on Vertex".
  {
    pattern: new RegExp(
      String.raw`\b(I(?:\s*'(?:m|ve)?|\s+is|\s+are|\s+am|\s+was|\s+were)?|Mino|this\s+assistant|the\s+assistant)\s+(?:is\s+|are\s+)?(?:powered|run|running|hosted|operated|served|built|backed)\s+(?:by|on|with|using|through|via)\s+(?:an?\s+|the\s+)?${VENDOR}\b`,
      "gi"
    ),
    replace: (_m, subject) => asMino(subject),
  },
  // "Mino was created by OpenAI", "this assistant is powered by Gemini".
  // A bare "it" is deliberately excluded: in "I think it was created by Google"
  // the pronoun refers to something else entirely.
  {
    pattern: new RegExp(
      String.raw`\b(Mino|this\s+assistant|the\s+assistant)(\s+(?:was\s+|were\s+|is\s+|are\s+|has\s+been\s+|been\s+)?)(created|developed|made|built|designed|trained|powered|hosted|operated)\s+(?:by|on|with|using|through|via)\s+(?:an?\s+|the\s+)?${VENDOR}\b`,
      "gi"
    ),
    replace: (_m, subject, aux, verb) =>
      /powered|hosted|operated/i.test(verb)
        ? asMino(subject)
        : withTense(bareSubject(subject), aux, verb, "by Minetallest"),
  },
  // "my creator is Google", "my developer is OpenAI".
  {
    pattern: new RegExp(
      String.raw`\b(my\s+(?:creator|owner|developer|author|maker|founder|team|company|employer))\s+(?:is|are)\s+(?:an?\s+|the\s+)?(?:not\s+)?${CREATOR_NAMES}\b`,
      "gi"
    ),
    replace: (_m, role) => `${role} is Minetallest`,
  },
  // "my name is Gemini", "my model is GPT-4".
  {
    pattern: new RegExp(
      String.raw`\b(my\s+(?:name|model|identity|system)\s+is)\s+(?:an?\s+|the\s+)?${VENDOR}'?s?(?=\W|$)`,
      "gi"
    ),
    replace: (_m, role) => `${role} Mino`,
  },
  // "I'm not Gemini, I'm Mino" — after the negation is dropped both halves
  // read "Mino", so collapse the duplicate.
  { pattern: /\bMino\b[,.]\s*(?:but\s+|and\s+)?(?:I\s*'?m|I\s+am)\s+Mino\b/gi, replace: () => "Mino" },
];

export function sanitizeIdentity(text: string): string {
  return IDENTITY_REWRITES.reduce((acc, { pattern, replace }) => acc.replace(pattern, replace), text);
}

/**
 * Whether a piece of text names a provider, a model, or an inference host.
 *
 * Used to decide what may be *shown* rather than rewritten. The rewrites above
 * exist to keep a name out of an answer a user reads; here the question is
 * whether a short machine-written detail is worth putting in front of an
 * administrator at all. "Rate limited" helps; a sentence carrying a model id
 * does not, and rewriting it produces the mangled half-names the rewrites are
 * built to avoid.
 */
export function mentionsProvider(text: string): boolean {
  return new RegExp(String.raw`\b${VENDOR}\b`, "i").test(text);
}

export function sanitizeProviderDetail(detail: string): string {
  return detail
    .replace(new RegExp(String.raw`\b${VENDOR}\b`, "gi"), "Mino model service")
    // A model id often has a tail the vendor pattern cannot consume — "gpt-oss-120b"
    // matches only "gpt", "claude-3-5-sonnet" only "claude-3" — which would leave a
    // half-redacted name reading "Mino model service-oss-120b".
    //
    // The tail must be attached with NO space. Allowing a space here would eat the
    // next English word, and "is not found" quietly becoming "found" turns a clear
    // error into a false one, which is worse than a clumsy name.
    .replace(/\bMino model service[-\/]\S+/gi, "Mino model service")
    .replace(/\b(?:made|created|developed|built|designed|trained)\s+by\s+[\w\s.]{2,30}/gi, "created by Minetallest");
}

/**
 * Streaming-safe identity filter.
 *
 * Provider deltas can split a phrase across chunks ("I was cre" + "ated by Goo…"),
 * so the filter holds back a short tail, never cuts a word in half, and only then
 * emits the sanitized prefix. `flush()` releases whatever is still buffered.
 *
 * The hold is larger than the longest self-reference phrase the rewrites match,
 * so a phrase is never only half-visible when the rewrite runs.
 */
export class IdentityFilter {
  private carry = "";
  private readonly hold: number;

  constructor(hold = 64) {
    this.hold = hold;
  }

  push(delta: string): string {
    this.carry += delta;
    if (this.carry.length <= this.hold) return "";

    let cut = this.carry.length - this.hold;
    const breakAt = Math.max(this.carry.lastIndexOf(" ", cut), this.carry.lastIndexOf("\n", cut));
    if (breakAt >= 0) {
      cut = breakAt + 1;
    } else if (this.carry.length > this.hold * 3) {
      // Unbroken token with no whitespace anywhere — never stall the stream.
      cut = this.carry.length;
    } else {
      return "";
    }

    const safe = this.carry.slice(0, cut);
    this.carry = this.carry.slice(cut);
    return sanitizeIdentity(safe);
  }

  flush(): string {
    const rest = this.carry;
    this.carry = "";
    return rest ? sanitizeIdentity(rest) : "";
  }
}
