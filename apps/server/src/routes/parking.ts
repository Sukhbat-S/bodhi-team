// ============================================================
// BODHI — parking system REST surface (Wave 3, Jul 5, 2026)
//
// Durable attention parking: store an executable date/manual-review trigger,
// list active parks, deterministically reconcile its boundary, close manually,
// or re-park after resurfacing. Codex owns prioritization and execution.
//
//   POST /api/parking             — park (date or manual review only)
//   GET  /api/parking?status=     — list (default: not-closed) + counts
//   POST /api/parking/maintenance/reconcile — deterministic date/review sweep
//   POST /api/parking/:id/close   — manual close (reason done|moot)
//   POST /api/parking/:id/repark  — back to parked, clears resurfaced fields
//
// Rich historical trigger/auto_close JSON remains stored verbatim. Reads label
// unsupported conditions as descriptive-only; new writes never promise them.
// ============================================================

import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import {
  createParkingMaintenanceService,
  type ParkingMaintenanceService,
} from "../services/parking/maintenance.js";
import {
  describeStoredTrigger,
  parseTrigger,
  TriggerValidationError,
} from "../services/parking/triggers.js";

export interface ParkingRoutesDeps {
  db: Database;
  maintenance?: ParkingMaintenanceService;
}

export function mountParkingRoutes(app: Hono, deps: ParkingRoutesDeps): Hono {
  const { db } = deps;
  const maintenance = deps.maintenance ?? createParkingMaintenanceService(db);

  // ── POST /api/parking ────────────────────────────────────────
  app.post("/api/parking", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const { title, detail, originKind, originRef, trigger, autoClose, reviewBy, createdBy } =
      body ?? {};

    if (typeof title !== "string" || title.trim().length === 0) {
      return c.json({ error: "title is required" }, 400);
    }

    if (autoClose != null) {
      return c.json({
        error: "autoClose is unsupported; closing a parked item requires an explicit close action",
      }, 400);
    }

    try {
      parseTrigger(trigger);
    } catch (err) {
      if (err instanceof TriggerValidationError) return c.json({ error: err.message }, 400);
      throw err;
    }

    // originKind/reviewBy would otherwise surface as raw Postgres CHECK/cast
    // errors (500) — give them the same clean 400 the trigger path gets.
    const ORIGIN_KINDS = ["memory", "cron", "free"];
    if (originKind != null && !ORIGIN_KINDS.includes(originKind)) {
      return c.json({ error: `unknown originKind: ${String(originKind)}` }, 400);
    }
    if (reviewBy != null && (typeof reviewBy !== "string" || Number.isNaN(Date.parse(reviewBy)))) {
      return c.json({ error: `reviewBy is not a parseable date: ${String(reviewBy)}` }, 400);
    }

    const rows = (await db.execute(sql`
      INSERT INTO parked_items
        (title, detail, origin_kind, origin_ref, trigger, auto_close, review_by, created_by)
      VALUES (
        ${title},
        ${detail ?? ""},
        ${originKind ?? "free"},
        ${originRef ?? null},
        ${JSON.stringify(trigger)}::jsonb,
        ${null}::jsonb,
        COALESCE(${reviewBy ?? null}::timestamptz, now() + interval '30 days'),
        ${createdBy ?? null}
      )
      RETURNING *
    `)) as unknown as any[];

    return c.json({ item: rows[0] ?? null }, 201);
  });

  // ── GET /api/parking?status= ─────────────────────────────────
  app.get("/api/parking", async (c) => {
    const status = c.req.query("status");
    const one = status === "parked" || status === "resurfaced" || status === "closed";

    const rows = (await db.execute(
      one
        ? sql`SELECT * FROM parked_items WHERE status = ${status} ORDER BY parked_at DESC`
        : sql`SELECT * FROM parked_items WHERE status IN ('parked','resurfaced') ORDER BY parked_at DESC`,
    )) as unknown as any[];
    const items = rows.map((item) => ({
      ...item,
      trigger_execution: describeStoredTrigger(item.trigger),
      auto_close_execution: item.auto_close == null
        ? { configured: false, supported: false }
        : {
            configured: true,
            supported: false,
            description: "stored legacy auto-close intent is not executed; closure requires an explicit action",
          },
    }));

    const countRows = (await db.execute(sql`
      SELECT status, count(*)::int AS n FROM parked_items GROUP BY status
    `)) as unknown as Array<{ status: string; n: number }>;

    const counts = { parked: 0, resurfaced: 0, closed: 0 } as Record<string, number>;
    for (const r of countRows) counts[r.status] = r.n;

    return c.json({ items, counts });
  });

  // ── POST /api/parking/maintenance/reconcile ────────────────
  app.post("/api/parking/maintenance/reconcile", async (c) => {
    return c.json(await maintenance.reconcile());
  });

  // ── POST /api/parking/:id/close ──────────────────────────────
  app.post("/api/parking/:id/close", async (c) => {
    const id = c.req.param("id");
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      /* empty body is fine — default reason */
    }
    const reason = body?.reason === "moot" ? "moot" : "done";

    const rows = (await db.execute(sql`
      UPDATE parked_items
      SET status = 'closed', closed_reason = ${reason}, closed_at = now()
      WHERE id = ${id}
      RETURNING *
    `)) as unknown as any[];

    if (!rows.length) return c.json({ error: "not found" }, 404);
    return c.json({ item: rows[0] });
  });

  // ── POST /api/parking/:id/repark ─────────────────────────────
  app.post("/api/parking/:id/repark", async (c) => {
    const id = c.req.param("id");
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      /* empty body is fine — keep existing trigger */
    }
    const { trigger, autoClose, reviewBy } = body ?? {};

    if (autoClose != null) {
      return c.json({
        error: "autoClose is unsupported; closing a parked item requires an explicit close action",
      }, 400);
    }

    try {
      if (trigger != null) parseTrigger(trigger);
    } catch (err) {
      if (err instanceof TriggerValidationError) return c.json({ error: err.message }, 400);
      throw err;
    }
    if (reviewBy != null && (typeof reviewBy !== "string" || Number.isNaN(Date.parse(reviewBy)))) {
      return c.json({ error: `reviewBy is not a parseable date: ${String(reviewBy)}` }, 400);
    }

    const existing = (await db.execute(sql`
      SELECT status FROM parked_items WHERE id = ${id}
    `)) as unknown as Array<{ status: string }>;

    if (!existing.length) return c.json({ error: "not found" }, 404);
    if (existing[0].status === "closed") {
      return c.json({ error: "cannot re-park a closed item" }, 409);
    }

    const rows = (await db.execute(sql`
      UPDATE parked_items
      SET status = 'parked',
          parked_at = now(),
          resurfaced_at = NULL,
          resurfaced_reason = NULL,
          trigger = COALESCE(${trigger != null ? JSON.stringify(trigger) : null}::jsonb, trigger),
          review_by = COALESCE(${reviewBy ?? null}::timestamptz, now() + interval '30 days')
      WHERE id = ${id}
      RETURNING *
    `)) as unknown as any[];

    return c.json({ item: rows[0] });
  });

  return app;
}
