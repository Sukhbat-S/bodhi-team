// ============================================================
// BODHI — Maintenance-liveness checker (K1, Jun 20, 2026)
//
// THE KEYSTONE FIX. BODHI builds self-maintenance machinery (decay /
// synthesis / demote / forget) but never verifies it actually DOES anything.
// A maintenance arm can fire green every night yet mutate zero rows forever —
// "ran: changed 0" — and look indistinguishable from a healthy one. The audit
// found exactly this ("0 demoted Jun-20"): the demote arm was a structural
// no-op and nobody noticed because nothing watched the EMITTED change-count.
//
// This module makes the substrate report its own inertness. For each mutating
// maintenance arm we read its last N system_events runs and check the numeric
// change-count (payload.changed, emitted by jobs/emit.ts since K1). An arm is
// STALE when its last N CONSECUTIVE runs ALL changed nothing — run-but-changed-
// nothing, the inertness signature. The active check emits one durable system
// event; session-start translates material degradation into the native task.
//
// Verify-by-emission applied to BODHI's own housekeeping (first-principles
// doctrine #2): a green cron ≠ a working cron; only the change-count proves it.
// ============================================================

import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import type { SystemEventsService } from "../services/system-events.js";

/**
 * The mutating maintenance arms we watch. Each maps a system_events `kind` to
 * the payload count-key that means "this arm changed something". A verifier
 * arm (coherence-check) is deliberately NOT here — for a verifier, 0 findings
 * is HEALTHY, not inert; only MUTATING arms make "changed 0 forever" a bug.
 *
 * `countKey` reads payload.<key>; if absent (older events pre-K1), the run is
 * treated as UNKNOWN and skipped from the consecutive-no-change tally so we
 * never false-flag an arm whose telemetry predates the numeric counts.
 *
 * `poolKey` (optional) names a payload key holding the arm's CANDIDATE-POOL size.
 * A candidate-driven arm that changed 0 because its pool was EMPTY is healthy-
 * quiet, not inert — so a run where payload.<poolKey> === 0 is skipped from the
 * no-change streak (same mechanic as the pre-K1 UNKNOWN-skip). Without this, an
 * arm with a legitimately empty pool (e.g. synthesizer-demote: no superseded
 * foundational rows) is a permanent false-positive on staleArms.
 */
export interface MaintenanceArm {
  arm: string;
  kind: string;
  countKey: string;
  poolKey?: string;
}

export const MAINTENANCE_ARMS: MaintenanceArm[] = [
  {
    arm: "forgetting-tier",
    kind: "forgetting-tier",
    countKey: "changed",
    poolKey: "candidates",
  },
  {
    arm: "parking-maintenance",
    kind: "parking-maintenance",
    countKey: "changed",
    poolKey: "eligible",
  },
];

/** How many consecutive change-0 runs before an arm is declared stale. */
export const STALE_CONSECUTIVE_RUNS = 3;
/** How many recent runs to pull per arm (≥ STALE so we can see the streak). */
const RUNS_WINDOW = 10;

/**
 * Four states, never two (Jul 25 2026). `stale: false` used to carry BOTH
 * "we have evidence this arm is working" AND "we have no evidence at all"
 * (zero decidable runs) — the overloaded-sentinel bug class
 * (pattern_overloaded_empty_vs_terminal_state_second_lap_jul22). Zero decidable
 * runs is the *blindest* case, and it read as healthy: synthesizer-demote showed
 * no decidable runs while `staleArms: []` and the cron logged "all maintenance
 * arms live". `status` is now the honest field:
 *
 *   live    — ≥1 decidable run and no full no-change streak. Evidence of work.
 *   stale   — a full streak of decidable runs that all changed 0. Inert.
 *   quiet   — we watched, and there was genuinely nothing to do (every observed
 *             run had an EMPTY candidate pool). Healthy, but distinct from
 *             `live`: an arm whose pool-measuring query is itself broken would
 *             also report 0 forever, and calling that `live` would be a false
 *             green in the one module built to prevent them. "Quiet for 30
 *             nights" stays a question you can ask.
 *   unknown — ZERO observed runs. We cannot see this arm at all; the watcher
 *             itself is blind here. NOT healthy, NOT proven inert.
 *
 * FOURTH STATE ADDED Jul 25 2026, and the reason is the same overloaded-sentinel
 * bug one level down. The comment at the `decidable` filter below has always
 * said "a run whose pool was EMPTY was healthy-quiet — not inert", but the code
 * dropped those runs entirely and then read `decidable.length === 0` as
 * `unknown`. So "we looked and there was nothing to do" was reported as "we are
 * blind" — synthesizer-demote sat at `unknown` indefinitely while being
 * perfectly healthy. The distinction that fixes it:
 *
 *   observed  — the emitter measured its pool this run (0 included). We LOOKED.
 *   decidable — the pool was non-empty. There was WORK, so the run is evidence
 *               about whether the arm functions.
 *
 * `status` keys off `observed`; the streak/`stale` logic keys off `decidable`,
 * exactly as before, so no arm can NEWLY become stale from this change.
 *
 * `stale` is retained (same meaning as before, now narrowed to the real
 * inert case) so existing consumers keep working; new consumers should read
 * `status`.
 */
export type ArmStatus = "live" | "stale" | "quiet" | "unknown";

export interface ArmLiveness {
  arm: string;
  kind: string;
  /** Runs where the emitter measured its pool at all — the "we looked" count. */
  runsConsidered: number;
  /** Subset of those whose pool was non-empty — the "there was work" count. */
  runsWithCandidates: number;
  /** Consecutive most-recent runs that changed nothing (count = 0). */
  consecutiveNoChange: number;
  status: ArmStatus;
  stale: boolean;
  /** ISO of the most recent run that DID change something, or null if none seen. */
  lastChangedAt: string | null;
}

interface EventRow {
  ts: string;
  // payload is JSONB; the count we care about lives at payload.<countKey>.
  // Pulled as text and Number()-coerced so a missing key reads as null, not 0.
  changed: string | null;
  // payload.<poolKey> when the arm declares one; NULL for arms without a pool
  // key (and for pre-poolKey events). A pool of 0 marks a healthy-quiet run.
  pool: string | null;
}

/** The per-arm verdict, minus the arm's own identity. */
export interface RunClassification {
  runsConsidered: number;
  runsWithCandidates: number;
  consecutiveNoChange: number;
  status: ArmStatus;
  stale: boolean;
  lastChangedAt: string | null;
}

/**
 * Classify one arm's recent runs. PURE — no db, no clock, no env. Extracted
 * from computeArmLiveness (Jul 25 2026) with zero behavior change, so the
 * decision table can be tested directly: this module's whole job is deciding
 * "is the arm inert?", and until now nothing exercised that decision at all.
 *
 * `rows` is newest-first, already numeric-coerced and filtered to runs carrying
 * a numeric count. `poolKey` non-null marks a pool-aware arm.
 */
export function classifyRuns(
  rows: { ts: string; changed: number; pool: number | null }[],
  poolKey: string | null,
): RunClassification {
  // Pool-driven arms (poolKey set): a run is EVIDENCE of liveness only when its
  // candidate pool was non-empty. A run whose pool was EMPTY (pool === 0) was
  // healthy-quiet — nothing to change — not inert. A run MISSING the pool key
  // is also non-evidence: for `synthesis` the substrate emits TWO rows per
  // cycle (the synthesizer's own event carries demoteCandidates; the
  // scheduler's emitJobEvent twin does not) plus pre-fix telemetry — none of
  // those pool-less twins should be mistaken for an inert run. Both are skipped
  // with the same non-evidence status as a pre-K1 UNKNOWN run. Arms WITHOUT a
  // poolKey keep prior behavior (every numeric-count run is decidable).
  // OBSERVED vs DECIDABLE — the two questions this module kept conflating.
  // observed  = the emitter measured its pool (0 included). "We looked."
  // decidable = the pool was non-empty. "There was work to judge it by."
  // Until Jul 25 2026 only `decidable` existed, so an arm that ran every night
  // with nothing to do was indistinguishable from an arm we never saw.
  const poolAware = poolKey != null;
  const observed = poolAware
    ? rows.filter((r) => r.pool != null && !Number.isNaN(r.pool))
    : rows;
  const decidable = poolAware ? observed.filter((r) => r.pool! > 0) : observed;

  let consecutiveNoChange = 0;
  let lastChangedAt: string | null = null;
  for (const r of decidable) {
    // decidable is newest-first. Walk until the first run that changed > 0.
    if (r.changed > 0) {
      lastChangedAt = r.ts;
      break;
    }
    consecutiveNoChange += 1;
  }

  // STALE only when we actually have a full streak of decidable no-change
  // runs (≥ STALE_CONSECUTIVE_RUNS). A young arm with < STALE decidable runs
  // is NOT yet stale — insufficient evidence, never a false alarm.
  const stale =
    decidable.length >= STALE_CONSECUTIVE_RUNS && consecutiveNoChange >= STALE_CONSECUTIVE_RUNS;

  // ZERO OBSERVED runs → UNKNOWN, never live. Pre-K1 NULL counts and pool-less
  // twins can eat *all* the rows, and when they do we have observed nothing
  // about this arm. Reporting that as healthy is precisely the false-green this
  // module exists to prevent.
  //
  // But an empty candidate pool is NOT that case — it is the arm reporting, in
  // good faith, that it had nothing to do. That reads QUIET. Keying `status`
  // off `decidable` (as this did until Jul 25 2026) collapsed the two and
  // pinned synthesizer-demote at `unknown` forever.
  const status: ArmStatus =
    observed.length === 0
      ? "unknown"
      : stale
        ? "stale"
        : decidable.length === 0
          ? "quiet"
          : "live";

  return {
    runsConsidered: observed.length,
    runsWithCandidates: decidable.length,
    consecutiveNoChange,
    status,
    stale,
    lastChangedAt,
  };
}

/**
 * Compute liveness for every arm WITHOUT side effects. Shared by the read-only
 * GET (for /status) and the POST (which additionally posts inbox rows). Pure
 * over the DB: it only reads system_events.
 */
export async function computeArmLiveness(db: Database): Promise<ArmLiveness[]> {
  const out: ArmLiveness[] = [];

  for (const a of MAINTENANCE_ARMS) {
    // Most-recent RUNS_WINDOW successful runs for this kind, newest first.
    // Extract payload.<countKey> as text so an absent key is NULL (pre-K1
    // events) rather than coercing to 0.
    // Pull payload.<poolKey> alongside the count when the arm declares one; a
    // NULL literal when it doesn't, so EventRow.pool is uniformly typed.
    const poolExpr = a.poolKey
      ? sql`(payload ->> ${a.poolKey})`
      : sql`NULL::text`;
    const rows = (await db.execute(sql`
      SELECT ts::text AS ts, (payload ->> ${a.countKey}) AS changed, ${poolExpr} AS pool
      FROM system_events
      WHERE kind = ${a.kind}
        AND severity <> 'error'
      ORDER BY ts DESC
      LIMIT ${RUNS_WINDOW}
    `)) as unknown as EventRow[];

    // Only runs that carry a numeric count are decidable. Pre-K1 runs (NULL
    // count) are skipped — we cannot tell if they changed anything.
    const withCounts = rows
      .map((r) => ({
        ts: r.ts,
        changed: r.changed == null ? null : Number(r.changed),
        pool: r.pool == null ? null : Number(r.pool),
      }))
      .filter((r): r is { ts: string; changed: number; pool: number | null } =>
        r.changed != null && !Number.isNaN(r.changed));

    out.push({
      arm: a.arm,
      kind: a.kind,
      ...classifyRuns(withCounts, a.poolKey ?? null),
    });
  }

  return out;
}

export interface MaintenanceLivenessRoutesDeps {
  db: Database;
  systemEvents: SystemEventsService;
}

export function mountMaintenanceLivenessRoutes(
  app: Hono,
  deps: MaintenanceLivenessRoutesDeps,
): Hono {
  const { db, systemEvents } = deps;

  // Read-only — same computed arms[], no inbox writes. For /status + ad-hoc.
  // `unknownArms` is reported ALONGSIDE `staleArms`, never folded into it: an
  // unobserved arm and a proven-inert arm are different problems with different
  // fixes (fix the telemetry vs fix the arm).
  app.get("/api/maintenance/liveness", async (c) => {
    const arms = await computeArmLiveness(db);
    return c.json({
      ok: true,
      arms,
      staleArms: arms.filter((a) => a.stale).map((a) => a.arm),
      unknownArms: arms.filter((a) => a.status === "unknown").map((a) => a.arm),
    });
  });

  // Active check — computes arms[] and emits one maintenance-liveness event.
  // Codex session-start owns delivery into the architect's current task.
  app.post("/api/maintenance/liveness-check", async (c) => {
    const arms = await computeArmLiveness(db);
    const stale = arms.filter((a) => a.stale);
    const unknown = arms.filter((a) => a.status === "unknown");

    // The checker watches itself — emit its own run so a future audit can see
    // THIS arm fired (and the GET surfaces the sweep on /status).
    // "liveness ok" is claimable ONLY when every arm is observed AND live. An
    // unknown arm downgrades the sweep to warn — a blind watcher reporting green
    // is the failure mode, not an acceptable default.
    const parts: string[] = [];
    if (stale.length > 0) parts.push(`${stale.length} stale arm(s): ${stale.map((a) => a.arm).join(", ")}`);
    if (unknown.length > 0) parts.push(`${unknown.length} unknown arm(s) (0 decidable runs): ${unknown.map((a) => a.arm).join(", ")}`);
    await systemEvents.record({
      kind: "maintenance-liveness",
      summary: parts.length === 0 ? `liveness ok — ${arms.length} arms live` : parts.join(" · "),
      severity: parts.length === 0 ? "info" : "warn",
      payload: {
        jobName: "maintenance-liveness",
        armsConsidered: arms.length,
        staleCount: stale.length,
        staleArms: stale.map((a) => a.arm),
        unknownCount: unknown.length,
        unknownArms: unknown.map((a) => a.arm),
      },
    });

    return c.json({
      ok: true,
      arms,
      staleArms: stale.map((a) => a.arm),
      unknownArms: unknown.map((a) => a.arm),
    });
  });

  return app;
}
