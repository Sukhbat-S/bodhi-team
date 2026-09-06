import type { SchedulerCtx } from "../types.js";
import { emitJobEvent, type JobResult } from "./emit.js";
import { internalApiHeaders, internalApiUrl } from "../lib/internal-api.js";

interface CheckpointMaintenanceReport {
  ok: true;
  staleActiveCount: number;
  pendingVerificationCount: number;
  changed: number;
  readOnly: true;
  thresholds: { activeDays: number; pendingVerificationDays: number };
}

/** Deterministic liveness/reconciliation report for durable work checkpoints. */
export async function runCheckpointMaintenance(
  ctx: SchedulerCtx,
): Promise<JobResult> {
  const startedAt = Date.now();
  const job = ctx.jobs.get("checkpoint-maintenance");
  let result: JobResult;

  try {
    const response = await fetch(
      internalApiUrl("/api/checkpoints/maintenance/reconcile"),
      { method: "POST", headers: internalApiHeaders() },
    );
    if (!response.ok) throw new Error(`checkpoint reconcile returned ${response.status}`);
    const report = (await response.json()) as CheckpointMaintenanceReport;
    result = {
      status: "sent",
      content:
        `${report.staleActiveCount} stale active checkpoint(s); ` +
        `${report.pendingVerificationCount} overdue pending receipt(s)`,
      counts: {
        changed: report.changed,
        staleActive: report.staleActiveCount,
        pendingVerification: report.pendingVerificationCount,
      },
    };
  } catch (error) {
    result = {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (job) {
    job.lastRun = new Date();
    job.lastResult = result.status === "error" ? "error" : "sent";
    job.lastDurationMs = Date.now() - startedAt;
  }
  await emitJobEvent(
    ctx,
    "checkpoint-maintenance",
    "checkpoint-maintenance",
    result,
    Date.now() - startedAt,
  );
  return result;
}
