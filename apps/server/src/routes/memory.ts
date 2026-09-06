import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type {
  MemoryService,
  InsightGenerator,
  EntityService,
} from "@seneca/memory";
import { isValidSubtype, isSubjectEntity, configuredSubjectNames, memoryVisible } from "@seneca/memory";
import type { Database } from "@seneca/db";
import { memoryTypeEnum, memorySourceEnum } from "@seneca/db";
import type { AuditService } from "../lib/audit.js";
import type { SystemEventsService } from "../services/system-events.js";
import { badUuid } from "../lib/validation.js";

// #24 input-validation (Jun 4): the `type` query param is bound against a
// Postgres enum column (memory_type) downstream — an out-of-set label throws
// 22P02 and surfaces as a 500. Validate at the route against the enum
// allowlist (single source of truth = memoryTypeEnum.enumValues), mirroring
// how `status` is already handled: an invalid label degrades to
// "filter ignored → 200", never a server fault. Exported pure helper so the
// allowlist behavior is unit-testable without a live DB.
const VALID_MEMORY_TYPES: ReadonlySet<string> = new Set(memoryTypeEnum.enumValues);
export type MemoryType = (typeof memoryTypeEnum.enumValues)[number];
export function validateMemoryType(raw: string | undefined): MemoryType | undefined {
  return raw !== undefined && VALID_MEMORY_TYPES.has(raw) ? (raw as MemoryType) : undefined;
}

// Same allowlist discipline for `source` (Jul 25). memory_source is ALSO a
// Postgres enum, so an unvalidated ?source=<junk> would be the identical 22P02
// → 500 bypass. Added for the extraction-limbo drain, which needs to page its
// own pool (status=pending & source=extraction) rather than filtering a mixed
// page client-side.
const VALID_MEMORY_SOURCES: ReadonlySet<string> = new Set(memorySourceEnum.enumValues);
export type MemorySource = (typeof memorySourceEnum.enumValues)[number];
export function validateMemorySource(raw: string | undefined): MemorySource | undefined {
  return raw !== undefined && VALID_MEMORY_SOURCES.has(raw) ? (raw as MemorySource) : undefined;
}

export interface MemoryRoutesDeps {
  timeZone?: string;
  db: Database;
  memoryService: MemoryService;
  insightGenerator: InsightGenerator;
  entityService: EntityService;
  audit: AuditService;
  systemEvents: SystemEventsService;
}

/**
 * Memory routes.
 *
 * Extracted from apps/server/src/index.ts on 2026-05-26 (Wave 10 v2 god-file pass).
 * 17 lifted /api/memor* and /api/memories* routes. (The /api/memory-calibration
 * GET was retired 2026-07-25 in the Wave 2 prune — 0 callers, inert data.)
 *
 * Closure-scoped deps: memoryService, insightGenerator, entityService, audit,
 * systemEvents, and db. Model extraction is deliberately not a dependency.
 */
export function mountMemoryRoutes(app: Hono, deps: MemoryRoutesDeps): Hono {
  const {
    db,
    memoryService,
    insightGenerator,
    entityService,
    audit,
    systemEvents,
  } = deps;
  const timeZone = deps.timeZone ?? "Asia/Ulaanbaatar";
  // Reject an invalid injected zone before serving inconsistent calendar evidence.
  new Intl.DateTimeFormat("en", { timeZone }).format();

  // ============================================================
  // Forgetting Tier (Phase S1, May 18)
  // ------------------------------------------------------------
  // SUBSTRATE.md §9 #3. Marks cold-tier memories as forgotten
  // (soft-delete: forgotten_at IS NOT NULL but row preserved for
  // audit). Predicate: age > olderThanDays AND recall_count = 0
  // AND importance < importanceBelow AND no protective tag.
  // ============================================================
  app.post("/api/memory/forget-cold-tier", async (c) => {
    type Body = {
      olderThanDays?: number;
      importanceBelow?: number;
      protectedTags?: string[];
    };
    let body: Body;
    try { body = await c.req.json<Body>(); }
    catch { return c.json({ error: "invalid json" }, 400); }
    const days = body.olderThanDays ?? 90;
    const impCap = body.importanceBelow ?? 0.7;
    // `decision`/`goal` are TYPE enum values, not tags — protected via the
    // `type NOT IN (...)` gate below, not this tag list (default keeps tag-only values).
    const protectedTags = body.protectedTags ?? ["do-not-forget", "canonical", "milestone"];

    // Candidates = rows that match the predicate. forgotten = update count.
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    // FIX (Jun 7): bind protectedTags as a SINGLE jsonb param, not via
    // `${protectedTags}::text[]`. Drizzle splats a JS array into a positional
    // TUPLE — `?| ($3,$4,$5,$6)::text[]` — a record-constructor cast Postgres
    // rejects, which 500'd this route on every cron run since the route shipped
    // (0 of 3928 memories ever forgotten). `ARRAY(SELECT jsonb_array_elements_text(...))`
    // derives a real text[] from one bound jsonb param. Verified logically
    // identical to the original `?|` form against the live DB (69 = 69).
    const protectedTagsJson = JSON.stringify(protectedTags);
    const candidatesRow = await db.execute(sql`
      SELECT COUNT(*)::int as n FROM memories
      WHERE forgotten_at IS NULL
        AND recall_count = 0
        AND importance < ${impCap}
        AND created_at < ${cutoff}::timestamptz
        AND type NOT IN ('decision', 'goal')
        AND NOT (COALESCE(tags, '[]'::jsonb) ?| ARRAY(SELECT jsonb_array_elements_text(${protectedTagsJson}::jsonb)))
    `);
    const candidates = Number((candidatesRow as unknown as Array<{ n: number }>)[0]?.n ?? 0);

    const result = await db.execute(sql`
      UPDATE memories
      SET forgotten_at = NOW()
      WHERE forgotten_at IS NULL
        AND recall_count = 0
        AND importance < ${impCap}
        AND created_at < ${cutoff}::timestamptz
        AND type NOT IN ('decision', 'goal')
        AND NOT (COALESCE(tags, '[]'::jsonb) ?| ARRAY(SELECT jsonb_array_elements_text(${protectedTagsJson}::jsonb)))
    `);
    const r = result as unknown as { count?: number; rowCount?: number; length?: number };
    const forgotten = r.count ?? r.rowCount ?? r.length ?? 0;

    await systemEvents
      .record({
        kind: "memory-forgetting",
        severity: "info",
        summary: forgotten === 0 ? "0 forgotten" : `${forgotten} cold-tier memories forgotten (of ${candidates} candidates)`,
        payload: { forgotten, candidates, olderThanDays: days, importanceBelow: impCap, protectedTags },
      })
      .catch(() => {});

    return c.json({ ok: true, forgotten, candidates });
  });

  // API: Memory endpoints
  app.get("/api/memories", async (c) => {
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");
    const tag = c.req.query("tag") || undefined;
    const search = c.req.query("search") || undefined;
    // #24: allowlist-validate against the memory_type enum (mirrors `status`
    // below). An out-of-set label → undefined → filter ignored (200), never a
    // 22P02 enum-cast 500.
    const type = validateMemoryType(c.req.query("type"));
    const source = validateMemorySource(c.req.query("source"));
    const statusParam = c.req.query("status");
    const status =
      statusParam === "confirmed" || statusParam === "pending" || statusParam === "rejected"
        ? statusParam
        : undefined;
    const scopeParam = c.req.query("scope");
    const scope =
      scopeParam === "foundational" || scopeParam === "session-active" || scopeParam === "archived"
        ? scopeParam
        : undefined;

    const result = await memoryService.listFiltered({ limit, offset, tag, search, type, source, status, scope });
    return c.json(result);
  });

  app.get("/api/memories/stats", async (c) => {
    const stats = await memoryService.getStats();
    return c.json(stats);
  });

  // (memories/field route retired Wave 8, 2026-07-03: the Brain topology's
  // memory-star canvas was replaced by the operational Dispatch Floor, so the
  // sole consumer is gone — no inert push paths.)

  // M6 (May 9 late evening): EMERGING surface for /entities. Returns
  // recent goal-type memories with their linked entities. The user's
  // insight: importance isn't just mention-count weighting — it's
  // reactive to what's happening NOW. A goal that emerged today
  // (job-search re-prioritization, e.g.) should bubble above active
  // threads, not be buried in them.
  app.get("/api/memories/emerging-goals", async (c) => {
    const days = parseInt(c.req.query("days") || "7", 10);
    const limit = parseInt(c.req.query("limit") || "5", 10);
    const since = new Date(Date.now() - (Number.isFinite(days) ? days : 7) * 86_400_000);
    const subjectNames = sql.join(configuredSubjectNames().map((n) => sql`${n}`), sql`, `);
    const rows = (await db.execute(sql`
      SELECT
        m.id::text as id,
        m.content,
        m.importance,
        m.created_at,
        m.tags,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', e.id::text,
              'name', e.name,
              'type', e.type,
              'subtype', e.subtype
            )
            ORDER BY e.mention_count DESC
          ) FILTER (
            WHERE e.id IS NOT NULL
              AND LOWER(e.name) NOT IN (${subjectNames})
          ),
          '[]'::json
        ) as entities
      FROM memories m
      LEFT JOIN entity_memories em ON em.memory_id = m.id
      LEFT JOIN entities e ON e.id = em.entity_id
      WHERE m.type = 'goal'
        AND ${memoryVisible("m")}
        AND m.created_at >= ${since.toISOString()}
      GROUP BY m.id, m.content, m.importance, m.created_at, m.tags
      ORDER BY m.created_at DESC, m.importance DESC
      LIMIT ${Number.isFinite(limit) ? limit : 5}
    `)) as unknown as Array<{
      id: string;
      content: string;
      importance: number;
      created_at: string;
      tags: string[] | null;
      entities: Array<{ id: string; name: string; type: string; subtype: string | null }>;
    }>;
    return c.json({
      intentAuthority: "memory-observation", createsObligation: false,
      goals: rows.map((r) => ({
        id: r.id,
        content: r.content,
        importance: Number(r.importance),
        createdAt: r.created_at,
        tags: r.tags ?? [],
        entities: r.entities ?? [],
      })),
    });
  });

  // Phase C-7: activity ribbon for /entities. Returns the most recent N
  // confirmed memories, each tagged with its primary linked entity (the
  // 'subject' role wins; falls back to first-linked). Used by the ribbon
  // at the top of /entities and by the timeline view-toggle.
  app.get("/api/memories/recent-with-entities", async (c) => {
    const limit = parseInt(c.req.query("limit") || "10", 10);
    const days = parseInt(c.req.query("days") || "0", 10); // 0 = no filter
    const sinceClause = days > 0
      ? sql`AND m.created_at >= ${new Date(Date.now() - days * 86_400_000).toISOString()}`
      : sql``;
    const rows = (await db.execute(sql`
      SELECT
        m.id::text as id,
        m.content,
        m.type,
        m.importance,
        m.created_at,
        e.id::text as entity_id,
        e.name as entity_name,
        e.type as entity_type,
        e.subtype as entity_subtype
      FROM memories m
      LEFT JOIN LATERAL (
        SELECT em.entity_id
        FROM entity_memories em
        WHERE em.memory_id = m.id
        ORDER BY
          CASE em.role WHEN 'subject' THEN 0 WHEN 'mentioned' THEN 1 ELSE 2 END,
          em.created_at
        LIMIT 1
      ) primary_link ON true
      LEFT JOIN entities e ON e.id = primary_link.entity_id
      WHERE ${memoryVisible("m")}
        AND m.created_at IS NOT NULL
        ${sinceClause}
      ORDER BY m.created_at DESC
      LIMIT ${Number.isFinite(limit) ? limit : 10}
    `)) as unknown as Array<{
      id: string;
      content: string;
      type: string;
      importance: number;
      created_at: string;
      entity_id: string | null;
      entity_name: string | null;
      entity_type: string | null;
      entity_subtype: string | null;
    }>;
    return c.json({
      memories: rows
        // Owner entities do not surface — the owner is the watcher.
        .filter((r) => !r.entity_name || !isSubjectEntity(r.entity_name))
        // M2: only memories with an entity link surface in the ribbon.
        // Without this filter the ribbon shows "—" rows, which reads as
        // broken even though the memory exists. As entity-linking improves
        // (via session-save entityHints + backfill), more rows surface.
        .filter((r) => r.entity_id !== null)
        .map((r) => ({
          id: r.id,
          content: r.content,
          type: r.type,
          importance: Number(r.importance),
          createdAt: r.created_at,
          entity: r.entity_id
            ? {
                id: r.entity_id,
                name: r.entity_name,
                type: r.entity_type,
                subtype: r.entity_subtype,
              }
            : null,
        })),
    });
  });

  // Dashboard v2 Wave 1 (Jun 11): day-bucketed counts of confirmed memories
  // for the entities time-strip. Both endpoints use the configured calendar
  // zone, independently of the database/client session timezone.
  app.get("/api/memories/histogram", async (c) => {
    const rawDays = parseInt(c.req.query("days") || "90", 10);
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, rawDays)) : 90;
    const rows = (await db.execute(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM memories
      WHERE ${memoryVisible()}
        AND created_at IS NOT NULL
        AND created_at >= (((now() AT TIME ZONE ${timeZone})::date - (${days} - 1))::timestamp AT TIME ZONE ${timeZone})
        AND created_at < (((now() AT TIME ZONE ${timeZone})::date + 1)::timestamp AT TIME ZONE ${timeZone})
      GROUP BY 1
      ORDER BY 1
    `)) as unknown as Array<{ day: string; count: number }>;
    return c.json({ timeZone, days: rows.map((r) => ({ day: r.day, count: Number(r.count) })) });
  });

  // One configured calendar day, including DST-short/long days.
  app.get("/api/memories/by-day", async (c) => {
    const date = c.req.query("date") || "";
    // Regex first (shape), then Date.parse (calendar validity — '2026-13-45'
    // matches the regex but would 22008 at the ::timestamptz cast → 500).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      return c.json({ error: "date must be a valid YYYY-MM-DD" }, 400);
    }
    const rows = (await db.execute(sql`
      SELECT
        m.id::text as id,
        m.content,
        m.type,
        m.importance,
        m.created_at,
        COALESCE(
          json_agg(
            json_build_object('id', e.id::text, 'name', e.name, 'type', e.type)
          ) FILTER (WHERE e.id IS NOT NULL),
          '[]'::json
        ) AS entities
      FROM memories m
      LEFT JOIN entity_memories em ON em.memory_id = m.id
      LEFT JOIN entities e ON e.id = em.entity_id
      WHERE ${memoryVisible("m")}
        AND m.created_at >= (${date}::date::timestamp AT TIME ZONE ${timeZone})
        AND m.created_at < ((${date}::date + 1)::timestamp AT TIME ZONE ${timeZone})
      GROUP BY m.id, m.content, m.type, m.importance, m.created_at
      ORDER BY m.created_at DESC
      LIMIT 200
    `)) as unknown as Array<{
      id: string;
      content: string;
      type: string;
      importance: number;
      created_at: string;
      entities: Array<{ id: string; name: string; type: string }>;
    }>;
    return c.json({
      date, timeZone,
      memories: rows.map((r) => ({
        id: r.id,
        content: r.content,
        type: r.type,
        importance: Number(r.importance),
        createdAt: r.created_at,
        // SUBJECT-class entities don't surface — same filter as
        // recent-with-entities, applied to the aggregated client shape.
        entities: (r.entities ?? []).filter((e) => !isSubjectEntity(e.name)),
      })),
    });
  });

  app.get("/api/memories/search", async (c) => {
    const q = c.req.query("q");
    if (!q) {
      return c.json({ error: "q query parameter is required" }, 400);
    }
    const limit = parseInt(c.req.query("limit") || "10");
    // Wave 11 follow-up (2026-05-24): optional ?tag= filters retrieval to a
    // project. MCP search_memories tool passes the calling session's project
    // here to prevent cross-project memory bleed (jewelry session retrieving
    // BODHI memories ranked by embedding similarity). Omit for current behavior.
    const tag = c.req.query("tag") || undefined;
    const results = await memoryService.retrieve(q, limit, tag);
    return c.json({ memories: results });
  });

  app.post("/api/memories", async (c) => {
    const body = await c.req.json<{
      content: string;
      tags?: string[];
      importance?: number;
      type?: "fact" | "decision" | "pattern" | "preference" | "event";
      scope?: "foundational" | "session-active" | "archived";
    }>();
    if (!body.content) {
      return c.json({ error: "content is required" }, 400);
    }
    // KC-4 (C7b) REMOVED (R, Jun 3): the prior code coerced any body-supplied
    // `scope:'foundational'` → 'session-active' unconditionally. That was both
    // broken and redundant. Broken because the MCP `store_memory` tool is a
    // first-party caller that routes through this exact route (mcp-server
    // client.ts → POST /api/memories), so every legit foundational write was
    // silently downgraded. Redundant because C1 (bearer-auth middleware) already
    // 401s unauthenticated mutating POSTs and C7a (rate-limit) bounds the flood.
    // `scope:'foundational'` now passes through; auth is the real boundary.
    const id = await memoryService.store({
      content: body.content,
      tags: body.tags,
      importance: body.importance,
      type: body.type,
      source: "manual",
      scope: body.scope,
    });
    // Phase 33 C1: audit trail — hash-not-body discipline
    await audit.write({
      kind: "memory.write",
      actor: "parent-orch",
      target: id,
      payload: body.content,
      metadata: { type: body.type ?? "fact", importance: body.importance ?? null },
    });
    return c.json({ id }, 201);
  });

  app.post("/api/memories/batch", async (c) => {
    const body = await c.req.json<{
      memories: Array<{
        content: string;
        tags?: string[];
        importance?: number;
        type?: "fact" | "decision" | "pattern" | "preference" | "event";
      }>;
      // Phase C: optional pre-classified entities. The session-save skill
      // populates this from people/projects it observed during the session,
      // so the extractor doesn't have to re-derive them. Each hint links to
      // ALL memories in the batch (single session = shared context).
      entityHints?: Array<{
        name: string;
        type: "person" | "project" | "topic" | "organization" | "place";
        subtype?: string | null;
      }>;
    }>();

    if (!body.memories || !Array.isArray(body.memories) || body.memories.length === 0) {
      return c.json({ error: "memories array is required" }, 400);
    }

    if (body.memories.length > 128) {
      return c.json({ error: "max 128 memories per batch" }, 400);
    }

    const inputs = body.memories.map((m) => ({
      content: m.content,
      tags: m.tags,
      importance: m.importance,
      type: m.type,
      source: "manual" as const,
    }));

    const result = await memoryService.storeBatch(inputs);

    // Apply entity hints — non-fatal. If linking fails, the memories still
    // landed; the extractor cron + manual dedup catch what slips.
    const hints = body.entityHints ?? [];
    if (hints.length > 0 && entityService && result.ids?.length) {
      Promise.all(
        hints.map(async (h) => {
          if (!h.name || !h.type) return;
          const subtype = h.subtype && isValidSubtype(h.type, h.subtype) ? h.subtype : null;
          try {
            const entity = await entityService.findOrCreate(h.name, h.type, undefined, subtype);
            for (const memoryId of result.ids) {
              await entityService.linkToMemory(entity.id, memoryId);
            }
          } catch (err) {
            console.error(`[batch] Failed to link entity hint "${h.name}":`, err);
          }
        }),
      ).catch(() => { /* non-fatal */ });
    }

    return c.json(result, 201);
  });

  app.delete("/api/memories/:id", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const body: { reason?: string } = await c.req
      .json<{ reason?: string }>()
      .catch(() => ({}));
    const reason = body.reason?.trim();
    if (!reason || reason.length > 500) {
      return c.json({ error: "reason is required and must be at most 500 characters" }, 400);
    }
    const forgotten = await memoryService.forget(id);
    if (!forgotten) return c.json({ error: "Memory not found or already forgotten" }, 404);
    await audit.write({
      kind: "memory.forget",
      actor: "parent-orch",
      target: id,
      metadata: { reason },
    });
    await systemEvents.record({
      kind: "memory-forgotten",
      summary: `memory soft-forgotten: ${id}`,
      severity: "info",
      payload: { memoryId: id },
    });
    return c.json({ forgotten: true, memoryId: id });
  });

  app.post("/api/memories/:id/correct", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const body = await c.req.json<{
      content?: string;
      reason?: string;
      type?: string;
      importance?: number;
      tags?: string[];
      scope?: "foundational" | "session-active" | "archived";
    }>().catch(() => null);
    if (!body) return c.json({ error: "invalid json" }, 400);

    const content = body.content?.trim();
    const reason = body.reason?.trim();
    if (!content || content.length > 20_000) {
      return c.json({ error: "content is required and must be at most 20000 characters" }, 400);
    }
    if (!reason || reason.length > 500) {
      return c.json({ error: "reason is required and must be at most 500 characters" }, 400);
    }
    const type = validateMemoryType(body.type);
    if (body.type !== undefined && !type) {
      return c.json({ error: `type must be one of: ${memoryTypeEnum.enumValues.join(", ")}` }, 400);
    }
    if (body.importance !== undefined && (!Number.isFinite(body.importance) || body.importance < 0 || body.importance > 1)) {
      return c.json({ error: "importance must be between 0 and 1" }, 400);
    }
    if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 64 || body.tags.some((tag) => typeof tag !== "string" || !tag.trim()))) {
      return c.json({ error: "tags must contain at most 64 non-empty strings" }, 400);
    }
    if (body.scope !== undefined && !["foundational", "session-active", "archived"].includes(body.scope)) {
      return c.json({ error: "scope must be foundational, session-active, or archived" }, 400);
    }

    const corrected = await memoryService.correct(id, {
      content,
      type,
      importance: body.importance,
      tags: body.tags?.map((tag) => tag.trim()),
      scope: body.scope,
      source: "manual",
      status: "confirmed",
    });
    if (!corrected) return c.json({ error: "Memory not found or already forgotten" }, 404);

    await audit.write({
      kind: "memory.correct",
      actor: "parent-orch",
      target: id,
      metadata: { reason, replacementId: corrected.replacementId },
    });
    await systemEvents.record({
      kind: "memory-corrected",
      summary: `memory corrected: ${id} → ${corrected.replacementId}`,
      severity: "info",
      payload: corrected,
    });
    return c.json({ corrected: true, ...corrected }, 201);
  });

  app.patch("/api/memories/:id", async (c) => {
    const id = c.req.param("id");
    // Reject a malformed id with a clean 400 — otherwise the `${id}::uuid` bind
    // 500s at the DB cast. Parity with the agent-dispatches /verify sibling guard.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return c.json({ error: "invalid memory id (UUID expected)" }, 400);
    }
    const body = await c.req.json<{
      importanceDelta?: number;
      confidenceDelta?: number;
      scope?: "foundational" | "session-active" | "archived";
    }>();

    if (body.importanceDelta !== undefined) {
      await memoryService.adjustImportance([id], body.importanceDelta);
    }
    if (body.confidenceDelta !== undefined) {
      await memoryService.adjustConfidence([id], body.confidenceDelta);
    }
    if (body.scope !== undefined) {
      // The closeable end of the goal lifecycle (Jun 7): `archived` marks a goal
      // done/parked; DriftScanner.getActiveGoals excludes it so it stops surfacing.
      const VALID_SCOPES = ["foundational", "session-active", "archived"] as const;
      if (!VALID_SCOPES.includes(body.scope)) {
        return c.json(
          { error: `invalid scope; must be one of ${VALID_SCOPES.join(", ")}` },
          400
        );
      }
      await memoryService.setScope([id], body.scope);
      // Phase 33 C1 audit — id + scope are non-sensitive, safe in metadata.
      await audit.write({
        kind: "memory.scope.update",
        actor: "parent-orch",
        target: id,
        metadata: { scope: body.scope },
      });
    }

    return c.json({ updated: true });
  });

  app.get("/api/memories/insights", async (c) => {
    const insights = await insightGenerator.generate();
    return c.json({ insights });
  });

  app.get("/api/memories/quality", async (c) => {
    const [stale, neglected, frequent, tagTrends, recentRate, totalRate] =
      await Promise.all([
        memoryService.getStaleMemories(30, 0.5),
        memoryService.getNeglectedHighValue(0.7, 0, 14),
        memoryService.getFrequentlyAccessed(5, 20),
        memoryService.getTagTrends(7, 7),
        memoryService.getCreationRate(7),
        memoryService.getCreationRate(14),
      ]);

    return c.json({
      stale,
      neglected,
      frequent,
      tagTrends,
      creationRate: {
        thisWeek: recentRate,
        lastWeek: totalRate - recentRate,
      },
    });
  });

  // ---- Pending Memories API ----

  app.get("/api/memories/pending", async (c) => {
    const limit = Number(c.req.query("limit")) || 20;
    const memories = await memoryService.getPendingMemories(limit);
    const count = await memoryService.getPendingCount();
    return c.json({ memories, count });
  });

  app.get("/api/memories/pending/count", async (c) => {
    const count = await memoryService.getPendingCount();
    return c.json({ count });
  });

  app.post("/api/memories/:id/confirm", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const confirmed = await memoryService.confirmMemory(id);
    if (!confirmed) return c.json({ error: "Memory not found or not pending" }, 404);
    return c.json({ confirmed: true });
  });

  app.post("/api/memories/:id/reject", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const rejected = await memoryService.rejectMemory(id);
    if (!rejected) return c.json({ error: "Memory not found or not pending" }, 404);
    return c.json({ rejected: true });
  });

  // (GET /api/memory-calibration RETIRED Jul 25, 2026 — Wave 2 prune. Zero
  // callers, and the data behind it was inert: all 6 memory_calibration rows
  // were an identity transform with total_sampled=0 since Jun 7. The
  // calibrator module was deleted in the same wave.)

  return app;
}
