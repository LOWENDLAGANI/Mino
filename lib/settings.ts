export type ResponseLength = "short" | "balanced" | "detailed";
export type Appearance = "dark" | "light";
/** How hard the model thinks before answering. Mino defaults to the cheapest. */
export type ReasoningEffort = "low" | "medium" | "high";

const RESPONSE_LENGTH_KEY = "mino:response-length";
const REASONING_EFFORT_KEY = "mino:reasoning-effort";
const LEGACY_CUSTOM_INSTRUCTIONS_KEY = "mino:custom-instructions";
const APPEARANCE_KEY = "mino:appearance";

export function loadResponseLength(): ResponseLength {
  if (typeof window === "undefined") return "balanced";
  const value = window.localStorage.getItem(RESPONSE_LENGTH_KEY);
  return value === "short" || value === "detailed" ? value : "balanced";
}

export function saveResponseLength(value: ResponseLength): void {
  try { window.localStorage.setItem(RESPONSE_LENGTH_KEY, value); } catch { /* optional preference */ }
}

export function loadReasoningEffort(): ReasoningEffort {
  if (typeof window === "undefined") return "low";
  // The custom-instructions field is gone; drop whatever it left behind.
  try { window.localStorage.removeItem(LEGACY_CUSTOM_INSTRUCTIONS_KEY); } catch { /* optional preference */ }
  const value = window.localStorage.getItem(REASONING_EFFORT_KEY);
  return value === "medium" || value === "high" ? value : "low";
}

export function saveReasoningEffort(value: ReasoningEffort): void {
  try { window.localStorage.setItem(REASONING_EFFORT_KEY, value); } catch { /* optional preference */ }
}

export function loadAppearance(): Appearance {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(APPEARANCE_KEY) === "light" ? "light" : "dark";
}

export function saveAppearance(value: Appearance): void {
  try { window.localStorage.setItem(APPEARANCE_KEY, value); } catch { /* optional preference */ }
  document.documentElement.classList.toggle("light", value === "light");
}
