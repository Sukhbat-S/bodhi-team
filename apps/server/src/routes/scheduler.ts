import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import {
  RETAINED_JOB_TYPES,
  type RetainedSchedulerJobType,
  type SchedulerContract,
  type SchedulerJobScope,
} from "@seneca/scheduler";
import type { AuditService } from "../lib/audit.js";
import { TRANSIENT_ERROR_SIGNATURE } from "../lib/cron-error-class.js";

export interface SchedulerStatus {
  state: "leader" | "standby" | "degraded" | "stopped";
  started: boolean;
  running: boolean;
  lockOwned: boolean;
  registeredTaskCount: number;
  catchUpTaskCount: number;
  contract: SchedulerContract;
  lastSupervisorTickAt: string | null;
  lastCatchUpSweepAt: string | null;
  timezone: string;
  jobs: Array<{
    type: string;
    scope: SchedulerJobScope | "retired";
    lastRun: string | null;
    lastResult: string | null;
    lastDurationMs: number | null;
  }>;
}

export interface SchedulerTriggerResult {
  status: string;
  content?: string;
  error?: string;
  [key: string]: unknown;
}

/** The only scheduler surface retained by the HTTP composition root. */
export interface SchedulerRouteScheduler {
  getStatus(): SchedulerStatus;
  trigger(type: RetainedSchedulerJobType): Promise<SchedulerTriggerResult>;
  runStalenessCheck(opts?: { force?: boolean }): Promise<unknown>;
}

export interface SchedulerRoutesDeps {
  db: Database;
  scheduler: SchedulerRouteScheduler;
  audit: AuditService;
}

const RETIRED_TRIGGER_TYPES = [
  "morning",
  "evening",
  "weekly",
  "synthesis",
  "persona-refresh",
  "retrieval-scope-ab",
  "daily-digest",
  "calendar-lookahead",
  "architect-mode-sync",
  "verify-dispatches",
  "substrate-curation",
  "research",
  "jewelry-advisor",
  "sentry-nightly",
  "memory-triage",
] as const;

/** Deterministic scheduler APIs; user-facing briefings belong to Codex. */
export function mountSchedulerRoutes(app: Hono, deps: SchedulerRoutesDeps): Hono {
  const { db, scheduler, audit } = deps;

  app.get("/api/scheduler", (c) => c.json(scheduler.getStatus()));

  app.post("/api/scheduler/trigger", async (c) => {
    const body: { type?: string } = await c.req.json<{ type?: string }>().catch(() => ({}));
    const type = body.type;
    if (type && (RETIRED_TRIGGER_TYPES as readonly string[]).includes(type)) {
      return c.json({
        error: "scheduler capability retired",
        capability: type,
        replacement: "Use a native Codex Desktop scheduled task when an outward outcome is required.",
      }, 410);
    }
    if (!type || !(RETAINED_JOB_TYPES as readonly string[]).includes(type)) {
      return c.json({ error: `type must be one of: ${RETAINED_JOB_TYPES.join(", ")}` }, 400);
    }

    const result = await scheduler.trigger(type as RetainedSchedulerJobType);
    await audit.write({
      kind: "scheduler.fire",
      actor: `scheduler:${type}`,
      target: null,
      payload: null,
      metadata: { triggeredAt: new Date().toISOString(), manual: true },
    });
    return c.json(result);
  });

  app.post("/api/scheduler/staleness-check", async (c) => {
    const body = await c.req
      .json<{ force?: boolean }>()
      .catch(() => ({}) as { force?: boolean });
    const force = !!body.force;
    const result = await scheduler.runStalenessCheck({ force });
    await audit.write({
      kind: "scheduler.staleness-check",
      actor: "scheduler:staleness",
      target: null,
      payload: null,
      metadata: { triggeredAt: new Date().toISOString(), manual: true, force },
    });
    return c.json(result ?? { ok: true });
  });

  app.get("/api/scheduler/job-stats", async (c) => {
    const rawDays = parseInt(c.req.query("days") || "30", 10);
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(90, rawDays)) : 30;
    const isError = sql`(severity = 'error' OR payload->>'status' = 'error')`;
    const isTransient = sql`(
      COALESCE(payload->>'outcome', '') = 'skipped'
      OR COALESCE(payload->>'status', '') = 'skipped'
      OR COALESCE(payload->>'reason', '') = 'offline'
      OR COALESCE(payload->>'error', summary) ~* ${TRANSIENT_ERROR_SIGNATURE}
    )`;
    const rows = (await db.execute(sql`
      SELECT
        payload->>'jobName' AS job,
        COUNT(*)::int AS runs,
        COUNT(*) FILTER (WHERE ${isError})::int AS errors,
        COUNT(*) FILTER (WHERE ${isError} AND NOT ${isTransient})::int AS faults,
        COUNT(*) FILTER (WHERE ${isError} AND ${isTransient})::int AS transient,
        MAX(ts) AS last_ts
      FROM system_events
      WHERE payload ? 'jobName'
        AND ts > now() - (${days} || ' days')::interval
      GROUP BY 1
      ORDER BY 2 DESC
    `)) as unknown as Array<{
      job: string;
      runs: number;
      errors: number;
      faults: number;
      transient: number;
      last_ts: string;
    }>;
    return c.json({
      window: { days },
      jobs: rows.map((row) => ({
        job: row.job,
        runs: Number(row.runs),
        errors: Number(row.errors),
        faults: Number(row.faults),
        transient: Number(row.transient),
        lastTs: row.last_ts,
      })),
    });
  });

  return app;
}
