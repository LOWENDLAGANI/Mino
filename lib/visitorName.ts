// ── Visitor display name ──────────────────────────────────────────────────────
// Asked once, then remembered in this browser. Nothing is tied to an account:
// clearing site data simply asks again.

const NAME_KEY = "mino:display-name";

export function loadDisplayName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveDisplayName(name: string): string {
  const trimmed = name.trim().slice(0, 40);
  try {
    if (trimmed) window.localStorage.setItem(NAME_KEY, trimmed);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    // Private mode: the name simply is not remembered next visit.
  }
  return trimmed;
}

/** First letter for the sidebar avatar, falling back to "M". */
export function nameInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "M";
}
