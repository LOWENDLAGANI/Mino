import { NextRequest } from "next/server";
import webpush from "web-push";

// ── Web Push, server side ────────────────────────────────────────────────────
// Holds this deployment's push subscriptions and sends notifications to them.
//
// The store is an in-process map, which is the same deliberate trade-off the
// rate limiter makes: this project has no shared store and no service account,
// and both of those are design decisions rather than omissions. It means a
// restart forgets who subscribed — the browser still holds its subscription and
// Settings shows it as on, so the fix on the user's side is to press the button
// again if a send ever fails. It also means a notification sent from one
// instance reaches only that instance's map; with a single deployment that is
// everybody.
//
// Sending requires three keys, all set by the owner:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  public half (also read by the browser)
//   WEB_PUSH_PRIVATE_KEY          private half — never reaches the client
//   WEB_PUSH_SUBJECT              a mailto: or https: the push service can contact
//
// Nothing here identifies a visitor: a subscription is a random device id and
// an endpoint the *browser* chose. There is no account attached to either.

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

/** deviceId → its most recent subscription. One entry per browser. */
const store = new Map<string, StoredSubscription>();

function vapidDetails(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  if (publicKey && privateKey && subject) return { publicKey, privateKey, subject };
  return null;
}

export async function GET(): Promise<Response> {
  return Response.json({ configured: vapidDetails() !== null, devices: store.size });
}

interface PushRequestBody {
  action?: "subscribe" | "unsubscribe" | "test";
  deviceId?: string;
  subscription?: PushEndpoint;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: PushRequestBody | null = null;
  try {
    body = (await req.json()) as PushRequestBody;
  } catch {
    // Falls through to the 400 below.
  }

  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.slice(0, 128) : "";
  if (!body?.action || !deviceId) {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  if (body.action === "subscribe") {
    if (!body.subscription?.endpoint || !body.subscription.keys) {
      return Response.json({ ok: false, error: "bad-subscription" }, { status: 400 });
    }
    store.set(deviceId, { subscription: body.subscription, updatedAt: Date.now() });
    return Response.json({ ok: true });
  }

  if (body.action === "unsubscribe") {
    store.delete(deviceId);
    return Response.json({ ok: true });
  }

  if (body.action === "test") {
    const vapid = vapidDetails();
    if (!vapid) {
      return Response.json({ ok: false, error: "missing-keys" }, { status: 503 });
    }
    const stored = store.get(deviceId);
    if (!stored) {
      return Response.json({ ok: false, error: "not-subscribed" }, { status: 404 });
    }
    try {
      await webpush.sendNotification(
        stored.subscription,
        JSON.stringify({
          title: "Mino",
          body: "Notifications are working. This is how a renewal reminder will reach you.",
          url: "/",
        }),
        {
          TTL: 60 * 60 * 24,
          vapidDetails: {
            subject: vapid.subject,
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
        }
      );
      return Response.json({ ok: true });
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode;
      // 404/410 means the push service says this endpoint is gone — the user
      // revoked it or the browser rotated it. Forgetting it is the fix, and
      // Settings will correctly read as off on the next press.
      if (status === 404 || status === 410) store.delete(deviceId);
      return Response.json({ ok: false, error: "send-failed" }, { status: 502 });
    }
  }

  return Response.json({ ok: false, error: "unknown-action" }, { status: 400 });
}
