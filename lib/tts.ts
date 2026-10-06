// ── Read aloud ───────────────────────────────────────────────────────────────
// Web Speech API, nothing else: a browser voice needs no key, no quota, and no
// server round trip, which is the whole reason it can sit on every answer
// without a plan gate. Everything is best-effort — a browser without the API
// simply has no button, and an utterance that fails ends the speaking state
// rather than leaving a stop button stuck on screen.

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Turns markdown into something worth hearing.
 *
 * A model writes syntax, not prose: code fences, links, and rules would be
 * read aloud as punctuation soup otherwise. Code blocks are announced as
 * omitted rather than read character by character, and the whole thing is
 * capped so one enormous answer cannot occupy the voice for minutes.
 */
export function speechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ". Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

/** Starts reading. Returns false when there was nothing to say. */
export function speak(text: string, onEnd?: () => void): boolean {
  if (!speechSupported()) return false;
  const clean = speechText(text);
  if (!clean) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
