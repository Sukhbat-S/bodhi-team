// ============================================================
// BODHI — Staleness watcher (fail-LOUD binding-rot detection, Jun 13)
//
// WHY: the on-wake catch-up sweep (catch-up.ts + runCatchUpSweep) self-HEALS
// the CATCH_UP_META jobs, but NOTHING detects/alerts when something stale is
// NOT healed — a non-eligible job regressed, catch-up itself failed, or the
// launchd DB backup quietly died (it stopped 10 days before this build with
// zero alert). This module is the DETECTION half: a pure check that the KAIROS
// */5 watcher loop runs on every tick, so the alarm rides the ONE cron that is
// reliably awake (a fresh wall-clock cron would itself sleep through its slot —
// the exact failure mode we are fixing).
//
// Design rules baked in:
//   - Only flag jobs that are ENABLED and have run AT LEAST ONCE. A job that
//     never ran (lastRun=null) is catch-up's job, not ours — flagging it would
//     false-alarm on a fresh install. only-ran-before-now-stale = REGRESSION,
//     which is precisely what catch-up does NOT cover.
//   - The backup is ALWAYS expected: missing OR old IS the alarm.
//   - Opt-in / dormant features are deliberately absent from the threshold map
//     so they can't false-alert.
//   - The check NEVER throws into the caller (fail-safe) and NEVER no-ops
//     silently when disabled (fail-loud — silence is the anti-pattern).
// ============================================================

import { existsSync, readdirSync, readFileSync, statSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JobRecord, SchedulerJobType } from "../types.js";
import { isRetainedJobEnabled } from "../contract.js";
import { resolveBackupDirectory, resolveStalenessAlertStatePath } from "./data-paths.js";
import { atomicWriteJson } from "./job-state.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Max acceptable age per ALWAYS-ON substrate-critical job. Keyed by the job's
 * SchedulerJobType so the staleness check reads the same `jobs` Map the catch-up
 * sweep does. Daily jobs ≈ 26h (one cron miss of slack over a 24h cadence);
 * weekly jobs ≈ 8d (one day of slack over a 7d cadence).
 *
 * INCLUDED: forgetting-tier, coherence-check, system-events-retention, and
 * parking-maintenance and checkpoint-maintenance (daily); retrieval-eval (opt-in daily) and
 * library-retrieval-eval (weekly). Every entry is gated by the retained
 * manifest so dormant or removed jobs cannot alert.
 *
 * No user-facing or high-frequency loop is included; a late notification is
 * worse than silence and a missed supervisor tick self-heals on the next wake.
 */
export const STALENESS_THRESHOLDS: Partial<Record<SchedulerJobType, number>> = {
  // Daily, default-ON.
  "forgetting-tier": 26 * HOUR,
  "coherence-check": 26 * HOUR,
  "system-events-retention": 26 * HOUR,
  "parking-maintenance": 26 * HOUR,
  "checkpoint-maintenance": 26 * HOUR,
  "skill-learning-maintenance": 26 * HOUR,
  // Daily, opt-in (only contributes when RETRIEVAL_EVAL_ENABLED=true).
  "retrieval-eval": 26 * HOUR,
  // Weekly.
  "library-retrieval-eval": 8 * DAY,
};

/** Backup expectations — the launchd-written nightly dumps. */
export const BACKUP_DIR = resolveBackupDirectory();
/** Newest backup older than this (or none present) is the alarm. */
export const BACKUP_STALE_MS = 36 * HOUR;

/** Dedup ledger — per-item last-alert ISO so the watcher loop can't spam. */
export const STALENESS_ALERT_STATE_PATH = resolveStalenessAlertStatePath();
/** Suppress re-alerting the SAME item within this window. */
export const ALERT_DEDUP_MS = 18 * HOUR;

export interface StaleJob {
  type: SchedulerJobType;
  ageHrs: number;
}
export interface StalenessResult {
  staleJobs: StaleJob[];
  backup: { stale: boolean; ageHrs: number | null };
}

/**
 * Mirror the per-job registration gates so the check only flags a job that is
 * actually enabled in this process. (Twin of scheduler.isCatchUpJobEnabled —
 * registration sites stay the source of truth; this is the read-side gate.)
 * config-dependent gates (e.g. synthesizer presence) cannot be read here, so
 * a job whose ONLY gate is a config dependency is treated as enabled when its
 * threshold is present — the lastRun!=null guard prevents false alarms anyway.
 */
function isJobEnabled(type: SchedulerJobType): boolean {
  return isRetainedJobEnabled(type);
}

/** Newest supported PostgreSQL backup mtime, or null if none / dir absent. */
function newestBackupMtime(dir = resolveBackupDirectory()): number | null {
  if (!existsSync(dir)) return null;
  let newest: number | null = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".sql.gz") && !name.endsWith(".dump")) continue;
    // The new producer exposes a manifest only after the dump is complete.
    // A recent partial .dump must not reset backup liveness to healthy.
    if (/^bodhi_\d{17}_[a-f0-9]{8}\.dump$/.test(name)) {
      try {
        const dump = lstatSync(join(dir, name));
        const manifestFile = join(dir, `${name}.json`);
        const manifestStat = lstatSync(manifestFile);
        const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
        if (!dump.isFile() || dump.isSymbolicLink() || !manifestStat.isFile() || manifestStat.isSymbolicLink()
          || manifest.contractVersion !== 1 || manifest.file !== name || manifest.bytes !== dump.size
          || !/^[a-f0-9]{64}$/.test(manifest.sha256)) continue;
      } catch { continue; }
    }
    try {
      const m = statSync(join(dir, name)).mtimeMs;
      if (newest === null || m > newest) newest = m;
    } catch {
      /* unreadable entry — skip */
    }
  }
  return newest;
}

/**
 * Pure staleness check. For each threshold'd job that is ENABLED and has run at
 * least once (lastRun != null), flag if `now − lastRun > threshold`. Never-run
 * or disabled jobs are NOT flagged (catch-up owns never-run). The backup is
 * always expected: stale if the newest *.sql.gz is older than BACKUP_STALE_MS,
 * or if none is present at all.
 */
export function checkStaleness(
  jobs: Map<SchedulerJobType, JobRecord>,
  now: number = Date.now(),
  opts?: { backupDir?: string },
): StalenessResult {
  const staleJobs: StaleJob[] = [];
  for (const [type, threshold] of Object.entries(STALENESS_THRESHOLDS) as [
    SchedulerJobType,
    number,
  ][]) {
    if (!isJobEnabled(type)) continue;
    const job = jobs.get(type);
    const lastRun = job?.lastRun ?? null;
    if (!lastRun) continue; // never ran → catch-up's domain, not a regression
    const age = now - lastRun.getTime();
    if (age > threshold) {
      staleJobs.push({ type, ageHrs: Math.round((age / HOUR) * 10) / 10 });
    }
  }

  const newest = newestBackupMtime(opts?.backupDir);
  // Filesystem timestamp precision can place a just-written backup a fraction
  // ahead of a separately captured `now`, which otherwise emits `-0` hours.
  const backupAge = newest === null ? null : Math.max(0, now - newest);
  const backupStale =
    newest === null || (backupAge !== null && backupAge > BACKUP_STALE_MS);

  return {
    staleJobs,
    backup: {
      stale: backupStale,
      ageHrs: backupAge === null ? null : Math.round((backupAge / HOUR) * 10) / 10,
    },
  };
}

// ---- Dedup ledger -------------------------------------------------------

type AlertLedger = Record<string, string>; // item-key → last-alert ISO

function loadLedger(path = STALENESS_ALERT_STATE_PATH): AlertLedger {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as AlertLedger;
  } catch {
    return {};
  }
}

function saveLedger(ledger: AlertLedger, path = STALENESS_ALERT_STATE_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteJson(path, JSON.stringify(ledger, null, 2));
  } catch (err) {
    console.warn(
      "[staleness] alert-ledger flush failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Stable per-item dedup key (the backup is one item; each job its own). */
function itemKey(item: { kind: "job"; type: SchedulerJobType } | { kind: "backup" }): string {
  return item.kind === "backup" ? "backup" : `job:${item.type}`;
}

export interface DedupSelection {
  staleJobs: StaleJob[];
  backupStale: boolean;
  backupAgeHrs: number | null;
}

/**
 * READ-ONLY selector (Jun 13 crash-safety split): which stale items are NOT
 * within the ALERT_DEDUP_MS window — i.e. eligible to alert. Does NOT mutate the
 * ledger. `force` bypasses the window (testing). The ledger is stamped ONLY by
 * stampDelivered(), AFTER the durable system-event recorder confirms — so a
 * missing or failed emission cannot mute a backup-dead alarm for 18h.
 */
export function selectNewlyStale(
  result: StalenessResult,
  now: number = Date.now(),
  opts?: { force?: boolean; path?: string },
): DedupSelection {
  const path = opts?.path ?? resolveStalenessAlertStatePath();
  const ledger = loadLedger(path);

  const fresh = (key: string): boolean => {
    if (opts?.force) return true;
    const last = ledger[key];
    if (!last) return true;
    const t = Date.parse(last);
    return Number.isNaN(t) || now - t > ALERT_DEDUP_MS;
  };

  const staleJobs = result.staleJobs.filter((j) => fresh(itemKey({ kind: "job", type: j.type })));
  const backupStale = result.backup.stale && fresh(itemKey({ kind: "backup" }));

  return { staleJobs, backupStale, backupAgeHrs: result.backup.ageHrs };
}

/**
 * Stamp the ledger for items whose alert was CONFIRMED delivered (Jun 13). Call
 * this only after the send succeeds. Best-effort persistence; mutation+save are
 * synchronous so a concurrent caller can't observe a half-written ledger.
 */
export function stampDelivered(
  items: { staleJobs: StaleJob[]; backupStale: boolean },
  now: number = Date.now(),
  opts?: { path?: string },
): void {
  if (items.staleJobs.length === 0 && !items.backupStale) return;
  const path = opts?.path ?? resolveStalenessAlertStatePath();
  const ledger = loadLedger(path);
  const nowIso = new Date(now).toISOString();
  for (const j of items.staleJobs) ledger[itemKey({ kind: "job", type: j.type })] = nowIso;
  if (items.backupStale) ledger[itemKey({ kind: "backup" })] = nowIso;
  saveLedger(ledger, path);
}

/** Compose the alert body + urgency. backup-stale = HIGH (data-loss case). */
export function composeStalenessAlert(input: {
  staleJobs: StaleJob[];
  backupStale: boolean;
  backupAgeHrs: number | null;
}): { text: string; urgency: "medium" | "high" } | null {
  const { staleJobs, backupStale, backupAgeHrs } = input;
  if (staleJobs.length === 0 && !backupStale) return null;

  const lines: string[] = ["🔔 BODHI staleness alert"];
  if (staleJobs.length > 0) {
    lines.push(
      ...staleJobs.map((j) => `• ${j.type}: last ran ${j.ageHrs}h ago`),
    );
  }
  if (backupStale) {
    lines.push(
      backupAgeHrs === null
        ? "⚠️ DB backup: NONE present in the configured backup directory (local-pg data-loss risk)"
        : `⚠️ DB backup: ${backupAgeHrs}h old (local-pg data-loss risk)`,
    );
  }
  // Backup-stale pierces bandwidth gating (the data-loss case); stale daily
  // jobs alone respect KAIROS's existing urgency gating.
  return { text: lines.join("\n"), urgency: backupStale ? "high" : "medium" };
}
