// ── The subscription ────────────────────────────────────────────────────────
// What this person has paid for, and whether they have been told about it yet.
//
// There is no gateway. Mino is paid for by QR transfer, so the owner checks
// their bank and grants by hand from the admin console; this file is the other
// end of that. It reads one node the owner can read and nobody else, live, so
// the celebration appears on a tab that is already open — and on the next visit
// if there was no tab — without a reload, a poll, or an email round trip.
//
// The record lives at `subscriptions/$uid` and deliberately not under
// `users/$uid`. The rules grant a visitor write access to their own `users/$uid`
// node for chats, and a Realtime Database grant cannot be taken back by a deeper
// rule, so a subscription stored there could be written by the person it is
// meant to describe. A separate top-level node with no owner write is the only
// place a plan can be recorded safely. See `database.rules.json`.

import { onIdTokenChanged } from "firebase/auth";
import { get, onValue, ref, set, type Database } from "firebase/database";
import { firebaseConfigured, getServices } from "./firebaseHistory";
import { parseSubscriptionView, type SubscriptionView } from "./subscriptionState";

/**
 * Where the browser remembers what it has already shown.
 *
 * The same fact is also written to the database, so a second browser does not
 * repeat the dialog. This copy is what makes "after that don't show again"
 * hold even when that write cannot land — a deployment whose rules have not
 * been republished yet, or an offline moment. One of the two is always enough,
 * and either being absent cannot produce a second dialog on a later visit.
 */
const ACK_KEY = "mino:subscription-ack";

export function readLocalAck(): number {
  try {
    const value = Number(window.localStorage.getItem(ACK_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    // Private mode and blocked storage both throw here; 0 simply means "nothing
    // remembered", and the database copy is still consulted.
    return 0;
  }
}

export function writeLocalAck(announcementId: number): void {
  try {
    window.localStorage.setItem(ACK_KEY, String(announcementId));
  } catch {
    // Nothing to do — see readLocalAck.
  }
}

function subscriptionRef(database: Database, uid: string) {
  return ref(database, `subscriptions/${uid}`);
}

/**
 * Reads the subscription once, for a caller that only needs the current value.
 *
 * Returns null on any failure — including a deployment whose rules have not
 * been republished — so a caller that has not configured the subscription never
 * shows a person a plan nobody granted.
 */
export async function loadSubscription(): Promise<SubscriptionView | null> {
  const current = await getServices();
  if (!current) return null;
  try {
    const snapshot = await get(subscriptionRef(current.database, (await current.ensureUser()).uid));
    return parseSubscriptionView(snapshot.val());
  } catch {
    return null;
  }
}

/**
 * Subscribes to this person's subscription, live.
 *
 * Bound to the *signed-in* identity rather than to a UID read once, because
 * linking a Google account can move the subscription to a different UID and a
 * listener pinned to the old one would then report nothing forever.
 */
export function watchSubscription(
  onChange: (view: SubscriptionView | null) => void
): () => void {
  if (!firebaseConfigured || typeof window === "undefined") {
    onChange(null);
    return () => {};
  }

  let stopValue: (() => void) | undefined;
  let cancelled = false;

  const detach = () => {
    stopValue?.();
    stopValue = undefined;
  };

  void getServices()
    .then(async (services) => {
      if (!services || cancelled) return;
      await services.auth.authStateReady();
      if (cancelled) return;
      onIdTokenChanged(services.auth, (user) => {
        detach();
        if (cancelled) return;
        if (!user) {
          onChange(null);
          return;
        }
        stopValue = onValue(
          subscriptionRef(services.database, user.uid),
          (snapshot) => {
            if (!cancelled) onChange(parseSubscriptionView(snapshot.val()));
          },
          () => {
            // A refusal is not an error worth interrupting anyone for: it means
            // this deployment has not published the subscription rules yet.
            if (!cancelled) onChange(null);
          }
        );
      });
    })
    .catch(() => {
      if (!cancelled) onChange(null);
    });

  return () => {
    cancelled = true;
    detach();
  };
}

/**
 * Records that this person has been shown grant number `announcementId`.
 *
 * Written only after they press the button, never when the dialog appears, so
 * a tab that is closed or reloaded before they have read it still owes them the
 * dialog on their next visit. Best effort by design: losing this write costs a
 * repeated celebration on one device, while blocking the dialog on it would
 * cost someone the news that they had just paid.
 */
export async function acknowledgeSubscription(announcementId: number): Promise<void> {
  const current = await getServices();
  if (!current) return;
  try {
    await set(
      ref(current.database, `subscriptions/${(await current.ensureUser()).uid}/ack`),
      { announcementId, at: Date.now() }
    );
  } catch {
    // Rules not republished yet, or offline. The local record still stands.
  }
}