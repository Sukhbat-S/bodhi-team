// ============================================================
// BODHI — Maintenance-liveness cron (K1, Jun 20, 2026)
//
// Thin watcher that fires the /api/maintenance/liveness-check sweep daily,
// AFTER the other maintenance jobs (forgetting-tier 03:50,
// coherence 04:45) have had a chance to run + emit their numeric change-counts.
// The route does the work (per-arm staleness over system_events, deduped inbox
// rows for stale arms, its own system_event); this job is just the trigger +
// a self-emitted closure event so the cron itself is auditable.
//
// HOST MODEL (doctrine #3): the MacBook sleeps through pre-dawn slots, so this
// is registered for on-wake catch-up (see scheduler.ts catch-up gate). It
// reads STALENESS from system_events, not a wall-clock moment — a sweep run a
// few hours late is still correct, because "last N runs changed nothing" is
// time-independent. We never assume the 06:30 tick was actually hit.
//
// POST via internalApiHeaders() (bearer-aware), classify the result, finish()
// through emitJobEvent.
// ============================================================

import type { SchedulerCtx } from "../types.js";
import { emitJobEvent } from "./emit.js";
import { internalApiHeaders, internalApiUrl } from "../lib/internal-api.js";

interface LivenessResponse {
  ok: boolean;
  staleArms?: string[];
  /** Arms with ZERO decidable runs — unobserved, NOT healthy (Jul 25 2026). */
  unknownArms?: string[];
  arms?: Array<{ arm: string; stale: boolean; status?: "live" | "stale" | "unknown" }>;
}

export async function runMaintenanceLiveness(
  ctx: SchedulerCtx,
): Promise<{ status: string; content?: string; error?: string }> {
  const startTime = Date.now();
  const job = ctx.jobs.get("maintenance-liveness");

  const finish = async (
    result: { status: string; content?: string; error?: string },
  ) => {
    if (job) {
      job.lastRun = new Date();
      job.lastResult = result.status as "sent" | "skipped" | "error";
      job.lastDurationMs = Date.now() - startTime;
    }
    // kind='maintenance-liveness' — the cron watches itself. (The route emits a
    // richer same-kind event when it runs; this is the cron-side closure twin.)
    await emitJobEvent(ctx, "maintenance-liveness", "maintenance-liveness", result, Date.now() - startTime);
    return result;
  };

  try {
    const res = await fetch(internalApiUrl("/api/maintenance/liveness-check"), {
      method: "POST",
      headers: internalApiHeaders(),
    });
    if (!res.ok) {
      return finish({ status: "error", error: `liveness-check returned ${res.status}` });
    }
    const data = (await res.json()) as LivenessResponse;
    const staleArms = data.staleArms ?? [];
    const unknownArms = data.unknownArms ?? [];
    // "all maintenance arms live" is a claim about EVIDENCE, so it requires
    // evidence for every arm. An arm with 0 decidable runs is unobserved — this
    // log line used to swallow that and report green (the exact false-green the
    // route exists to catch). Report the blind spot instead.
    const parts: string[] = [];
    if (staleArms.length > 0) parts.push(`${staleArms.length} stale arm(s): ${staleArms.join(", ")}`);
    if (unknownArms.length > 0) parts.push(`${unknownArms.length} unknown arm(s), 0 decidable runs: ${unknownArms.join(", ")}`);
    const content = parts.length === 0 ? "all maintenance arms live" : parts.join(" · ");
    console.log(`[scheduler] Maintenance liveness: ${content}`);
    return finish({ status: "sent", content });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] Maintenance liveness failed: ${errMsg}`);
    return finish({ status: "error", error: errMsg });
  }
}
