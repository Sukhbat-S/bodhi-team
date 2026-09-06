import type { SchedulerCtx } from "../types.js";
import { emitJobEvent, type JobResult } from "./emit.js";
import { internalApiHeaders, internalApiUrl } from "../lib/internal-api.js";

interface SkillLearningMaintenanceReport {
  eligibleReceipts: number;
  deletedReceipts: number;
  retentionDays: number;
  cutoff: string;
}

/** Aggregate and compact metadata-only skill receipts after their retention window. */
export async function runSkillLearningMaintenance(ctx: SchedulerCtx): Promise<JobResult> {
  const startedAt = Date.now();
  const job = ctx.jobs.get("skill-learning-maintenance");
  let result: JobResult;
  try {
    const response = await fetch(
      internalApiUrl("/api/skill-learning/maintenance/compact"),
      {
        method: "POST",
        headers: internalApiHeaders(),
        body: JSON.stringify({ retentionDays: 90 }),
      },
    );
    if (!response.ok) throw new Error(`skill learning compaction returned ${response.status}`);
    const report = await response.json() as SkillLearningMaintenanceReport;
    result = {
      status: "sent",
      content: `${report.deletedReceipts} skill receipt(s) compacted after ${report.retentionDays} days`,
      counts: {
        changed: report.deletedReceipts,
        eligible: report.eligibleReceipts,
        deleted: report.deletedReceipts,
      },
    };
  } catch (error) {
    result = { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
  if (job) {
    job.lastRun = new Date();
    job.lastResult = result.status === "error" ? "error" : "sent";
    job.lastDurationMs = Date.now() - startedAt;
  }
  await emitJobEvent(
    ctx,
    "skill-learning-maintenance",
    "skill-learning-maintenance",
    result,
    Date.now() - startedAt,
  );
  return result;
}
