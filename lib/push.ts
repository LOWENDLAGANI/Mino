// ── Web Push, browser side ───────────────────────────────────────────────────
// Opt-in notifications for an installed Mino. Everything here is best-effort
// by design: a browser that refuses, a deployment with no keys, and a device
// with no service worker all resolve to a clear reason rather than a spinner
// that never ends, because a notification setting that lies about its state
// is worse than one that says it is off.
//
// Two keys make this work, both set by the owner:
//
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  the public half, safe to ship to the browser
//   WEB_PUSH_PRIVATE_KEY          the private half, read only inside the route
//   WEB_PUSH_SUBJECT              a mailto: or https: contact for the push service
//
// Generate a pair with `bunx web-push generate-vapid-keys`. Until they exist,
// `GET /api/push` reports configured: false and the Settings section says so
// instead of pretending.

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * A stable id for this browser's notification subscription.
 *
 * The route keeps subscriptions in a plain map keyed by device, so a test
 * notification goes to the phone that pressed the button and not to everybody
 * else who ever subscribed. It is not an identity: it is a random string in
 * localStorage with no account attached.
 */
export function pushDeviceId(): string {
  const KEY = "mino:push-device-id";
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "ephemeral-device";
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64Normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

async function postPush(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    return { ok: response.ok && data?.ok !== false, error: data?.error };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** The subscription this browser already has, if any. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** The route's own view of whether the keys are present. */
export async function pushServerStatus(): Promise<{ configured: boolean }> {
  try {
    const response = await fetch("/api/push", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as { configured?: boolean } | null;
    return { configured: Boolean(data?.configured) };
  } catch {
    return { configured: false };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export type PushEnableResult = { ok: true } | { ok: false; error: string };

/** Asks for permission, subscribes, and tells the route where to send. */
export async function enablePush(): Promise<PushEnableResult> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return { ok: false, error: "missing-keys" };
  if (!pushSupported()) return { ok: false, error: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "denied" };

  try {
    // `ready` never settles if no worker has registered — which is the case in
    // development, where the app deliberately skips registration — so it is
    // raced against a timeout rather than awaited forever.
    const registration = await withTimeout(navigator.serviceWorker.ready, 8000);
    if (!registration) return { ok: false, error: "no-worker" };

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const result = await postPush({
      action: "subscribe",
      deviceId: pushDeviceId(),
      subscription: subscription.toJSON(),
    });
    if (!result.ok) {
      // Roll the local subscription back rather than leaving one the route
      // never accepted — a half-subscribed browser looks enabled and is not.
      await subscription.unsubscribe().catch(() => undefined);
      return { ok: false, error: result.error ?? "network" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "subscribe-failed" };
  }
}

export async function disablePush(): Promise<{ ok: boolean }> {
  try {
    const subscription = await currentPushSubscription();
    if (subscription) await subscription.unsubscribe().catch(() => undefined);
  } catch {
    // Nothing to unsubscribe from is still "off".
  }
  const result = await postPush({ action: "unsubscribe", deviceId: pushDeviceId() });
  return { ok: result.ok };
}

/** Sends a notification to this device only, as the proof that it works. */
export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  return postPush({ action: "test", deviceId: pushDeviceId() });
}
