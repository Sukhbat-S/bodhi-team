import type { ScheduledTask } from "node-cron";
import {
  CATCH_UP_JOB_TYPES,
  RETAINED_JOB_MANIFEST,
  isRetainedJobEnabled,
  type RetainedSchedulerJob,
} from "./contract.js";

type CronCallback = () => unknown;
type CatchUpCronJobType = typeof CATCH_UP_JOB_TYPES[number];

/** Narrow host surface for BODHI 1.0's substrate-maintenance scheduler. */
export interface SchedulerCronRegistrationHost {
  timezone: string;
  schedule(
    expression: string,
    callback: () => Promise<void>,
    options: { timezone: string },
  ): ScheduledTask;
  addTask(task: ScheduledTask): void;
  guardCron(name: string, fn: CronCallback): () => Promise<void>;
  trackCatchUp(type: CatchUpCronJobType, task: ScheduledTask): ScheduledTask;
  runRetrievalEval(): unknown;
  runCoherenceCheck(): unknown;
  runSystemEventsRetention(): unknown;
  runForgettingTier(): unknown;
  runParkingMaintenance(): unknown;
  runMaintenanceLiveness(): unknown;
  runCheckpointMaintenance(): unknown;
  runSkillLearningMaintenance(): unknown;
  runLibraryRetrievalEvalGated(): unknown;
  runMaintenanceSupervisorTick(): unknown;
}

/**
 * Register only deterministic truth-store maintenance. User-facing work and
 * execution remain outside this package.
 */
export function registerSchedulerCronJobs(
  host: SchedulerCronRegistrationHost,
): void {
  const tz = host.timezone;

  // Re-arm sleep recovery and staleness detection without reviving the retired
  // outward watcher loop.
  host.addTask(
    host.schedule(
      "*/5 * * * *",
      host.guardCron("maintenance-supervisor", () =>
        host.runMaintenanceSupervisorTick(),
      ),
      { timezone: tz },
    ),
  );

  // The retained manifest is the sole source of job type, schedule, callback,
  // catch-up membership, and env-gate metadata. Keep the registration order
  // stable for logs/status consumers without maintaining a second job list.
  const retainedJobs = [...RETAINED_JOB_MANIFEST].sort(
    (a, b) => a.registrationOrder - b.registrationOrder,
  );
  for (const job of retainedJobs) {
    if (!isRetainedJobEnabled(job.type)) continue;
    host.addTask(registerRetainedJob(host, job, tz));
  }

  console.log(
    "[scheduler] BODHI 1.0 substrate maintenance registered (memory, retrieval, coherence, retention, liveness)",
  );
}

function registerRetainedJob(
  host: SchedulerCronRegistrationHost,
  job: RetainedSchedulerJob,
  timezone: string,
): ScheduledTask {
  const callback = host.guardCron(job.guard, () => host[job.runner]());
  const task = host.schedule(job.schedule, callback, { timezone });
  return job.catchUp
    ? host.trackCatchUp(job.type as CatchUpCronJobType, task)
    : task;
}
