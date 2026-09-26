import { NextRequest, NextResponse } from "next/server";
import { adminConfigured, adminDatabase, verifyPinServer } from "@/lib/adminServer";

// ── Admin API ────────────────────────────────────────────────────────────────
// The browser never reads chat data. Every action here is gated by the PIN,
// checked server-side, and executed with the Admin SDK so the write-only
// Realtime Database rules cannot be bypassed by a visitor.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AdminAction =
  | { action: "listUsers" }
  | { action: "listChats"; uid: string }
  | { action: "getChat"; uid: string; chatId: string }
  | { action: "wipeUser"; uid: string }
  | { action: "wipeAll" };

interface StoredMessage {
  id?: string;
  role?: "user" | "assistant";
  content?: string;
  model?: string;
  createdAt?: number;
  error?: string;
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured()) {
    return fail(
      "The admin API is not configured. Add FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY to the deployment environment, then redeploy.",
      503
    );
  }

  let body: AdminAction;
  try {
    body = (await req.json()) as AdminAction;
  } catch {
    return fail("Malformed request.", 400);
  }

  const digest = (req.headers.get("x-mino-digest") ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) return fail("Missing or malformed PIN digest.", 400);

  const verified = await verifyPinServer(digest).catch((error: unknown) => ({
    ok: false as const,
    reason: "database-error" as const,
    diagnostics: {
      databaseHost: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "(not set)",
      foundDigest: false,
      storedLength: 0,
      browserDigestMatched: null,
      readError: error instanceof Error ? error.message : String(error),
    },
  }));

  if (!verified.ok) {
    if (verified.reason === "locked") {
      return NextResponse.json(
        { error: "Too many attempts. Wait a few minutes and try again.", diagnostics: verified.diagnostics },
        { status: 429 }
      );
    }
    if (verified.reason === "database-error") {
      const keyProblem = (verified.diagnostics.readError ?? "").toLowerCase().includes("private key");
      return NextResponse.json(
        {
          error: keyProblem
            ? "The stored Firebase service-account key is damaged. The server repairs line breaks and padding automatically, so copy the private_key field from the JSON again, markers included."
            : "The server could not reach the Realtime Database with the Admin SDK.",
          diagnostics: verified.diagnostics,
        },
        { status: 502 }
      );
    }
    if (verified.reason === "not-set-up") {
      return NextResponse.json(
        {
          error:
            "The server cannot see an admin PIN. The browser and the server are probably pointed at different databases — check NEXT_PUBLIC_FIREBASE_DATABASE_URL.",
          diagnostics: verified.diagnostics,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: "The PIN did not match the digest stored on the server.",
        diagnostics: verified.diagnostics,
      },
      { status: 401 }
    );
  }

  const database = adminDatabase();

  try {
    switch (body.action) {
      case "listUsers": {
        const [registry, users] = await Promise.all([
          database.ref("admin/registry").get(),
          database.ref("users").get(),
        ]);
        const names = (registry.val() ?? {}) as Record<string, { name?: string; firstSeen?: number; lastSeen?: number }>;
        const chats = (users.val() ?? {}) as Record<string, { chats?: Record<string, unknown> }>;

        const rows = Object.entries(chats).map(([uid, value]) => {
          const profile = names[uid];
          const entries = Object.values(value?.chats ?? {});
          let messages = 0;
          for (const chat of entries) {
            const stored = (chat as { messages?: Record<string, unknown> }).messages ?? {};
            messages += Object.keys(stored).length;
          }
          const lastChatAt = entries.reduce<number>((latest, chat) => {
            const updated = (chat as { updatedAt?: number }).updatedAt ?? 0;
            return updated > latest ? updated : latest;
          }, 0);

          return {
            uid,
            name: profile?.name ?? null,
            firstSeen: profile?.firstSeen ?? null,
            lastSeen: profile?.lastSeen ?? lastChatAt,
            chats: entries.length,
            messages,
          };
        });

        rows.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
        return NextResponse.json({ users: rows });
      }

      case "listChats": {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(body.uid)) return fail("Invalid user id.", 400);
        const snapshot = await database.ref(`users/${body.uid}/chats`).get();
        const value = (snapshot.val() ?? {}) as Record<string, { id?: string; title?: string; createdAt?: number; updatedAt?: number }>;
        const chats = Object.entries(value)
          .map(([chatId, chat]) => ({
            chatId,
            id: chat.id ?? chatId,
            title: chat.title ?? "Untitled",
            createdAt: Number(chat.createdAt ?? 0),
            updatedAt: Number(chat.updatedAt ?? chat.createdAt ?? 0),
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        return NextResponse.json({ chats });
      }

      case "getChat": {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(body.uid) || !/^[A-Za-z0-9_-]{1,128}$/.test(body.chatId)) {
          return fail("Invalid id.", 400);
        }
        const snapshot = await database.ref(`users/${body.uid}/chats/${body.chatId}`).get();
        const chat = snapshot.val() as { title?: string; messages?: Record<string, StoredMessage> } | null;
        if (!chat) return fail("Chat not found.", 404);
        const messages = Object.values(chat.messages ?? {})
          .filter((message) => typeof message?.content === "string" && message.content !== "")
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
          .map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content ?? "",
            model: message.model ?? null,
            createdAt: message.createdAt ?? 0,
            error: message.error ?? null,
          }));
        return NextResponse.json({ title: chat.title ?? "Untitled", messages });
      }

      case "wipeUser": {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(body.uid)) return fail("Invalid user id.", 400);
        await Promise.all([
          database.ref(`users/${body.uid}`).remove(),
          database.ref(`admin/registry/${body.uid}`).remove(),
        ]);
        return NextResponse.json({ ok: true });
      }

      case "wipeAll": {
        // admin/pinHash is preserved so the console stays reachable afterwards.
        await Promise.all([
          database.ref("users").remove(),
          database.ref("admin/registry").remove(),
        ]);
        return NextResponse.json({ ok: true });
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Admin request failed.";
    return fail(message, 500);
  }
}
