import { onValue, ref } from "firebase/database";
import { getServices } from "./firebaseHistory";

// ── Runtime controls, read by the server on every request ───────────────────
// The administrator sets these from the admin console. They live in Realtime
// Database at `config/` with a public read, which is what lets the server-side
// route handlers enforce them without holding any credential of its own: an
// unauthenticated read is exactly what the rules grant, so no service account
// had to be introduced to keep the deployment secret-free.
//
// Every default is permissive. A missing or unreadable `config` node must
// never take the app down, so anything absent is treated as "no restriction
// configured" rather than as a denial.

export interface AppConfig {
  /** Master switch for chat. */
  chatEnabled: boolean;
  /** Master switch for image generation. */
  imageEnabled: boolean;
  /** Master switch for web search inside chat. */
  searchEnabled: boolean;
  /** A short line shown to every visitor. Empty hides the banner. */
  announcement: string;
  /** Messages per visitor per day. 0 means unlimited. */
  dailyChatCap: number;
  /** Images per visitor per day. 0 means unlimited. */
  dailyImageCap: number;
  /** Anonymous UIDs refused by the server. */
  bannedUids: string[];
  updatedAt: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  chatEnabled: true,
  imageEnabled: true,
  searchEnabled: true,
  announcement: "",
  dailyChatCap: 0,
  dailyImageCap: 0,
  bannedUids: [],
  updatedAt: 0,
};

const asBool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const asCount = (value: unknown) => {
  const n = typeof value === "number" ? Math.trunc(value) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Coerces whatever is stored into a usable config, ignoring junk values. */
export function normalizeConfig(raw: unknown): AppConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    chatEnabled: asBool(value.chatEnabled, DEFAULT_CONFIG.chatEnabled),
    imageEnabled: asBool(value.imageEnabled, DEFAULT_CONFIG.imageEnabled),
    searchEnabled: asBool(value.searchEnabled, DEFAULT_CONFIG.searchEnabled),
    announcement: typeof value.announcement === "string" ? value.announcement.slice(0, 200) : "",
    dailyChatCap: asCount(value.dailyChatCap),
    dailyImageCap: asCount(value.dailyImageCap),
    bannedUids: Array.isArray(value.bannedUids)
      ? value.bannedUids.filter((uid): uid is string => typeof uid === "string" && uid.length > 0)
      : [],
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

/**
 * Subscribes to the administrator's settings. Used for the announcement banner
 * and to grey out controls, never for enforcement — a client that lies about
 * the config gains nothing, because the server decides.
 */
export function subscribeAppConfig(onChange: (config: AppConfig) => void): () => void {
  let unsubscribe = () => {};
  let cancelled = false;

  void getServices()
    .then((services) => {
      if (!services || cancelled) return;
      unsubscribe = onValue(ref(services.database, "config"), (snapshot) => {
        onChange(normalizeConfig(snapshot.val()));
      });
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
