// ── The Gradio Space (server only) ──────────────────────────────────────────
// Mino's own model, hosted on Hugging Face Spaces behind Gradio. This adapter
// is the only file that knows that.
//
// Two things make it more than a `fetch`. The Space exposes one endpoint that
// takes a single `prompt` string rather than a message array, and it answers
// with one finished string rather than a token stream. So the conversation is
// flattened into a transcript here, and the result is handed back shaped like
// an OpenAI SSE response. Everything downstream — the identity filter, the
// truncation check, the fallback chain, the client — then behaves exactly as it
// does for every other provider, with no special case anywhere else.
//
// This module must never be imported by a client component: it carries the
// Space host and the name of the Hugging Face token.

/** Space id. Overridable so a fork or a second deployment can be pointed at. */
const SPACE_ID = process.env.MINO_HF_SPACE?.trim() || "Minetallest/Mino";

/**
 * The Space's only named endpoint, confirmed against its live API schema.
 * `/predict` does not exist on it and calling that name throws.
 */
const ENDPOINT = "/generate_code";

const HOST = `https://${SPACE_ID.toLowerCase().replace("/", "-")}.hf.space`;

/** Set to `off` to remove Mino's own model from the deployment entirely. */
function spaceEnabled(): boolean {
  return process.env.MINO_HF_SPACE?.trim().toLowerCase() !== "off";
}

/** Optional. A public Space needs no token; a private or ZeroGPU one does. */
function spaceToken(): string {
  return process.env.MINO_HF_TOKEN?.trim() || "";
}

/**
 * How long one call may take before it is treated as a Space that never
 * answered, in milliseconds.
 *
 * The bound exists because a ZeroGPU Space is frequently asleep. A cold start
 * queues the job behind the allocation, and a Space whose worker died closes
 * without ever sending `complete` — in both cases the event feed simply never
 * ends. Without a deadline the request stays open until the browser gives up,
 * which is the one failure mode a user experiences as a permanently spinning
 * message. Overridable so a colder hardware tier can be given more room.
 */
function readTimeoutMs(): number {
  const configured = Number(process.env.MINO_HF_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120_000;
}

/**
 * Roughly how many characters of conversation are sent to the Space.
 *
 * The Space takes one flat string and the model behind it is a 7B coder with a
 * 32k window, so an unbounded transcript does not fail loudly: the prompt
 * overflows and the model answers something unrelated, or the Space errors with
 * nothing a reader can act on. Budgeting here means a long thread loses its
 * oldest turns instead of its newest question.
 */
function promptBudget(): number {
  const configured = Number(process.env.MINO_HF_PROMPT_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? configured : 12_000;
}

/** The wire id used for this model in provider lists and stored messages. */
export const SPACE_MODEL = "mino-self";

export function isSpaceConfigured(): boolean {
  return spaceEnabled();
}

export class SpaceError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SpaceError";
    this.status = status;
  }
}

interface ChatTurn {
  role: string;
  content: unknown;
}

/**
 * Flattens the conversation into the one string the Space accepts.
 *
 * The transcript keeps the alternating turns so the model can still see who
 * said what; the system prompt is prefixed as a labelled block rather than
 * merged into the first user turn, because a Space that only sees "prompt"
 * has no other way to learn the persona.
 */
export function toSpacePrompt(
  system: string,
  messages: ChatTurn[],
  budget: number = promptBudget()
): string {
  const turns = messages
    .map((message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? // Multimodal parts are flattened to their text. The Space takes a
              // string, so an image part becomes a note rather than an image.
              message.content
                .map((part) =>
                  part && typeof part === "object" && "text" in part && typeof part.text === "string"
                    ? part.text
                    : "[attachment]",
                )
                .join(" ")
            : "";
      if (!content.trim()) return "";
      const who = message.role === "assistant" ? "Assistant" : "User";
      return `${who}: ${content}`;
    })
    .filter(Boolean);

  const header = [`System: ${system}`, ""];
  const full = [...header, ...turns].join("\n");
  const limit = Math.max(1, Math.trunc(budget));
  if (full.length <= limit) return full;

  // Keep the newest turns that still fit. The question being asked right now is
  // the one thing that must survive, so the walk runs backwards and the oldest
  // turns are what fall off.
  let used = header.join("\n").length + 1;
  const kept: string[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const cost = turns[index].length + 1;
    if (used + cost > limit) break;
    kept.unshift(turns[index]);
    used += cost;
  }
  // A single turn longer than the whole budget still gets asked: cutting the
  // question is worse than asking a shortened version of it.
  if (kept.length === 0 && turns.length > 0) {
    kept.push(turns[turns.length - 1].slice(0, Math.max(1, limit - used)));
  }

  const dropped = turns.length - kept.length;
  const note =
    dropped > 0
      ? [`[${dropped} earlier message${dropped === 1 ? "" : "s"} omitted to fit Mino's context window]`, ""]
      : [];
  return [...header, ...note, ...kept].join("\n");
}

/**
 * Whether an answer from the Space reads as cut off mid-thought.
 *
 * The Space caps its own generation and reports only that it finished, so a
 * reply stopped at the cap is indistinguishable from a complete one. The chat
 * route already has exactly the right response to that — it marks the message
 * truncated and the thread says so out loud — but it can only act on a
 * `length` finish reason, which Gradio never sends. Deciding it here is a
 * guess, so the test is deliberately narrow: an unclosed code fence, or a tail
 * that cannot end a real sentence. Anything weaker would mark finished answers
 * as broken, which is the more expensive mistake of the two.
 */
export function looksTruncated(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  const fences = trimmed.match(/```/g)?.length ?? 0;
  if (fences % 2 === 1) return true;
  return /[\\,;([{=<>|+&~]$/.test(trimmed);
}

interface SpaceEvent {
  event?: string;
  data?: unknown;
}

/**
 * Explains a Space failure in the reader's terms.
 *
 * A ZeroGPU Space in particular reports its remaining quota as the error
 * text, and that one message decides everything: without a Hugging Face token
 * the Space will not answer again for hours. Discarding it and returning a
 * generic failure would leave the administrator with nothing to act on.
 */
function spaceErrorMessage(data: unknown): string {
  const error =
    data && typeof data === "object" && "error" in data
      ? (data as { error?: unknown }).error
      : typeof data === "string"
        ? data
        : "";

  const detail = typeof error === "string" ? error.trim() : "";
  if (/zero ?gpu|quota/i.test(detail)) {
    return "Mino Azure is out of GPU time. A Hugging Face token gives it more — the person who runs this deployment needs to add one.";
  }
  if (detail) {
    const first = detail.split(/(?<=[.!?])\s/)[0] ?? detail;
    return first.length > 160 ? "Mino Azure could not generate a reply." : first;
  }
  return "Mino Azure reported an error while generating.";
}

/** Reads the call's SSE feed until it completes, and returns the text. */
async function readCompletion(url: string, signal: AbortSignal): Promise<string> {
  // Two reasons to stop: the caller went away, or the Space stopped answering.
  // Only the second is this function's error to explain.
  const deadline = AbortSignal.timeout(readTimeoutMs());
  const stop = AbortSignal.any([signal, deadline]);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: stop,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new SpaceError(
      "Mino Azure did not answer in time. It may be starting up or out of GPU time — try again.",
      504
    );
  }
  if (!response.ok || !response.body) {
    throw new SpaceError("The Space did not return a readable response.", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (deadline.aborted) {
        throw new SpaceError(
          "Mino Azure stopped answering partway through. It may be starting up or out of GPU time — try again.",
          504
        );
      }

      // Events are separated by a blank line; the last block stays buffered
      // until more arrives, so a split event is never parsed half-read.
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const event: SpaceEvent = {};
        for (const line of block.split(/\r?\n/)) {
          const separator = line.indexOf(":");
          if (separator === -1) continue;
          const field = line.slice(0, separator).trim();
          const value = line.slice(separator + 1).trim();
          if (field === "event") event.event = value;
          if (field === "data") {
            try {
              event.data = JSON.parse(value);
            } catch {
              event.data = value;
            }
          }
        }

        if (event.event === "error") {
          throw new SpaceError(spaceErrorMessage(event.data), 502);
        }
        if (event.event !== "complete") continue; // heartbeat / generating

        // The endpoint returns a one-element array; anything else is a schema
        // change worth failing on rather than rendering as an empty answer.
        const data = event.data;
        const text = Array.isArray(data) ? data[0] : data;
        if (typeof text !== "string" || !text.trim()) {
          throw new SpaceError("The Space returned an empty answer.", 502);
        }
        return text;
      }
    }
  } catch (error) {
    // A SpaceError from the loop is already phrased for a reader and passes
    // through untouched. Only the deadline's own abort is translated: when the
    // feed stalls mid-answer the stream never ends on its own, so this is the
    // one place that can turn silence into a retryable message.
    if (error instanceof SpaceError) throw error;
    if (signal.aborted) throw error;
    if (deadline.aborted) {
      throw new SpaceError(
        "Mino Azure stopped answering partway through. It may be starting up or out of GPU time — try again.",
        504
      );
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  // The feed ended without a completion event. A Space that is asleep or still
  // starting up closes like this, and the user should be told to retry rather
  // than shown a blank answer.
  throw new SpaceError("The Space closed before finishing. It may be starting up — try again.", 504);
}

/**
 * Asks the Space and returns its answer as an OpenAI-shaped SSE `Response`.
 *
 * Returning the same shape as every other provider is the whole point: the
 * chat route's stream pump, identity filter and usage accounting all work
 * unchanged, and the fallback to the next provider behaves as it already does.
 *
 * The answer arrives in one piece rather than token by token. Mino's client
 * reveals text smoothly as it arrives, so this still reads as a streamed
 * reply without pretending to be a token stream.
 */
async function askSpace(prompt: string, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = spaceToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const budget = AbortSignal.timeout(readTimeoutMs());

  // Step one: open a call and get an event id back.
  let opened: Response;
  try {
    opened = await fetch(`${HOST}/gradio_api/call/v2${ENDPOINT}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.any([signal, budget]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new SpaceError("Mino Azure could not be reached in time.", 504);
  }

  if (opened.status === 429) {
    throw new SpaceError("The Space is busy and has paused new requests. Try again shortly.", 429);
  }
  if (!opened.ok) {
    throw new SpaceError("The Space could not be reached.", opened.status);
  }

  const { event_id: eventId } = (await opened.json()) as { event_id?: string };
  if (!eventId) {
    throw new SpaceError("The Space did not return a call to wait on.", 502);
  }

  // Step two: watch that call until it completes.
  return readCompletion(`${HOST}/gradio_api/call${ENDPOINT}/${eventId}`, signal);
}

export async function callSpace(
  system: string,
  messages: ChatTurn[],
  signal: AbortSignal
): Promise<Response> {
  const prompt = toSpacePrompt(system, messages);
  if (!prompt.trim()) {
    throw new SpaceError("There was nothing to send.", 400);
  }
  const text = await askSpace(prompt, signal);

  // `length` is the one finish reason the chat route reads as "this answer is
  // incomplete", and it is the only thing standing between a reply stopped at
  // the Space's token cap and a clean-looking message that is quietly missing
  // its ending. The Space never reports it, so the shape of the answer decides
  // — narrowly, so a finished answer is never mislabelled as broken.
  const finishReason = looksTruncated(text) ? "length" : "stop";
  const body = [
    `data: ${JSON.stringify({
      choices: [{ delta: { content: text }, finish_reason: finishReason }],
    })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A short probe for the admin model panel, which only needs a live answer. */
export async function probeSpace(signal?: AbortSignal): Promise<string> {
  const prompt = toSpacePrompt("You are running a connectivity check. Follow the instruction exactly.", [
    { role: "user", content: "Reply with the single word: ok" },
  ]);
  if (!prompt.trim()) throw new SpaceError("There was nothing to send.", 400);
  return askSpace(prompt, signal ?? new AbortController().signal);
}