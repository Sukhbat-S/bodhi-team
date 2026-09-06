import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import type { SystemEventsService } from "../services/system-events.js";

export interface SystemEventsRetainRoutesDeps { db: Database; systemEvents: SystemEventsService; }

/** Kind-specific system_events retention pruning. Extracted from index.ts 2026-05-29 (Wave B1). */
export function mountSystemEventsRetainRoutes(app: Hono, deps: SystemEventsRetainRoutesDeps): Hono {
  const { db, systemEvents } = deps;

  app.post("/api/system-events/retain", async (c) => {
    type Body = {
      retentionDaysByKind: Record<string, number>;
      indefiniteKinds?: string[];
    };
    let body: Body;
    try {
      body = await c.req.json<Body>();
    } catch {
      return c.json({ error: "invalid json body" }, 400);
    }
    if (!body.retentionDaysByKind || typeof body.retentionDaysByKind !== "object") {
      return c.json({ error: "retentionDaysByKind required" }, 400);
    }
    const indefinite = new Set(body.indefiniteKinds ?? []);

    const byKind: Record<string, number> = {};
    let totalPruned = 0;
    for (const [kind, days] of Object.entries(body.retentionDaysByKind)) {
      if (indefinite.has(kind)) continue;
      if (typeof days !== "number" || days <= 0) continue;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const result = await db.execute(sql`
        DELETE FROM system_events
        WHERE kind = ${kind} AND ts < ${cutoff.toISOString()}::timestamptz
      `);
      const r = result as unknown as { count?: number; rowCount?: number; length?: number };
      const n = r.count ?? r.rowCount ?? r.length ?? 0;
      if (n > 0) {
        byKind[kind] = n;
        totalPruned += n;
      }
    }

    const summary = totalPruned === 0
      ? "0 pruned (substrate quiet)"
      : `${totalPruned} events pruned: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(", ")}`;

    await systemEvents
      .record({
        kind: "system-events-retention",
        severity: "info",
        summary,
        payload: { totalPruned, byKind, retentionDaysByKind: body.retentionDaysByKind, indefiniteKinds: body.indefiniteKinds },
      })
      .catch(() => {});

    return c.json({ ok: true, totalPruned, byKind });
  });

  // ============================================================
  // Persistence Bridge — Tier 0 transcript ingest (Phase B1, May 17)
  // ------------------------------------------------------------
  // The structural fix for pattern_parent_claude_outside_substrate_may15.
  // Stop hook posts {transcriptPath, sessionId, cwd, endReason}; this
  // endpoint reads the JSONL on local disk, parses each event, and
  // persists user/assistant turns into conversation_turns with
  // channel='cli'. Idempotent on source_event_id (JSONL line uuid).
  //
  // Tool-result truncation: payloads >10KB stored as {kind,name,status}
  // only; reduces row size while preserving the "what did we do" trail.
  // Tool calls are persisted in full (small).
  // ============================================================

  return app;
}
