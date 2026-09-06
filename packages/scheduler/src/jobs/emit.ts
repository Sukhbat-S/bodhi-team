// ============================================================
// BODHI — Closure-tracking emit helper (Apr 26 C#5 follow-up)
//
// Wraps `ctx.systemEvents.record(...)` so every cron-fired job in
// jobs/*.ts surfaces at /dashboard/recent on success + error.
// Best-effort: returns silently if systemEvents isn't configured
// or the underlying record call fails (record() never throws).
//
// Every retained cron callback emits a system_event via emitJobEvent. The
// payload carries `jobName` so the event stream can count durable job runs.
// ============================================================

import type { SchedulerCtx } from "../types.js";

export type JobResult = {
  status: string;
  content?: string;
  error?: string;
  // Skip provenance (Jul 7): a `status:"skipped"` result carries WHY it skipped
  // (bandwidth-mode | no-memories | no-recent-memories | offline | …). Appended
  // to the summary and stored in payload so a skip no longer needs DB forensics
  // to explain.
  reason?: string;
  // K1 (Jun 20, maintenance-liveness): numeric change-counts a maintenance arm
  // mutated this run. The liveness checker reads `payload.changed` to decide if
  // an arm is run-but-changed-nothing (a string summary like "0 forgotten" is
  // un-queryable). Each maintenance job sets at least `changed` (the canonical
  // "did this arm DO anything" number) plus any arm-specific breakdown keys.
  counts?: Record<string, number>;
};

export async function emitJobEvent(
  ctx: SchedulerCtx,
  kind: string,
  jobName: string,
  result: JobResult,
  durationMs: number,
): Promise<void> {
  if (!ctx.systemEvents) return;

  const isError = result.status === "error" || !!result.error;
  const contentLen = result.content?.length ?? 0;

  const tail =
    result.status === "sent" && contentLen > 0
      ? ` (${contentLen} chars)`
      : result.status === "skipped" && result.reason
        ? ` (${result.reason})`
        : result.error
          ? `: ${result.error.slice(0, 100)}`
          : "";

  await ctx.systemEvents.record({
    kind,
    summary: `${jobName} → ${result.status}${tail}`,
    severity: isError ? "error" : "info",
    payload: {
      jobName,
      status: result.status,
      reason: result.reason,
      durationMs,
      contentLength: contentLen,
      error: result.error,
      // Spread numeric maintenance counts so the liveness checker can read
      // `payload.changed` (+ arm-specific keys) per run.
      ...(result.counts ?? {}),
    },
  });
}
