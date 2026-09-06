// ============================================================
// BODHI — Scheduler shared types
// Extracted from scheduler.ts during the Apr 26 C#4 split.
// jobs/*.ts files import from here (not from scheduler.ts) to
// avoid circular imports.
// ============================================================

import type { SchedulerConfig, SchedulerJobType } from "./scheduler.js";

export interface JobRecord {
  type: SchedulerJobType;
  lastRun: Date | null;
  lastResult: "sent" | "skipped" | "error" | "validation-failed" | null;
  lastDurationMs: number | null;
}

/**
 * Closure-tracking emitter contract. Structurally typed against
 * `apps/server/src/services/system-events.ts:SystemEventsService.record()`.
 * Best-effort, never throws — null on failure. Wired in from the server
 * side so the scheduler package stays decoupled from the app layer.
 */
export interface SystemEventsRecorder {
  record(input: {
    kind: string;
    summary: string;
    payload?: unknown;
    severity?: "info" | "warn" | "error";
  }): Promise<{ id: string } | null>;
}

/**
 * Context passed to extracted job functions in jobs/*.ts.
 * The Scheduler class exposes this via a `getCtx()` helper so its
 * private state can be threaded into free-function form.
 */
export interface SchedulerCtx {
  readonly config: SchedulerConfig;
  readonly jobs: Map<SchedulerJobType, JobRecord>;
  /** Closure-tracking emitter for durable job outcomes. */
  readonly systemEvents?: SystemEventsRecorder | null;
}

export type { SchedulerConfig, SchedulerJobType };
