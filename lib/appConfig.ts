import { onValue, ref } from "firebase/database";
import { getServices } from "./firebaseHistory";
import { normalizeNotes, type DevNote } from "./notes";

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

/**
 * One ban, with everything the console and the visitor need to know about it.
 *
 * A bare uid was enough to refuse somebody, but it answered none of the
 * questions a ban actually raises: why it was made, who made it, when it was
 * made, and whether it ever lifts. A temporary ban that expires by itself is
 * the difference between a sanction and a permanent grudge.
 */
export interface BanRecord {
  uid: string;
  /** Shown to the visitor in the refusal. Empty when none was given. */
  reason: string;
  /** When the ban was made. 0 only for a legacy record with no history. */
  bannedAt: number;
  /** When the ban lifts on its own. null means permanent. */
  expiresAt: number | null;
  /** The administrator's address at the time of the ban, when known. */
  bannedBy: string;
}

/** Whether a ban is still in force at `now`. An expired ban lifts by itself. */
export function isBanActive(ban: BanRecord, now = Date.now()): boolean {
  return ban.expiresAt === null || ban.expiresAt > now;
}

export interface AppConfig {
  /** Master switch for chat. */
  chatEnabled: boolean;
  /** Master switch for image generation. */
  imageEnabled: boolean;
  /** Master switch for web search inside chat. */
  searchEnabled: boolean;
  /**
   * Master switch for the Google tools (Calendar, Tasks, Sheets, Docs, Maps)
   * inside chat. Absent in an older config, so the default is on and the
   * normalize step treats a missing value as on.
   */
  googleToolsEnabled: boolean;
  /** A short line shown to every visitor. Empty hides the banner. */
  announcement: string;
  /** Heading on the notes page, e.g. "News From Developers". */
  notesTitle: string;
  /** Everything published under "News from the developers". Empty list hides
   *  the section entirely rather than showing an empty page. */
  notes: DevNote[];
  /** Messages per visitor per day. 0 means unlimited. */
  dailyChatCap: number;
  /** Images per visitor per day. 0 means unlimited. */
  dailyImageCap: number;
  /** Everyone the server refuses, with the reason and the length of the ban. */
  bans: BanRecord[];
  /**
   * Closes Mino to everyone but the administrator. Enforced in the route
   * handlers, so it holds even for a visitor with a modified bundle.
   */
  maintenanceEnabled: boolean;
  /** Shown on the notice. The administrator sees it too. */
  maintenanceMessage: string;
  updatedAt: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  chatEnabled: true,
  imageEnabled: true,
  searchEnabled: true,
  googleToolsEnabled: true,
  announcement: "",
  notesTitle: "News From Developers",
  notes: [],
  dailyChatCap: 0,
  dailyImageCap: 0,
  bans: [],
  maintenanceEnabled: false,
  maintenanceMessage: "Mino is down for maintenance. Please check back soon.",
  updatedAt: 0,
};

const asBool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const asCount = (value: unknown) => {
  const n = typeof value === "number" ? Math.trunc(value) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Coerces one stored ban, falling back to the map key as the uid. */
function normalizeBan(raw: unknown, fallbackUid: string): BanRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const uid = typeof value.uid === "string" && value.uid.trim() ? value.uid.trim() : fallbackUid;
  if (!uid) return null;
  return {
    uid,
    reason: typeof value.reason === "string" ? value.reason.slice(0, 200) : "",
    bannedAt: typeof value.bannedAt === "number" && value.bannedAt > 0 ? value.bannedAt : 0,
    // Anything not a positive timestamp is read as "no end recorded", which
    // the console writes back as permanent. A ban must never expire into
    // existence because a field arrived malformed.
    expiresAt: typeof value.expiresAt === "number" && value.expiresAt > 0 ? value.expiresAt : null,
    bannedBy: typeof value.bannedBy === "string" ? value.bannedBy.slice(0, 120) : "",
  };
}

/**
 * Reads the ban list from either shape the database may hold.
 *
 * New writes are a map keyed by uid (`bans/{uid}`), which is what the Realtime
 * Database stores naturally. Older deployments hold a bare `bannedUids` array
 * of uid strings; those bans were permanent and carried no reason, and folding
 * them in here means an existing deployment keeps every ban it had with no
 * migration step and no window in which the list reads as empty.
 */
function normalizeBans(raw: unknown, legacy: unknown): BanRecord[] {
  const bans: BanRecord[] = [];
  const seen = new Set<string>();
  const add = (record: BanRecord | null) => {
    if (record && !seen.has(record.uid)) {
      seen.add(record.uid);
      bans.push(record);
    }
  };
  if (Array.isArray(raw)) {
    for (const entry of raw) add(normalizeBan(entry, ""));
  } else if (raw && typeof raw === "object") {
    for (const [uid, entry] of Object.entries(raw as Record<string, unknown>)) add(normalizeBan(entry, uid));
  }
  if (Array.isArray(legacy)) {
    for (const uid of legacy) {
      if (typeof uid === "string" && uid.trim()) {
        add({ uid: uid.trim(), reason: "", bannedAt: 0, expiresAt: null, bannedBy: "" });
      }
    }
  }
  return bans;
}

/** Coerces whatever is stored into a usable config, ignoring junk values. */
export function normalizeConfig(raw: unknown): AppConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    chatEnabled: asBool(value.chatEnabled, DEFAULT_CONFIG.chatEnabled),
    imageEnabled: asBool(value.imageEnabled, DEFAULT_CONFIG.imageEnabled),
    searchEnabled: asBool(value.searchEnabled, DEFAULT_CONFIG.searchEnabled),
    googleToolsEnabled: asBool(value.googleToolsEnabled, DEFAULT_CONFIG.googleToolsEnabled),
    announcement: typeof value.announcement === "string" ? value.announcement.slice(0, 200) : "",
    notesTitle:
      typeof value.notesTitle === "string" && value.notesTitle.trim()
        ? value.notesTitle.slice(0, 60)
        : DEFAULT_CONFIG.notesTitle,
    notes: normalizeNotes(value.notes),
    dailyChatCap: asCount(value.dailyChatCap),
    dailyImageCap: asCount(value.dailyImageCap),
    bans: normalizeBans(value.bans, value.bannedUids),
    maintenanceEnabled: asBool(value.maintenanceEnabled, DEFAULT_CONFIG.maintenanceEnabled),
    maintenanceMessage:
      typeof value.maintenanceMessage === "string" && value.maintenanceMessage.trim()
        ? value.maintenanceMessage.slice(0, 300)
        : DEFAULT_CONFIG.maintenanceMessage,
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
