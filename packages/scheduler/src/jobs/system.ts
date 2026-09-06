// ============================================================
// BODHI — deterministic substrate scheduler jobs.
//
// This module contains only retained, owner-neutral maintenance: retrieval
// evaluation, library retrieval evaluation, forgetting, event retention, and
// coherence checking. User-facing work belongs to Codex Desktop.
// ============================================================

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { SchedulerCtx } from "../types.js";
import { emitJobEvent } from "./emit.js";
import { internalApiHeaders, internalApiUrl } from "../lib/internal-api.js";
import { isOfflineError } from "../lib/offline-error.js";
import { runEval } from "@seneca/memory";
import { runLibraryEval } from "@seneca/library";

// ============================================================
// Repo root, computed from this file's filesystem location.
// scheduler/src/jobs/system.ts → up 4 dirs → repo root.
//
// Why this matters (Mission 4 fix, May 19, 2026): the coherence
// cron previously did `path.join("scripts", "check-coherence.ts")`
// relative to `process.env.BODHI_HOME ?? process.cwd()`. When the
// scheduler runs inside apps/server's tsx watch, cwd is
// `<repo>/apps/server/`, so the path resolved to
// `apps/server/scripts/check-coherence.ts` — which doesn't exist.
// Every nightly cron failed with exit 1 + no parseable JSON.
// Surfaced by Mission 3 widget May 19.
// ============================================================
const SCHEDULER_FILE = fileURLToPath(import.meta.url);
const SCHEDULER_REPO_ROOT = path.resolve(path.dirname(SCHEDULER_FILE), "..", "..", "..", "..");

export function resolveCoherenceCommand(env: NodeJS.ProcessEnv = process.env): {
  repoRoot: string;
  executable: string;
  args: string[];
} {
  const repoRoot = env.BODHI_REPO_ROOT ?? SCHEDULER_REPO_ROOT;
  const personalManifest = path.resolve(repoRoot, ".release", "manifest.json");
  if (existsSync(personalManifest)) {
    return {
      repoRoot,
      executable: process.execPath,
      args: [
        path.resolve(repoRoot, "scripts", "check-personal-coherence.mjs"),
        "--root",
        repoRoot,
        "--json",
      ],
    };
  }
  return {
    repoRoot,
    executable: process.execPath,
    args: [
      path.resolve(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      path.resolve(repoRoot, "scripts", "check-coherence.ts"),
      "--json",
    ],
  };
}

// --- Job: Retrieval Eval (Ch3 of memory-war plan) ---
//
// Runs the retrieval fixture daily; emits the full report via systemEvents
// so /dashboard/recent + the status chip surface it. Aggregate drift alerting
// (the "once we have ≥7d of data points" TODO this comment used to carry) is
// now LIVE below — 83 rows since May 14, 2026 made it measurable.

// --- Aggregate drift detection (Jul 26, 2026) ---
//
// The precise gap it closes: the per-query rule below (`failedCount > 0` →
// severity "warn") means a P@5 REGRESSION could never emit anything louder than
// a warn, and no consumer thresholds on warn — so only a job CRASH was ever
// actionable. Every `error` row this job has ever emitted is a `fetch failed`
// from a sleeping Mac, correctly suppressed downstream as connectivity. A real
// quality regression now remains explicit in the durable eval event stream;
// session-start decides whether it is material enough to surface.

/**
 * P@5 drop (percentage points, vs the trailing baseline) that counts as an
 * aggregate regression worth escalating.
 *
 * 5.0 pp, derived from the real series (71 SCORED runs, 2026-05-14 → 07-25):
 *  - the live band is 71–76% P@5 (currently 72.0; R@10 pinned at 84.2);
 *  - over 66 trailing windows the WORST drop vs its own 10-point median is
 *    3.5 pp, so 5.0 pp fires ZERO times on the observed jitter. A guard that
 *    cries wolf gets ignored, which returns it to being decoration;
 *  - the fixture holds 20 queries, so one query collapsing from perfect to zero
 *    precision moves the aggregate by exactly 5.0 pp. The threshold therefore
 *    reads as "at least one whole query stopped retrieving, or the equivalent
 *    spread across several" — the smallest move that is unambiguously not noise.
 * Compared with `>=`, so that exact single-query collapse does fire.
 */
export const RETRIEVAL_DRIFT_DROP_PP = 5.0;
/** Trailing SCORED runs the baseline median is taken over (~5 days at the current ~2 runs/day). */
export const RETRIEVAL_DRIFT_BASELINE_SIZE = 10;
/** Fewer scored priors than this → not enough history to judge; stay silent. */
export const RETRIEVAL_DRIFT_MIN_BASELINE = 5;
/** Lookback for the baseline fetch. 14d comfortably covers BASELINE_SIZE runs. */
const RETRIEVAL_DRIFT_LOOKBACK_HOURS = 336;

/** A raw system_events row as /api/events/recent returns it. NOTE: the table has
 *  no `created_at` — the timestamp column is `ts`. */
export interface RetrievalEvalRow {
  ts?: string;
  severity?: string;
  summary?: string;
  payload?: unknown;
}

/** One usable (SCORED) prior run. */
export interface RetrievalBaselinePoint {
  /** report.ranAt when present, else the row's `ts`. */
  ranAt: string;
  pAt5: number;
  failingQueryIds: string[];
}

export interface RetrievalDriftResult {
  regressed: boolean;
  reason: "regression" | "within-tolerance" | "insufficient-history";
  baselinePAt5: number | null;
  baselineSize: number;
  dropPp: number | null;
  /** Query ids failing in the current run AND in every baseline point — the
   *  actionable half of the signal (an aggregate number alone says "something
   *  moved"; this says which query). */
  persistentFailures: string[];
  summary: string;
}

/**
 * Pull the SCORED prior runs out of raw rows, newest first.
 *
 * The two exclusions are the whole ballgame:
 *  1. OFFLINE SKIPS (`payload.status === "skipped"`, severity info) carry no
 *     P@5 at all — 3 such rows exist. Admitting one as a score of 0 would drag
 *     the median down and manufacture a permanent fake regression.
 *  2. ERROR rows (all 9 to date are `fetch failed`) likewise have no score.
 * The `typeof number` guard is the belt to those braces: any future row shape
 * that omits the metric is skipped rather than silently coerced.
 */
export function extractRetrievalBaselinePoints(rows: RetrievalEvalRow[] | null | undefined): RetrievalBaselinePoint[] {
  const points: RetrievalBaselinePoint[] = [];
  for (const row of rows ?? []) {
    if (!row) continue;
    if (row.severity === "error") continue; // (2) no score on an error row
    const payload = (row.payload ?? {}) as {
      status?: unknown;
      ranAt?: unknown;
      aggregatePrecisionAt5?: unknown;
      failingQueryIds?: unknown;
    };
    if (payload.status === "skipped") continue; // (1) offline skip — no score
    const pAt5 = payload.aggregatePrecisionAt5;
    if (typeof pAt5 !== "number" || !Number.isFinite(pAt5)) continue;
    points.push({
      ranAt: typeof payload.ranAt === "string" ? payload.ranAt : (row.ts ?? ""),
      pAt5,
      failingQueryIds: Array.isArray(payload.failingQueryIds)
        ? payload.failingQueryIds.filter((id): id is string => typeof id === "string")
        : [],
    });
  }
  // Sort defensively — the caller shouldn't have to guarantee route ordering.
  return points.sort((a, b) => (a.ranAt < b.ranAt ? 1 : a.ranAt > b.ranAt ? -1 : 0));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * PURE drift verdict — no I/O, so the red path is unit-testable in both
 * directions. Median (not mean) so one bad night can't move the baseline.
 */
export function detectRetrievalDrift(input: {
  pAt5: number;
  failingQueryIds?: string[];
  baseline: RetrievalBaselinePoint[];
  thresholdPp?: number;
  baselineSize?: number;
  minBaseline?: number;
}): RetrievalDriftResult {
  const thresholdPp = input.thresholdPp ?? RETRIEVAL_DRIFT_DROP_PP;
  const window = input.baseline.slice(0, input.baselineSize ?? RETRIEVAL_DRIFT_BASELINE_SIZE);
  const minBaseline = input.minBaseline ?? RETRIEVAL_DRIFT_MIN_BASELINE;

  if (window.length < minBaseline) {
    return {
      regressed: false,
      reason: "insufficient-history",
      baselinePAt5: null,
      baselineSize: window.length,
      dropPp: null,
      persistentFailures: [],
      summary: `retrieval drift: only ${window.length} scored prior run(s) (need ${minBaseline}) — no verdict`,
    };
  }

  const baselinePAt5 = median(window.map((p) => p.pAt5));
  const dropPp = (baselinePAt5 - input.pAt5) * 100;
  // Epsilon on the compare: the threshold is tuned so an exact one-query
  // collapse (5.0 pp) fires, but IEEE754 makes (0.72 - 0.67) * 100 =
  // 4.999999999999993 — a bare `>=` would swallow precisely the case the
  // number was chosen for.
  const regressed = dropPp >= thresholdPp - 1e-9;
  const persistentFailures = (input.failingQueryIds ?? []).filter((id) =>
    window.every((p) => p.failingQueryIds.includes(id)),
  );

  const persistentStr = persistentFailures.length > 0
    ? ` · persistently failing: ${persistentFailures.join(", ")} (every one of the last ${window.length} runs)`
    : "";
  const summary = regressed
    ? `Memory retrieval P@5 regressed — ${(input.pAt5 * 100).toFixed(1)}% vs trailing baseline ${(baselinePAt5 * 100).toFixed(1)}% (−${dropPp.toFixed(1)}pp over ${window.length} runs, threshold ${thresholdPp.toFixed(1)}pp)${persistentStr}`
    : `retrieval drift within tolerance: P@5 ${(input.pAt5 * 100).toFixed(1)}% vs baseline ${(baselinePAt5 * 100).toFixed(1)}% (${dropPp >= 0 ? "−" : "+"}${Math.abs(dropPp).toFixed(1)}pp, threshold ${thresholdPp.toFixed(1)}pp)`;

  return {
    regressed,
    reason: regressed ? "regression" : "within-tolerance",
    baselinePAt5,
    baselineSize: window.length,
    dropPp,
    persistentFailures,
    summary,
  };
}

/**
 * Prior retrieval-eval rows for the baseline. The scheduler is
 * @seneca/db-decoupled by design (SystemEventsRecorder can only WRITE), so the
 * read goes over the authenticated internal HTTP route. Best-effort: [] on
 * any failure, which degrades drift
 * detection to SILENT (insufficient-history), never to a false alarm.
 */
async function fetchRecentRetrievalEvalRows(): Promise<RetrievalEvalRow[]> {
  const url = internalApiUrl(`/api/events/recent?kind=retrieval-eval&hours=${RETRIEVAL_DRIFT_LOOKBACK_HOURS}&limit=40`);
  try {
    const res = await fetch(url, { headers: internalApiHeaders() });
    if (!res.ok) {
      console.warn(`[retrieval-eval] baseline fetch failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { events?: RetrievalEvalRow[] };
    return Array.isArray(data.events) ? data.events : [];
  } catch (err) {
    console.warn("[retrieval-eval] baseline fetch errored:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function runRetrievalEval(ctx: SchedulerCtx): Promise<{ status: string; content?: string; error?: string }> {
  const startTime = Date.now();
  const job = ctx.jobs.get("retrieval-eval");

  try {
    const report = await runEval();
    const summary = `P@5 ${(report.aggregatePrecisionAt5 * 100).toFixed(1)}% · R@10 ${(report.aggregateRecallAt10 * 100).toFixed(1)}% · ${report.passedCount}/${report.totalQueries} passed`;
    const durationMs = Date.now() - startTime;

    console.log(`[scheduler] Retrieval eval: ${summary}`);

    if (job) {
      job.lastRun = new Date();
      job.lastResult = "sent";
      job.lastDurationMs = durationMs;
    }

    // Baseline is fetched BEFORE the row below is recorded, so the current run
    // cannot enter its own baseline (the ranAt filter further down is the
    // belt to that braces, in case these two calls are ever reordered).
    const priorRows = await fetchRecentRetrievalEvalRows();

    // Persist full payload via systemEvents — the status chip reads
    // the most-recent row by kind="retrieval-eval".
    await ctx.systemEvents?.record({
      kind: "retrieval-eval",
      summary,
      severity: report.failedCount > 0 ? "warn" : "info",
      payload: {
        // jobName so /api/scheduler/job-stats counts this SUCCESS run (it groups
        // by payload->>'jobName'; without it only the error-path emitJobEvent row
        // carried jobName → a healthy job read as ~100% error). Additive only.
        jobName: "retrieval-eval",
        ranAt: report.ranAt,
        fixtureVersion: report.fixtureVersion,
        totalQueries: report.totalQueries,
        aggregatePrecisionAt5: report.aggregatePrecisionAt5,
        aggregateRecallAt10: report.aggregateRecallAt10,
        passedCount: report.passedCount,
        failedCount: report.failedCount,
        byBucket: report.byBucket,
        failingQueryIds: report.queries.filter((q) => !q.passed).map((q) => q.id),
      },
    });

    // Aggregate-drift classification. The eval result event above is the
    // durable signal; session-start owns delivery into the active Codex task.
    try {
      const baseline = extractRetrievalBaselinePoints(priorRows)
        .filter((p) => p.ranAt !== report.ranAt);
      const drift = detectRetrievalDrift({
        pAt5: report.aggregatePrecisionAt5,
        failingQueryIds: report.queries.filter((q) => !q.passed).map((q) => q.id),
        baseline,
      });
      if (drift.regressed) {
        console.warn(`[scheduler] Retrieval eval — ${drift.summary}`);
        await ctx.systemEvents?.record({
          kind: "retrieval-quality-regression",
          summary: drift.summary,
          severity: "warn",
          payload: {
            jobName: "retrieval-eval",
            pAt5: report.aggregatePrecisionAt5,
            failingQueryIds: report.queries.filter((q) => !q.passed).map((q) => q.id),
            ranAt: report.ranAt,
          },
        });
      } else {
        console.log(`[scheduler] Retrieval eval — ${drift.summary}`);
      }
    } catch (driftErr) {
      console.warn("[retrieval-eval] drift check errored:", driftErr instanceof Error ? driftErr.message : String(driftErr));
    }

    return { status: "sent", content: summary };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    // Offline quiet-skip (Jul 17): a pre-dawn run on a sleeping Mac fails the
    // Voyage embed with `fetch failed after 4 attempts` — host-off, not a job
    // fault. Record a distinguishable status:'skipped' info row (no error field,
    // so emitJobEvent's severity stays info), same as the other network-bound
    // evaluation job.
    const offline = isOfflineError(err);
    if (offline) {
      console.warn(`[scheduler] Retrieval eval skipped (offline): ${errMsg.slice(0, 120)}`);
    } else {
      console.error(`[scheduler] Retrieval eval failed: ${errMsg}`);
    }

    if (job) {
      job.lastRun = new Date();
      job.lastResult = offline ? "skipped" : "error";
      job.lastDurationMs = durationMs;
    }

    const result = offline
      ? { status: "skipped", reason: "offline" }
      : { status: "error", error: errMsg };
    await emitJobEvent(ctx, "retrieval-eval", "retrieval-eval", result, durationMs);
    return result;
  }
}

// --- Job: Library Retrieval Eval (Wave F, Jun 10 2026) ---
//
// The library corpus's recall measurement — mirrors runRetrievalEval above, but
// over packages/library/evals/library-retrieval-fixture.json via
// LibraryService.search() (production path, telemetry:false so the sweep can't
// fake the library-cite staleness signal). Fired on a staleness-on-wake gate
// (scheduler.shouldRunLibraryEval) rather than a fixed wall-clock slot.
//
// Library Health Loop (Jun 30 2026): on each run it persists kind=
// "library-eval-result" (the architect-facing trendline the dashboard reads),
// keeps the richer kind="library-retrieval-eval" row for back-compat, and
// emits ERRORs (kind="library-eval-error") and quality-regression warnings —
// UNLESS the failure is a mere connectivity
// blip (the Mac sleeps/goes offline — host-model doctrine), which degrades to a
// quiet info row, never a HIGH alarm.

/** rAt10 below this aggregate floor = a quality regression worth surfacing. */
const LIBRARY_EVAL_RECALL_FLOOR = 0.85;
/** pAt5 below this aggregate floor = a quality regression worth surfacing. */
const LIBRARY_EVAL_PRECISION_FLOOR = 0.55;

/**
 * Best-effort previous metrics for the regression alert's "previous values if
 * available" — DB-free, in-memory (the scheduler is @seneca/db-decoupled).
 * null right after a process restart; that's fine, the alert omits "prev" then.
 */
let lastLibraryEvalMetrics: { pAt5: number; rAt10: number; ranAt: string } | null = null;

/**
 * Last time a HIGH library-eval-error inbox alarm was posted (epoch ms). The
 * staleness gate re-runs the eval HOURLY to re-measure on recovery, so a
 * STANDING real error (e.g. VOYAGE_API_KEY unset — thrown before any fetch, so
 * classified real not offline) would otherwise post a HIGH inbox row every hour
 * (server dedup is only 10min < the 60min cadence). Back the ALARM off to once
 * per ≥24h; the eval itself keeps re-running. In-memory (resets on restart — at
 * worst one extra post per restart, and the day-stamped contextHash collapses
 * those in the inbox view anyway).
 */

/** Connectivity-error tokens — a Mac-offline / Voyage-blip failure must not
 *  raise a HIGH alarm (host-model doctrine). Local copy (not imported from
 *  scheduler.ts, which would be a circular dep); broader than isOfflineError so
 *  it also catches a bare undici `fetch failed`. */
const LIBRARY_EVAL_CONNECTIVITY_TOKENS = [
  "fetch failed", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "EAI_AGAIN", "socket hang up", "getaddrinfo", "network", "timed out",
];
function isLibraryEvalConnectivityError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = err && typeof err === "object" && "code" in err
    ? String((err as { code?: unknown }).code ?? "")
    : "";
  return LIBRARY_EVAL_CONNECTIVITY_TOKENS.some((t) => msg.includes(t) || (code !== "" && code === t));
}

export async function runLibraryRetrievalEval(ctx: SchedulerCtx): Promise<{ status: string; content?: string; error?: string }> {
  const startTime = Date.now();
  const job = ctx.jobs.get("library-retrieval-eval");

  try {
    const report = await runLibraryEval();
    const durationMs = Date.now() - startTime;
    const pAt5 = report.aggregatePrecisionAt5;
    const rAt10 = report.aggregateRecallAt10;
    const summary = `P@5 ${(pAt5 * 100).toFixed(1)}% · R@10 ${(rAt10 * 100).toFixed(1)}% · ${report.passedCount}/${report.totalQueries} passed`;

    console.log(`[scheduler] Library retrieval eval: ${summary}`);

    if (job) {
      job.lastRun = new Date();
      job.lastResult = "sent";
      job.lastDurationMs = durationMs;
    }

    // Richer trendline row (back-compat — StatusPage cron status, byBucket).
    await ctx.systemEvents?.record({
      kind: "library-retrieval-eval",
      summary,
      severity: report.failedCount > 0 ? "warn" : "info",
      payload: {
        // jobName on the canonical library-retrieval-eval SUCCESS row so
        // job-stats counts it (mirrors the error-path emitJobEvent jobName). The
        // sibling library-eval-result row below is left WITHOUT jobName on
        // purpose — it feeds the dashboard trend by kind, not the job-stats
        // stream, so tagging it too would double-count runs. Additive only.
        jobName: "library-retrieval-eval",
        ranAt: report.ranAt,
        fixtureVersion: report.fixtureVersion,
        totalQueries: report.totalQueries,
        aggregatePrecisionAt5: pAt5,
        aggregateRecallAt10: rAt10,
        passedCount: report.passedCount,
        failedCount: report.failedCount,
        byBucket: report.byBucket,
        failingQueryIds: report.queries.filter((q) => !q.passed).map((q) => q.id),
      },
    });

    // Canonical health-loop row — the trend the dashboard reads (Jun 30).
    await ctx.systemEvents?.record({
      kind: "library-eval-result",
      summary,
      severity: report.failedCount > 0 ? "warn" : "info",
      payload: {
        pAt5,
        rAt10,
        queryCount: report.totalQueries,
        passCount: report.passedCount,
        status: "ok",
        ranAt: report.ranAt,
        durationMs,
      },
    });

    // Quality-regression detail is carried by the warning eval-result event.
    // Includes previous metrics in the summary for session-start triage.
    if (rAt10 < LIBRARY_EVAL_RECALL_FLOOR || pAt5 < LIBRARY_EVAL_PRECISION_FLOOR) {
      const prev = lastLibraryEvalMetrics;
      const prevStr = prev
        ? ` · prev R@10 ${(prev.rAt10 * 100).toFixed(0)}% P@5 ${(prev.pAt5 * 100).toFixed(0)}% (${prev.ranAt.slice(0, 10)})`
        : "";
      console.warn(
        `[scheduler] Library retrieval quality below floor — R@10 ${(rAt10 * 100).toFixed(0)}% ` +
        `(floor ${(LIBRARY_EVAL_RECALL_FLOOR * 100).toFixed(0)}%), P@5 ${(pAt5 * 100).toFixed(0)}% ` +
        `(floor ${(LIBRARY_EVAL_PRECISION_FLOOR * 100).toFixed(0)}%)${prevStr}`,
      );
      await ctx.systemEvents?.record({
        kind: "library-quality-regression",
        summary: `Library retrieval quality below floor — R@10 ${(rAt10 * 100).toFixed(0)}% (floor ${(LIBRARY_EVAL_RECALL_FLOOR * 100).toFixed(0)}%), P@5 ${(pAt5 * 100).toFixed(0)}% (floor ${(LIBRARY_EVAL_PRECISION_FLOOR * 100).toFixed(0)}%)${prevStr}`,
        severity: "warn",
        payload: { jobName: "library-retrieval-eval", pAt5, rAt10, ranAt: report.ranAt },
      });
    }

    lastLibraryEvalMetrics = { pAt5, rAt10, ranAt: report.ranAt };
    return { status: "sent", content: summary };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    const offline = isLibraryEvalConnectivityError(err);

    if (offline) {
      console.warn(`[scheduler] Library retrieval eval skipped (offline): ${errMsg.slice(0, 120)}`);
    } else {
      console.error(`[scheduler] Library retrieval eval failed: ${errMsg}`);
    }

    if (job) {
      job.lastRun = new Date();
      job.lastResult = offline ? "skipped" : "error";
      job.lastDurationMs = durationMs;
    }

    // Honest health-loop row either way (so the trend shows the gap). Offline =
    // a quiet "skipped" info row (no alarm, distinguishable status); a real
    // break = an "error" row + escalation.
    await ctx.systemEvents?.record({
      kind: "library-eval-result",
      summary: offline
        ? `library eval skipped (offline): ${errMsg.slice(0, 100)}`
        : `library eval errored: ${errMsg.slice(0, 120)}`,
      severity: offline ? "info" : "error",
      payload: {
        status: offline ? "skipped" : "error",
        error: errMsg,
        offline,
        ranAt: new Date().toISOString(),
        durationMs,
      },
    });

    if (!offline) {
      // This error event is the durable signal. Session-start applies the
      // materiality filter and brings it into the current Codex task.
      await ctx.systemEvents?.record({
        kind: "library-eval-error",
        summary: `library eval failed after retries: ${errMsg.slice(0, 120)}`,
        severity: "error",
        payload: { error: errMsg, ranAt: new Date().toISOString(), durationMs },
      });
    }

    // Offline quiet-skip (Jul 17): drop the error field when offline so
    // emitJobEvent (isError = status==='error' || !!error) records an info-level
    // skipped row, not an error — the library-eval-result row above already
    // captures the offline detail. A real break still emits an error.
    const result = offline
      ? { status: "skipped", reason: "offline" }
      : { status: "error", error: errMsg };
    await emitJobEvent(ctx, "library-retrieval-eval", "library-retrieval-eval", result, durationMs);
    return result;
  }
}

// --- Job: Cold-Tier Forgetting (Phase S1, May 18) ---
//
// SUBSTRATE.md §9 #3 — closes the hoarding endgame. Daily 04:00 UB
// (in the early maintenance window) — marks cold-tier memories as forgotten.
// Predicate: age > 90d AND recall_count = 0 AND importance < 0.7
// AND no protective tag (do-not-forget / canonical / decision).
// "Forgotten" = forgotten_at IS NOT NULL — the row stays for audit
// but retrieve() filters it out (handled in memory service).
//
// Soft-delete by design — can be un-forgotten by NULLing forgotten_at.
// Aggressive hard-delete after Nd would be a second phase.

export async function runForgettingTier(ctx: SchedulerCtx): Promise<{ status: string; content?: string; error?: string }> {
  const startTime = Date.now();
  const job = ctx.jobs.get("forgetting-tier");

  try {
    const res = await fetch(internalApiUrl("/api/memory/forget-cold-tier"), {
      method: "POST",
      headers: internalApiHeaders(),
      body: JSON.stringify({
        olderThanDays: 90,
        importanceBelow: 0.7,
        // Tag-only — `decision`/`goal` are TYPE values, protected by the route's type-gate.
        protectedTags: ["do-not-forget", "canonical", "milestone"],
      }),
    });
    if (!res.ok) throw new Error(`forget endpoint returned ${res.status}`);
    const data = (await res.json()) as { forgotten: number; candidates: number };
    const durationMs = Date.now() - startTime;
    const summary = data.forgotten === 0
      ? "0 forgotten (substrate dense)"
      : `${data.forgotten} cold-tier memories forgotten (of ${data.candidates} candidates)`;

    console.log(`[scheduler] Forgetting tier: ${summary}`);
    if (job) {
      job.lastRun = new Date();
      job.lastResult = "sent";
      job.lastDurationMs = durationMs;
    }
    // Decision sweep May 19, 2026: success path now emits telemetry too.
    // Pre-fix: only the error path called emitJobEvent, so the 30-day audit
    // showed 2 fires (errors) but the daily successful no-op runs were
    // invisible — making the cron look DORMANT-under-firing.
    // K1 (Jun 20): emit numeric counts so the maintenance-liveness checker can
    // read `payload.changed` (= rows forgotten this run). GAP-A close: the
    // string summary alone ("0 forgotten") was un-queryable, so a forever-no-op
    // forgetting arm looked indistinguishable from a healthy one.
    const result = {
      status: "sent",
      content: summary,
      counts: { changed: data.forgotten, forgotten: data.forgotten, candidates: data.candidates },
    };
    await emitJobEvent(ctx, "forgetting-tier", "forgetting-tier", result, durationMs);
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] Forgetting tier failed: ${errMsg}`);
    if (job) {
      job.lastRun = new Date();
      job.lastResult = "error";
      job.lastDurationMs = Date.now() - startTime;
    }
    await emitJobEvent(ctx, "forgetting-tier", "forgetting-tier", { status: "error", error: errMsg }, Date.now() - startTime);
    return { status: "error", error: errMsg };
  }
}

// --- Job: System Events Retention (Phase S4, May 18) ---
//
// Daily 03:30 UB — prunes old system_events rows by kind-specific
// retention windows. Without this, the table grows indefinitely
// (B1 alone ships ~1K transcript-ingest events/day at full pace).
//
// Retention windows by kind (config-driven, not magic-numbered):
//   30d:  turn, subagent-dispatch (noisy, low-signal individually)
//   90d:  skill, subagent, briefing, intel, synthesis, retrieval-eval,
//         coherence, parking-maintenance, transcript-ingest,
//         transcript-reconciliation, watcher (observability — keep a season)
//   7d:   watcher-skip (offline quiet-skips, ~288/watcher/offline-day —
//         pure host-offline noise, split out of watcher-error Jul 8)
//   indefinite: architect-state-change, trust-tier-change,
//         trust-tier-delete (milestone events — narrative continuity)
//
// Future: per-architect tunable via /api/system-events-retention.

const SYSTEM_EVENTS_RETENTION_DAYS: Record<string, number> = {
  // 30-day noisy
  "turn": 30,
  "subagent-dispatch": 30,
  // 90-day observability (one season — long enough for monthly digests)
  "skill": 90,
  "subagent": 90,
  "briefing": 90,
  "intel": 90,
  "synthesis": 90,
  "retrieval-eval": 90,
  "coherence": 90,
  "parking-maintenance": 90,
  "transcript-ingest": 90,
  "transcript-reconciliation": 90,
  "watcher": 90,
  // Real watcher faults (genuine errors post Jul-8 kind split, not offline
  // noise) — 90d like other diagnostics; previously unbounded (crit finding).
  "watcher-error": 90,
  // 7-day noise: offline quiet-skips (kind split out of watcher-error Jul 8).
  // High-volume host-offline signal — a week is enough for a weekly digest.
  "watcher-skip": 7,
};

const RETENTION_INDEFINITE_KINDS = [
  "trust-tier-change",
  "trust-tier-delete",
];

export async function runSystemEventsRetention(ctx: SchedulerCtx): Promise<{ status: string; content?: string; error?: string }> {
  const startTime = Date.now();
  const job = ctx.jobs.get("system-events-retention");

  try {
    const res = await fetch(internalApiUrl("/api/system-events/retain"), {
      method: "POST",
      headers: internalApiHeaders(),
      body: JSON.stringify({
        retentionDaysByKind: SYSTEM_EVENTS_RETENTION_DAYS,
        indefiniteKinds: RETENTION_INDEFINITE_KINDS,
      }),
    });
    if (!res.ok) {
      throw new Error(`retention endpoint returned ${res.status}`);
    }
    const data = (await res.json()) as { totalPruned: number; byKind: Record<string, number> };
    const totalPruned = data.totalPruned;
    const byKind = data.byKind ?? {};

    const durationMs = Date.now() - startTime;
    const summary = totalPruned === 0
      ? "0 pruned (substrate quiet)"
      : `${totalPruned} pruned: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(", ")}`;

    console.log(`[scheduler] System events retention: ${summary}`);

    if (job) {
      job.lastRun = new Date();
      job.lastResult = "sent";
      job.lastDurationMs = durationMs;
    }

    // Emit the SUCCESS outcome with jobName so job-stats counts it. Pre-fix the
    // success path recorded nothing while the error path emitted via emitJobEvent
    // → the job read as ~100% error. Route through the same helper for symmetry.
    await emitJobEvent(ctx, "system-events-retention", "system-events-retention", { status: "sent", content: summary }, durationMs);
    return { status: "sent", content: summary };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] System events retention failed: ${errMsg}`);
    if (job) {
      job.lastRun = new Date();
      job.lastResult = "error";
      job.lastDurationMs = Date.now() - startTime;
    }
    await emitJobEvent(ctx, "system-events-retention", "system-events-retention", { status: "error", error: errMsg }, Date.now() - startTime);
    return { status: "error", error: errMsg };
  }
}

// (Job: Transcript Reconciliation — Phase B1, May 17 — DELETED Jul 25 2026,
// Wave 1a prune. Env-disabled since ~Jul 2 (TRANSCRIPT_RECONCILIATION_ENABLED
// =false) and silent since. It was a BACKSTOP for the Stop-hook ingest path;
// that path (`transcript-ingest`) is live at ~1,033 events/7d and untouched.
// Historical kind='transcript-reconciliation' rows still exist, so this file's
// SYSTEM_EVENTS_RETENTION_DAYS entry for that kind is deliberately KEPT.)

// --- Job: Coherence Check (Phase A2, May 16) ---
//
// Daily 04:45 UB. Verifies the Codex-native pure-substrate architecture:
// no server-side model runtime, no permanent specialist roster, canonical
// skills, required doctrine files, and the exact retained MCP surface.
//
// Output emitted to system_events.kind='coherence'. The /status page
// can surface latest pass/fail; on fail, the failingItems list is in
// the payload for inspection.

interface CoherenceFinding {
  severity: "fail" | "warn" | "info";
  category: string;
  message: string;
  file?: string;
  line?: number;
}

interface CoherenceReport {
  passed: boolean;
  findings: CoherenceFinding[];
  summary: { fail: number; warn: number; info: number };
}

export async function runCoherenceCheck(ctx: SchedulerCtx): Promise<{ status: string; content?: string; error?: string }> {
  const startTime = Date.now();
  const job = ctx.jobs.get("coherence-check");
  // BODHI_HOME is the data directory and must never be interpreted as source.
  // An explicit repository override is available for packaged deployments;
  // otherwise derive the source root from this module, never process.cwd().
  const command = resolveCoherenceCommand();

  let report: CoherenceReport | null = null;
  let exitCode = 0;
  let raw = "";

  try {
    raw = execFileSync(command.executable, command.args, {
      cwd: command.repoRoot,
      timeout: 30_000,
      encoding: "utf8",
    });
    report = JSON.parse(raw) as CoherenceReport;
  } catch (err: unknown) {
    // execFileSync throws on non-zero exit. Exit 1 = coherence fail
    // (still has a valid JSON report on stdout). Exit 2 = script error.
    const e = err as { status?: number; stdout?: Buffer | string };
    exitCode = e.status ?? 2;
    const stdout = typeof e.stdout === "string" ? e.stdout : e.stdout?.toString() ?? "";
    if (stdout.trim()) {
      try {
        report = JSON.parse(stdout) as CoherenceReport;
      } catch {
        // unparseable — leave report null
      }
    }
  }

  const durationMs = Date.now() - startTime;

  if (!report) {
    const errMsg = `coherence script failed (exit ${exitCode}); no parseable JSON output`;
    console.error(`[scheduler] ${errMsg}`);
    if (job) {
      job.lastRun = new Date();
      job.lastResult = "error";
      job.lastDurationMs = durationMs;
    }
    await emitJobEvent(ctx, "coherence-check", "coherence", { status: "error", error: errMsg }, durationMs);
    return { status: "error", error: errMsg };
  }

  const summary = `${report.summary.fail} fail · ${report.summary.warn} warn · ${report.summary.info} info`;
  console.log(`[scheduler] Coherence check: ${report.passed ? "PASS" : "FAIL"} — ${summary}`);

  if (job) {
    job.lastRun = new Date();
    job.lastResult = "sent";
    job.lastDurationMs = durationMs;
  }

  // Mission 4 (May 19, 2026): unified kind="coherence-check" for both
  // success and error paths. Previously the success path emitted
  // kind="coherence" while the error path (emitJobEvent) emitted
  // kind="coherence-check" — same job, two kinds, downstream queries
  // had to OR them. Job name + widget query + error path all already
  // use "coherence-check"; success path now matches.
  await ctx.systemEvents?.record({
    kind: "coherence-check",
    summary,
    severity: report.passed ? "info" : "warn",
    payload: {
      jobName: "coherence",
      status: report.passed ? "ok" : "warn",
      passed: report.passed,
      summary: report.summary,
      durationMs,
      contentLength: raw.length,
      failingItems: report.findings.filter((f) => f.severity === "fail"),
      warnings: report.findings.filter((f) => f.severity === "warn"),
    },
  });

  return { status: "sent", content: summary };
}
