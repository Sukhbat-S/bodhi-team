// ============================================================
// BODHI — Durable scheduler job state (catch-up support, Jun 13)
//
// WHY: BODHI runs on a laptop that sleeps and can be offline for long periods.
// The durable LaunchAgent restores the process, but node-cron still uses
// in-process wall-clock slots with NO
// catch-up, and JobRecord.lastRun lived ONLY in memory (reset to null on
// every boot). Pre-dawn slots essentially NEVER ran — the laptop is asleep at
// those minutes and node-cron does not replay a missed slot.
//
// This module persists per-job {lastRun, lastResult, lastDurationMs} to
// ~/.bodhi/scheduler-state.json (the scheduler package is DB-free by design;
// its retained jobs reach the API over HTTP, so a JSON file, NOT Drizzle).
// lastRun read FROM DISK is what lets the on-wake catch-up sweep
// decide which jobs missed their slot, and is also the restart-flood guard:
// opening the laptop twice within a job's interval re-runs nothing because the
// stale-in-memory `null` is replaced by the real last-run timestamp on load.
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { JobRecord, SchedulerJobType } from "../types.js";
import { resolveSchedulerStatePath } from "./data-paths.js";

/**
 * Atomic write: write to a pid-suffixed temp file then renameSync over the
 * target. rename() is atomic on POSIX, so a concurrent reader sees either the
 * old whole file or the new whole file — NEVER a torn half-write (which JSON.parse
 * rejects → readers reset to {} → catch-up re-floods every job on next wake).
 */
export function atomicWriteJson(path: string, data: string): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** ~/.bodhi/ already exists (token-events.jsonl lives there). */
export const SCHEDULER_STATE_PATH = resolveSchedulerStatePath();

/** On-disk shape — ISO string for lastRun so JSON round-trips cleanly. */
interface PersistedJob {
  lastRun: string | null;
  lastResult: JobRecord["lastResult"];
  lastDurationMs: number | null;
}
type PersistedState = Record<string, PersistedJob>;

/**
 * Hydrate the in-memory job Map from disk. Called once at start(), BEFORE any
 * catch-up decision. Missing file / parse error → no-op (jobs keep their
 * constructor defaults of lastRun:null, which the sweep treats as "never ran →
 * eligible"). Best-effort: a read failure must never block scheduler start.
 */
export function loadJobState(
  jobs: Map<SchedulerJobType, JobRecord>,
  path = resolveSchedulerStatePath(),
): void {
  try {
    if (!existsSync(path)) return;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedState;
    for (const [type, rec] of jobs) {
      const p = parsed[type];
      if (!p) continue;
      rec.lastRun = p.lastRun ? new Date(p.lastRun) : null;
      rec.lastResult = p.lastResult ?? null;
      rec.lastDurationMs = p.lastDurationMs ?? null;
    }
  } catch (err) {
    console.warn(
      "[scheduler] job-state load failed (using defaults):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Flush the in-memory job Map to disk. Called after every job run (the existing
 * `job.lastRun = …` bookkeeping is extended by the guardCron wrapper to also
 * call this). Synchronous writeFileSync — the state is tiny (~20 rows) and a
 * sync write avoids interleaving from two flushes racing. Best-effort.
 */
export function flushJobState(
  jobs: Map<SchedulerJobType, JobRecord>,
  path = resolveSchedulerStatePath(),
): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const out: PersistedState = {};
    for (const [type, rec] of jobs) {
      out[type] = {
        lastRun: rec.lastRun ? rec.lastRun.toISOString() : null,
        lastResult: rec.lastResult,
        lastDurationMs: rec.lastDurationMs,
      };
    }
    atomicWriteJson(path, JSON.stringify(out, null, 2));
  } catch (err) {
    console.warn(
      "[scheduler] job-state flush failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
