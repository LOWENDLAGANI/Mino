export type ResponseLength = "short" | "balanced" | "detailed";
export type Appearance = "dark" | "light";

const RESPONSE_LENGTH_KEY = "mino:response-length";
const CUSTOM_INSTRUCTIONS_KEY = "mino:custom-instructions";
const APPEARANCE_KEY = "mino:appearance";

export function loadResponseLength(): ResponseLength {
  if (typeof window === "undefined") return "balanced";
  const value = window.localStorage.getItem(RESPONSE_LENGTH_KEY);
  return value === "short" || value === "detailed" ? value : "balanced";
}

export function saveResponseLength(value: ResponseLength): void {
  try { window.localStorage.setItem(RESPONSE_LENGTH_KEY, value); } catch { /* optional preference */ }
}

export function loadCustomInstructions(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY)?.slice(0, 1200) ?? "";
}

export function saveCustomInstructions(value: string): void {
  try { window.localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, value.slice(0, 1200)); } catch { /* optional preference */ }
}

export function loadAppearance(): Appearance {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(APPEARANCE_KEY) === "light" ? "light" : "dark";
}

export function saveAppearance(value: Appearance): void {
  try { window.localStorage.setItem(APPEARANCE_KEY, value); } catch { /* optional preference */ }
  document.documentElement.classList.toggle("light", value === "light");
}
