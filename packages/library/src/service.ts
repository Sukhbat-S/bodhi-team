// ============================================================
// @seneca/library — LibraryService
//
// Embed + vector-search + telemetry-write for library_entries.
// Single source of truth for library reads — consumed by:
//   - /api/library/search (HTTP, MCP path, librarian-protocol PULL)
//   - LibraryProvider (ContextEngine PUSH, Wave 1 LP)
//   - /api/library/index (landscape view)
//
// Every search writes one library_search_invocations row so /agents
// can roll up consultation rate per domain × agent_context.
// ============================================================

import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import { embedSingle } from "@seneca/memory";

export interface LibrarySearchArgs {
  query: string;
  domain?: string | null;
  sub_domain?: string | null;
  threshold?: number;
  limit?: number;
  /**
   * Where the search originated. Tagged on the telemetry row.
   * Conventions:
   *   - "mcp"                  — Claude Code MCP path
   *   - "context-engine-push"  — LibraryProvider auto-injection
   *   - "service:<name>"       — internal service callers
   *   - "unknown"              — endpoint default when caller doesn't set it
   */
  agent_context?: string;
  caller?: string | null;
  /**
   * Set false to skip both retrieval telemetry writes. The retrieval-eval
   * runner uses this so a fixture sweep cannot inflate real consultation
   * telemetry. Default true.
   */
  telemetry?: boolean;
}

export interface LibraryHit {
  id: string;
  source: string;
  domain: string;
  sub_domain: string | null;
  chunk_index: number;
  chunk_text: string;
  heading: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

export interface LibraryIndexEntry {
  domain: string;
  sub_domain: string | null;
  source: string;
  chunks: number;
  ingested_at: string;
}

export interface LibraryIndexResult {
  domains: Array<{
    domain: string;
    sub_domains: Array<{
      sub_domain: string | null;
      sources: Array<{ source: string; chunks: number; ingested_at: string }>;
      chunks: number;
    }>;
    chunks: number;
    sources: number;
  }>;
  totals: { domains: number; sources: number; chunks: number };
}

export class LibraryService {
  constructor(
    private db: Database,
    private voyageApiKey: string,
  ) {}

  async search(args: LibrarySearchArgs): Promise<{
    query: string;
    filters: {
      domain: string | null;
      sub_domain: string | null;
      threshold: number;
      limit: number;
    };
    hits: LibraryHit[];
  }> {
    const query = args.query;
    const domain = args.domain ?? null;
    const subDomain = args.sub_domain ?? null;
    const threshold = args.threshold ?? 0.25;
    const limit = Math.min(args.limit ?? 5, 25);
    const agentContext = (args.agent_context ?? "unknown").slice(0, 80);
    const caller = args.caller ? args.caller.slice(0, 120) : null;
    const telemetry = args.telemetry ?? true;

    const queryEmbedding = await embedSingle(query, this.voyageApiKey);
    const embeddingLiteral = JSON.stringify(queryEmbedding);

    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        source,
        domain,
        sub_domain,
        chunk_index,
        chunk_text,
        metadata,
        1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM library_entries
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> ${embeddingLiteral}::vector) > ${threshold}
        AND (${domain}::text IS NULL OR domain = ${domain})
        AND (${subDomain}::text IS NULL OR sub_domain = ${subDomain})
      ORDER BY embedding <=> ${embeddingLiteral}::vector ASC
      LIMIT ${limit}
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    const hits: LibraryHit[] = rows.map((r) => ({
      id: String(r.id),
      source: String(r.source),
      domain: String(r.domain),
      sub_domain: r.sub_domain === null ? null : String(r.sub_domain),
      chunk_index: Number(r.chunk_index),
      chunk_text: String(r.chunk_text),
      heading: (r.metadata as Record<string, unknown> | null)?.heading
        ? String((r.metadata as Record<string, unknown>).heading)
        : null,
      title: (r.metadata as Record<string, unknown> | null)?.title
        ? String((r.metadata as Record<string, unknown>).title)
        : null,
      metadata: r.metadata && typeof r.metadata === "object"
        ? r.metadata as Record<string, unknown>
        : null,
      similarity: Number(r.similarity),
    }));

    const topSim = hits.length > 0 ? hits[0]!.similarity : null;
    // retrieved_chunk_ids (Wave C, Jun 10): record WHICH chunks were served, not
    // just how many — unlocks per-source serving stats. Bound as a SINGLE jsonb
    // param then derived to text[] in SQL, because drizzle splats a JS array into
    // a positional tuple (the memory.ts:85 forget-route bug class).
    const retrievedIdsJson = JSON.stringify(hits.map((h) => h.id));
    if (telemetry) {
      this.db
        .execute(sql`
          INSERT INTO library_search_invocations
            (query, domain, sub_domain, threshold, limit_n, hits, top_similarity, agent_context, caller, retrieved_chunk_ids)
          VALUES
            (${query}, ${domain}, ${subDomain}, ${threshold}, ${limit}, ${hits.length}, ${topSim}, ${agentContext}, ${caller},
             ARRAY(SELECT jsonb_array_elements_text(${retrievedIdsJson}::jsonb)))
        `)
        .catch((err) => {
          console.error(
            "[library-search-telemetry] write failed:",
            err instanceof Error ? err.message : err,
          );
        });
    }

    // Search results are retrieval evidence, not proof that a source was cited
    // or used. Keep a distinct event for observability without refreshing the
    // citation clock used by detectStale(). Fire-and-forget by design.
    if (telemetry && hits.length > 0) {
      const surfacedSources = [...new Set(hits.map((h) => h.source))];
      const byDomain = hits.reduce<Record<string, number>>((acc, h) => {
        acc[h.domain] = (acc[h.domain] ?? 0) + 1;
        return acc;
      }, {});
      const retrievalSummary = `search retrieved ${surfacedSources.length} source(s) [${agentContext}]: ${Object.entries(byDomain).map(([d, n]) => `${d}×${n}`).join(", ")}`;
      const retrievalPayload = JSON.stringify({ via: "search", sources: surfacedSources, byDomain, agentContext, query: query.slice(0, 200) });
      this.db
        .execute(sql`
          INSERT INTO system_events (kind, summary, severity, payload)
          VALUES ('library-retrieval', ${retrievalSummary}, 'info', ${retrievalPayload}::jsonb)
        `)
        .catch((err) => {
          console.error(
            "[library-retrieval] search-path emit failed:",
            err instanceof Error ? err.message : err,
          );
        });
    }

    return {
      query,
      filters: { domain, sub_domain: subDomain, threshold, limit },
      hits,
    };
  }

  /**
   * A5 — Log a near-miss: the LibraryProvider's intent gate blocked an
   * injection even though the message had domain keywords. Helps the
   * architect see whether the 0.7 gate is too strict.
   *
   * Routed to system_events (not library_search_invocations) because no
   * search ran — semantically distinct event. Filter at the caller: only
   * log when intent is close-to-but-not-clearing the gate (>= 0.4).
   * Fire-and-forget; never throws.
   */
  logIntentMiss(args: {
    query: string;
    domain: string | null;
    intent_score: number;
    agent_context?: string;
    caller?: string;
  }): void {
    const query = args.query.length > 1000 ? `${args.query.slice(0, 1000)}…` : args.query;
    const summary = `Library intent gate near-miss (${args.domain ?? "no-domain"}, ${args.intent_score.toFixed(2)})`;
    const payload = {
      query,
      domain: args.domain,
      intent_score: args.intent_score,
      agent_context: args.agent_context ?? "context-engine-push",
      caller: args.caller ?? null,
    };
    this.db
      .execute(sql`
        INSERT INTO system_events (kind, summary, severity, payload)
        VALUES ('library-intent-miss', ${summary}, 'info', ${JSON.stringify(payload)}::jsonb)
      `)
      .catch((err) => {
        console.error(
          "[library-intent-miss] write failed:",
          err instanceof Error ? err.message : err,
        );
      });
  }

  /**
   * rag-corpus-1 (May 31) — Log a similarity-gate miss: the provider got raw
   * hits from the embedder but ALL of them fell below the 0.6 Gate-2 threshold,
   * so it returned EMPTY silently. This is the PREREQUISITE telemetry for any
   * corpus densification — you can't tune a corpus you can't see missing. The
   * symmetric counterpart to logIntentMiss (Gate-1). Routed to system_events;
   * fire-and-forget, never throws.
   */
  logSimilarityMiss(args: {
    query: string;
    domain: string | null;
    top_raw_similarity: number;
    hits_examined: number;
    agent_context?: string;
    caller?: string;
  }): void {
    const query = args.query.length > 1000 ? `${args.query.slice(0, 1000)}…` : args.query;
    const summary = `Library similarity gate miss (${args.domain ?? "no-domain"}, top=${args.top_raw_similarity.toFixed(3)}, n=${args.hits_examined})`;
    const payload = {
      query,
      domain: args.domain,
      top_raw_similarity: args.top_raw_similarity,
      hits_examined: args.hits_examined,
      agent_context: args.agent_context ?? "context-engine-push",
      caller: args.caller ?? null,
    };
    this.db
      .execute(sql`
        INSERT INTO system_events (kind, summary, severity, payload)
        VALUES ('library-similarity-miss', ${summary}, 'info', ${JSON.stringify(payload)}::jsonb)
      `)
      .catch((err) => {
        console.error(
          "[library-similarity-miss] write failed:",
          err instanceof Error ? err.message : err,
        );
      });
  }

  /**
   * rag-corpus-2 (May 31) — distinct domains present in the DB. Used by the
   * provider at construction to assert every seeded domain has a DOMAIN_KEYWORDS
   * entry (else it's invisible to the PUSH intent gate). Cheap SELECT DISTINCT.
   */
  async listDomains(): Promise<string[]> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT domain FROM library_entries WHERE embedding IS NOT NULL ORDER BY domain
    `);
    return (result as unknown as Array<{ domain: string }>).map((r) => String(r.domain));
  }

  async index(domain?: string | null): Promise<LibraryIndexResult> {
    const filter = domain ?? null;
    const result = await this.db.execute(sql`
      SELECT
        domain,
        sub_domain,
        source,
        COUNT(*)::int AS chunks,
        MIN(created_at) AS ingested_at
      FROM library_entries
      WHERE embedding IS NOT NULL
        AND (${filter}::text IS NULL OR domain = ${filter})
      GROUP BY domain, sub_domain, source
      ORDER BY domain, sub_domain NULLS FIRST, source
    `);
    const rows = result as unknown as Array<{
      domain: string;
      sub_domain: string | null;
      source: string;
      chunks: number;
      ingested_at: string | Date;
    }>;

    type SourceEntry = { source: string; chunks: number; ingested_at: string };
    type SubDomainEntry = {
      sub_domain: string | null;
      sources: SourceEntry[];
      chunks: number;
    };
    type DomainEntry = {
      domain: string;
      sub_domains: SubDomainEntry[];
      chunks: number;
      sources: number;
    };

    const byDomain = new Map<string, DomainEntry>();
    for (const r of rows) {
      let dEntry = byDomain.get(r.domain);
      if (!dEntry) {
        dEntry = { domain: r.domain, sub_domains: [], chunks: 0, sources: 0 };
        byDomain.set(r.domain, dEntry);
      }
      let sdEntry = dEntry.sub_domains.find(
        (s) => s.sub_domain === r.sub_domain,
      );
      if (!sdEntry) {
        sdEntry = { sub_domain: r.sub_domain, sources: [], chunks: 0 };
        dEntry.sub_domains.push(sdEntry);
      }
      const ingestedIso =
        r.ingested_at instanceof Date
          ? r.ingested_at.toISOString()
          : String(r.ingested_at);
      sdEntry.sources.push({
        source: r.source,
        chunks: r.chunks,
        ingested_at: ingestedIso,
      });
      sdEntry.chunks += r.chunks;
      dEntry.chunks += r.chunks;
      dEntry.sources += 1;
    }

    return {
      domains: Array.from(byDomain.values()),
      totals: {
        domains: byDomain.size,
        sources: rows.length,
        chunks: rows.reduce((s, r) => s + r.chunks, 0),
      },
    };
  }

  // Wave 10 (May 24, 2026): library decay loop. Surface sources that
  // have been ingested past `graceDays` AND have not been actually cited in a
  // `system_events.kind='library-cite'` row within `cooldownDays`. Historical
  // search-path cite rows remain immutable but do not count as citation use.
  //
  // The signal: a source ingested 60 days ago but never quoted in any
  // briefing or agent output is a candidate for review (rewrite or
  // remove). Closes [[pattern_persona_file_staleness_may21]] at the
  // library tier — analogous decay problem, this time addressed.
  //
  // Defaults: grace=14d (skip recently-ingested), cooldown=30d.
  async detectStale(opts?: {
    graceDays?: number;
    cooldownDays?: number;
    domain?: string | null;
  }): Promise<{
    stale: Array<{
      domain: string;
      sub_domain: string | null;
      source: string;
      chunks: number;
      first_ingested_at: string;
      days_since_ingest: number;
    }>;
    totals: { stale: number; cooldown_days: number; grace_days: number };
  }> {
    const graceDays = opts?.graceDays ?? 14;
    const cooldownDays = opts?.cooldownDays ?? 30;
    const domain = opts?.domain ?? null;

    const result = await this.db.execute(sql`
      WITH sources AS (
        SELECT
          domain,
          sub_domain,
          source,
          MIN(created_at) AS first_ingested_at,
          COUNT(*)::int AS chunks
        FROM library_entries
        WHERE embedding IS NOT NULL
          AND (${domain}::text IS NULL OR domain = ${domain})
        GROUP BY domain, sub_domain, source
      ),
      recent_cites AS (
        SELECT DISTINCT jsonb_array_elements_text(payload->'sources') AS cited_source
        FROM system_events
        WHERE kind = 'library-cite'
          AND (payload->>'via') IS DISTINCT FROM 'search'
          AND ts > now() - (${cooldownDays} || ' days')::interval
      )
      SELECT
        s.domain,
        s.sub_domain,
        s.source,
        s.chunks,
        s.first_ingested_at,
        EXTRACT(DAY FROM (now() - s.first_ingested_at))::int AS days_since_ingest
      FROM sources s
      WHERE s.first_ingested_at < now() - (${graceDays} || ' days')::interval
        AND s.source NOT IN (SELECT cited_source FROM recent_cites)
      ORDER BY s.first_ingested_at ASC
    `);

    const rows = result as unknown as Array<{
      domain: string;
      sub_domain: string | null;
      source: string;
      chunks: number;
      first_ingested_at: string | Date;
      days_since_ingest: number;
    }>;

    const stale = rows.map((r) => ({
      ...r,
      first_ingested_at:
        r.first_ingested_at instanceof Date
          ? r.first_ingested_at.toISOString()
          : String(r.first_ingested_at),
    }));

    return {
      stale,
      totals: {
        stale: stale.length,
        cooldown_days: cooldownDays,
        grace_days: graceDays,
      },
    };
  }
}
