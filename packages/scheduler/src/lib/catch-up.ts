// ============================================================
// BODHI — Catch-up metadata (on-wake missed-slot replay, Jun 13)
//
// Per-job staleness threshold (catchUpAfterMs). After cron registration the
// scheduler runs an async sweep: for each catch-up-eligible job, if
// (now − lastRun-from-disk) > catchUpAfterMs (or lastRun unknown), the job is
// enqueued and run SEQUENTIALLY (concurrency 1) with a stagger + a startup
// grace, so opening the laptop doesn't fire a dozen LLM jobs at once.
//
// EXCLUSIONS: the supervisor is deliberately absent — it fires often enough
// that a missed tick self-heals on the next interval; catching it up would be
// pure noise. Any job NOT in CATCH_UP_META is never caught up.
// ============================================================

import type { SchedulerJobType } from "../types.js";
import { CATCH_UP_JOB_TYPES } from "../contract.js";

const HOUR = 60 * 60 * 1000;

/**
 * Staleness threshold per catch-up-eligible job. Daily jobs ≈ 20h (so a job
 * that ran yesterday morning but missed today's pre-dawn slot is caught up on
 * the next laptop-open); weekly jobs ≈ 6d (one day of slack under the 7d
 * cadence). A job absent from this map is NOT catch-up-eligible.
 *
 * The supervisor is excluded by omission because its interval is short and
 * self-healing. The retained set is substrate maintenance whose value is
 * "did it run today at all", not "did it run at minute X".
 * The catch-up set is the SUBSTRATE-MAINTENANCE crons
 * whose value is "did it run today at all", not "did it run at minute X".
 */
// BODHI 1.0 owns only durable truth-store maintenance. User-facing work,
// user-facing work and autonomous mutation moved to Codex Desktop and are
// deliberately absent. The job names come from
// the retained manifest so a retired job cannot remain catch-up eligible via a
// stale second list.
export const CATCH_UP_META: Partial<Record<SchedulerJobType, { catchUpAfterMs: number }>> =
  Object.fromEntries(CATCH_UP_JOB_TYPES.map((type) => [type, { catchUpAfterMs: 20 * HOUR }])) as
    Partial<Record<SchedulerJobType, { catchUpAfterMs: number }>>;

/**
 * Imminent-slot grace (Jul 26). A job whose NEXT REAL CRON SLOT lands within
 * this window is NOT replayed on wake — the slot itself will run it shortly, so
 * a catch-up here is a pure double-run.
 *
 * WHY THIS EXISTS: catchUpAfterMs is 20h for every daily job, but the host is a
 * MacBook that sleeps through the pre-dawn slots. On a mid-morning wake `lastRun`
 * is ~20-21h old for EVERY daily job, so every one reads "stale" even when its
 * real slot is only 3-4h away. Measured over 7 days: 14 job types, 79 redundant
 * catch-up runs (157/30d), and EVERY catch-up row logged `missed by 20h` or
 * `missed by 21h` — the tell that these were slot-adjacent, not genuine misses.
 * The only two real catch-ups in that window were long overdue.
 *
 * SIZING: must EXCEED the longest gap between a plausible wake and the pre-dawn
 * slot that wake precedes. Largest observed gap in the 7-day sample was ~4.0h
 * (maintenance-liveness caught up 02:33-03:22 against its 06:30 slot; research
 * likewise). 6h keeps ~2h of headroom. It must also stay well UNDER the 20h
 * staleness threshold, or a genuinely-missed daily job would never replay.
 *
 * NOT A SCHEDULE MIRROR: the next-slot time is read from the LIVE registered
 * node-cron task (`ScheduledTask.getNextRun()`), never from a hand-maintained
 * copy of the cron expression. Only this one duration is a constant.
 */
export const CATCH_UP_IMMINENT_SLOT_MS = 6 * HOUR;

/**
 * CATCH_UP_META keys deliberately NOT subject to the imminent-slot guard, i.e.
 * whose cron.schedule() site intentionally skips trackCatchUp(). The boot
 * tripwire consults this so a real registration mistake still shouts.
 *
 * `library-retrieval-eval` — its cron is an HOURLY probe, not a real slot: every
 * tick is gated by shouldRunLibraryEval() (>7d since a successful run). So
 * getNextRun() is perpetually ≤1h away and perpetually claims "the slot will
 * handle it", which is FALSE for staleness between the 6d catch-up threshold and
 * the 7d tick gate — the guard would silently disable catch-up across that band.
 * It is also not one of the 14 measured offenders (its 6d threshold makes it
 * immune to the 20h false-positive class this guard exists to kill).
 */
export const CATCH_UP_SLOT_GUARD_EXEMPT: ReadonlySet<SchedulerJobType> = new Set<SchedulerJobType>([
  "library-retrieval-eval",
]);

/**
 * True if a job's next real cron slot is close enough that replaying it now
 * would just double-run it. `nextRun` comes from the live task handle;
 * null/undefined (job not registered this boot, or task stopped) → false, i.e.
 * FALL BACK to the staleness-only decision. A missing task must never make a
 * job permanently ineligible.
 */
export function isSlotImminent(
  nextRun: Date | null | undefined,
  graceMs: number,
  now = Date.now(),
): boolean {
  if (!nextRun) return false; // unknown next slot → defer to staleness alone
  const deltaMs = nextRun.getTime() - now;
  if (deltaMs < 0) return false; // slot already past (stale handle) → don't suppress
  return deltaMs <= graceMs;
}

/** Startup grace: wait this long after boot before the first catch-up job. */
export const CATCH_UP_STARTUP_GRACE_MS = 25_000;

/** Stagger between sequential catch-up jobs (battery/CPU/attention budget). */
export const CATCH_UP_STAGGER_MS = 45_000;

/** True if `now − lastRun` exceeds the threshold (or lastRun is unknown). */
export function isStale(lastRun: Date | null, catchUpAfterMs: number, now = Date.now()): boolean {
  if (!lastRun) return true; // never run (per disk) → eligible
  return now - lastRun.getTime() > catchUpAfterMs;
}
