// ── Visitor display name ──────────────────────────────────────────────────────
// Asked once, then remembered in this browser. Nothing is tied to an account:
// clearing site data simply asks again.

const NAME_KEY = "mino:display-name";
const FIRST_SEEN_KEY = "mino:first-seen";

/**
 * When this browser first used Mino.
 *
 * Kept here rather than read back from the database because a visitor has no
 * read access to their own `admin/registry` node — only a write — so a read
 * there is refused and the profile write behind it never happens.
 */
export function firstSeen(): number {
  if (typeof window === "undefined") return Date.now();
  try {
    const stored = Number(window.localStorage.getItem(FIRST_SEEN_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // Private mode: fall through and stamp it now.
  }
  const now = Date.now();
  try {
    window.localStorage.setItem(FIRST_SEEN_KEY, String(now));
  } catch {
    // Not remembered next visit; the timestamp still reaches the database.
  }
  return now;
}

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
