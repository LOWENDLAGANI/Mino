import { NextRequest } from "next/server";
import webpush from "web-push";
import { requireAdmin, verifyCaller, writeAsCaller } from "@/lib/serverControl";

// ── Web Push, server side ────────────────────────────────────────────────────
// Holds this deployment's push subscriptions and sends notifications to them.
//
// Subscriptions are persisted under `push/subscriptions/{uid}` with the
// subscriber's own token, so a restart no longer forgets who subscribed — the
// in-process map below is kept only as the fallback for a deployment whose
// database rules predate that node, and as the test-send cache. Writing the
// node needs no new rules grant in spirit: an owner may always write their own
// subtree, and `database.rules.json` names that path explicitly so the admin
// broadcast can read them all.
//
// Sending requires three keys, all set by the owner:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  public half (also read by the browser)
//   WEB_PUSH_PRIVATE_KEY          private half — never reaches the client
//   WEB_PUSH_SUBJECT              a mailto: or https: the push service can contact
//
// Nothing here identifies a visitor beyond the uid the database already holds
// under `users/`: a subscription is a device endpoint the *browser* chose.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The wire shape of a browser subscription after `PushSubscription.toJSON()`.
 * Declared here rather than imported because the browser's own type and the
 * push library's disagree on nullability while describing the same JSON.
 */
interface PushEndpoint {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

interface StoredSubscription {
  subscription: PushEndpoint;
  updatedAt: number;
}

/** Fallback device → subscription. Populated when the database write fails. */
const store = new Map<string, StoredSubscription>();

function vapidDetails(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  if (publicKey && privateKey && subject) return { publicKey, privateKey, subject };
  return null;
}

function restBase(): string | null {
  const url = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

async function readPersisted(authorization: string, uid: string): Promise<PushEndpoint | null> {
  const base = restBase();
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!base || !token) return null;
  try {
    const response = await fetch(
      `${base}/push/subscriptions/${uid}.json?auth=${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!response.ok) return null;
    const value = (await response.json()) as PushEndpoint | null;
    return value?.endpoint && value?.keys ? value : null;
  } catch {
    return null;
  }
}

/** Every persisted subscription, read with the administrator's own token. */
async function readAllPersisted(
  authorization: string
): Promise<Array<{ uid: string; subscription: PushEndpoint }>> {
  const base = restBase();
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!base || !token) return [];
  try {
    const response = await fetch(`${base}/push/subscriptions.json?auth=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const value = (await response.json()) as Record<
      string,
      { endpoint?: string; keys?: { p256dh: string; auth: string } } | null
    > | null;
    if (!value) return [];
    return Object.entries(value)
      .filter(([, entry]) => Boolean(entry?.endpoint && entry?.keys))
      .map(([uid, entry]) => ({ uid, subscription: entry as unknown as PushEndpoint }));
  } catch {
    return [];
  }
}

async function forgetPersisted(authorization: string, uid: string): Promise<void> {
  await writeAsCaller(authorization, `push/subscriptions/${uid}`, null);
}

function sendOptions(vapid: { publicKey: string; privateKey: string; subject: string }) {
  return {
    TTL: 60 * 60 * 24,
    vapidDetails: {
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
  };
}

export async function GET(): Promise<Response> {
  return Response.json({ configured: vapidDetails() !== null, devices: store.size });
}

interface PushRequestBody {
  action?: "subscribe" | "unsubscribe" | "test" | "broadcast";
  deviceId?: string;
  subscription?: PushEndpoint;
  title?: string;
  body?: string;
  url?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: PushRequestBody | null = null;
  try {
    body = (await req.json()) as PushRequestBody;
  } catch {
    // Falls through to the 400 below.
  }

  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.slice(0, 128) : "";
  if (!body?.action || (!deviceId && body.action !== "broadcast")) {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const authorization = req.headers.get("authorization");

  if (body.action === "subscribe") {
    if (!body.subscription?.endpoint || !body.subscription.keys) {
      return Response.json({ ok: false, error: "bad-subscription" }, { status: 400 });
    }
    store.set(deviceId, { subscription: body.subscription, updatedAt: Date.now() });
    // Best-effort persistence under the verified uid. A failure (rules not yet
    // republished) leaves the fallback map as the store, exactly as before.
    const identity = await verifyCaller(authorization);
    let persisted = false;
    if (identity) {
      persisted = await writeAsCaller(authorization, `push/subscriptions/${identity.uid}`, {
        ...body.subscription,
        deviceId,
        updatedAt: Date.now(),
      });
    }
    return Response.json({ ok: true, persisted });
  }

  if (body.action === "unsubscribe") {
    store.delete(deviceId);
    const identity = await verifyCaller(authorization);
    if (identity) await forgetPersisted(authorization ?? "", identity.uid);
    return Response.json({ ok: true });
  }

  if (body.action === "test") {
    const vapid = vapidDetails();
    if (!vapid) {
      return Response.json({ ok: false, error: "missing-keys" }, { status: 503 });
    }
    // The persisted record first, so a test proves the durable store rather
    // than only the fallback map.
    const identity = await verifyCaller(authorization);
    const persisted = identity ? await readPersisted(authorization ?? "", identity.uid) : null;
    const stored: PushEndpoint | null =
      persisted ?? store.get(deviceId)?.subscription ?? null;
    if (!stored) {
      return Response.json({ ok: false, error: "not-subscribed" }, { status: 404 });
    }
    try {
      await webpush.sendNotification(
        stored,
        JSON.stringify({
          title: "Mino",
          body: "Notifications are working. This is how a renewal reminder will reach you.",
          url: "/",
        }),
        sendOptions(vapid)
      );
      return Response.json({ ok: true });
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode;
      // 404/410 means the push service says this endpoint is gone — the user
      // revoked it or the browser rotated it. Forgetting it is the fix.
      if (status === 404 || status === 410) {
        store.delete(deviceId);
        if (identity) await forgetPersisted(authorization ?? "", identity.uid);
      }
      return Response.json({ ok: false, error: "send-failed" }, { status: 502 });
    }
  }

  if (body.action === "broadcast") {
    // Administrator only: this reaches every subscriber, so it sits behind the
    // same gate as every other admin route, with the rules as the backstop —
    // the read below forwards this caller's own token.
    const admin = await requireAdmin(req.headers);
    if (!admin.allowed) {
      return Response.json({ ok: false, error: admin.error }, { status: admin.status });
    }
    const vapid = vapidDetails();
    if (!vapid) {
      return Response.json({ ok: false, error: "missing-keys" }, { status: 503 });
    }
    const title = (body.title ?? "Mino").slice(0, 80);
    const text = (body.body ?? "").slice(0, 300);
    const url = typeof body.url === "string" && body.url.startsWith("/") ? body.url : "/";

    const persisted = await readAllPersisted(authorization ?? "");
    // The fallback map covers a deployment whose rules predate the node.
    // Each target remembers where it came from so a dead endpoint is pruned
    // from the right store, and the endpoint set dedupes anyone in both.
    const targets: Array<{
      uid: string | null;
      subscription: PushEndpoint;
      source: "database" | "map";
    }> = [
      ...persisted.map(({ uid, subscription }) => ({ uid, subscription, source: "database" as const })),
      ...[...store.entries()].map(([deviceId, stored]) => ({
        uid: deviceId,
        subscription: stored.subscription,
        source: "map" as const,
      })),
    ];
    const seen = new Set<string>();
    let sent = 0;
    let failed = 0;
    for (const target of targets) {
      if (seen.has(target.subscription.endpoint)) continue;
      seen.add(target.subscription.endpoint);
      try {
        await webpush.sendNotification(
          target.subscription,
          JSON.stringify({ title, body: text, url }),
          sendOptions(vapid)
        );
        sent += 1;
      } catch (cause) {
        failed += 1;
        const status = (cause as { statusCode?: number }).statusCode;
        // 404/410: the push service says this endpoint is gone. Forget it in
        // whichever store it lives, so the next broadcast skips it entirely.
        if (status === 404 || status === 410) {
          if (target.source === "map" && target.uid) store.delete(target.uid);
          if (target.source === "database" && target.uid) {
            await forgetPersisted(authorization ?? "", target.uid);
          }
        }
      }
    }
    return Response.json({ ok: true, sent, failed });
  }

  return Response.json({ ok: false, error: "unknown-action" }, { status: 400 });
}
