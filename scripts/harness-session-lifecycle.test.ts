import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCRIPT = resolve("scripts/harness-session-lifecycle.sh");
const PROJECT_ROOT = resolve(".");
// A sealed release has no Git checkout; the hook then reports the working directory.
function canonicalProjectRoot(): string {
  try {
    return dirname(execFileSync(
      "git",
      ["-C", PROJECT_ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim());
  } catch {
    return PROJECT_ROOT;
  }
}
const CANONICAL_PROJECT_ROOT = canonicalProjectRoot();
const FIRST_ID = "019fa7af-ded1-7ef3-8973-60768fecdc21";
const SECOND_ID = "019fa7af-aaaa-7abc-8def-111111111111";

type HookResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function fixture(
  event: "SessionStart" | "UserPromptSubmit" | "SessionEnd",
  sessionId = FIRST_ID,
  cwd = PROJECT_ROOT,
): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd,
    hook_event_name: event,
  };
}

async function runScript(script: string, input: unknown, args: string[]): Promise<HookResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("bash", [script, ...args], {
      cwd: PROJECT_ROOT,
      // If a regression reintroduces HTTP writes, pointing at a guaranteed bad
      // endpoint keeps the test deterministic and the hook best-effort.
      env: { ...process.env, BODHI_BASE_URL: "http://127.0.0.1:1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (typeof status !== "number") return reject(new Error("hook exited without status"));
      resolveResult({ status, stdout, stderr });
    });
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

async function runHook(input: unknown, args: string[] = []): Promise<HookResult> {
  return runScript(SCRIPT, input, args);
}

describe("Native harness project identity hook", () => {
  it("emits metadata only and leaves routing plus persistence to canonical skills", () => {
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).not.toMatch(/curl|\/api\/checkpoints|create_thread|navigate_to_codex_page/);
    expect(source).toMatch(/\$session-start project-identity check/);
    expect(source).toMatch(/\$session-start owns/);
    expect(source).toMatch(/\$session-save owns/);
  });

  it("emits the exact native task identity and project on SessionStart", async () => {
    const result = await runHook(fixture("SessionStart"));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          `BODHI_PROVIDER=codex\nBODHI_NATIVE_TASK_ID=${FIRST_ID}\nBODHI_PROJECT=${CANONICAL_PROJECT_ROOT}`,
      },
    });
  });

  it("emits provider claude-code when invoked with that argument", async () => {
    const result = await runHook(fixture("SessionStart"), ["claude-code"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          `BODHI_PROVIDER=claude-code\nBODHI_NATIVE_TASK_ID=${FIRST_ID}\nBODHI_PROJECT=${CANONICAL_PROJECT_ROOT}`,
      },
    });
  });

  it("fails closed for an unknown harness while naming it on stderr", async () => {
    const result = await runHook(fixture("SessionStart"), ["unknown-harness"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown provider");
    expect(result.stderr).toContain("unknown-harness");
  });

  it("keeps full native IDs distinct", async () => {
    const [first, second] = await Promise.all([
      runHook(fixture("SessionStart", FIRST_ID)),
      runHook(fixture("SessionStart", SECOND_ID)),
    ]);

    expect(first.stdout).toContain(FIRST_ID);
    expect(second.stdout).toContain(SECOND_ID);
    expect(first.stdout).not.toEqual(second.stdout);
  });

  it.each(["UserPromptSubmit", "SessionEnd"] as const)(
    "performs no compatibility work for %s",
    async (event) => {
      const result = await runHook(fixture(event));
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    },
  );

  it.each([
    "not-json",
    JSON.stringify({ hook_event_name: "SessionStart", session_id: "short", cwd: PROJECT_ROOT }),
    JSON.stringify({ hook_event_name: "Unknown", session_id: FIRST_ID, cwd: PROJECT_ROOT }),
  ])("fails closed and silently for malformed input", async (input) => {
    const result = await runHook(input);
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("falls back to the full cwd outside a git repository", async () => {
    const result = await runHook(fixture("SessionStart", FIRST_ID, "/tmp"));
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain(
      "BODHI_PROJECT=/tmp",
    );
  });
});
