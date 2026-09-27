import { NextRequest } from "next/server";
import { checkRateLimit, identityGate, isAdmin, readConfig, verifyCaller } from "@/lib/serverControl";

// ── Mino — run the project's own checks ──────────────────────────────────────
//
// A coding assistant that can only assert that its code is correct is a coding
// assistant that guesses. This route runs the repository's real scripts
// (`typecheck`, `lint`, `test`) and returns their unmodified output, which the
// client feeds back on the next turn. The model then reacts to a real compiler
// rather than to its own confidence.
//
// Only allow-listed checks can run, each from package.json, and none of them is
// built from caller input — a caller picks which check by name, never what is
// executed. Output is size-capped and timed out, so a hung script cannot hold a
// serverless instance open indefinitely.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CheckId = "typecheck" | "lint" | "test" | "build";

const CHECKS: Record<CheckId, { script: string; label: string }> = {
  typecheck: { script: "typecheck", label: "typecheck" },
  lint: { script: "lint", label: "lint" },
  test: { script: "test", label: "test" },
  build: { script: "build", label: "build" },
};

const MAX_OUTPUT = 12_000;
const TIMEOUT_MS = 45_000;

/**
 * A hard cap on checks running at once.
 *
 * The per-minute rate limit bounds how many a client can START in a minute, but
 * a check holds a CPU-bound process for up to 45s. Without a concurrency gate,
 * a single caller can have `next build` or `tsc` running several times over in
 * one instance and exhaust its memory — taking down the whole app, not just
 * verification. Two is deliberately conservative: these are real compilers, and
 * a serverless instance does not have memory to spare.
 */
const MAX_CONCURRENT = 2;
let inFlight = 0;

function isCheckId(value: unknown): value is CheckId {
  return typeof value === "string" && Object.hasOwn(CHECKS, value);
}

/** Trimmed from the front when the output is too long: the error is at the end. */
function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  const head = text.slice(0, Math.floor(MAX_OUTPUT * 0.25));
  const tail = text.slice(-Math.floor(MAX_OUTPUT * 0.75));
  return `${head}\n\n… ${text.length - MAX_OUTPUT} characters omitted …\n\n${tail}`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const authorization = req.headers.get("authorization");
  const identity = await verifyCaller(authorization);
  const config = await readConfig();

  if (config.maintenanceEnabled && !isAdmin(identity)) {
    return Response.json({ error: config.maintenanceMessage }, { status: 503 });
  }

  // Verification spends the deployment's CPU, so it shares the chat rate limit
  // rather than getting an unbounded one of its own.
  const limit = checkRateLimit(req, identity, 30);
  if (!limit.allowed) {
    return Response.json(
      { error: `Too many requests. Please wait ${limit.retryAfterSeconds}s and try again.` },
      { status: 429 }
    );
  }
  const gate = identityGate(identity, config, 0);
  if (!gate.allowed) {
    return Response.json({ error: gate.error ?? "Verification is not available to this device." }, { status: 403 });
  }

  let body: { check?: unknown };
  try {
    body = (await req.json()) as { check?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isCheckId(body.check)) {
    return Response.json(
      { error: `Unknown check. Available: ${Object.keys(CHECKS).join(", ")}.` },
      { status: 400 }
    );
  }

  const check = CHECKS[body.check];
  const startedAt = Date.now();

  if (inFlight >= MAX_CONCURRENT) {
    return Response.json(
      {
        check: check.label,
        passed: false,
        output: `A check is already running on this instance (${MAX_CONCURRENT} at a time). Wait for it to finish and run again.`,
      },
      { status: 429 }
    );
  }

  const { spawn } = await import("node:child_process");

  return await new Promise<Response>((resolve) => {
    inFlight += 1;
    // The command is a fixed template. Nothing from the request reaches argv.
    //
    // `detached` puts the child in its own process group so the whole tree can
    // be killed together. Signalling only the direct child would kill `bun run`
    // and leave the actual compiler — tsc, eslint, next — running as an orphan,
    // holding the CPU and memory this instance was trying to give back.
    const child = spawn("bun", ["run", check.script], {
      cwd: process.cwd(),
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: true,
    });

    let output = "";
    let settled = false;

    /** Kills the child's entire process group, falling back to the child. */
    const killTree = () => {
      if (child.pid === undefined) return;
      try {
        // Negative pid targets the process group created by `detached`.
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group is already gone, or was never created. The child itself is
        // the next best thing.
        child.kill("SIGKILL");
      }
    };

    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT * 2) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const finish = (payload: Record<string, unknown>, status = 200) => {
      if (settled) return;
      settled = true;
      inFlight -= 1;
      clearTimeout(timer);
      // Always detach, whichever path finished first, so the listener cannot
      // outlive the response and fire against a recycled closure.
      req.signal.removeEventListener("abort", onAbort);
      resolve(Response.json(payload, { status }));
    };

    const timer = setTimeout(() => {
      killTree();
      finish(
        {
          check: check.label,
          passed: false,
          durationMs: Date.now() - startedAt,
          output: capOutput(`${output}\n\nThe check was stopped after ${TIMEOUT_MS / 1000}s without finishing.`),
        },
        200
      );
    }, TIMEOUT_MS);

    child.on("error", (error) => {
      // A missing runtime is a configuration fact, not a code failure, and the
      // client shows the same panel either way.
      finish({
        check: check.label,
        passed: false,
        durationMs: Date.now() - startedAt,
        output: `Could not run \`bun run ${check.script}\`: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      finish({
        check: check.label,
        passed: code === 0,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        output: capOutput(output.trim() || "The check finished with no output."),
      });
    });

    // If the client disconnects — closed the tab, navigated away, or the user
    // pressed stop — the check has no one left to report to, but the compiler is
    // still burning CPU. Abandoning the stream without killing the child would
    // hold the concurrency slot for the full 45s timeout on every disconnect,
    // and could wedge verification for a legitimate caller.
    const onAbort = () => {
      killTree();
      finish({ check: check.label, passed: false, output: "The check was cancelled." }, 499);
    };
    req.signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Which checks this repository actually defines, so the UI offers real ones. */
export async function GET(): Promise<Response> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  try {
    const raw = await readFile(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts ?? {};
    const available = (Object.keys(CHECKS) as CheckId[]).filter((id) => Boolean(scripts[CHECKS[id].script]));
    return Response.json({ available });
  } catch {
    // A deployment with no readable package.json simply offers nothing.
    return Response.json({ available: [] });
  }
}
