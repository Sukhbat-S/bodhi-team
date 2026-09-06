// ============================================================
// BODHI — System Events Service
// Single closure-tracking surface. Every detection signal
// (synthesis, drift, briefing, workflow, watcher, intel) records
// here. Powered by the Apr 26 architecture audit (C#5).
//
// Emitter contract: best-effort, never throws. Closure-tracking
// must not become a critical-path dependency. Failures log to
// console and return null.
//
// Currently emitted from:
//   - /api/scheduler/trigger route (manual triggers)
//   - bodhi-watch deploy smokes (planned)
// Not yet emitted from (TODO, post-C#4 scheduler split):
//   - cron-fired scheduler jobs (need pass-through inside scheduler.ts)
//   - DriftScanner.scan() on-finding
//   - MemorySynthesizer auto-runs (every-4h gated path)
// ============================================================

import { EventEmitter } from "node:events";
import { desc, gte, and, eq, sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import { systemEvents } from "@seneca/db";

export type SystemEventKind =
  | "synthesis"
  | "drift"
  | "briefing"
  | "workflow"
  | "watcher"
  | "intel"
  | "deploy_smoke"
  | "messenger_intel"
  | "mcp_call"
  | "provider_fire"
  | "push";

export type SystemEventSeverity = "info" | "warn" | "error";

export interface RecordedEvent {
  id: string;
  kind: string;
  summary: string;
  severity: SystemEventSeverity;
  payload?: unknown;
  ts: string;
}

export class SystemEventsService {
  /**
   * EventEmitter for live SSE consumers. Fires after every successful
   * record() with a `RecordedEvent` payload. Best-effort.
   */
  readonly bus = new EventEmitter();

  constructor(private db: Database) {
    // Allow many SSE clients (one per dashboard tab) without warnings.
    this.bus.setMaxListeners(50);
  }

  // Best-effort emitter. Never throws — closure tracking must not
  // become a critical-path dependency for the emitting subsystem.
  async record(input: {
    kind: SystemEventKind | string;
    summary: string;
    payload?: unknown;
    severity?: SystemEventSeverity;
  }): Promise<{ id: string } | null> {
    try {
      const severity = input.severity ?? "info";
      const [row] = await this.db
        .insert(systemEvents)
        .values({
          kind: input.kind,
          summary: input.summary,
          payload: input.payload ?? null,
          severity,
        })
        .returning({ id: systemEvents.id });
      if (row) {
        this.bus.emit("event", {
          id: row.id,
          kind: input.kind,
          summary: input.summary,
          severity,
          payload: input.payload,
          ts: new Date().toISOString(),
        } satisfies RecordedEvent);
      }
      return row ?? null;
    } catch (err) {
      console.warn("[system-events] record failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  async listRecent(opts: { hours?: number; kind?: string; limit?: number; unackedOnly?: boolean } = {}) {
    const hours = opts.hours ?? 24;
    const limit = Math.min(opts.limit ?? 200, 1000);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const conds = [gte(systemEvents.ts, since)];
    if (opts.kind) conds.push(eq(systemEvents.kind, opts.kind));
    if (opts.unackedOnly) conds.push(sql`${systemEvents.acknowledgedAt} IS NULL`);

    return await this.db
      .select()
      .from(systemEvents)
      .where(and(...conds))
      .orderBy(desc(systemEvents.ts))
      .limit(limit);
  }

  async acknowledge(id: string): Promise<boolean> {
    const result = await this.db
      .update(systemEvents)
      .set({ acknowledgedAt: new Date() })
      .where(eq(systemEvents.id, id))
      .returning({ id: systemEvents.id });
    return result.length > 0;
  }
}

/**
 * Observability (Jul 7): emit a `push` row for a single proactive-push attempt.
 * The Telegram push was the ONLY briefing-pipeline step with no emitted signal
 * — a swallowed `deps.send` failure was invisible (had to be inferred from the
 * absence of a delivered message). Shared by BOTH send surfaces (Concierge's
 * voiced-briefing path and the scheduler's direct telegram fallback) so every
 * attempt records exactly once. `error === null` → ok (info); else warn.
 * Fire-and-forget: record() already swallows its own failures, so this never
 * throws into the push path.
 */
export function recordPushEvent(
  systemEvents: SystemEventsService | undefined | null,
  label: string,
  error: string | null,
): void {
  if (!systemEvents) return;
  const ok = error === null;
  void systemEvents.record({
    kind: "push",
    summary: ok
      ? `telegram push → ok (${label})`
      : `telegram push → failed (${label}): ${error.slice(0, 100)}`,
    severity: ok ? "info" : "warn",
    payload: { label, ok, error: error ?? undefined },
  });
}
