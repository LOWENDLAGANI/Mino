"use client";

import type { ReactNode } from "react";
import MaintenanceScreen from "./MaintenanceScreen";
import { useMaintenance } from "@/lib/useMaintenance";

// ── Page-level maintenance gate ─────────────────────────────────────────────
// Replaces a page with the notice while Mino is closed, rather than covering
// it, so nothing behind the notice stays mounted or navigable. The chat page
// reads the same hook directly rather than using this wrapper.

export default function MaintenanceGate({ children }: { children: ReactNode }) {
  const { active, message, resolved } = useMaintenance();
  // Hold the first paint until the answer is known, so nobody catches a glimpse
  // of the closed site on the way to the notice.
  if (!resolved) return null;
  if (!active) return <>{children}</>;
  return <MaintenanceScreen message={message} />;
}
