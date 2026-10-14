"use client";

import { useEffect } from "react";
import { getServices } from "@/lib/firebaseHistory";

// ── Warm the account service before anyone can ask to sign in ────────────────
// Firebase sign-in opens a popup with `window.open`, which browsers only allow
// while the click that asked for it is still a user gesture — and the SDK's own
// first call also has to read persistence and, for a first-time visitor, create
// the anonymous account over the network. Left to the click itself, all of that
// stands between the tap and the popup: on a slow connection, or on iOS and
// iPadOS Safari where the gesture window is short, the window arrives too late
// and the browser blocks it. The user sees "The browser blocked the sign-in
// window", and it looks like Google login is broken for everybody.
//
// So the service is created the moment any page mounts instead, and by the time
// the button is pressed the only thing left between the click and the popup is
// a resolved promise. `getServices()` is idempotent and signs the visitor in
// anonymously itself, so this is the whole warm-up; it also fails silently,
// because a deployment with no Firebase has no account to warm and every caller
// already degrades when that is the case.
export default function AuthWarmup() {
  useEffect(() => {
    void getServices();
  }, []);
  return null;
}
