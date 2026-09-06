// ============================================================
// BODHI — Drift Scanner
// Detects commitment-vs-reality gaps in the memory store.
// Mycelial memory: surfaces patterns before being asked.
//
// A goal is flagged as "drifting" when:
//   (a) it was stated at least N days ago AND
//   (b) no memories in the last 7 days semantically match it
//
// The scanner runs at 06:00 daily, 2 hours before morning briefing,
// and its output is injected as an "Accountability Check" section.
// ============================================================

import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import type { MemoryService } from "./service.js";

export interface DriftFinding {
  /** 0-1 severity. Higher = more confident drift. */
  severity: number;
  type: "stale_goal" | "low_activity_goal" | "self_reported_drift";
  goalId: string;
  goalContent: string;
  goalAgeDays: number;
  recentActivityCount: number;
  details: string;
}

/**
 * Regex patterns that indicate a goal's content itself reports drift.
 * When a user writes "ZERO videos published" into a goal memory, they're
 * already naming the drift — the scanner just has to surface it.
 */
const SELF_REPORTED_DRIFT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bzero\b\s*(?:new\s+)?(?:videos|posts|ships|delivered|published|shipped)/i, label: "zero shipped" },
  { re: /\b0\s+(?:new\s+)?(?:videos|posts|ships|delivered|published|shipped)/i, label: "0 shipped" },
  { re: /haven'?t\s+(?:started|shipped|published|begun|delivered)/i, label: "haven't shipped" },
  { re: /not\s+yet\s+(?:started|shipped|published|delivered)/i, label: "not yet shipped" },
  { re: /fall(?:ing|en)\s+behind/i, label: "falling behind" },
  { re: /behind\s+schedule/i, label: "behind schedule" },
  { re: /no\s+(?:progress|follow-through|videos\s+yet)/i, label: "no progress" },
  { re: /\bdrift(?:ing|ed)?\b/i, label: "drift" },
  { re: /overdue/i, label: "overdue" },
];

export interface DriftReport {
  findings: DriftFinding[];
  scannedGoals: number;
  scannedAt: Date;
}

/**
 * Goals younger than this (by row-age in DB) don't get scanned — too fresh.
 * Note: a goal's DB age may be much newer than the commitment itself (e.g.
 * a promise made a month ago but extracted yesterday has age_days=1). So
 * this threshold is deliberately low.
 */
const MIN_GOAL_AGE_DAYS = 1;

/** How many days of recent memory we consider "recent activity". */
const RECENT_WINDOW_DAYS = 7;

/** Top K recent memories to fetch for each goal's similarity check. */
const RECENT_TOP_K = 10;

/** A recent memory "matches" a goal if cosine similarity exceeds this. */
const MATCH_THRESHOLD = 0.35;

/**
 * Severity ≥ this gets surfaced into briefings. Raised 0.5 → 0.7 (Jun 3,
 * drift→multiplier) so the morning "Accountability Check" stops age-nagging
 * about quiet goals — it now matches the contradiction-provider's 0.7 gate, so
 * age-based staleness (capped at 0.69 by ageScaledSeverity) surfaces on NEITHER
 * surface; only self_reported_drift (0.85, a goal's own text declaring drift)
 * crosses. Age is not intent.
 */
const SURFACE_SEVERITY = 0.7;

/**
 * Currency window for self_reported_drift (Jun 7, a recurring video goal).
 * A goal's text is a point-in-time snapshot — "as of Apr 26, zero videos" matches
 * the drift regex forever — so a self-report only counts as LIVE while the goal is
 * fresh by row-age OR shows recent related activity. Past that it's a frozen note,
 * demoted to the age-capped (non-surfacing) tier. See selfReportSeverity().
 */
const SELF_REPORT_FRESH_DAYS = 7;

/**
 * Optional event sink so the agent graph can pulse the DriftScanner
 * node when scans run. Best-effort — never throws — failure to emit
 * does not affect scan results.
 */
export interface EventSink {
  record(input: { kind: string; summary: string; payload?: unknown; severity?: "info" | "warn" | "error" }): Promise<unknown>;
}

/**
 * Optional audit sink (Phase 33 C1, May 25, 2026). Mirrors the
 * `AuditService.write` contract in `apps/server/src/lib/audit.ts`
 * exactly without importing it cross-package — the server wires its
 * audit service into the memory layer via dependency injection,
 * matching the EventSink pattern above.
 *
 * Schema: {kind, actor, target?, payload?, metadata?}. Note there is
 * NO top-level `summary` field — callers carrying a human-readable
 * line should put it in `metadata.summary` (it's rendered on /status
 * by reading the metadata jsonb column).
 *
 * Hash-not-body discipline: callers pass raw `payload` (e.g. memory
 * IDs, matched secret strings); the sink hashes via SHA-256 before
 * persistence. NEVER put payload contents in `metadata.summary`.
 *
 * Best-effort: every implementation MUST swallow its own errors so
 * an audit-write failure never breaks the caller's primary action.
 */
export interface AuditSink {
  write(params: {
    kind: string;
    actor: string;
    target?: string | null;
    payload?: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export class DriftScanner {
  constructor(
    private db: Database,
    private memoryService: MemoryService,
    private events?: EventSink | null
  ) {}

  async scan(): Promise<DriftReport> {
    const startTime = Date.now();
    const scannedAt = new Date();
    const goals = await this.getActiveGoals(MIN_GOAL_AGE_DAYS);
    const findings: DriftFinding[] = [];

    for (const goal of goals) {
      const ageDays = daysSince(goal.createdAt);
      // Recent related activity is needed by BOTH the self-report currency gate
      // and the stale/low-activity rules below, so compute it once up front.
      const recentMatches = await this.findRecentMatches(goal);

      // Rule 1: goal content self-reports drift. A self-report is surfaced only
      // while it's LIVE (fresh row OR recent activity); a stale snapshot whose
      // frozen text still says "zero videos" two months on is demoted, not nagged
      // daily — that recurrence (Jun 7) is exactly what this gate kills.
      const driftMarker = detectSelfReportedDrift(goal.content);
      if (driftMarker) {
        const severity = selfReportSeverity(ageDays, recentMatches.length);
        const live = severity >= SURFACE_SEVERITY;
        findings.push({
          severity,
          type: "self_reported_drift",
          goalId: goal.id,
          goalContent: goal.content,
          goalAgeDays: ageDays,
          recentActivityCount: recentMatches.length,
          details: live
            ? `Goal text contains "${driftMarker}" — self-reported drift, and the topic is still live (${recentMatches.length} related memor${recentMatches.length === 1 ? "y" : "ies"} in the last ${RECENT_WINDOW_DAYS}d). Surface it; it is already on the owner's own dashboard.`
            : `Goal text contains "${driftMarker}" but it is a ${ageDays}-day-old snapshot with no recent activity — frozen status, not live drift. Demoted below the surface gate.`,
        });
        continue; // don't also run stale-goal check on same goal
      }

      if (recentMatches.length === 0) {
        // No recent activity at all → stale goal
        findings.push({
          severity: ageScaledSeverity(ageDays, 0.5),
          type: "stale_goal",
          goalId: goal.id,
          goalContent: goal.content,
          goalAgeDays: ageDays,
          recentActivityCount: 0,
          details: `Goal stated ${ageDays} days ago. No related memories in the last ${RECENT_WINDOW_DAYS} days.`,
        });
      } else if (recentMatches.length < 2 && ageDays > 7) {
        // Weak recent activity on an older goal → low-activity
        findings.push({
          severity: ageScaledSeverity(ageDays, 0.4),
          type: "low_activity_goal",
          goalId: goal.id,
          goalContent: goal.content,
          goalAgeDays: ageDays,
          recentActivityCount: recentMatches.length,
          details: `Goal stated ${ageDays} days ago. Only ${recentMatches.length} related memor${recentMatches.length === 1 ? "y" : "ies"} in the last ${RECENT_WINDOW_DAYS} days.`,
        });
      }
    }

    findings.sort((a, b) => b.severity - a.severity);

    const top10 = findings.slice(0, 10);
    const durationMs = Date.now() - startTime;

    // Phase 2: pulse the DriftScanner node in BrainHome. Severity
    // mirrors the highest-signal finding so the dashboard can color
    // the pulse (info/warn/error). Best-effort.
    if (this.events) {
      const topSeverity = top10[0]?.severity ?? 0;
      const sev: "info" | "warn" | "error" = topSeverity >= 0.7 ? "warn" : "info";
      this.events.record({
        kind: "drift",
        summary: `drift scan → ${top10.length} findings (${goals.length} goals scanned)`,
        payload: { findingsCount: top10.length, scannedGoals: goals.length, durationMs, topSeverity },
        severity: sev,
      }).catch(() => { /* best-effort */ });
    }

    return {
      findings: top10,
      scannedGoals: goals.length,
      scannedAt,
    };
  }

  /**
   * Format a report as a briefing-ready markdown section.
   * Returns empty string if no findings exceed the surface threshold.
   */
  formatForBriefing(report: DriftReport): string {
    const surfaceable = report.findings.filter(
      (f) => f.severity >= SURFACE_SEVERITY
    );
    if (surfaceable.length === 0) return "";

    const lines = surfaceable.map((f) => {
      const shortGoal =
        f.goalContent.length > 120
          ? f.goalContent.slice(0, 117) + "..."
          : f.goalContent;
      return `- ${f.details}\n  Goal: "${shortGoal}"`;
    });

    return `\n\n## Accountability Check\n\n${lines.join("\n\n")}`;
  }

  private async getActiveGoals(
    minAgeDays: number
  ): Promise<Array<{ id: string; content: string; createdAt: Date }>> {
    const result = await this.db.execute(sql`
      SELECT id, content, created_at
      FROM memories
      WHERE type = 'goal'
        AND status = 'confirmed'
        AND scope != 'archived'
        AND confidence > 0.5
        AND created_at < now() - ${minAgeDays + " days"}::interval
      ORDER BY importance DESC, created_at DESC
      LIMIT 20
    `);

    const rows = result as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      content: String(r.content),
      createdAt: new Date(r.created_at as string),
    }));
  }

  private async findRecentMatches(goal: {
    id: string;
    content: string;
  }): Promise<Array<{ id: string; similarity: number }>> {
    const results = await this.memoryService.retrieve(
      goal.content,
      RECENT_TOP_K
    );
    const cutoff = Date.now() - RECENT_WINDOW_DAYS * 86400000;
    return results
      .filter(
        (r) =>
          r.id !== goal.id &&
          r.createdAt.getTime() > cutoff &&
          r.similarity > MATCH_THRESHOLD
      )
      .map((r) => ({ id: r.id, similarity: r.similarity }));
  }
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

/**
 * Age nudges a stale-goal finding's RANK among quiet signals, but never pushes
 * it across the surface threshold on its own. Age is not intent (drift→multiplier,
 * Jun 3): an old goal with no recent memories may be done, deliberately parked,
 * or simply un-logged — that is not drift. Only an intent signal
 * (self_reported_drift = 0.85, set directly) may surface a challenge; age-based
 * staleness stays a quiet signal capped strictly below SURFACE_SEVERITY (0.7).
 */
export function ageScaledSeverity(ageDays: number, base: number): number {
  const ageFactor = Math.min(0.4, ((ageDays - 3) / 27) * 0.4);
  return Math.min(0.69, base + Math.max(0, ageFactor));
}

/**
 * Currency gate for self_reported_drift (Jun 7). A goal's text is a point-in-time
 * snapshot: "as of Apr 26, zero videos" matches the drift regex forever, so without
 * this gate the SAME April status leads the morning thought every single day (the
 * a recurring video goal). A self-report earns its 0.85 surfacing severity
 * only when it's still LIVE — the topic shows recent related activity, OR the goal
 * row itself is genuinely fresh (≤ SELF_REPORT_FRESH_DAYS). Otherwise it's a frozen
 * note: demote to the age-capped tier (strictly < SURFACE_SEVERITY) so it stops
 * nagging. Aligns with drift→multiplier (non-neg #6): surface a still-active
 * commitment, once — never a stale snapshot, daily. Row-age is a deliberately weak
 * freshness proxy (the extractor can re-mint an old fact with a new created_at), so
 * recent ACTIVITY is the primary signal; fresh-row only rescues brand-new self-reports.
 */
export function selfReportSeverity(ageDays: number, recentActivityCount: number): number {
  const live = recentActivityCount >= 1 || ageDays <= SELF_REPORT_FRESH_DAYS;
  return live ? 0.85 : ageScaledSeverity(ageDays, 0.5);
}

export function detectSelfReportedDrift(content: string): string | null {
  for (const { re, label } of SELF_REPORTED_DRIFT_PATTERNS) {
    if (re.test(content)) return label;
  }
  return null;
}
