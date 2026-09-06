import type { SchedulerCtx } from "../types.js";
import { emitJobEvent, type JobResult } from "./emit.js";
import { internalApiHeaders, internalApiUrl } from "../lib/internal-api.js";

interface ParkingMaintenanceReport {
  ok: true;
  deterministic: true;
  scanned: number;
  eligible: number;
  changed: number;
  dateEligible: number;
  reviewEligible: number;
  invalidTriggerCount: number;
  invalidReviewByCount: number;
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function parseReport(value: unknown): ParkingMaintenanceReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("parking reconcile response is invalid");
  }
  const report = value as Partial<ParkingMaintenanceReport>;
  const counts = [
    report.scanned,
    report.eligible,
    report.changed,
    report.dateEligible,
    report.reviewEligible,
    report.invalidTriggerCount,
    report.invalidReviewByCount,
  ];
  if (
    report.ok !== true
    || report.deterministic !== true
    || !counts.every(isCount)
    || report.changed! > report.eligible!
    || report.eligible! > report.scanned!
    || report.dateEligible! + report.reviewEligible! !== report.eligible
  ) {
    throw new Error("parking reconcile response is invalid");
  }
  return report as ParkingMaintenanceReport;
}

/** Resurface only overdue date/review parking boundaries through the local API. */
export async function runParkingMaintenance(ctx: SchedulerCtx): Promise<JobResult> {
  const startedAt = Date.now();
  const job = ctx.jobs.get("parking-maintenance");
  let result: JobResult;

  try {
    const response = await fetch(
      internalApiUrl("/api/parking/maintenance/reconcile"),
      { method: "POST", headers: internalApiHeaders() },
    );
    if (!response.ok) throw new Error(`parking reconcile returned ${response.status}`);
    const report = parseReport(await response.json());
    result = {
      status: "sent",
      content:
        `${report.changed}/${report.eligible} due parked item(s) resurfaced; ` +
        `${report.invalidTriggerCount + report.invalidReviewByCount} invalid boundary row(s) skipped`,
      counts: {
        changed: report.changed,
        eligible: report.eligible,
        scanned: report.scanned,
        dateEligible: report.dateEligible,
        reviewEligible: report.reviewEligible,
        invalidTrigger: report.invalidTriggerCount,
        invalidReviewBy: report.invalidReviewByCount,
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
    "parking-maintenance",
    "parking-maintenance",
    result,
    Date.now() - startedAt,
  );
  return result;
}
