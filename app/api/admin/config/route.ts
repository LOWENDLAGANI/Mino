import { NextRequest } from "next/server";
import { normalizeConfig, type AppConfig } from "@/lib/appConfig";
import { invalidateConfig, isAdmin, serverControlsConfigured, verifyCaller, writeAsCaller } from "@/lib/serverControl";

// ── Administrator-only control surface ──────────────────────────────────────
// Read by anyone, because the public rules allow it and the server needs it to
// enforce. Written only by the administrator: the request must carry a Firebase
// ID token, the token is verified with Google, and the write is then performed
// with that same token so `database.rules.json` makes the final decision rather
// than this file.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_PATH = "config";

/**
 * The administrator's address, as the server sees it.
 *
 * `database.rules.json` remains the source of truth: the write below is made
 * with the caller's own token, so Firebase compares the address itself. This
 * value only lets the route refuse early with a clear message, and a mismatch
 * between the two shows up as a refused write rather than a silent success.
 */
function configuredAdminEmail(): string {
  return process.env.MINO_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
}

export async function GET(): Promise<Response> {
  if (!serverControlsConfigured) {
    return Response.json({ error: "Controls are not configured in this deployment." }, { status: 503 });
  }
  // The console reads through the Firebase SDK on the public read, so this
  // endpoint only needs to answer for the admin check itself.
  return Response.json({ adminEmailConfigured: Boolean(configuredAdminEmail()) });
}

export async function PUT(req: NextRequest): Promise<Response> {
  if (!serverControlsConfigured) {
    return Response.json({ error: "Controls are not configured in this deployment." }, { status: 503 });
  }
  if (!configuredAdminEmail()) {
    return Response.json(
      { error: "Set `MINO_ADMIN_EMAIL` in the deployment environment to match the address in the database rules." },
      { status: 503 }
    );
  }

  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);
  if (!identity) {
    return Response.json(
      { error: "Your session could not be verified. Close the console, sign in with Google again, and retry." },
      { status: 401 }
    );
  }
  if (!isAdmin(identity)) {
    // Reached when the token is valid but carries no administrator address,
    // which is what an anonymous session looks like even after signing in.
    return Response.json(
      {
        error: identity.email
          ? "This account is not the Mino administrator."
          : "This session is still anonymous. Sign in with Google inside the console before changing controls.",
      },
      { status: 403 }
    );
  }

  let body: Partial<AppConfig>;
  try {
    body = (await req.json()) as Partial<AppConfig>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Normalise before writing so a bad value is corrected rather than stored and
  // then trusted by the enforcement path.
  const next: AppConfig = { ...normalizeConfig(body), updatedAt: Date.now() };
  const written = await writeAsCaller(authorization, CONFIG_PATH, next);
  if (!written) {
    return Response.json(
      { error: "The database refused the write. Check that the address in the rules matches `MINO_ADMIN_EMAIL`." },
      { status: 403 }
    );
  }

  invalidateConfig();
  return Response.json({ ok: true, config: next });
}
