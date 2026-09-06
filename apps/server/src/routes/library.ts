import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { LibraryService } from "@seneca/library";
import type { Database } from "@seneca/db";

export interface LibraryRoutesDeps {
  libraryService: LibraryService;
  db: Database;
}

/**
 * Library substrate routes.
 *
 * Extracted from apps/server/src/index.ts on 2026-05-24 (god-file 5,447 LOC
 * reduction pass). Original group: Phase C C2 search + Wave 1 LP index +
 * Wave 10 stale surface.
 *
 * Closure-scoped state: libraryService + db. Both injected via `deps`.
 */
export function mountLibraryRoutes(app: Hono, deps: LibraryRoutesDeps): Hono {
  const { libraryService, db } = deps;

  // Phase C C2 (May 17): Library semantic search.
  // Wave 1 LP (May 19): logic moved to LibraryService so the HTTP path
  // and ContextEngine LibraryProvider share one read path (and one
  // telemetry write). agent_context defaults to "unknown" — callers
  // tag themselves so /agents can roll up per-surface consultation rate.
  // Optional filters: domain (design|security|engineering|...), sub_domain.
  app.get("/api/library/search", async (c) => {
    const q = c.req.query("q");
    if (!q) return c.json({ error: "q query parameter is required" }, 400);
    const response = await libraryService.search({
      query: q,
      domain: c.req.query("domain") || null,
      sub_domain: c.req.query("sub_domain") || null,
      threshold: c.req.query("threshold")
        ? Number(c.req.query("threshold"))
        : undefined,
      limit: c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined,
      agent_context: c.req.query("agent_context") || undefined,
      caller: c.req.query("caller") || null,
    });
    return c.json(response);
  });

  // Wave 1 S4a (May 19): library_index — landscape view before searching.
  // Returns domain → sub_domain → source tree with chunk counts so the
  // agent can pick a sub_domain filter instead of firing a broad search.
  // Cheap; only consulted at orientation time.
  app.get("/api/library/index", async (c) => {
    const result = await libraryService.index(c.req.query("domain") || null);
    return c.json(result);
  });

  app.get("/api/library/stats", async (c) => {
    const result = await db.execute(sql`
      SELECT domain, sub_domain,
             COUNT(*)::int AS chunks,
             COUNT(DISTINCT source)::int AS sources
      FROM library_entries
      GROUP BY domain, sub_domain
      ORDER BY domain, sub_domain NULLS FIRST
    `);
    return c.json({ entries: result });
  });

  // Human-facing visibility for imported personal history. Conversations are
  // evidence sources, not entities or canonical memory rows; this route keeps
  // those storage layers legible in the local Admin without conflating them.
  app.get("/api/personal-history/summary", async (c) => {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*)::int AS chunks,
        COUNT(DISTINCT source) FILTER (WHERE sub_domain = 'chatgpt-conversations')::int AS conversations,
        COUNT(DISTINCT source) FILTER (WHERE sub_domain = 'reviewed-evidence')::int AS reviewed_evidence,
        COUNT(DISTINCT source) FILTER (WHERE sub_domain = 'corpus-analysis')::int AS analyses,
        MIN(NULLIF(metadata->>'date_start', '')) FILTER (WHERE sub_domain = 'chatgpt-conversations') AS date_start,
        MAX(NULLIF(metadata->>'date_end', '')) FILTER (WHERE sub_domain = 'chatgpt-conversations') AS date_end
      FROM library_entries
      WHERE domain = 'personal-history'
    `) as unknown as Array<{
      chunks: number;
      conversations: number;
      reviewed_evidence: number;
      analyses: number;
      date_start: string | null;
      date_end: string | null;
    }>;
    const row = rows[0];
    return c.json({
      available: Number(row?.conversations ?? 0) > 0,
      assistantName: process.env.BODHI_ASSISTANT_NAME?.trim() || "BODHI",
      conversations: Number(row?.conversations ?? 0),
      reviewedEvidence: Number(row?.reviewed_evidence ?? 0),
      analyses: Number(row?.analyses ?? 0),
      chunks: Number(row?.chunks ?? 0),
      dateStart: row?.date_start ?? null,
      dateEnd: row?.date_end ?? null,
    });
  });

  app.get("/api/personal-history/recent", async (c) => {
    const requested = Number.parseInt(c.req.query("limit") ?? "24", 10);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(requested, 100)) : 24;
    const rows = await db.execute(sql`
      SELECT source,
             metadata->>'record_id' AS "recordId",
             metadata->>'title' AS title,
             metadata->>'date_start' AS "dateStart",
             metadata->>'date_end' AS "dateEnd",
             COALESCE((metadata->>'turn_count')::int, 0) AS "turnCount",
             metadata->>'chain_completeness' AS "chainCompleteness"
      FROM (
        SELECT DISTINCT ON (source) source, metadata
        FROM library_entries
        WHERE domain = 'personal-history' AND sub_domain = 'chatgpt-conversations'
        ORDER BY source, chunk_index
      ) conversations
      ORDER BY metadata->>'date_end' DESC NULLS LAST, source
      LIMIT ${limit}
    `);
    return c.json({ conversations: rows });
  });

  // Wave 10 (May 24, 2026): library decay surface. Returns sources
  // that have been ingested past `grace` days AND have not been actually cited
  // within `cooldown` days. Search retrieval never refreshes this clock, and
  // historical via=search rows are excluded read-side. Default grace=14,
  // cooldown=30. Optional `?domain=design` filter.
  // On-demand for now; can be wired into a cron later if signal warrants.
  app.get("/api/library/stale", async (c) => {
    const grace = c.req.query("grace");
    const cooldown = c.req.query("cooldown");
    const domain = c.req.query("domain") || null;
    if (!libraryService) {
      return c.json({ error: "library service not initialized" }, 503);
    }
    const result = await libraryService.detectStale({
      graceDays: grace ? Number(grace) : undefined,
      cooldownDays: cooldown ? Number(cooldown) : undefined,
      domain,
    });
    return c.json(result);
  });

  return app;
}
