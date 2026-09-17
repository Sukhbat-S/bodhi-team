// ============================================================
// BODHI — Substrate Maintenance Scheduler
// The active registration surface is deterministic truth-store maintenance.
// Codex owns user-facing briefings, research, communication, and execution.
// Only retained deterministic maintenance is imported or registered here.
// ============================================================

import cron, { type ScheduledTask } from "node-cron";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Connectivity-error matcher (Jun 21). BODHI runs on a MacBook that sleeps /
 * goes offline overnight, so network-bound evaluation jobs throw DNS/socket/timeout
 * errors on offline nights and run green on online days. guardCron uses this to
 * emit a `skipped`/`offline` outcome instead of a hard `cron-error` for THOSE
 * errors only — preserving real-failure visibility for everything else.
 *
 * Centralized Jul 17 into ./lib/offline-error.ts (the single source of truth;
 * see that file for the conservative-by-design rationale). Re-exported here so
 * existing callers can share the same conservative classifier.
 */
import { isOfflineError } from "./lib/offline-error.js";
export { isOfflineError };

export interface SchedulerConfig {
  /** IANA timezone used by node-cron. */
  timezone: string;
  /**
   * Override for the singleton cron-lock file (default ~/.bodhi/scheduler.lock).
   * Tests MUST pass a per-test tmp path: with the default, a test's
   * "real Scheduler.start()" contends for the PRODUCTION lock against the live
   * dev server — pass/fail then depends on tsx-watch restart timing, and a
   * winning reclaim steals the live server's lock (proven flaky Jul 10).
   */
  lockPath?: string;
  /** Durable event sink for job outcomes and staleness alarms. */
  systemEvents?: SystemEventsRecorder | null;
}

// JobRecord re-exported from ./types for back-compat. The split-out jobs/*.ts
// files import it directly from types.ts to avoid a circular dep.
import type { JobRecord, SchedulerCtx, SystemEventsRecorder } from "./types.js";
export type { JobRecord, SystemEventsRecorder };

// C#4 split (Apr 26): job bodies moved to jobs/*.ts.
// scheduler.ts retains class shell (cron registration, public API,
// 1-line delegators) so the SchedulerConfig contract + tests are unchanged.
import {
  runRetrievalEval as runRetrievalEvalImpl,
  runLibraryRetrievalEval as runLibraryRetrievalEvalImpl,
  runCoherenceCheck as runCoherenceCheckImpl,
  runSystemEventsRetention as runSystemEventsRetentionImpl,
  runForgettingTier as runForgettingTierImpl,
} from "./jobs/system.js";
import { runMaintenanceLiveness as runMaintenanceLivenessImpl } from "./jobs/maintenance-liveness.js";
import { runParkingMaintenance as runParkingMaintenanceImpl } from "./jobs/parking-maintenance.js";
import { runCheckpointMaintenance as runCheckpointMaintenanceImpl } from "./jobs/checkpoint-maintenance.js";
import { registerSchedulerCronJobs } from "./cron-registration.js";
// Durable job state + on-wake catch-up (Jun 13) — laptop sleeps through
// pre-dawn cron slots; node-cron doesn't replay them. See lib/job-state.ts +
// lib/catch-up.ts for the full rationale.
import { loadJobState, flushJobState } from "./lib/job-state.js";
import { resolveSchedulerLockPath } from "./lib/data-paths.js";
import {
  CATCH_UP_META,
  CATCH_UP_STARTUP_GRACE_MS,
  CATCH_UP_STAGGER_MS,
  CATCH_UP_IMMINENT_SLOT_MS,
  CATCH_UP_SLOT_GUARD_EXEMPT,
  isStale,
  isSlotImminent,
} from "./lib/catch-up.js";
import {
  CATCH_UP_JOB_TYPES,
  RETAINED_JOB_TYPES,
  SCHEDULER_CONTRACT,
  getRetainedSchedulerJob,
  isRetainedJobEnabled,
  type SchedulerJobScope,
  type RetainedSchedulerJobType,
} from "./contract.js";
import {
  checkStaleness,
  selectNewlyStale,
  stampDelivered,
  composeStalenessAlert,
} from "./lib/staleness.js";

export type SchedulerJobType = RetainedSchedulerJobType;
export class Scheduler {
  private config: SchedulerConfig;
  private tasks: ScheduledTask[] = [];
  /**
   * Live task handles for the catch-up-eligible jobs ONLY, keyed by
   * SchedulerJobType (Jul 26). The sweep asks each handle for its next real slot
   * (`getNextRun()`) so it can skip a replay that the slot itself is about to do.
   *
   * WHY A LOCAL MAP AND NOT `cron.getTask(name)`: node-cron's global registry is
   * keyed by an auto-generated `task.id` (`createID('task', 12)`), NOT by the
   * `name` option — `registry.get(taskId)` in node-cron 4.2.1's task-registry.js.
   * `cron.getTask("retrieval-eval")` therefore returns undefined no matter what
   * `name` is passed, which would silently reduce this whole guard to a no-op.
   * Holding the handle returned by cron.schedule() is exact and per-instance
   * (no cross-Scheduler global-registry bleed in tests).
   */
  private catchUpTasks: Map<SchedulerJobType, ScheduledTask> = new Map();
  private jobs: Map<SchedulerJobType, JobRecord> = new Map();
  private started = false;
  private running = false;

  // Singleton guard (Jun 13): cross-process lockfile at ~/.bodhi/scheduler.lock
  // holding the owning PID. Stale `tsx watch` processes (live ps: 6 servers, 2
  // :4000 listeners) each registered KAIROS-lite, multiplexing every cron ~7×.
  // The guard lets only ONE process register the crons; we record whether THIS
  // process holds the lock so stop() only releases its own.
  private readonly lockPath: string;
  private holdsLock = false;
  private lockError: string | null = null;

  /**
   * Throttle for the on-wake catch-up sweep RIDDEN by the every-5-min watch tick (Jul 17).
   * The boot-only sweep never replays a slot slept-through mid-run: a multi-day-
   * uptime process misses every pre-dawn cron while the Mac sleeps and never
   * reboots to re-fire the sweep. Re-arming it on the reliable watch loop heals
   * that; the sweep is idempotent + per-job staleness-gated (CATCH_UP_META), so
   * this ≤1/hr throttle only spares a needless hourly DB lastRun check every 5min.
   * Seeded to the boot-sweep time so the first post-boot hour is already covered.
   */
  private lastCatchUpSweepAt = 0;
  private static readonly CATCH_UP_SWEEP_MIN_INTERVAL_MS = 60 * 60 * 1000;
  private lastSupervisorTickAt = 0;
  private supervisorRunning = false;
  private static readonly SUPERVISOR_STALE_AFTER_MS = 15 * 60 * 1000;

  /**
   * Acquire the singleton lock. Returns true if this process may register crons.
   * If a live holder exists → false (skip). A stale lock (no file, or the PID is
   * dead) is reclaimed so a crash never permanently blocks the scheduler.
   * Dependency-free: node fs + os only.
   */
  private acquireSchedulerLock(): boolean {
    this.lockError = null;
    try {
      mkdirSync(dirname(this.lockPath), { recursive: true });
      // Atomic acquire (Jun 13, hardened): exclusive create (`wx`) so only ONE
      // racing process can win — a plain existsSync→write was a TOCTOU race
      // (two servers starting within ms both passed the liveness check and both
      // wrote their PID, re-creating the N× cron multiplex this guard exists to
      // kill). On EEXIST we inspect the holder: live → skip; ours → idempotent;
      // stale/dead → unlink and retry the exclusive create (bounded loop so a
      // reclaim race resolves to exactly one winner).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
          this.holdsLock = true;
          return true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          let raw = "";
          try { raw = readFileSync(this.lockPath, "utf8").trim(); } catch { /* vanished */ }
          const pid = Number.parseInt(raw, 10);
          if (pid === process.pid) { this.holdsLock = true; return true; } // already ours
          let alive = false;
          if (Number.isInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0); // signal 0 = liveness probe, doesn't kill
              alive = true;
            } catch {
              alive = false; // ESRCH (dead) or EPERM (alive, other user)
            }
          }
          if (alive) {
            console.warn(`[scheduler] already running in pid ${pid} — skipping cron registration`);
            return false;
          }
          // Stale/dead holder — reclaim and retry the exclusive create.
          console.warn(`[scheduler] reclaiming stale lock from dead pid ${pid || "?"}`);
          try { unlinkSync(this.lockPath); } catch { /* another process may have reclaimed first */ }
        }
      }
      // Both attempts lost the reclaim race to a live winner — skip.
      console.warn("[scheduler] lost lock reclaim race — skipping cron registration");
      return false;
    } catch (err) {
      // Lock IO failed — fail closed. Registering without exclusive ownership
      // recreates the duplicate-cron class this lock exists to prevent.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[scheduler] lock acquire failed (${msg}) — scheduler degraded`);
      this.lockError = msg;
      this.holdsLock = false;
      return false;
    }
  }

  /** Release the lock iff this process owns it (clean shutdown). */
  private releaseSchedulerLock(): void {
    if (!this.holdsLock) return;
    try {
      if (existsSync(this.lockPath)) {
        const pid = Number.parseInt(readFileSync(this.lockPath, "utf8").trim(), 10);
        if (pid === process.pid) unlinkSync(this.lockPath);
      }
    } catch { /* best-effort */ }
    this.holdsLock = false;
  }

  /**
   * Build the SchedulerCtx passed to extracted job functions in jobs/*.ts.
   * Created on demand (not stored) so private state is always read live.
   */
  private getCtx(): SchedulerCtx {
    const ctx: SchedulerCtx = {
      config: this.config,
      jobs: this.jobs,
      systemEvents: this.config.systemEvents ?? null,
    };
    return ctx;
  }

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.lockPath = config.lockPath ?? resolveSchedulerLockPath();

    // Initialize only the retained substrate contract.
    for (const type of RETAINED_JOB_TYPES) {
      this.jobs.set(type, {
        type,
        lastRun: null,
        lastResult: null,
        lastDurationMs: null,
      });
    }
  }

  /**
   * Wrap a cron callback so an UNCAUGHT throw/rejection emits a `cron-error`
   * system_event with `payload.cron_name = <name>` — the producer the
   * suggest_next_action oracle's failed_cron tier reads (it partitions
   * recurrence by `payload->>'cron_name'`). Fire-and-forget cron callbacks
   * otherwise reject silently and the tier stays decorative (failedCronCount
   * was structurally always 0). ALWAYS wrap new cron callbacks in this — it
   * makes the safe behavior the default. Jobs that emit their own job-kind
   * error events still do so; this is the catastrophic-uncaught backstop.
   */
  private guardCron(name: string, fn: () => unknown): () => Promise<void> {
    return async () => {
      try {
        await fn();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Offline-skip (Jun 21): a connectivity error on a sleeping/offline
        // laptop is not a real failure. Emit a quiet `skipped`/`offline`
        // outcome (same kind shape, severity:info) so it stops surfacing as a
        // cron-error in the failed_cron tier — but ANY non-connectivity error
        // still emits the normal error event below (don't mask real breakage).
        if (isOfflineError(err)) {
          console.warn(`[scheduler] cron '${name}' skipped (offline):`, errMsg.slice(0, 120));
          try {
            await this.config.systemEvents?.record({
              kind: "cron-error",
              summary: `cron ${name} skipped (offline): ${errMsg.slice(0, 100)}`,
              severity: "info",
              payload: { cron_name: name, outcome: "skipped", reason: "offline", error: errMsg },
            });
          } catch (emitErr) {
            console.error(
              `[scheduler] cron-skip emit failed for '${name}':`,
              emitErr instanceof Error ? emitErr.message : emitErr,
            );
          }
          return;
        }
        console.error(`[scheduler] cron '${name}' threw uncaught:`, err);
        try {
          await this.config.systemEvents?.record({
            kind: "cron-error",
            summary: `cron ${name} failed: ${errMsg.slice(0, 120)}`,
            severity: "error",
            payload: { cron_name: name, error: errMsg },
          });
        } catch (emitErr) {
          console.error(
            `[scheduler] cron-error emit failed for '${name}':`,
            emitErr instanceof Error ? emitErr.message : emitErr,
          );
        }
      } finally {
        // Durable state (Jun 13): every job body mutates job.lastRun/lastResult/
        // lastDurationMs in its JobRecord; flush the whole Map to disk after each
        // run so a wake-up catch-up sweep + the restart-flood guard can read the
        // real last-run timestamp instead of the reset in-memory null.
        flushJobState(this.jobs);
      }
    };
  }

  /**
   * Record a catch-up-eligible job's LIVE task handle, keyed by its
   * SchedulerJobType, and pass the handle straight through so call sites stay
   * `this.tasks.push(this.trackCatchUp(<type>, cron.schedule(...)))` (Jul 26).
   *
   * The sweep reads `getNextRun()` off these handles to skip a replay whose real
   * slot is imminent. Wrap EVERY cron.schedule() whose job type appears in
   * CATCH_UP_META — an unwrapped one silently reverts to staleness-only
   * selection, i.e. it keeps double-running while looking fixed.
   *
   * ⚠ The `type` here is the CATCH_UP_META key, which is NOT always the
   * The typed job key is kept separate from node-cron's untyped display name.
   */
  private trackCatchUp(type: SchedulerJobType, task: ScheduledTask): ScheduledTask {
    if (!CATCH_UP_META[type]) {
      // Not catch-up-eligible → tracking it would be dead weight. Loud, because
      // it means this call site and CATCH_UP_META disagree about the job.
      console.warn(`[scheduler] trackCatchUp('${type}') — not a CATCH_UP_META key; not tracked`);
      return task;
    }
    this.catchUpTasks.set(type, task);
    return task;
  }

  /**
   * Start all retained cron jobs.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Singleton guard (Jun 13): only one process may own the cron loops. If a
    // live holder exists, skip registration entirely — N concurrent server
    // processes must not run N KAIROS-lite loops (the root multiplier behind
    // A1/A2's floods). A duplicate process reports standby and owns no tasks.
    if (!this.acquireSchedulerLock()) {
      this.running = false;
      // FIX 4 (Jun 13) boot fail-open: a non-holder registers no crons (so it
      // never rides a legacy watcher loop. Still
      // hydrate disk state + fire ONE read-only staleness check at boot, so a
      // dead backup / regressed job is surfaced even on the process that lost the
      // lock race. Detection is read-only + self-dedup'd — safe to run here.
      loadJobState(this.jobs);
      void this.runStalenessCheck();
      return;
    }

    // Hydrate durable job state from ~/.bodhi/scheduler-state.json BEFORE the
    // catch-up decision (Jun 13). This replaces the constructor's in-memory
    // lastRun:null with the real last-run timestamp — both feeding the on-wake
    // sweep AND acting as the restart-flood guard (two laptop-opens within a
    // job's interval re-run nothing because lastRun is no longer a fresh null).
    loadJobState(this.jobs);

    registerSchedulerCronJobs({
      timezone: this.config.timezone,
      schedule: (expression, callback, options) => cron.schedule(expression, callback, options),
      addTask: (task) => this.tasks.push(task),
      guardCron: (name, fn) => this.guardCron(name, fn),
      trackCatchUp: (type, task) => this.trackCatchUp(type, task),
      runRetrievalEval: () => this.runRetrievalEval(),
      runCoherenceCheck: () => this.runCoherenceCheck(),
      runSystemEventsRetention: () => this.runSystemEventsRetention(),
      runForgettingTier: () => this.runForgettingTier(),
      runParkingMaintenance: () => this.runParkingMaintenance(),
      runMaintenanceLiveness: () => this.runMaintenanceLiveness(),
      runCheckpointMaintenance: () => this.runCheckpointMaintenance(),
      runLibraryRetrievalEvalGated: () => this.runLibraryRetrievalEvalGated(),
      runMaintenanceSupervisorTick: () => this.runMaintenanceSupervisorTick(),
    });

    // `running` means this process is the singleton leader with live tasks.
    // `started` separately records that start() was invoked.
    this.running = this.holdsLock && this.tasks.length > 0;

    // Slot-guard registration tripwire (Jul 26). The imminent-slot guard is only
    // as good as its task handles: an enabled catch-up job with NO handle falls
    // back to staleness-only and keeps double-running while the fix looks
    // applied. Shout at boot rather than degrade quietly. Never blocks.
    for (const type of Object.keys(CATCH_UP_META) as SchedulerJobType[]) {
      if (CATCH_UP_SLOT_GUARD_EXEMPT.has(type)) continue;
      if (!this.isCatchUpJobEnabled(type)) continue; // legitimately not registered
      if (this.catchUpTasks.has(type)) continue;
      console.warn(
        `[scheduler] catch-up slot-guard: '${type}' is enabled but has no registered task — ` +
          `its cron.schedule() site is missing trackCatchUp("${type}"). ` +
          `Falling back to staleness-only selection for it.`,
      );
    }

    // One boot tick, then cron re-arms this path every five minutes.
    void this.runMaintenanceSupervisorTick();
  }

  /**
   * Substrate-only supervisor for catch-up and staleness maintenance.
   */
  async runMaintenanceSupervisorTick(opts?: { forceCatchUpCheck?: boolean }): Promise<{
    status: "ran" | "skipped";
    reason?: "not-leader" | "already-running";
    catchUpChecked: boolean;
  }> {
    if (!this.running || !this.holdsLock) {
      return { status: "skipped", reason: "not-leader", catchUpChecked: false };
    }
    if (this.supervisorRunning) {
      return { status: "skipped", reason: "already-running", catchUpChecked: false };
    }

    this.supervisorRunning = true;
    let catchUpChecked = false;
    try {
      const now = Date.now();
      // Record tick start before awaiting the sweep so a wedged supervisor can
      // become stale/degraded instead of reporting an eternal null timestamp.
      this.lastSupervisorTickAt = now;
      const catchUpDue = process.env.SCHEDULER_CATCHUP_ENABLED !== "false"
        && (opts?.forceCatchUpCheck === true
          || now - this.lastCatchUpSweepAt >= Scheduler.CATCH_UP_SWEEP_MIN_INTERVAL_MS);
      if (catchUpDue) {
        this.lastCatchUpSweepAt = now;
        catchUpChecked = true;
        await this.runCatchUpSweep();
      } else {
        await this.runStalenessCheck();
      }
      return { status: "ran", catchUpChecked };
    } finally {
      this.lastSupervisorTickAt = Date.now();
      this.supervisorRunning = false;
    }
  }

  /**
   * On-wake catch-up sweep (Jun 13). Public + manually invokable for tests
   * (force=true skips the startup grace + staleness gate so a single missed job
   * can be replayed on demand).
   *
   * For each catch-up-eligible job (CATCH_UP_META; high-frequency loops are
   * excluded by omission), if it is stale per the DISK lastRun — or force — it
   * is run SEQUENTIALLY (concurrency 1) with a stagger between jobs and a short
   * startup grace, so laptop-open doesn't fire a dozen LLM jobs at once.
   *
   * OFFLINE/FAILURE SOFT: lastRun is snapshotted before each run and RESTORED if
   * the job returns status 'error' (or throws), so a failed catch-up (e.g. no
   * internet) does NOT advance lastRun and the job retries on the next wake.
   * Only success / clean-skip advances lastRun (the job body already does this).
   *
   * IMMINENT-SLOT GUARD (Jul 26): staleness alone over-selects on a sleeping
   * host. catchUpAfterMs is 20h for every daily job, so a mid-morning wake makes
   * EVERY daily job read "stale" even when its real slot is hours away — it
   * replays, then the slot fires the same day (measured: 14 job types, 79
   * redundant runs / 7d). A job whose next LIVE cron slot lands within
   * CATCH_UP_IMMINENT_SLOT_MS is therefore skipped, and the skip is reported.
   * `force` bypasses it; an unregistered job falls back to staleness-only.
   *
   * @param opts.force run every eligible job regardless of staleness + skip the grace.
   * @param opts.only restrict to a single job type (test helper).
   */
  async runCatchUpSweep(opts?: { force?: boolean; only?: SchedulerJobType }): Promise<{
    eligible: SchedulerJobType[];
    ran: { type: SchedulerJobType; status: string }[];
    skipped: { type: SchedulerJobType; reason: string; nextRunAt: string }[];
  }> {
    // Singleton: only the lock-holder runs the catch-up REPLAY (re-running a
    // job). A non-holder (duplicate process) must not double-run jobs — BUT the
    // read-only staleness DETECTION must still fire at boot regardless of lock
    // ownership (FIX 4, Jun 13), else a process that lost the lock race never
    // surfaces a dead backup / regressed job until its next */5 tick (and a
    // non-cron-registering duplicate never would). Detection is read-only +
    // self-dedup'd, so running it from a non-holder is safe.
    if (!this.holdsLock) {
      await this.runStalenessCheck();
      return { eligible: [], ran: [], skipped: [] };
    }

    const now = Date.now();
    const eligible: SchedulerJobType[] = [];
    const skipped: { type: SchedulerJobType; reason: string; nextRunAt: string }[] = [];
    for (const [type, meta] of Object.entries(CATCH_UP_META) as [
      SchedulerJobType,
      { catchUpAfterMs: number },
    ][]) {
      if (opts?.only && type !== opts.only) continue;
      if (!this.isCatchUpJobEnabled(type)) continue;
      const job = this.jobs.get(type);
      const stale = opts?.force || isStale(job?.lastRun ?? null, meta.catchUpAfterMs, now);
      if (!stale) continue;

      // Imminent-slot guard. `force` is the manual/test escape hatch and must
      // still bypass it. getNextRun() reads the LIVE registered cron (no
      // hand-maintained schedule mirror); a job with no handle — not registered
      // this boot, env-gated off, task stopped — yields null and falls back to
      // the staleness-only decision above.
      if (!opts?.force) {
        const nextRun = this.catchUpTasks.get(type)?.getNextRun() ?? null;
        if (isSlotImminent(nextRun, CATCH_UP_IMMINENT_SLOT_MS, now)) {
          skipped.push({
            type,
            reason: "slot-imminent",
            nextRunAt: nextRun!.toISOString(),
          });
          continue;
        }
      }
      eligible.push(type);
    }

    // Report the skips BEFORE the empty-eligible early return (Jul 26): a sweep
    // that skipped everything must not look like a sweep that found nothing.
    // A change that quietly stops doing something is indistinguishable from a
    // change that broke it.
    if (skipped.length > 0) {
      const graceHrs = Math.round(CATCH_UP_IMMINENT_SLOT_MS / 3_600_000);
      const detail = skipped
        .map((s) => `${s.type}@${new Date(s.nextRunAt).toLocaleTimeString("en-GB", { timeZone: this.config.timezone })}`)
        .join(", ");
      console.log(
        `[scheduler] catch-up sweep: skipped ${skipped.length} stale job(s) — next slot within ${graceHrs}h → ${detail}`,
      );
      this.config.systemEvents?.record({
        kind: "catch-up",
        summary: `catch-up: skipped ${skipped.length} job(s) — next slot within ${graceHrs}h (${skipped.map((s) => s.type).join(", ")})`,
        severity: "info",
        payload: {
          outcome: "skipped",
          reason: "slot-imminent",
          graceMs: CATCH_UP_IMMINENT_SLOT_MS,
          sweptAt: new Date(now).toISOString(),
          skipped,
        },
      }).catch(() => { /* best-effort */ });
    }

    const ran: { type: SchedulerJobType; status: string }[] = [];
    if (eligible.length === 0) {
      this.emitCatchUpSweepSignal(eligible, ran, skipped);
      return { eligible, ran, skipped };
    }

    console.log(
      `[scheduler] catch-up sweep: ${eligible.length} stale job(s) → ${eligible.join(", ")}`,
    );

    // Startup grace so laptop-open settles before the first LLM job.
    if (!opts?.force) await this.sleep(CATCH_UP_STARTUP_GRACE_MS);

    for (let i = 0; i < eligible.length; i++) {
      const type = eligible[i];
      const job = this.jobs.get(type);
      const prevLastRun = job?.lastRun ?? null; // snapshot for soft-fail restore
      let status = "error";
      try {
        const result = await this.trigger(type);
        status = result.status;
      } catch (err) {
        console.error(
          `[scheduler] catch-up '${type}' threw:`,
          err instanceof Error ? err.message : err,
        );
        status = "error";
      }
      // OFFLINE/FAILURE SOFT: on error, do NOT advance lastRun — restore the
      // pre-run timestamp so the job stays stale and retries next wake.
      // FIX 5 (Jun 13) flush-interleave invariant: the restore + flush below MUST
      // stay in ONE synchronous tick (no await between them). flushJobState is a
      // sync writeFileSync, so as long as nothing yields here a sibling cron's
      // concurrent flush (also sync, fired from its guardCron finally) cannot
      // observe or persist a half-restored Map — JS single-threaded event-loop
      // semantics make this section atomic w.r.t. other flushes. Do not insert an
      // `await` between the restore and the flush.
      if (status === "error" && job) {
        job.lastRun = prevLastRun;
      } else if (status !== "error" && job && (job.lastRun === prevLastRun || job.lastRun == null)) {
        // SAFETY NET (Jul 8): a job body is expected to stamp job.lastRun itself,
        // but a body that forgets to stamp would leave lastRun
        // un-advanced after a SUCCESSFUL replay → isStale stays true → the sweep
        // re-replays it on every registration (the replay storm). Guarantee that a
        // successful catch-up ALWAYS advances lastRun, so a caught-up job is not
        // re-selected within its window regardless of body hygiene. (Kept in the
        // same synchronous tick as the error-restore above — see FIX 5.)
        job.lastRun = new Date();
      }
      flushJobState(this.jobs);
      ran.push({ type, status });

      // Observability (Jun 14): emit a queryable system_event per replayed job so
      // catch-up activity is directly visible (autonomy/status + events timeline),
      // not just inferred from lastRun advancing off-slot. Best-effort: a telemetry
      // failure must never break the sweep.
      const stalenessMs = prevLastRun ? now - new Date(prevLastRun).getTime() : null;
      const staleStr = stalenessMs ? `${Math.round(stalenessMs / 3_600_000)}h` : "never-ran";
      this.config.systemEvents?.record({
        kind: "catch-up",
        summary: `catch-up: replayed ${type} (missed by ${staleStr}) → ${status}`,
        severity: status === "error" ? "warn" : "info",
        payload: { jobType: type, lastRun: prevLastRun, ranAt: new Date().toISOString(), status },
      }).catch(() => { /* best-effort */ });

      // Stagger before the next job (skip after the last one / when forced).
      if (!opts?.force && i < eligible.length - 1) {
        await this.sleep(CATCH_UP_STAGGER_MS);
      }
    }

    console.log(
      `[scheduler] catch-up sweep done: ${ran.map((r) => `${r.type}=${r.status}`).join(", ")}`,
    );
    // Detection half: after catch-up HEALS the eligible jobs, flag whatever is
    // still stale (non-eligible regression, the launchd backup, or a job
    // catch-up failed to heal). Fail-safe — never throws.
    await this.runStalenessCheck();
    this.emitCatchUpSweepSignal(eligible, ran, skipped);
    return { eligible, ran, skipped };
  }

  /** One structured recovery receipt per leader sweep, including a no-op wake. */
  private emitCatchUpSweepSignal(
    eligible: SchedulerJobType[],
    ran: { type: SchedulerJobType; status: string }[],
    skipped: { type: SchedulerJobType; reason: string; nextRunAt: string }[],
  ): void {
    this.config.systemEvents?.record({
      kind: "catch-up-sweep",
      summary: `catch-up sweep checked ${eligible.length + skipped.length} stale job(s); ran ${ran.length}, skipped ${skipped.length}`,
      severity: ran.some((entry) => entry.status === "error") ? "warn" : "info",
      payload: {
        outcome: "checked",
        checkedAt: new Date().toISOString(),
        eligibleCount: eligible.length,
        ranCount: ran.length,
        skippedCount: skipped.length,
        ran,
        skipped,
      },
    }).catch(() => { /* best-effort recovery observability */ });
  }

  /**
   * Staleness watcher (Jun 13) — the DETECTION half of binding-rot. Ridden by
   * the KAIROS every-5-min loop (NOT a new wall-clock cron, which would itself
   * sleep) and called once at the end of runCatchUpSweep (so it only flags what
   * catch-up did NOT heal). Fail-SAFE (never throws to the caller) + fail-LOUD
   * (one log line when env-disabled — silence is the very anti-pattern this
   * build fixes). Returns the alerted subset so it's testable on demand.
   *
   * Backup-stale / local-pg data-loss risk → HIGH urgency (pierces bandwidth
   * gating). Stale daily jobs alone → MEDIUM (respect KAIROS's existing gate).
   */
  async runStalenessCheck(
    opts?: { force?: boolean },
  ): Promise<{ alerted: boolean; staleJobs: { type: SchedulerJobType; ageHrs: number }[]; backupStale: boolean }> {
    const NONE = { alerted: false, staleJobs: [], backupStale: false };
    // FIX 3 (Jun 13) reentrancy guard: runCatchUpSweep's tail and the */5 watch
    // loop both reach here — a slow event emission must not let a second invocation
    // overlap the first (it would re-evaluate staleness mid-stamp). Skip if busy.
    if (this.stalenessRunning) {
      console.log("[staleness] check already running — skipping reentrant call");
      return NONE;
    }
    this.stalenessRunning = true;
    try {
      if (process.env.STALENESS_WATCH_ENABLED === "false") {
        // Fail-LOUD on disable — do NOT no-op silently.
        console.log("[staleness] watch disabled (STALENESS_WATCH_ENABLED=false) — skipping check");
        return NONE;
      }

      // FIX 3 (Jun 13): serialize the ledger load→modify→save. Both the
      // catch-up sweep tail and the */5 watch loop reach this in-process, and
      // the reentrancy guards can't cover the catch-up↔watch cross path, so a
      // dedicated promise-chain mutex makes the select→stamp critical section
      // atomic w.r.t. itself (loadLedger / saveLedger run inside stampDelivered).
      return await this.withStalenessLock(async () => {
        const result = checkStaleness(this.jobs);
        // FIX 2 (Jun 13): READ-ONLY selection. The ledger is NOT stamped here —
        // only after delivery confirms below, so a deferred/failed send can't
        // mute the HIGH backup-dead alarm for 18h.
        const due = selectNewlyStale(result, Date.now(), { force: opts?.force });
        const alert = composeStalenessAlert(due);
        if (!alert) return { alerted: false, staleJobs: due.staleJobs, backupStale: due.backupStale };

        // Staleness is a durable substrate signal, not an outward delivery.
        // Record the event first and stamp the dedup ledger only when the
        // recorder returns a durable id. A missing/failed recorder must remain
        // retryable; it must never be treated as an implicit delivery.
        const recorder = this.config.systemEvents;
        if (!recorder) {
          console.warn("[staleness] no system-events recorder — not stamped; will retry");
          return { alerted: false, staleJobs: due.staleJobs, backupStale: due.backupStale };
        }
        const emitted = await recorder.record({
          kind: "staleness-alert",
          summary: alert.text,
          severity: due.backupStale ? "error" : "warn",
          payload: { ...due, urgency: alert.urgency },
        });
        if (!emitted?.id) {
          console.warn("[staleness] system-event emission did not return an id — not stamped; will retry");
          return { alerted: false, staleJobs: due.staleJobs, backupStale: due.backupStale };
        }

        // Durable event confirmed → stamp the ledger so we dedup for 18h.
        stampDelivered({ staleJobs: due.staleJobs, backupStale: due.backupStale });
        console.log(`[staleness] durable alert emitted (${emitted.id}) — stamped`);

        return { alerted: true, staleJobs: due.staleJobs, backupStale: due.backupStale };
      });
    } catch (err) {
      // Fail-SAFE: the check must never throw into the watcher loop.
      console.error(
        "[staleness] check failed (continuing):",
        err instanceof Error ? err.message : String(err),
      );
      return NONE;
    } finally {
      this.stalenessRunning = false;
    }
  }

  /** FIX 3 (Jun 13) reentrancy flag for runStalenessCheck — see guard at top. */
  private stalenessRunning = false;

  /**
   * In-process async mutex for the staleness ledger critical section (FIX 3,
   * Jun 13). Catch-up and manual status checks reach
   * the ledger load->modify->save; a promise-chain serializes them so a concurrent
   * stamp can't read-modify-write over a sibling's mutation. Errors propagate
   * but never wedge the chain (the tail resets it once drained).
   */
  private stalenessChain: Promise<unknown> = Promise.resolve();
  private withStalenessLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.stalenessChain.then(fn, fn);
    // Keep the chain alive but swallow rejections so one failure doesn't poison
    // every later acquirer; the actual result/throw still reaches `next`.
    this.stalenessChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Small awaitable delay (no foreground-sleep shenanigans — pure timer). */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Mirror the per-job registration gates so the catch-up sweep only replays a
   * job that is actually enabled in this process. Keeps the env-gate / required-
   * dependency logic in ONE place conceptually (registration sites stay the
   * source of truth; this is their read-side twin for the sweep).
   */
  private isCatchUpJobEnabled(type: SchedulerJobType): boolean {
    if (!(CATCH_UP_JOB_TYPES as readonly string[]).includes(type)) return false;
    return isRetainedJobEnabled(type);
  }

  /**
   * Stop all cron jobs.
   */
  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    // Drop the slot-guard handles with them (Jul 26). A stopped task's
    // getNextRun() already returns null, but a stale map would also survive a
    // stop→start cycle and shadow the fresh registration.
    this.catchUpTasks.clear();
    this.started = false;
    this.running = false;
    this.lastSupervisorTickAt = 0;
    this.lastCatchUpSweepAt = 0;
    this.lockError = null;
    this.releaseSchedulerLock();
    console.log("[scheduler] Stopped");
  }

  /**
   * Manually trigger a retained substrate job. Model-backed and outward
   * execution jobs are retired; the HTTP compatibility route rejects them
   * before reaching this method.
   */
  async trigger(type: SchedulerJobType, _workflowId?: string, _lessonNumber?: number, opts?: { source?: "cron" | "engage" }): Promise<{ status: string; content?: string; error?: string }> {
    if (type === "retrieval-eval") {
      return this.runRetrievalEval();
    }
    if (type === "coherence-check") {
      return this.runCoherenceCheck();
    }
    if (type === "system-events-retention") {
      return this.runSystemEventsRetention();
    }
    if (type === "forgetting-tier") {
      return this.runForgettingTier();
    }
    if (type === "parking-maintenance") {
      return this.runParkingMaintenance();
    }
    if (type === "maintenance-liveness") {
      return this.runMaintenanceLiveness();
    }
    if (type === "checkpoint-maintenance") {
      return this.runCheckpointMaintenance();
    }
    if (type === "library-retrieval-eval") {
      return this.runLibraryRetrievalEval();
    }
    return {
      status: "retired",
      error: `scheduler job '${type}' is retired; Codex owns reasoning and execution`,
    };
  }

  /**
   * Get status of all jobs for API/dashboard.
   */
  // `includeRetired` remains accepted for API-shape compatibility; retired
  // records are no longer created, so both views expose the retained manifest.
  getStatus(options: { includeRetired?: boolean } = {}): {
    state: "leader" | "standby" | "degraded" | "stopped";
    started: boolean;
    running: boolean;
    lockOwned: boolean;
    registeredTaskCount: number;
    catchUpTaskCount: number;
    /** Static contract counts; these reconcile registration/status/catch-up gates. */
    contract: typeof SCHEDULER_CONTRACT;
    lastSupervisorTickAt: string | null;
    lastCatchUpSweepAt: string | null;
    timezone: string;
    jobs: {
      type: SchedulerJobType;
      scope: SchedulerJobScope | "retired";
      lastRun: string | null;
      lastResult: string | null;
      lastDurationMs: number | null;
    }[];
  } {
    const supervisorStale = this.lastSupervisorTickAt > 0
      && Date.now() - this.lastSupervisorTickAt > Scheduler.SUPERVISOR_STALE_AFTER_MS;
    const state = !this.started
      ? "stopped"
      : this.lockError || (this.holdsLock && (!this.running || this.tasks.length === 0 || supervisorStale))
        ? "degraded"
        : !this.holdsLock
          ? "standby"
          : "leader";

    return {
      state,
      started: this.started,
      running: this.running,
      lockOwned: this.holdsLock,
      registeredTaskCount: this.tasks.length,
      catchUpTaskCount: this.catchUpTasks.size,
      contract: SCHEDULER_CONTRACT,
      lastSupervisorTickAt: this.lastSupervisorTickAt
        ? new Date(this.lastSupervisorTickAt).toISOString()
        : null,
      lastCatchUpSweepAt: this.lastCatchUpSweepAt
        ? new Date(this.lastCatchUpSweepAt).toISOString()
        : null,
      timezone: this.config.timezone,
      jobs: Array.from(this.jobs.values())
        .filter((job) => options.includeRetired || RETAINED_JOB_TYPES.includes(job.type as RetainedSchedulerJobType))
        .map((j) => ({
        type: j.type,
        scope: getRetainedSchedulerJob(j.type)?.scope ?? "retired",
        lastRun: j.lastRun?.toISOString() || null,
        lastResult: j.lastResult,
        lastDurationMs: j.lastDurationMs,
        })),
    };
  }

  // Ch3 of memory-war plan — delegates to ./jobs/system.ts.
  private async runRetrievalEval(): Promise<{ status: string; content?: string; error?: string }> {
    return runRetrievalEvalImpl(this.getCtx());
  }

  // Phase A2 (May 16) — delegates to ./jobs/system.ts.
  private async runCoherenceCheck(): Promise<{ status: string; content?: string; error?: string }> {
    return runCoherenceCheckImpl(this.getCtx());
  }

  // Phase S4 (May 18) — delegates to ./jobs/system.ts.
  private async runSystemEventsRetention(): Promise<{ status: string; content?: string; error?: string }> {
    return runSystemEventsRetentionImpl(this.getCtx());
  }

  // Phase S1 (May 18) — delegates to ./jobs/system.ts.
  private async runForgettingTier(): Promise<{ status: string; content?: string; error?: string }> {
    return runForgettingTierImpl(this.getCtx());
  }

  private async runParkingMaintenance(): Promise<{ status: string; content?: string; error?: string }> {
    return runParkingMaintenanceImpl(this.getCtx());
  }

  // K1 (Jun 20) — delegates to ./jobs/maintenance-liveness.ts. Fires the
  // /api/maintenance/liveness-check sweep; flags inert maintenance arms.
  private async runMaintenanceLiveness(): Promise<{ status: string; content?: string; error?: string }> {
    return runMaintenanceLivenessImpl(this.getCtx());
  }

  private async runCheckpointMaintenance(): Promise<{ status: string; content?: string; error?: string }> {
    return runCheckpointMaintenanceImpl(this.getCtx());
  }


  // Wave F (Jun 10) — delegates to ./jobs/system.ts. Library recall eval
  // (P@5/R@10 over the library fixture, production search path). The UNGATED
  // path — used by the manual trigger + boot catch-up sweep (which run on
  // demand). Holds the re-entrancy flag for its whole duration so the hourly
  // gate short-circuits while it runs; the hourly cron uses the gated wrapper.
  private async runLibraryRetrievalEval(): Promise<{ status: string; content?: string; error?: string }> {
    this.libraryEvalRunning = true;
    try {
      return await runLibraryRetrievalEvalImpl(this.getCtx());
    } finally {
      this.libraryEvalRunning = false;
    }
  }

  // Library Health Loop (Jun 30): in-memory re-entrancy flag. Every run path
  // (gated hourly tick, manual trigger, boot catch-up) goes through
  // runLibraryRetrievalEval, which sets it, and the staleness gate short-circuits
  // while it's held — so the hourly tick won't pile onto an in-flight eval. NOT a
  // hard mutex: two operator-initiated runs (e.g. two manual triggers) can still
  // race. The eval is read-only, so the worst case is wasted Voyage embeds + a
  // duplicate library-eval-result row — never corruption. Single scheduler
  // process per the cross-process lockfile.
  private libraryEvalRunning = false;

  /**
   * Staleness-on-wake gate — mirrors MemorySynthesizer.shouldRun(). Run when
   * there has been NO successful run in 7d (or never) AND no concurrent lock.
   * Reads JobRecord.lastRun/lastResult (hydrated from ~/.bodhi/scheduler-state.json
   * by loadJobState at start), so "last successful run" survives restarts. A
   * non-success last run (error/skipped) is treated as "due" so a recovered host
   * re-measures on the next tick instead of waiting out the full 7d.
   */
  private shouldRunLibraryEval(): { run: boolean; reason: string } {
    if (this.libraryEvalRunning) return { run: false, reason: "already running" };
    const job = this.jobs.get("library-retrieval-eval");
    const lastRun = job?.lastRun ?? null;
    const lastOk = job?.lastResult === "sent";
    const SEVEN_D = 7 * 24 * 60 * 60 * 1000;
    if (lastRun && lastOk) {
      const age = Date.now() - lastRun.getTime();
      if (age < SEVEN_D) {
        return { run: false, reason: `last successful run ${Math.round(age / 3_600_000)}h ago (need 7d)` };
      }
      return { run: true, reason: "stale (>7d since last success)" };
    }
    return { run: true, reason: lastRun ? "last run not successful" : "never run" };
  }

  /** Hourly-tick entry: evaluate the staleness gate (which also short-circuits
   *  while an ungated run holds the flag), then run. runLibraryRetrievalEval
   *  owns the flag, so the wrapper doesn't set it itself. */
  private async runLibraryRetrievalEvalGated(): Promise<{ status: string; content?: string; error?: string }> {
    const gate = this.shouldRunLibraryEval();
    if (!gate.run) return { status: "skipped", content: gate.reason };
    return this.runLibraryRetrievalEval();
  }

}
