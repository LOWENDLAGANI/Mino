// ── Mino's Google tools (server only) ────────────────────────────────────────
//
// Read and write access to the connected account's Calendar, Tasks, Sheets and
// Docs, plus Google Maps — executed only when the model emits an explicit
// action block, and only against the token of the caller whose browser sent
// the request.
//
// The model never talks to Google directly and never sees a token. It writes
// an action block; this module parses it, calls Google, and hands back plain
// text the model folds into its answer. Anything missing, malformed, or
// refused becomes an error line the model can explain to the user.

import type { GoogleSession } from "./googleAuth";
import { ensureFreshSession } from "./googleAuth";

// ── The action block format ──────────────────────────────────────────────────
//
// A fenced block the model emits when the user's request needs Google:
//
//   ```mino-google
//   {"action":"calendar.create","params":{"summary":"Dentist","start":"2026-10-09T15:00:00","durationMinutes":30}}
//   ```
//
// A fenced block is deliberately chosen over a magic token: it survives
// markdown rendering, it is trivial to detect in the stream, and a model that
// ignores the instruction to use it cannot produce a stray partial token that
// looks like ordinary prose.

export const ACTION_FENCE = "mino-google";

const API = "https://www.googleapis.com";
// Google's APIs answer well inside this on a good day; a hung call must not
// hold a streamed answer hostage.
const TIMEOUT_MS = 20_000;

export interface GoogleAction {
  action: string;
  params: Record<string, unknown>;
}

/** Parses one complete action block body. Returns null for anything malformed. */
export function parseActionBlock(body: string): GoogleAction | null {
  try {
    const parsed = JSON.parse(body.trim()) as { action?: unknown; params?: unknown };
    if (typeof parsed.action !== "string" || !parsed.action) return null;
    if (parsed.params !== undefined && (typeof parsed.params !== "object" || parsed.params === null || Array.isArray(parsed.params))) {
      return null;
    }
    return { action: parsed.action, params: (parsed.params ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

// ── Allowed actions ──────────────────────────────────────────────────────────
//
// An allowlist, not a free-form proxy: the model can only ask for an operation
// this file implements, and each implementation reads only the parameters it
// knows. Nothing here forwards arbitrary JSON to a Google endpoint.

type Handler = (session: GoogleSession, params: Record<string, unknown>) => Promise<string>;

function str(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function requireLogin(): string {
  return "Error: the user has not connected their Google account. Ask them to open Settings and use Connect Google, then try again.";
}

async function googleFetch(
  session: GoogleSession,
  url: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.blob.accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (rare error pages). Handled by callers via `ok`.
  }
  return { ok: response.ok, status: response.status, body };
}

/** A Google error the model can relay, without ever quoting a token. */
function googleError(what: string, status: number, body: unknown): string {
  let detail = "";
  if (body && typeof body === "object" && "error" in (body as Record<string, unknown>)) {
    const err = (body as Record<string, unknown>).error;
    if (typeof err === "string") detail = err;
    else if (err && typeof err === "object" && "message" in (err as Record<string, unknown>)) {
      detail = String((err as Record<string, unknown>).message ?? "");
    }
  }
  if (status === 401 || status === 403) {
    return `Error: Google refused the ${what} request (HTTP ${status}). The connected account may be missing permission for this — ask the user to reconnect in Settings.`;
  }
  if (status === 404) return `Error: the ${what} target was not found (HTTP 404). Check the name or id and try again.`;
  if (status === 429) return `Error: Google is rate-limiting ${what} requests (HTTP 429). Ask the user to wait a moment.`;
  return `Error: the ${what} request failed (HTTP ${status})${detail ? `: ${detail}` : ""}.`;
}

// ── Calendar ─────────────────────────────────────────────────────────────────

const calendarHandlers: Record<string, Handler> = {
  // What is coming up. `query` filters by text, `days` bounds the window.
  "calendar.list": async (session, params) => {
    const days = Math.min(Math.max(num(params, "days", 7), 1), 30);
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + days * 86_400_000).toISOString();
    const query = str(params, "query");
    const url = new URL(`${API}/calendar/v3/calendars/primary/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "25");
    if (query) url.searchParams.set("q", query);
    const { ok, status, body } = await googleFetch(session, url.toString());
    if (!ok) return googleError("calendar list", status, body);
    const events = (body as { items?: Array<Record<string, unknown>> }).items ?? [];
    if (events.length === 0) return "No events found in the requested window.";
    const lines = events.map((event) => {
      const start = (event.start as { dateTime?: string; date?: string } | undefined) ?? {};
      const when = start.dateTime ?? start.date ?? "unknown time";
      const end = (event.end as { dateTime?: string; date?: string } | undefined) ?? {};
      const until = end.dateTime ?? end.date ?? "";
      return `- ${String(event.summary ?? "(untitled)")} | ${when}${until ? ` to ${until}` : ""} (id: ${String(event.id ?? "")})`;
    });
    return `Upcoming events:\n${lines.join("\n")}`;
  },

  // The user's reminder. `start` is ISO local time; a full-day event uses
  // `date` instead. `durationMinutes` defaults to a reminder-length 30.
  "calendar.create": async (session, params) => {
    const summary = str(params, "summary");
    if (!summary) return "Error: a calendar event needs a `summary` (what it is).";
    const start = str(params, "start");
    const date = str(params, "date");
    if (!start && !date) return "Error: a calendar event needs a `start` (ISO local datetime) or a `date` (YYYY-MM-DD for all-day).";
    const body: Record<string, unknown> = { summary, description: str(params, "description") || undefined };
    if (date) {
      body.start = { date };
      body.end = { date: str(params, "endDate") || date };
    } else {
      const duration = Math.min(Math.max(num(params, "durationMinutes", 30), 5), 24 * 60);
      const startMs = Date.parse(start.endsWith("Z") || start.includes("+") ? start : `${start}`);
      const startAt = Number.isNaN(startMs) ? null : new Date(startMs);
      if (!startAt) return "Error: `start` could not be read as a datetime. Use ISO 8601 local time, e.g. 2026-10-09T15:00:00.";
      body.start = { dateTime: startAt.toISOString() };
      body.end = { dateTime: new Date(startAt.getTime() + duration * 60_000).toISOString() };
    }
    const { ok, status, body: responseBody } = await googleFetch(session, `${API}/calendar/v3/calendars/primary/events`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!ok) return googleError("calendar create", status, responseBody);
    const created = responseBody as { id?: string; htmlLink?: string };
    return `Created calendar event "${summary}"${created.htmlLink ? ` — ${created.htmlLink}` : ""}.`;
  },

  "calendar.update": async (session, params) => {
    const id = str(params, "eventId");
    if (!id) return "Error: updating an event needs its `eventId` (list first with calendar.list).";
    const patch: Record<string, unknown> = {};
    const summary = str(params, "summary");
    if (summary) patch.summary = summary;
    const description = str(params, "description");
    if (description) patch.description = description;
    const start = str(params, "start");
    if (start) {
      const duration = Math.min(Math.max(num(params, "durationMinutes", 30), 5), 24 * 60);
      const startAt = new Date(start);
      if (Number.isNaN(startAt.getTime())) return "Error: `start` could not be read as a datetime.";
      patch.start = { dateTime: startAt.toISOString() };
      patch.end = { dateTime: new Date(startAt.getTime() + duration * 60_000).toISOString() };
    }
    if (Object.keys(patch).length === 0) return "Error: nothing to update. Provide `summary`, `description`, or `start`.";
    const { ok, status, body } = await googleFetch(session, `${API}/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!ok) return googleError("calendar update", status, body);
    return `Updated the calendar event.`;
  },

  "calendar.delete": async (session, params) => {
    const id = str(params, "eventId");
    if (!id) return "Error: deleting an event needs its `eventId` (list first with calendar.list).";
    const { ok, status, body } = await googleFetch(session, `${API}/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!ok) {
      if (status === 410 || status === 404) return "That event was already gone from the calendar.";
      return googleError("calendar delete", status, body);
    }
    return "Deleted the calendar event.";
  },
};

// ── Tasks ────────────────────────────────────────────────────────────────────

const taskHandlers: Record<string, Handler> = {
  "tasks.list": async (session, params) => {
    const url = new URL(`${API}/tasks/v1/lists/@default/tasks`);
    url.searchParams.set("showCompleted", str(params, "showCompleted") === "true" ? "true" : "false");
    url.searchParams.set("maxResults", "25");
    const { ok, status, body } = await googleFetch(session, url.toString());
    if (!ok) return googleError("tasks list", status, body);
    const items = (body as { items?: Array<Record<string, unknown>> }).items ?? [];
    if (items.length === 0) return "The default task list is empty.";
    const lines = items.map((task) => {
      const due = typeof task.due === "string" ? ` (due ${task.due.slice(0, 10)})` : "";
      const done = task.status === "completed" ? " [done]" : "";
      return `- ${String(task.title ?? "(untitled)")} (id: ${String(task.id ?? "")})${done}${due}`;
    });
    return `Tasks:\n${lines.join("\n")}`;
  },

  "tasks.create": async (session, params) => {
    const title = str(params, "title");
    if (!title) return "Error: a task needs a `title`.";
    const body: Record<string, unknown> = { title };
    const due = str(params, "due");
    // The Tasks API wants a full RFC 3339 timestamp for `due`.
    if (due) {
      const parsed = new Date(due.length === 10 ? `${due}T12:00:00` : due);
      if (Number.isNaN(parsed.getTime())) return "Error: `due` could not be read as a date.";
      body.due = parsed.toISOString();
    }
    const notes = str(params, "notes");
    if (notes) body.notes = notes;
    const { ok, status, body: responseBody } = await googleFetch(session, `${API}/tasks/v1/lists/@default/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!ok) return googleError("tasks create", status, responseBody);
    return `Added the task "${title}" to the default list.`;
  },

  "tasks.complete": async (session, params) => {
    const id = str(params, "taskId");
    if (!id) return "Error: completing a task needs its `taskId` (list first with tasks.list).";
    const { ok, status, body } = await googleFetch(session, `${API}/tasks/v1/lists/@default/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    if (!ok) return googleError("tasks complete", status, body);
    return "Marked the task as completed.";
  },

  "tasks.delete": async (session, params) => {
    const id = str(params, "taskId");
    if (!id) return "Error: deleting a task needs its `taskId` (list first with tasks.list).";
    const { ok, status, body } = await googleFetch(session, `${API}/tasks/v1/lists/@default/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!ok) {
      if (status === 404 || status === 410) return "That task was already gone.";
      return googleError("tasks delete", status, body);
    }
    return "Deleted the task.";
  },
};

// ── Sheets ───────────────────────────────────────────────────────────────────
//
// Spreadsheets are created through Drive (the Sheets API cannot create a
// file), then written and read through the Sheets API.

const sheetHandlers: Record<string, Handler> = {
  "sheets.read": async (session, params) => {
    const spreadsheetId = str(params, "spreadsheetId");
    const range = str(params, "range") || "A1:D50";
    if (!spreadsheetId) return "Error: reading a sheet needs its `spreadsheetId` (sheets.find can list the user's spreadsheets).";
    const url = `${API}/sheets/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const { ok, status, body } = await googleFetch(session, url);
    if (!ok) return googleError("sheets read", status, body);
    const values = (body as { values?: unknown[][] }).values ?? [];
    if (values.length === 0) return "The requested range is empty.";
    const rows = values.slice(0, 50).map((row) => row.map((cell) => String(cell ?? "")).join(" | "));
    return `Sheet contents (${range}):\n${rows.join("\n")}`;
  },

  "sheets.write": async (session, params) => {
    const spreadsheetId = str(params, "spreadsheetId");
    const range = str(params, "range") || "Sheet1!A1";
    const values = Array.isArray(params.values) ? params.values : null;
    if (!spreadsheetId) return "Error: writing a sheet needs its `spreadsheetId`.";
    if (!values) return "Error: writing a sheet needs `values` as an array of rows, each row an array of cells.";
    const { ok, status, body } = await googleFetch(
      session,
      `${API}/sheets/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: JSON.stringify({ values }) }
    );
    if (!ok) return googleError("sheets write", status, body);
    const updated = (body as { updatedCells?: number }).updatedCells ?? 0;
    return `Wrote ${updated} cell(s) to the spreadsheet.`;
  },

  "sheets.append": async (session, params) => {
    const spreadsheetId = str(params, "spreadsheetId");
    const range = str(params, "range") || "Sheet1!A1";
    const values = Array.isArray(params.values) ? params.values : null;
    if (!spreadsheetId) return "Error: appending needs a `spreadsheetId`.";
    if (!values) return "Error: appending needs `values` as an array of rows.";
    const { ok, status, body } = await googleFetch(
      session,
      `${API}/sheets/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values }) }
    );
    if (!ok) return googleError("sheets append", status, body);
    return "Appended the row(s) to the spreadsheet.";
  },

  "sheets.create": async (session, params) => {
    const name = str(params, "name") || "Mino spreadsheet";
    const rows = Array.isArray(params.rows) ? (params.rows as unknown[][]) : null;
    const drive = await googleFetch(session, `${API}/drive/v3/files`, {
      method: "POST",
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.spreadsheet" }),
    });
    if (!drive.ok) return googleError("sheets create", drive.status, drive.body);
    const file = drive.body as { id?: string };
    const id = file.id ?? "";
    if (!rows || rows.length === 0) return `Created spreadsheet "${name}" (id: ${id}).`;
    const write = await googleFetch(
      session,
      `${API}/sheets/v4/spreadsheets/${encodeURIComponent(id)}/values/Sheet1!A1?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: JSON.stringify({ values: rows }) }
    );
    if (!write.ok) return `Created spreadsheet "${name}" (id: ${id}), but writing the rows failed: ${googleError("sheets write", write.status, write.body)}`;
    return `Created spreadsheet "${name}" with the data (id: ${id}).`;
  },

  "sheets.find": async (session) => {
    const url = new URL(`${API}/drive/v3/files`);
    url.searchParams.set("q", "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    url.searchParams.set("pageSize", "15");
    url.searchParams.set("orderBy", "modifiedByMeTime desc");
    const { ok, status, body } = await googleFetch(session, url.toString());
    if (!ok) return googleError("sheets find", status, body);
    const files = (body as { files?: Array<Record<string, unknown>> }).files ?? [];
    if (files.length === 0) return "No spreadsheets were found on the connected account.";
    const lines = files.map((f) => `- ${String(f.name ?? "(untitled)")} (id: ${String(f.id ?? "")})`);
    return `Spreadsheets:\n${lines.join("\n")}`;
  },
};

// ── Docs ─────────────────────────────────────────────────────────────────────

const docHandlers: Record<string, Handler> = {
  "docs.create": async (session, params) => {
    const title = str(params, "title") || "Mino document";
    const content = str(params, "content");
    const drive = await googleFetch(session, `${API}/drive/v3/files`, {
      method: "POST",
      body: JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" }),
    });
    if (!drive.ok) return googleError("docs create", drive.status, drive.body);
    const file = drive.body as { id?: string };
    const id = file.id ?? "";
    if (!content) return `Created document "${title}" (id: ${id}).`;
    // Docs content is written as indexed insertions; paragraphs are separate
    // requests in the batchUpdate, so the text is split once here.
    const paragraphs = content.split(/\n/).slice(0, 200);
    let index = 1;
    const requests = paragraphs.map((paragraph) => {
      const text = `${paragraph}\n`;
      const request = { insertText: { location: { index }, text } };
      index += text.length;
      return request;
    });
    const write = await googleFetch(session, `${API}/docs/v1/documents/${encodeURIComponent(id)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
    if (!write.ok) return `Created document "${title}" (id: ${id}), but writing the content failed: ${googleError("docs write", write.status, write.body)}`;
    return `Created document "${title}" with the content (id: ${id}).`;
  },

  "docs.read": async (session, params) => {
    const documentId = str(params, "documentId");
    if (!documentId) return "Error: reading a document needs its `documentId` (docs.find can list documents).";
    const { ok, status, body } = await googleFetch(session, `${API}/docs/v1/documents/${encodeURIComponent(documentId)}`);
    if (!ok) return googleError("docs read", status, body);
    const doc = body as { title?: string; body?: { content?: Array<Record<string, unknown>> } };
    const text: string[] = [];
    for (const element of doc.body?.content ?? []) {
      const paragraph = element.paragraph as { elements?: Array<{ textRun?: { content?: string } }> } | undefined;
      for (const run of paragraph?.elements ?? []) {
        if (run.textRun?.content) text.push(run.textRun.content);
      }
    }
    const contents = text.join("").trim();
    return `Document "${doc.title ?? documentId}":\n${contents ? contents.slice(0, 4000) : "(the document is empty)"}`;
  },

  "docs.append": async (session, params) => {
    const documentId = str(params, "documentId");
    const text = str(params, "text");
    if (!documentId) return "Error: appending needs a `documentId`.";
    if (!text) return "Error: appending needs `text`.";
    const { ok, status, body } = await googleFetch(session, `${API}/docs/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [{ insertText: { endOfSegmentLocation: {}, text } }],
      }),
    });
    if (!ok) return googleError("docs append", status, body);
    return "Appended the text to the document.";
  },

  "docs.find": async (session) => {
    const url = new URL(`${API}/drive/v3/files`);
    url.searchParams.set("q", "mimeType='application/vnd.google-apps.document' and trashed=false");
    url.searchParams.set("pageSize", "15");
    url.searchParams.set("orderBy", "modifiedByMeTime desc");
    const { ok, status, body } = await googleFetch(session, url.toString());
    if (!ok) return googleError("docs find", status, body);
    const files = (body as { files?: Array<Record<string, unknown>> }).files ?? [];
    if (files.length === 0) return "No documents were found on the connected account.";
    const lines = files.map((f) => `- ${String(f.name ?? "(untitled)")} (id: ${String(f.id ?? "")})`);
    return `Documents:\n${lines.join("\n")}`;
  },
};

// ── Maps ─────────────────────────────────────────────────────────────────────
//
// Maps is read-only and needs no OAuth: searches and routes are public
// endpoints. Without a server key the tools return the same Google Maps URLs
// the user could open themselves — always useful, never a dead end.

const mapsHandlers: Record<string, Handler> = {
  "maps.search": async (_session, params) => {
    const query = str(params, "query");
    if (!query) return "Error: a maps search needs a `query`.";
    const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!key) {
      return `Map search for "${query}": https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)} (open this link in a browser).`;
    }
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    url.searchParams.set("key", key);
    try {
      const response = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        results?: Array<{ name?: string; formatted_address?: string; rating?: number }>;
      };
      const results = payload.results ?? [];
      if (payload.status !== "OK" || results.length === 0) {
        return `Map search for "${query}": https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)} (no structured results).`;
      }
      const lines = results.slice(0, 5).map((r) => `- ${r.name ?? "?"} — ${r.formatted_address ?? "?"}${typeof r.rating === "number" ? ` (rating ${r.rating})` : ""}`);
      return `Map results for "${query}":\n${lines.join("\n")}`;
    } catch {
      return `Map search for "${query}": https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)} (the search service could not be reached).`;
    }
  },

  "maps.directions": async (_session, params) => {
    const origin = str(params, "origin");
    const destination = str(params, "destination");
    if (!origin || !destination) return "Error: directions need an `origin` and a `destination`.";
    return `Directions from "${origin}" to "${destination}": https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
  },
};

// Google Sheets/Docs/Calendar/Tasks use session-aware handlers; Maps does not,
// but the dispatch shape keeps them uniform.
const HANDLERS: Record<string, Handler> = {
  ...calendarHandlers,
  ...taskHandlers,
  ...sheetHandlers,
  ...docHandlers,
  ...mapsHandlers,
};

/** The action names the model may emit, for the system prompt. */
export function actionNames(): string[] {
  return Object.keys(HANDLERS).sort();
}

export class GoogleActionError extends Error {}

/**
 * Executes one parsed action for the caller's connected account.
 *
 * The session is refreshed first; a fresh cookie is written back by the route
 * when the session reports one. Every unknown action, malformed parameter, and
 * Google refusal becomes a readable string rather than an exception, so the
 * model can tell the user what went wrong in its own voice.
 */
export async function runGoogleAction(session: GoogleSession, action: GoogleAction): Promise<string> {
  const handler = HANDLERS[action.action];
  if (!handler) {
    return `Error: "${action.action}" is not one of the supported Google actions (${actionNames().join(", ")}).`;
  }
  const fresh = await ensureFreshSession(session);
  try {
    return await handler(fresh, action.params);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return `Error: the ${action.action} request to Google timed out. Try again.`;
    }
    return `Error: the ${action.action} request failed${error instanceof Error ? ` (${error.message})` : ""}.`;
  }
}

// ── Should this message touch Google? ────────────────────────────────────────
//
// The same philosophy as shouldUseWebSearch: a cheap, explicit pattern match on
// the user's own words. Mino stays off for ordinary questions, and a request
// that names a Google surface gets the tools. "Set a reminder tomorrow" alone
// does NOT match — a reminder could be anything — unless Calendar is the only
// reading that makes sense with an explicit time or the word calendar.

const GOOGLE_INTENT_PATTERNS = [
  // Calendar
  /\b(?:google\s+)?calendar\b/i,
  /\b(?:schedule|book|reschedule|add|create|put)\b.{0,40}\b(?:event|meeting|appointment)\b/i,
  /\b(?:what(?:'s| is)|show|list|check)\b.{0,30}\b(?:my\s+)?(?:calendar|schedule|agenda)\b/i,
  /\b(?:set|add)\b.{0,20}\b(?:a\s+)?reminder\b.{0,40}\b(?:on|in|to)\b.{0,20}\b(?:my\s+)?calendar\b/i,
  // Tasks
  /\b(?:google\s+)?tasks?\b/i,
  /\b(?:add|create|complete|mark|delete)\b.{0,20}\btask\b/i,
  /\b(?:my\s+)?to-?do\s+list\b/i,
  // Sheets
  /\b(?:google\s+)?sheets?\b/i,
  /\b(?:spreadsheet|google\s+sheet)\b/i,
  /\b(?:add|append|write)\b.{0,30}\brow\b.{0,30}\b(?:sheet|spreadsheet)\b/i,
  // Docs
  /\b(?:google\s+)?docs?\b.{0,30}\b(?:document|doc|write|create|append)\b/i,
  /\b(?:create|write|open|edit|append)\b.{0,30}\bgoogle\s+doc\b/i,
  // Maps
  /\b(?:google\s+)?maps\b/i,
  /\bon (?:a |the )?map\b/i,
  /\b(?:directions|route|navigate)\b.{0,30}\b(?:from|to)\b/i,
  /\b(?:find|search)\b.{0,30}\b(?:nearby|near me|restaurants|cafes|shops)\b/i,
];

export function shouldUseGoogleTools(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return GOOGLE_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * The instruction block appended to the system prompt when Google is relevant
 * and the caller is connected. The model is told the exact block format, the
 * exact action names, and to confirm before mutating — the execution layer
 * still re-checks everything, but a model that asks the user first is the
 * difference between a tool and a surprise.
 */
export function googleToolsPrompt(nowIso: string, timeZone?: string): string {
  const zone = timeZone ? `\nThe user's time zone is ${timeZone}. Interpret datetimes in it.` : "";
  return [
    "GOOGLE TOOLS — the user has connected their Google account. Calendar, Tasks, Sheets, Docs, and Maps are available.",
    `The current date and time is ${nowIso}.${zone}`,
    "",
    "To use one, output a fenced block exactly like this (no text before or after it inside the fence):",
    "```" + ACTION_FENCE,
    '{"action":"<name>","params":{...}}',
    "```",
    "",
    "Rules:",
    "1. One action per block. To run several, emit several blocks in one answer.",
    "2. Available actions:",
    ...actionNames().map((name) => `   - ${name}`),
    "3. calendar.create needs `summary` plus either `start` (ISO local datetime like 2026-10-09T15:00:00) or `date` (YYYY-MM-DD, all-day); optional `durationMinutes`, `description`. calendar.update/calendar.delete need an `eventId` from calendar.list.",
    "4. tasks.create needs `title`; optional `due` (date or datetime), `notes`. tasks.complete/tasks.delete need a `taskId` from tasks.list.",
    "5. sheets.write/sheets.append need `spreadsheetId`, `range`, and `values` (array of rows). sheets.create accepts optional `rows`. Use sheets.find to list spreadsheets.",
    "6. docs.create accepts optional `content` (plain text). docs.read/docs.append need `documentId` from docs.find.",
    "7. maps.search needs `query`; maps.directions needs `origin` and `destination`.",
    "8. BEFORE any action that writes (create, update, delete, write, append), state plainly what you are about to do in the sentence before the block, so the user sees it happen. If the request is ambiguous about the time, the title, or the target file, ask first instead of acting.",
    "9. AFTER a block, the next model turn receives the result and you report it to the user in one clear sentence.",
    "10. Do not emit the block for questions you can answer without Google.",
  ].join("\n");
}

/**
 * Pulls complete action blocks out of a finished answer.
 *
 * Runs after the stream closes on the full text, so a block split across many
 * streamed chunks is still found whole. Incomplete fences are ignored — a cut
 * off answer should not fire half an action.
 */
export function extractActionBlocks(text: string): GoogleAction[] {
  const actions: GoogleAction[] = [];
  const pattern = new RegExp("```" + ACTION_FENCE + "\\s*\\n([\\s\\S]*?)```", "g");
  for (const match of text.matchAll(pattern)) {
    const parsed = parseActionBlock(match[1]);
    if (parsed) actions.push(parsed);
  }
  return actions;
}
