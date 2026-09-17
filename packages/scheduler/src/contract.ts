// BODHI — retained scheduler runtime contract.
//
// Keep the retained-job inventory in one place. Registration, status filtering,
// catch-up metadata, and contract tests otherwise drift independently whenever
// a legacy job is removed or an opt-in gate changes.

export type RetainedSchedulerJobType =
  | "retrieval-eval"
  | "coherence-check"
  | "system-events-retention"
  | "forgetting-tier"
  | "library-retrieval-eval"
  | "parking-maintenance"
  | "maintenance-liveness"
  | "checkpoint-maintenance";

export type RetainedSchedulerRunner =
  | "runRetrievalEval"
  | "runCoherenceCheck"
  | "runSystemEventsRetention"
  | "runForgettingTier"
  | "runLibraryRetrievalEvalGated"
  | "runParkingMaintenance"
  | "runMaintenanceLiveness"
  | "runCheckpointMaintenance";

/** Retained jobs are maintenance-only by construction; outward work stays in Codex. */
export type SchedulerJobScope = "substrate-maintenance";

export interface RetainedSchedulerJob {
  type: RetainedSchedulerJobType;
  /** Runtime ownership boundary exposed by scheduler status. */
  scope: SchedulerJobScope;
  /** The real cron slot, when this job has one. */
  schedule: string;
  /** Registration order; keeps the pre-manifest runtime order stable. */
  registrationOrder: number;
  /** The guard/event label emitted for the job. */
  guard: RetainedSchedulerJobType;
  /** Host method invoked by the cron callback. */
  runner: RetainedSchedulerRunner;
  /** Environment gate used by registration and read-side checks. */
  envVar: string;
  /** Whether the on-wake supervisor replays this job when stale. */
  catchUp: boolean;
  /** Whether registration requires an explicit true env gate. */
  optIn: boolean;
}

/**
 * The eight substrate jobs exposed by the scheduler status API.
 *
 * `library-retrieval-eval` is an hourly staleness probe rather than a daily
 * slot, so it is intentionally not catch-up tracked. Retrieval and library
 * evaluation are corpus-specific and therefore explicit opt-ins.
 */
export const RETAINED_JOB_MANIFEST = [
  {
    type: "retrieval-eval",
    scope: "substrate-maintenance",
    schedule: "35 4 * * *",
    registrationOrder: 2,
    guard: "retrieval-eval",
    runner: "runRetrievalEval",
    envVar: "RETRIEVAL_EVAL_ENABLED",
    catchUp: true,
    optIn: true,
  },
  {
    type: "coherence-check",
    scope: "substrate-maintenance",
    schedule: "45 4 * * *",
    registrationOrder: 3,
    guard: "coherence-check",
    runner: "runCoherenceCheck",
    envVar: "COHERENCE_CHECK_ENABLED",
    catchUp: true,
    optIn: false,
  },
  {
    type: "system-events-retention",
    scope: "substrate-maintenance",
    schedule: "30 3 * * *",
    registrationOrder: 0,
    guard: "system-events-retention",
    runner: "runSystemEventsRetention",
    envVar: "SYSTEM_EVENTS_RETENTION_ENABLED",
    catchUp: true,
    optIn: false,
  },
  {
    type: "forgetting-tier",
    scope: "substrate-maintenance",
    schedule: "50 3 * * *",
    registrationOrder: 1,
    guard: "forgetting-tier",
    runner: "runForgettingTier",
    envVar: "FORGETTING_TIER_ENABLED",
    catchUp: true,
    optIn: false,
  },
  {
    type: "library-retrieval-eval",
    scope: "substrate-maintenance",
    schedule: "0 * * * *",
    registrationOrder: 7,
    guard: "library-retrieval-eval",
    runner: "runLibraryRetrievalEvalGated",
    envVar: "LIBRARY_RETRIEVAL_EVAL_ENABLED",
    catchUp: false,
    optIn: true,
  },
  {
    type: "parking-maintenance",
    scope: "substrate-maintenance",
    schedule: "15 6 * * *",
    registrationOrder: 8,
    guard: "parking-maintenance",
    runner: "runParkingMaintenance",
    envVar: "PARKING_MAINTENANCE_ENABLED",
    catchUp: true,
    optIn: false,
  },
  {
    type: "maintenance-liveness",
    scope: "substrate-maintenance",
    schedule: "30 6 * * *",
    registrationOrder: 4,
    guard: "maintenance-liveness",
    runner: "runMaintenanceLiveness",
    envVar: "MAINTENANCE_LIVENESS_ENABLED",
    catchUp: true,
    optIn: false,
  },
  {
    type: "checkpoint-maintenance",
    scope: "substrate-maintenance",
    schedule: "45 6 * * *",
    registrationOrder: 5,
    guard: "checkpoint-maintenance",
    runner: "runCheckpointMaintenance",
    envVar: "CHECKPOINT_MAINTENANCE_ENABLED",
    catchUp: true,
    optIn: false,
  },
] as const satisfies readonly RetainedSchedulerJob[];

export function getRetainedSchedulerJob(type: string): RetainedSchedulerJob | undefined {
  return RETAINED_JOB_MANIFEST.find((job) => job.type === type);
}

/** Read-side twin of the registration gate, sourced from the same manifest. */
export function isRetainedJobEnabled(type: string): boolean {
  const job = getRetainedSchedulerJob(type);
  if (!job) return false;
  const value = process.env[job.envVar];
  return job.optIn ? value === "true" : value !== "false";
}

export const RETAINED_JOB_TYPES = RETAINED_JOB_MANIFEST.map((job) => job.type);
export const RETAINED_JOB_COUNT = RETAINED_JOB_MANIFEST.length;
export const CATCH_UP_JOB_TYPES = RETAINED_JOB_MANIFEST
  .filter((job) => job.catchUp)
  .map((job) => job.type);
export const CATCH_UP_JOB_COUNT = CATCH_UP_JOB_TYPES.length;
export const OPT_IN_JOB_TYPES = RETAINED_JOB_MANIFEST
  .filter((job) => job.optIn)
  .map((job) => job.type);
export const OPT_IN_JOB_COUNT = OPT_IN_JOB_TYPES.length;
export const USER_FACING_JOB_COUNT = RETAINED_JOB_COUNT
  - RETAINED_JOB_MANIFEST.filter((job) => job.scope === "substrate-maintenance").length;

/** One every-five-minute maintenance supervisor task owns the catch-up/staleness cadence. */
export const SUPERVISOR_TASK_COUNT = 1;

export const SCHEDULER_CONTRACT = {
  executionOwner: "codex",
  scope: "deterministic-substrate-maintenance",
  userFacingJobCount: USER_FACING_JOB_COUNT,
  supervisorTaskCount: SUPERVISOR_TASK_COUNT,
  retainedJobCount: RETAINED_JOB_COUNT,
  catchUpJobCount: CATCH_UP_JOB_COUNT,
  optInJobCount: OPT_IN_JOB_COUNT,
} as const;

export type SchedulerContract = typeof SCHEDULER_CONTRACT;
