import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { configuredSubjectNames, affectedRows } from "@seneca/memory";
import type { EntityService } from "@seneca/memory";
import type { Database } from "@seneca/db";
import { badUuid } from "../lib/validation.js";

export interface EntitiesRoutesDeps {
  entityService: EntityService;
  db: Database;
}

/**
 * Entity-graph routes.
 *
 * Extracted from apps/server/src/index.ts on 2026-05-24 (god-file pass).
 * 13 routes: list/stats/graph/merge-candidates/active/audit/get/memories/
 * create/patch/delete/merge/backfill.
 *
 * Closure-scoped state: entityService + db (injected via deps).
 */
export function mountEntitiesRoutes(app: Hono, deps: EntitiesRoutesDeps): Hono {
  const { entityService, db } = deps;

  app.get("/api/entities", async (c) => {
    const type = c.req.query("type");
    const search = c.req.query("search");
    const limit = Number(c.req.query("limit")) || 20;
    const offset = Number(c.req.query("offset")) || 0;
    const result = await entityService.list({ type: type || undefined, search: search || undefined, limit, offset });
    return c.json(result);
  });

  app.get("/api/entities/stats", async (c) => {
    const stats = await entityService.getStats();
    return c.json(stats);
  });

  app.get("/api/entities/graph", async (c) => {
    const minMentions = parseInt(c.req.query("minMentions") || "1", 10);
    // Node cap raised 200 -> 400 (Jun 9): the ceiling for the low-density "show
    // more" view. The dashboard's curated default is minMentions=30 (~56 nodes);
    // 400 only bites at the "all" end and is still bounded to avoid a hairball.
    const limit = parseInt(c.req.query("limit") || "400", 10);
    const graph = await entityService.getGraph({
      minMentions: Number.isFinite(minMentions) ? minMentions : 1,
      limit: Number.isFinite(limit) ? limit : 400,
    });
    return c.json(graph);
  });

  app.get("/api/entities/merge-candidates", async (c) => {
    const clusters = await entityService.listMergeCandidates();
    return c.json({ clusters });
  });

  // Phase C-5: orientation surface for /session-start. Returns the top
  // entities active in the last N days, ranked by mentionCount × recency.
  // Reads like "what's living in your thinking right now" — used by the
  // skill to render an editorial register, not a status dashboard.
  app.get("/api/entities/active", async (c) => {
    const days = parseInt(c.req.query("days") || "7", 10);
    const limit = parseInt(c.req.query("limit") || "5", 10);
    const since = new Date(Date.now() - (Number.isFinite(days) ? days : 7) * 86_400_000);
    const subjectNames = sql.join(configuredSubjectNames().map((n) => sql`${n}`), sql`, `);
    const rows = (await db.execute(sql`
      SELECT id::text as id, name, type, subtype, mention_count, last_seen_at
      FROM entities
      WHERE last_seen_at >= ${since.toISOString()}
        AND LOWER(name) NOT IN (${subjectNames})
      ORDER BY mention_count DESC, last_seen_at DESC
      LIMIT ${Number.isFinite(limit) ? limit : 5}
    `)) as unknown as Array<{
      id: string;
      name: string;
      type: string;
      subtype: string | null;
      mention_count: number;
      last_seen_at: string;
    }>;
    return c.json({
      days: Number.isFinite(days) ? days : 7,
      entities: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        subtype: r.subtype,
        mentionCount: Number(r.mention_count),
        lastSeenAt: r.last_seen_at,
      })),
    });
  });

  // Shared drift computation — READ-ONLY. Used by the report GET and the heal POST.
  async function computeDrift() {
    const driftRows = (await db.execute(sql`
      SELECT
        e.id::text as id,
        e.name,
        e.mention_count AS stored,
        COALESCE((SELECT COUNT(*) FROM entity_memories em WHERE em.entity_id = e.id), 0) AS truth
      FROM entities e
    `)) as unknown as Array<{ id: string; name: string; stored: number; truth: number }>;

    const drifted = driftRows
      .map((r) => ({ id: r.id, name: r.name, stored: Number(r.stored), truth: Number(r.truth), diff: Number(r.stored) - Number(r.truth) }))
      .filter((r) => r.diff !== 0)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    return { driftRows, drifted };
  }

  function driftReport(
    driftRows: Array<unknown>,
    drifted: Array<{ id: string; name: string; stored: number; truth: number; diff: number }>,
    healed: number,
  ) {
    const totalEntities = driftRows.length;
    return {
      totalEntities,
      driftedCount: drifted.length,
      driftPct: totalEntities > 0 ? Math.round((drifted.length / totalEntities) * 1000) / 10 : 0,
      topDrift: drifted.slice(0, 10),
      healed,
    };
  }

  // GET — drift REPORT ONLY. No write. (finding #13: the `?heal=true`
  // side-effect was removed — a state-mutating GET bypasses the
  // MUTATING_METHODS auth gate and is CSRF-forgeable via <img>/<a>. Heal now
  // lives on the POST below, which the gate sees.)
  app.get("/api/entities/audit", async (c) => {
    const { driftRows, drifted } = await computeDrift();
    return c.json(driftReport(driftRows, drifted, 0));
  });

  // POST — recompute mention_count from entity_memories. A real mutating verb,
  // so apiAuth.ts (MUTATING_METHODS) requires the bearer when BODHI_API_AUTH=1,
  // and a simple cross-site GET can no longer trigger the write. The UPDATE is
  // idempotent (only rewrites drifted rows to truth) so re-running is safe.
  app.post("/api/entities/audit/heal", async (c) => {
    const { driftRows, drifted } = await computeDrift();
    let healed = 0;
    if (drifted.length > 0) {
      const result = await db.execute(sql`
        UPDATE entities
        SET mention_count = COALESCE(
          (SELECT COUNT(*) FROM entity_memories WHERE entity_id = entities.id), 0
        )
        WHERE mention_count != COALESCE(
          (SELECT COUNT(*) FROM entity_memories WHERE entity_id = entities.id), 0
        )
      `);
      // NOT `(result as any).rowCount ?? drifted.length` (Jul 10): postgres-js has no
      // .rowCount, so that expression ALWAYS fell through to drifted.length — reporting
      // the rows DETECTED as if they were the rows HEALED, even when the UPDATE
      // affected none. A plausible number, never the truth. affectedRows() reads the
      // driver's real `.count`; no fallback to drifted.length, because a wrong count is
      // worse than a zero.
      healed = affectedRows(result);
    }
    return c.json(driftReport(driftRows, drifted, healed));
  });

  app.get("/api/entities/:id", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const entity = await entityService.getEntity(id);
    if (!entity) return c.json({ error: "Entity not found" }, 404);
    return c.json(entity);
  });

  app.get("/api/entities/:id/memories", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const limit = Number(c.req.query("limit")) || 20;
    const memories = await entityService.getEntityMemories(id, limit);
    return c.json({ memories });
  });

  app.post("/api/entities", async (c) => {
    const body = await c.req.json<{ name: string; type: string; description?: string; aliases?: string[]; distinctIdentity?: boolean }>();
    if (!body.name || !body.type) return c.json({ error: "name and type required" }, 400);
    if (body.distinctIdentity !== undefined && typeof body.distinctIdentity !== "boolean") return c.json({ error: "distinctIdentity must be boolean" }, 400);
    const entity = await entityService.findOrCreate(body.name, body.type as any, body.aliases, undefined, { distinctIdentity: body.distinctIdentity });
    if (body.description) {
      await entityService.update(entity.id, { description: body.description });
    }
    return c.json(entity, 201);
  });

  app.patch("/api/entities/:id", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const body = await c.req.json<{ name?: string; description?: string; aliases?: string[]; type?: string }>();
    const updated = await entityService.update(id, body as any);
    if (!updated) return c.json({ error: "Entity not found" }, 404);
    return c.json(updated);
  });

  app.delete("/api/entities/:id", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    await entityService.remove(id);
    return c.json({ ok: true });
  });

  app.post("/api/entities/:id/merge", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const body = await c.req.json<{ mergeId?: string; mergeIds?: string[] }>();
    if (body.mergeId && body.mergeIds) return c.json({ error: "supply mergeIds or legacy mergeId, not both" }, 400);
    const mergeIds = body.mergeIds ?? (body.mergeId ? [body.mergeId] : []);
    if (!Array.isArray(mergeIds) || mergeIds.length < 1 || mergeIds.length > 25) return c.json({ error: "mergeIds must contain 1..25 UUIDs" }, 400);
    for (const mergeId of mergeIds) { const invalid = badUuid(c, mergeId); if (invalid) return invalid; }
    const result = await entityService.mergeCluster(id, mergeIds);
    return c.json({ ok: true, ...result });
  });

  // (POST /api/entities/backfill RETIRED Jul 25, 2026 — Wave 2 prune: zero
  // callers. The backfill itself still runs at startup behind
  // ENTITY_BACKFILL_ON_STARTUP, and scripts/ can drive EntityBackfill directly.)

  return app;
}
