"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CONFIG, subscribeAppConfig, type AppConfig } from "./appConfig";
import { authHeader } from "./firebaseHistory";

// ── Is Mino closed, and am I the one who can open it? ───────────────────────
// Both answers come from the server. The page cannot be trusted to declare
// itself the administrator, and the switch is enforced by the route handlers
// regardless; this only decides what is drawn.

const RESOLVE_TIMEOUT_MS = 2000;

export interface MaintenanceState {
  /** True when this visitor should see the notice instead of the site. */
  active: boolean;
  message: string;
  /**
   * False until the answer is known. Callers that gate their first paint on
   * this avoid a flash of the page that is supposed to be closed.
   */
  resolved: boolean;
}

export function useMaintenance(): MaintenanceState {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        setResolved(true);
      }
    };

    const unsubscribe = subscribeAppConfig((next) => {
      setConfig(next);
      settle();
    });

    void (async () => {
      try {
        const response = await fetch("/api/admin/config", {
          headers: await authHeader(),
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as { isAdmin?: boolean };
        setIsAdmin(Boolean(data.isAdmin));
      } catch {
        // Unreachable means "not the administrator", which only ever shows the
        // notice to someone who was not going to be let in anyway.
      }
    })();

    // If the database never answers, fail open to the permissive default. The
    // routes still refuse, so an unanswerable question cannot let anyone in.
    const timer = setTimeout(settle, RESOLVE_TIMEOUT_MS);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return {
    active: Boolean(config?.maintenanceEnabled) && !isAdmin,
    message: config?.maintenanceMessage || DEFAULT_CONFIG.maintenanceMessage,
    resolved,
  };
}
