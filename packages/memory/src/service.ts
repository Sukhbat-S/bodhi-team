// ============================================================
// BODHI — Memory Service
// Store, retrieve, and manage memories with vector search
// ============================================================

import { eq, desc, sql, and, isNull } from "drizzle-orm";
import { memories } from "@seneca/db";
import type { Database } from "@seneca/db";
import { embed, embedSingle, DIMENSIONS } from "./embedding.js";
import { sanitize } from "./sanitizer.js";
import type { AuditSink } from "./drift-scanner.js";
import { memoryNotSuppressed, memoryVisible } from "./visibility.js";

// Surface filter: excludes memories tagged "do-not-surface" AND
// memories that have been cold-tier-forgotten (Phase S1, May 18).
// Both are soft-filters — the rows remain in the DB for audit.
// Used by every read path that returns memories to context, dashboard,
// synthesizer, or insight surfaces. Adding to this single fragment
// enforces the tag consistently across the codebase.
const NOT_HIDDEN = memoryNotSuppressed();

// §2.6 authority-tier weights — the SINGLE source for the foundational/archived
// scope deltas, used by scopeDelta() (JS re-sort), compositeScore() (via
// scopeDelta), AND interpolated into retrieve()'s SQL ORDER BY CASE below. Was
// three comment-synced literals (bodhi-crit May 31: a one-side tweak silently
// desynced the SQL weighting from the JS re-sort) — now change the weight once.
const SCOPE_WEIGHTS = { foundational: 0.1, archived: -0.15 } as const;

// Wave 6 — memory reinforcement (Jul 2026). Three TUNING KNOBS, not laws:
// retune against the retrieval-eval, don't treat these as pinned physics.
//
// CONFIDENCE_RANK_WEIGHT — the "soft gate" weight w: confidence enters the
// composite rank score as + w·confidence, so a decayed-but-alive memory ranks
// LOWER instead of being invisible. Deliberately non-dominating (max
// contribution 0.1 vs the 0.60 similarity term). The `WHERE confidence > 0.1`
// hard floor in retrieve() stays as the genuine forget threshold.
export const CONFIDENCE_RANK_WEIGHT = 0.1;
// ACCESS_BUMP_DELTA — the access-bump restoring force: each retrieval bumps a
// returned memory's confidence by this Δ (capped at 1.0).
//
// Do NOT say this "offsets" the decay — the old comment did, and the arithmetic
// does not support it (caught by a cross-provider review, grok-4.5, Jul 10).
// Decay for a session-active memory is c ← c·(1−d), d=0.05 (coupling.ts
// DECAY_RATE_BY_SCOPE), plus a neighbour-sustenance term s̄·d. For an ISOLATED
// memory (s̄≈0) retrieved once per synthesizer cycle the recurrence is
//     c ← 0.95·c + 0.02   ⇒   fixed point c* = Δ/d = 0.02/0.05 = 0.40
// Daily use does not hold a memory at its current confidence; it converges to 0.40.
// Offsetting decay AT c would need Δ = c·d (0.05 at c=1.0) — 2.5× this constant.
//
// That equilibrium is SAFE, not a bug: 0.40 sits well clear of retrieve()'s 0.1
// forget-gate, and coupled memories settle higher (s̄·d adds up to ~+0.02). The
// genuinely exposed class is orphaned NEAR-MISSES — rows ranked past `limit`, which
// are scored but never returned, so never bumped
// (pattern_memory_decay_without_reinforcement_silent_eviction_jun30).
//
// Looks like a risk, is not: the synthesizer's catch-block fallback applies an
// ABSOLUTE −0.1 (no positive fixed point), but getStaleMemories(30, 0.5) selects
// only rows unaccessed 30+ days with importance < 0.5 — a still-retrieved memory
// can never enter that set.
//
// Raising Δ is an EVAL-GATED change, not a free tweak (see TUNING KNOBS above):
// retune against the retrieval-eval, never on arithmetic alone.
export const ACCESS_BUMP_DELTA = 0.02;
// ACCESS_BUMP_MIN_INTERVAL_MS — rate limit: ≤1 bump/day/memory, gated INSIDE
// the atomic stats+bump UPDATE on the row's own pre-update last_accessed_at,
// so neither a chatty session nor CONCURRENT retrieve() calls can inflate
// confidence (per-row atomicity: the second caller's gate sees the first's
// committed now()).
export const ACCESS_BUMP_MIN_INTERVAL_MS = 24 * 3600 * 1000;

function scopeDelta(scope?: "foundational" | "session-active" | "archived"): number {
  if (scope === "foundational") return SCOPE_WEIGHTS.foundational;
  if (scope === "archived") return SCOPE_WEIGHTS.archived;
  return 0;
}

// Recency factor — decays 1.0 (today) → 0.0 (90+ days). Mirrors the SQL recency term.
function recencyFactor(createdAt: Date | string): number {
  const t = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return Math.max(0, 1 - (Date.now() - t) / (90 * 86400 * 1000));
}

// The retrieval composite — the JS re-sort key, a faithful mirror of the SQL
// ORDER BY (0.60·sim + 0.25·importance + 0.15·recency + w·confidence + scope).
// The earlier re-sort used importance alone, silently discarding the 60%
// similarity + 15% recency weights and re-ranking the block by importance
// (May 30 fix). Wave 6 (Jul 2026) added the confidence soft-gate term — keep
// it in lockstep with retrieve()'s SQL ORDER BY below.
export function compositeScore(
  row: {
    similarity: number;
    importance: number;
    createdAt: Date | string;
    // Wave 6: optional so pre-Wave-6 fixtures/callers score EXACTLY as before.
    // Defaults to 0 (no boost), NOT the column's 1.0 default — a row that
    // doesn't carry confidence gets no reinforcement credit. Production rows
    // always have it (memories.confidence is NOT NULL); mirrors the SQL
    // COALESCE(confidence, 0).
    confidence?: number;
    scope?: "foundational" | "session-active" | "archived";
  },
  // Scope-boost valve (Jun 16): when false, the §2.6 scope delta is zeroed in the
  // JS re-sort — mirrors the SQL CASE's fw/aw=0 path so the scope A/B eval's two
  // runs differ in EXACTLY the scope weight. Default true = unchanged behavior.
  // (The Wave-6 confidence term is orthogonal to this valve and never zeroed.)
  scopeBoost = true,
): number {
  return (
    0.6 * (row.similarity ?? 0) +
    0.25 * (row.importance ?? 0.5) +
    0.15 * recencyFactor(row.createdAt) +
    CONFIDENCE_RANK_WEIGHT * (row.confidence ?? 0) +
    (scopeBoost ? scopeDelta(row.scope) : 0)
  );
}

export interface MemoryInput {
  content: string;
  type?: "fact" | "decision" | "pattern" | "preference" | "event" | "goal";
  source?: "conversation" | "manual" | "extraction" | "synthesis";
  sourceThreadId?: string;
  importance?: number;
  tags?: string[];
  status?: "confirmed" | "pending" | "rejected";
  scope?: "foundational" | "session-active" | "archived";
}

export interface MemoryResult {
  id: string;
  content: string;
  type: string;
  importance: number;
  confidence: number;
  similarity: number;
  createdAt: Date;
  tags: string[] | null;
  // Provenance: distinguishes user-stated (manual|conversation) from
  // AI-generated (extraction|synthesis). Consumers like MemoryContextProvider
  // annotate AI-generated memories so prompts treat them as hypotheses,
  // not facts. Defends against inference-as-fact drift.
  source: "conversation" | "manual" | "extraction" | "synthesis";
  // Authority tier (§2.6, May 30). Optional: only retrieve() populates it.
  // Drives the assembly-time scope label + the retrieval weighting.
  scope?: "foundational" | "session-active" | "archived";
  // Forgetting-tier recall signal (Phase S1). Optional: only the scope-aware
  // SELECTs that pull recall_count populate it (retrieve does, post Jun 16 — the
  // scope A/B eval reads it without a 2nd query for the crowd-out count).
  recallCount?: number;
}

export interface MemoryCorrectionResult {
  forgottenId: string;
  replacementId: string;
}

// ============================================================
// rowToMemoryResult — the single row→MemoryResult mapper (spec #15, May 31)
// ------------------------------------------------------------
// Before this helper, ~10 call sites hand-rolled the same object literal, and
// they drifted: `scope` (the §2.6 authority tier) landed in only retrieve() +
// getRecentMemories(), so every other read path silently zeroed the authority
// marker. This helper centralizes the mapping so a new MemoryResult field is
// added in ONE place.
//
// Dual-case tolerance: BODHI's read paths split between raw `db.execute(sql\`\`)`
// (SNAKE_CASE: r.created_at, r.access_count, r.scope) and Drizzle `.select({})`
// (CAMELCASE: r.createdAt). The helper normalizes both — createdAt prefers the
// camelCase key, falls back to snake_case; scope is read straight through (the
// column is `scope` in both worlds) and tolerated as absent → undefined.
//
// Variant extra fields (accessCount, lastAccessedAt, targetId) and the
// constant-similarity overrides (list/getRecent set 1/0) are applied by the
// CALLER via spread: `{ ...rowToMemoryResult(r), accessCount: r.access_count }`.
// ------------------------------------------------------------
export function rowToMemoryResult(r: any): MemoryResult {
  return {
    id: r.id,
    content: r.content,
    type: r.type,
    importance: r.importance,
    confidence: r.confidence,
    // Most callers override this via spread (a constant 1/0); when the row
    // carries a real similarity (retrieve, findSimilarToMemory) it flows through.
    similarity: r.similarity ?? 0,
    // Normalize across the two row shapes. Drizzle camelCase wins when present;
    // raw-SQL snake_case is the fallback. Both produce a Date.
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(r.created_at),
    tags: r.tags,
    source: r.source,
    // §2.6 authority tier. Present on scope-aware SELECTs, undefined otherwise.
    scope: r.scope as MemoryResult["scope"],
    // Forgetting-tier recall signal. snake_case (raw SQL) or camelCase (Drizzle);
    // absent → undefined. Read by the scope A/B eval's crowd-out count.
    recallCount: r.recallCount ?? r.recall_count,
  };
}

/**
 * Rows affected by a mutating `db.execute()`. The postgres-js adapter (our client —
 * `packages/db/src/client.ts`) returns an Array carrying `.count`; node-postgres
 * returns `{ rowCount }`. Read both — a bare `(result as any).rowCount` silently
 * coalesces to 0 on postgres-js and makes a successful UPDATE report failure
 * (proven: reject/confirm 404'd while the row was in fact mutated).
 *
 * ORDERING IS LOAD-BEARING: `count` FIRST. On postgres-js the result is an Array, so
 * `.length` exists and equals 0 for an UPDATE with no RETURNING — putting `length`
 * before `count` would reintroduce the exact bug this fixes.
 */
export function affectedRows(result: unknown): number {
  const r = result as { count?: number; rowCount?: number; length?: number };
  return r?.count ?? r?.rowCount ?? r?.length ?? 0;
}

export class MemoryService {
  private db: Database;
  private voyageApiKey: string;
  // sc-1 M2 (May 31): optional audit sink. When wired (composition root passes
  // the AuditService), retrieve()'s block-mode sanitize emits a forensic
  // memory.sanitize row on every redaction — so a poisoned-memory block (or a
  // false-positive redaction) leaves a durable trail instead of only a stderr
  // line. Best-effort, hash-not-body (the sink SHA-256s the matched content).
  private audit?: AuditSink | null;

  constructor(db: Database, voyageApiKey: string, audit?: AuditSink | null) {
    this.db = db;
    this.voyageApiKey = voyageApiKey;
    this.audit = audit;
  }

  async store(input: MemoryInput): Promise<string> {
    const embedding = await embedSingle(input.content, this.voyageApiKey);

    const [result] = await this.db
      .insert(memories)
      .values({
        content: input.content,
        type: input.type || "fact",
        source: input.source || "extraction",
        sourceThreadId: input.sourceThreadId,
        importance: input.importance ?? 0.5,
        embedding,
        tags: input.tags,
        status: input.status ?? "confirmed",
        scope: input.scope ?? "session-active",
      })
      .returning({ id: memories.id });

    return result.id;
  }

  async storeBatch(
    inputs: MemoryInput[]
  ): Promise<{ stored: number; ids: string[] }> {
    if (inputs.length === 0) return { stored: 0, ids: [] };

    // Batch-embed all texts in a single Voyage AI API call
    const texts = inputs.map((i) => i.content);
    const embeddings = await embed(texts, this.voyageApiKey);

    // Insert all memories in one transaction
    const values = inputs.map((input, idx) => ({
      content: input.content,
      type: input.type || ("fact" as const),
      source: input.source || ("manual" as const),
      sourceThreadId: input.sourceThreadId,
      importance: input.importance ?? 0.5,
      embedding: embeddings[idx],
      tags: input.tags,
    }));

    const results = await this.db
      .insert(memories)
      .values(values)
      .returning({ id: memories.id });

    return { stored: results.length, ids: results.map((r) => r.id) };
  }

  async retrieve(
    query: string,
    limit = 5,
    tag?: string,
    opts?: { scopeBoost?: boolean },
  ): Promise<MemoryResult[]> {
    // §2.6 scope weights, with an opt-out valve (Jun 16). The scope A/B eval
    // calls retrieve(..., { scopeBoost: false }) to measure the boost's effect on
    // recall — when disabled, BOTH the SQL ORDER BY CASE and the JS re-sort zero
    // the foundational/archived deltas. DEFAULT (opts omitted) is byte-identical
    // to the prior behavior: fw=SCOPE_WEIGHTS.foundational, aw=SCOPE_WEIGHTS.archived.
    const fw = opts?.scopeBoost === false ? 0 : SCOPE_WEIGHTS.foundational;
    const aw = opts?.scopeBoost === false ? 0 : SCOPE_WEIGHTS.archived;
    const scopeBoostEnabled = opts?.scopeBoost !== false;

    // Fallback path: for vague/short queries ("hi", "what's up", "pending"),
    // semantic search returns thin or no results. Blend in recent-by-importance
    // memories so the conversation still gets context. 6th-agent audit finding.
    const isVague = query.trim().length < 30;

    const queryEmbedding = await embedSingle(query, this.voyageApiKey);

    // Composite scoring: 60% similarity + 25% importance + 15% recency
    // Recency decays from 1.0 (today) to 0.0 (90+ days ago)
    // Fetch 3x candidates, score compositely, return top `limit`
    const candidateLimit = Math.min(limit * 3, 50);
    // Wave 11 follow-up (2026-05-24): optional tag filter scopes retrieval
    // to a project. Spawned panes calling search_memories from a non-BODHI
    // project pass their project name to prevent cross-project memory bleed.
    // When tag is omitted (default), behavior is unchanged — backward-compat
    // for existing call sites (concierge, scheduler jobs, telegram bot).
    const tagFilter = tag ? sql`AND tags ? ${tag}` : sql``;
    const qEmb = JSON.stringify(queryEmbedding);
    // ANN-prefilter then composite re-rank (May 29). The `knn` CTE's
    // `ORDER BY embedding <=> q LIMIT annK` is served by the HNSW index
    // (memories_embedding_hnsw_idx) instead of a full sequential scan, and the
    // cosine distance is materialized ONCE as `dist` — the prior query computed
    // `embedding <=> q` three times per row (SELECT + WHERE + ORDER BY) across
    // the whole table. The composite 60/25/15 scoring is preserved exactly,
    // now applied only to the annK nearest candidates.
    //
    // annK is kept at 50 (== max candidateLimit): pgvector HNSW is only chosen
    // by the planner for small LIMITs (default hnsw.ef_search=40); a larger annK
    // (e.g. 400) reverts to a seq scan and the index is wasted. EXPLAIN-verified:
    // LIMIT 50 → HNSW index scan (~4ms warm) vs LIMIT 400 → seq scan (~1.3s).
    // Recall trade-off is negligible — similarity is 60% of the composite, so
    // the top results come from the nearest neighbours anyway.
    const annK = 50;
    const results = await this.db.execute(sql`
      WITH knn AS (
        SELECT
          id, content, type, importance, confidence, tags, source, created_at, access_count, recall_count, scope, last_accessed_at,
          (embedding <=> ${qEmb}::vector) AS dist
        FROM memories
        WHERE confidence > 0.1
          AND status = 'confirmed'
          AND ${NOT_HIDDEN}
          ${tagFilter}
        ORDER BY embedding <=> ${qEmb}::vector
        LIMIT ${annK}
      )
      SELECT
        id, content, type, importance, confidence, tags, source, created_at, access_count, recall_count, scope, last_accessed_at,
        1 - dist AS similarity,
        GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - created_at)) / (90 * 86400)) AS recency
      FROM knn
      WHERE 1 - dist > 0.3
      ORDER BY (
        0.60 * (1 - dist) +
        0.25 * COALESCE(importance, 0.5) +
        0.15 * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - created_at)) / (90 * 86400)) +
        -- Wave 6 soft gate (Jul 2026): confidence as a small rank weight so a
        -- decayed-but-alive memory down-ranks gracefully instead of vanishing.
        -- The confidence > 0.1 hard floor above stays the forget threshold.
        -- Weight interpolated from CONFIDENCE_RANK_WEIGHT — same single-source
        -- discipline as fw/aw, mirrored in compositeScore()'s JS re-sort.
        ${sql.raw(String(CONFIDENCE_RANK_WEIGHT))} * COALESCE(confidence, 0) +
        -- §2.6 authority tier: float durable memories up, sink archived (May 30).
        -- Weights interpolated from fw/aw (= SCOPE_WEIGHTS unless the scope-boost
        -- valve zeroes them, Jun 16) so this SQL CASE can never desync from
        -- scopeDelta()/compositeScore() — and the A/B opt-out zeroes both sides.
        (CASE scope WHEN 'foundational' THEN ${sql.raw(String(fw))} WHEN 'archived' THEN ${sql.raw(String(aw))} ELSE 0 END)
      ) DESC
      LIMIT ${candidateLimit}
    `);

    const semanticResults: MemoryResult[] = (results as any[]).slice(0, limit).map((r: any) =>
      rowToMemoryResult(r)
    );

    // Vague-query fallback: if a short query returned thin results, blend in
    // recent high-importance memories so conversation context isn't empty.
    // Dedupe by memory id (semantic results win if both paths match).
    // Skip when a tag filter is requested — getRecentMemories doesn't filter,
    // and leaking wrong-project memories into a scoped query defeats the tag.
    if (isVague && !tag && semanticResults.length < 3) {
      const seen = new Set(semanticResults.map((m) => m.id));
      const recent = await this.getRecentMemories(limit);
      for (const mem of recent) {
        if (seen.has(mem.id)) continue;
        semanticResults.push(mem);
        if (semanticResults.length >= limit) break;
      }
    }

    // Phase 33 B3 (May 25) + security-chain-2 (May 31): sanitize memory content
    // at the retrieval boundary in BLOCK mode — a poisoned memory surfaced at
    // priority 10 is now REDACTED, not warn-logged-then-passed-through. Mirrors
    // the briefing fenceExternal path (briefings.ts:35). The [sanitizer block]
    // stderr line is the live-smoke signal. No audit sink wired into
    // MemoryService (constructor is db+voyageApiKey only); block redaction is the
    // fix, audit-on-retrieve is a separate composition-root follow-up.
    const sanitized = semanticResults.map((row) => {
      const verdict = sanitize(row.content, { mode: "block", source: `memory.retrieve:${row.id}`, audit: this.audit });
      return { ...row, content: verdict.sanitized };
    });

    // Re-sort by the FULL composite (compositeScore), a faithful mirror of the
    // SQL ORDER BY — May 30 fix: the prior key was importance+scope alone, which
    // discarded the 60% similarity + 15% recency weights and let a low-similarity
    // high-importance row outrank a high-similarity one.
    //
    // (Phase 33 B2 per-type calibration was removed here Jul 25, 2026 — Wave 2
    // prune. It was an identity transform: all 6 memory_calibration rows sat at
    // scale 1.0 with total_sampled=0 since Jun 7, so applyToImportance() returned
    // its input unchanged on every call. The sort it fed is kept.)
    const ranked = [...sanitized];
    ranked.sort((a, b) => compositeScore(b, scopeBoostEnabled) - compositeScore(a, scopeBoostEnabled));
    // Only records actually returned count as recalled. Candidate ranking is not use.
    const returnedIds = ranked.map((row) => row.id);
    if (returnedIds.length > 0) {
      const returnedClause = sql.join(returnedIds.map((id: string) => sql`${id}::uuid`), sql`, `);
      // Single-source rate limit: interval derived from ACCESS_BUMP_MIN_INTERVAL_MS.
      const bumpGate = sql`(last_accessed_at IS NULL OR last_accessed_at < now() - interval '1 millisecond' * ${ACCESS_BUMP_MIN_INTERVAL_MS})`;
      this.db
        .execute(sql`
          UPDATE memories
          SET access_count = access_count + 1,
              recall_count = recall_count + 1,
              confidence = CASE WHEN ${bumpGate} THEN LEAST(1.0, confidence + ${ACCESS_BUMP_DELTA}) ELSE confidence END,
              updated_at = CASE WHEN ${bumpGate} THEN now() ELSE updated_at END,
              last_accessed_at = now(),
              last_recalled_at = now()
          WHERE id IN (${returnedClause}) AND ${memoryVisible()}
        `)
        .catch((err) => {
          console.warn(
            "[memory.retrieve] access-stats+bump failed (best-effort, skipped):",
            err instanceof Error ? err.message : err
          );
        });
    }

    return ranked;
  }

  async forget(memoryId: string): Promise<boolean> {
    const [forgotten] = await this.db
      .update(memories)
      .set({ forgottenAt: new Date(), updatedAt: new Date() })
      .where(and(eq(memories.id, memoryId), isNull(memories.forgottenAt)))
      .returning({ id: memories.id });
    return !!forgotten;
  }

  /**
   * Atomically supersede one live memory with a reviewed replacement. The
   * embedding is prepared before opening the transaction; the old row is only
   * hidden if the replacement insert can commit in the same transaction.
   */
  async correct(memoryId: string, replacement: MemoryInput): Promise<MemoryCorrectionResult | null> {
    const embedding = await embedSingle(replacement.content, this.voyageApiKey);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-entity-evidence'))`);
      const [current] = await tx
        .select({
          id: memories.id,
          type: memories.type,
          importance: memories.importance,
          tags: memories.tags,
          scope: memories.scope,
          sourceThreadId: memories.sourceThreadId,
        })
        .from(memories)
        .where(and(eq(memories.id, memoryId), isNull(memories.forgottenAt)))
        .limit(1)
        .for("update");
      if (!current) return null;

      const [forgotten] = await tx
        .update(memories)
        .set({ forgottenAt: new Date(), updatedAt: new Date() })
        .where(and(eq(memories.id, memoryId), isNull(memories.forgottenAt)))
        .returning({ id: memories.id });
      // A concurrent correction may have won after our initial read. Only the
      // transaction that actually hid the original row may insert a successor.
      if (!forgotten) return null;

      const [stored] = await tx
        .insert(memories)
        .values({
          content: replacement.content,
          type: replacement.type ?? current.type,
          source: replacement.source ?? "manual",
          sourceThreadId: replacement.sourceThreadId ?? current.sourceThreadId ?? undefined,
          importance: replacement.importance ?? current.importance,
          embedding,
          tags: replacement.tags ?? current.tags ?? undefined,
          status: replacement.status ?? "confirmed",
          scope: replacement.scope ?? current.scope,
        })
        .returning({ id: memories.id });

      // Hold the original row lock through link copying. linkToMemory takes
      // the same lock and refuses suppressed originals, so a late link cannot
      // land after this snapshot. Historical links remain on the original.
      await tx.execute(sql`
        INSERT INTO entity_memories (entity_id, memory_id, role, created_at)
        SELECT entity_id, ${stored.id}::uuid, role, created_at
        FROM entity_memories WHERE memory_id = ${memoryId}::uuid
        ON CONFLICT (entity_id, memory_id) DO NOTHING
      `);

      return { forgottenId: memoryId, replacementId: stored.id };
    });
  }

  async list(limit = 20): Promise<MemoryResult[]> {
    const results = await this.db
      .select({
        id: memories.id,
        content: memories.content,
        type: memories.type,
        importance: memories.importance,
        confidence: memories.confidence,
        createdAt: memories.createdAt,
        tags: memories.tags,
        source: memories.source,
        scope: memories.scope,
      })
      .from(memories)
      .where(memoryVisible())
      .orderBy(desc(memories.createdAt))
      .limit(limit);

    return results.map((r) => ({
      ...rowToMemoryResult(r),
      similarity: 1,
    }));
  }

  async listFiltered(opts: {
    limit?: number;
    offset?: number;
    tag?: string;
    search?: string;
    type?: string;
    status?: "confirmed" | "pending" | "rejected";
    /** Filter to one memory_source (Jul 25). Added so the extraction-limbo
     * drain can ask for ITS OWN pool instead of paging the whole pending list
     * and filtering client-side — a 60-row page of mixed-source pending rows
     * silently spent slots on rows the drain does not own. Binds to a Postgres
     * ENUM column, so callers MUST allowlist-validate first (the #24 22P02
     * enum-cast-500 class); routes/memory.ts does via validateMemorySource. */
    source?: "conversation" | "manual" | "extraction" | "synthesis";
    scope?: "foundational" | "session-active" | "archived";
    /** Exclude archived-scope memories (§2.6). Opt-in so existing list callers
     * (e.g. a memories browser that wants to SEE archived) are unaffected; goal
     * consumers pass true so a closed goal stops resurfacing. */
    excludeArchived?: boolean;
  } = {}): Promise<{ memories: MemoryResult[]; total: number }> {
    // Guard against NaN from unvalidated parseInt() in callers (routes/memory.ts
    // does parseInt(query) with no fallback → NaN bound into LIMIT/OFFSET → 500).
    // Coerce non-finite/negative to the default at this single boundary.
    const limit = Number.isFinite(opts.limit) && (opts.limit as number) >= 0 ? (opts.limit as number) : 20;
    const offset = Number.isFinite(opts.offset) && (opts.offset as number) >= 0 ? (opts.offset as number) : 0;

    const conditions = [NOT_HIDDEN];

    if (opts.tag) {
      conditions.push(sql`tags ? ${opts.tag}`);
    }
    if (opts.search) {
      conditions.push(sql`content ILIKE ${"%" + opts.search + "%"}`);
    }
    if (opts.type) {
      conditions.push(sql`type = ${opts.type}`);
    }
    if (opts.status) {
      conditions.push(sql`status = ${opts.status}`);
    }
    if (opts.source) {
      conditions.push(sql`source = ${opts.source}`);
    }
    if (opts.scope) {
      conditions.push(sql`scope = ${opts.scope}::memory_scope`);
    }
    if (opts.excludeArchived) {
      conditions.push(sql`scope != 'archived'`);
    }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    // Get total count
    const countResult = await this.db.execute(
      sql`SELECT count(*)::int as total FROM memories ${whereClause}`
    );
    const total = (countResult as any[])[0]?.total ?? 0;

    // Get paginated results
    const results = await this.db.execute(sql`
      SELECT
        id, content, type, importance, confidence, tags, source,
        created_at, access_count, last_accessed_at, scope
      FROM memories
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return {
      total,
      memories: (results as any[]).map((r: any) => ({
        ...rowToMemoryResult(r),
        similarity: 1,
        accessCount: r.access_count,
        lastAccessedAt: r.last_accessed_at,
      })),
    };
  }

  // ============================================================
  // Intelligence methods (for Synthesizer + InsightGenerator)
  // ============================================================

  /**
   * Find memories similar to a given memory by its embedding.
   * Used by Synthesizer for dedup and clustering.
   */
  async findSimilarToMemory(
    memoryId: string,
    threshold = 0.80,
    limit = 10
  ): Promise<(MemoryResult & { targetId: string })[]> {
    const results = await this.db.execute(sql`
      WITH target AS (
        SELECT embedding FROM memories WHERE id = ${memoryId} AND ${memoryVisible()}
      )
      SELECT
        m.id, m.content, m.type, m.importance, m.confidence,
        m.tags, m.source, m.created_at, m.scope,
        1 - (m.embedding <=> t.embedding) as similarity
      FROM memories m, target t
      WHERE m.id != ${memoryId}
        AND m.confidence > 0.1
        AND ${memoryVisible("m")}
        AND 1 - (m.embedding <=> t.embedding) > ${threshold}
      ORDER BY m.embedding <=> t.embedding
      LIMIT ${limit}
    `);

    return (results as any[]).map((r: any) => ({
      ...rowToMemoryResult(r),
      targetId: memoryId,
    }));
  }

  /**
   * Batch adjust confidence for a set of memories.
   * delta can be negative (decay) or positive (restore).
   */
  async adjustConfidence(ids: string[], delta: number): Promise<void> {
    if (ids.length === 0) return;
    // Parameterized (May 29): ids + delta used to be string-interpolated into
    // sql.raw and fed straight from the PATCH body — arbitrary SQL against the
    // substrate's most valuable table. ${id}::uuid binds + validates each id;
    // a non-uuid 400s at the DB instead of injecting.
    const idClause = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    await this.db.execute(sql`
      UPDATE memories
      SET confidence = GREATEST(0, LEAST(1, confidence + ${delta})),
          updated_at = now()
      WHERE id IN (${idClause})
    `);
  }

  /**
   * Batch adjust importance for a set of memories with a cap.
   */
  async adjustImportance(ids: string[], delta: number, cap = 1.0): Promise<void> {
    if (ids.length === 0) return;
    const idClause = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    await this.db.execute(sql`
      UPDATE memories
      SET importance = GREATEST(0, LEAST(${cap}, importance + ${delta})),
          updated_at = now()
      WHERE id IN (${idClause})
    `);
  }

  /**
   * Set the authority tier (§2.6 scope) on one or more memories. This is the
   * closeable end of the goal lifecycle: archiving a goal marks it done/parked,
   * and DriftScanner.getActiveGoals + retrieval ranking both honor `archived`.
   * Each id is bound + validated as ::uuid (parity with adjustImportance); scope
   * is bound + cast to the pg enum, which rejects any non-enum value at the DB.
   */
  async setScope(
    ids: string[],
    scope: "foundational" | "session-active" | "archived"
  ): Promise<void> {
    if (ids.length === 0) return;
    const idClause = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    await this.db.execute(sql`
      UPDATE memories
      SET scope = ${scope}::memory_scope,
          updated_at = now()
      WHERE id IN (${idClause})
    `);
  }

  /**
   * Get stale memories: not accessed recently, low importance.
   * Candidates for confidence decay.
   */
  async getStaleMemories(daysUnaccessed = 30, maxImportance = 0.5): Promise<MemoryResult[]> {
    const results = await this.db.execute(sql`
      SELECT id, content, type, importance, confidence, tags, source, created_at, scope
      FROM memories
      WHERE confidence > 0.1
        AND ${memoryVisible()}
        AND importance < ${maxImportance}
        AND (last_accessed_at IS NULL OR last_accessed_at < now() - ${daysUnaccessed + ' days'}::interval)
        AND created_at < now() - ${daysUnaccessed + ' days'}::interval
      ORDER BY importance ASC
      LIMIT 50
    `);

    return (results as any[]).map((r: any) => ({
      ...rowToMemoryResult(r),
      similarity: 1,
    }));
  }

  /**
   * Get frequently accessed memories. Candidates for importance promotion.
   */
  async getFrequentlyAccessed(minAccessCount = 5, limit = 20): Promise<MemoryResult[]> {
    const results = await this.db.execute(sql`
      SELECT id, content, type, importance, confidence, tags, source, created_at, access_count, scope
      FROM memories
      WHERE access_count >= ${minAccessCount}
        AND confidence > 0.1
        AND ${memoryVisible()}
        AND importance < 1.0
      ORDER BY access_count DESC
      LIMIT ${limit}
    `);

    return (results as any[]).map((r: any) => ({
      ...rowToMemoryResult(r),
      similarity: 1,
    }));
  }

  /**
   * Get memory creation count over a period.
   */
  async getCreationRate(days = 7): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT count(*)::int as count
      FROM memories
      WHERE ${memoryVisible()} AND created_at > now() - ${days + ' days'}::interval
    `);
    return (result as any[])[0]?.count ?? 0;
  }

  /**
   * Compare tag frequency between two time periods.
   */
  async getTagTrends(
    recentDays = 7,
    previousDays = 7
  ): Promise<{ tag: string; recent: number; previous: number }[]> {
    const results = await this.db.execute(sql`
      WITH recent_tags AS (
        SELECT tag, count(*)::int as cnt
        FROM memories, jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) as tag
        WHERE ${memoryVisible()} AND created_at > now() - ${recentDays + ' days'}::interval
        GROUP BY tag
      ),
      previous_tags AS (
        SELECT tag, count(*)::int as cnt
        FROM memories, jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) as tag
        WHERE ${memoryVisible()} AND created_at BETWEEN now() - ${(recentDays + previousDays) + ' days'}::interval
                              AND now() - ${recentDays + ' days'}::interval
        GROUP BY tag
      )
      SELECT
        COALESCE(r.tag, p.tag) as tag,
        COALESCE(r.cnt, 0) as recent,
        COALESCE(p.cnt, 0) as previous
      FROM recent_tags r
      FULL OUTER JOIN previous_tags p ON r.tag = p.tag
      ORDER BY COALESCE(r.cnt, 0) DESC
      LIMIT 15
    `);

    return (results as any[]).map((r: any) => ({
      tag: r.tag,
      recent: r.recent,
      previous: r.previous,
    }));
  }

  /**
   * Find decisions that were made but never REVIEWED — by review-evidence, not status.
   * (May 30 fix: the earlier `status='pending'` filter collided with
   * autoConfirmOldPending(7) — both keyed on the same 7-day boundary, so the
   * synthesizer auto-confirmed a decision the instant it became stalled-eligible,
   * permanently emptying this query on active days. An auto-confirmed-but-untouched
   * decision IS the textbook stalled case. So: exclude only `rejected`, and gate on
   * review-evidence — low access_count AND not recently updated. autoConfirmOldPending
   * stamps updated_at=now(), so a freshly auto-confirmed row self-excludes for `minAgeDays`
   * then correctly re-surfaces as stalled if still untouched.)
   */
  async getStalledDecisions(minAgeDays = 7, maxAccess = 2): Promise<MemoryResult[]> {
    const results = await this.db.execute(sql`
      SELECT id, content, type, importance, confidence, tags, source, created_at, scope
      FROM memories
      WHERE type = 'decision'
        AND status <> 'rejected'
        AND confidence > 0.1
        AND ${NOT_HIDDEN}
        AND access_count < ${maxAccess}
        AND created_at < now() - ${minAgeDays + ' days'}::interval
        AND updated_at < now() - ${minAgeDays + ' days'}::interval
      ORDER BY importance DESC
      LIMIT 10
    `);

    return (results as any[]).map((r: any) => ({
      ...rowToMemoryResult(r),
      similarity: 1,
    }));
  }

  /**
   * Count of decisions matching the getStalledDecisions predicate, without the
   * LIMIT. getStalledDecisions caps at 10 rows for display; this returns the
   * true total so an insight can report the real count instead of "10".
   */
  async countStalledDecisions(minAgeDays = 7, maxAccess = 2): Promise<number> {
    const results = await this.db.execute(sql`
      SELECT count(*)::int AS n
      FROM memories
      WHERE type = 'decision'
        AND status <> 'rejected'
        AND confidence > 0.1
        AND ${NOT_HIDDEN}
        AND access_count < ${maxAccess}
        AND created_at < now() - ${minAgeDays + ' days'}::interval
        AND updated_at < now() - ${minAgeDays + ' days'}::interval
    `);
    return (results as any[])[0]?.n ?? 0;
  }

  /**
   * Find high-value memories that are never retrieved.
   */
  async getNeglectedHighValue(
    minImportance = 0.7,
    maxAccess = 0,
    minAgeDays = 14
  ): Promise<MemoryResult[]> {
    const results = await this.db.execute(sql`
      SELECT id, content, type, importance, confidence, tags, source, created_at, scope
      FROM memories
      WHERE importance >= ${minImportance}
        AND confidence > 0.1
        AND ${memoryVisible()}
        AND access_count <= ${maxAccess}
        AND created_at < now() - ${minAgeDays + ' days'}::interval
      ORDER BY importance DESC
      LIMIT 10
    `);

    return (results as any[]).map((r: any) => ({
      ...rowToMemoryResult(r),
      similarity: 1,
    }));
  }

  /**
   * Get recent high-importance memories regardless of semantic similarity.
   * Used to surface important recent decisions/events even when the current
   * message is semantically distant (e.g., "Hey" doesn't match "Blink paused").
   */
  async getRecentMemories(limit = 8): Promise<MemoryResult[]> {
    // Filter to confirmed only — previously this leaked pending memories
    // (AI-extracted) into briefings/chat via the recent-fallback path.
    // memory-correctness sleeper (May 31): SELECT scope here. getRecentMemories
    // feeds TWO scope-rendering consumers (bodhi-crit verified), and omitting
    // scope dropped the §2.6 authority marker + zeroed scopeDelta for both:
    //   1. retrieve()'s vague-fallback (:248) — blends these into scope-aware output
    //   2. Legacy archived dispatch findings → dispositionMarker
    // This IS the one mapper feeding dispositionMarker; the other 8 mappers don't
    // reach it, so the full rowToMemoryResult extraction stays a separate notify
    // refactor (anti-future-drift, not a live bug).
    const results = await this.db.execute(sql`
      SELECT id, content, type, importance, confidence, tags, source, created_at, scope
      FROM memories
      WHERE importance >= 0.5
        AND confidence > 0.3
        AND status = 'confirmed'
        AND ${NOT_HIDDEN}
      ORDER BY created_at DESC, importance DESC
      LIMIT ${limit}
    `);

    return (results as any[]).map((r: any) => ({
      ...rowToMemoryResult(r),
      similarity: 0, // Not from semantic search
    }));
  }

  async getStats(): Promise<{
    totalMemories: number;
    topTags: { tag: string; count: number }[];
    recentCount: number;
  }> {
    // Total count
    const countResult = await this.db.execute(
      sql`SELECT count(*)::int as total FROM memories WHERE ${memoryVisible()}`
    );
    const totalMemories = (countResult as any[])[0]?.total ?? 0;

    // Recent count (last 24h)
    const recentResult = await this.db.execute(
      sql`SELECT count(*)::int as recent FROM memories WHERE ${memoryVisible()} AND created_at > now() - interval '24 hours'`
    );
    const recentCount = (recentResult as any[])[0]?.recent ?? 0;

    // Top tags (unnest JSONB array)
    const tagsResult = await this.db.execute(sql`
      SELECT tag, count(*)::int as count
      FROM memories, jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) as tag
      WHERE ${memoryVisible()}
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `);
    const topTags = (tagsResult as any[]).map((r: any) => ({
      tag: r.tag,
      count: r.count,
    }));

    return { totalMemories, topTags, recentCount };
  }

  // ============================================================
  // Pending memory confirmation gate
  // ============================================================

  async getPendingMemories(limit = 20): Promise<MemoryResult[]> {
    const results = await this.db.execute(sql`
      SELECT id, content, type, importance, confidence, tags, source, created_at, scope
      FROM memories
      WHERE status = 'pending' AND ${NOT_HIDDEN}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return (results as any[]).map((r: any) => ({
      ...rowToMemoryResult(r),
      similarity: 1,
    }));
  }

  async getPendingCount(): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT count(*)::int as count FROM memories WHERE status = 'pending' AND ${NOT_HIDDEN}`
    );
    return (result as any[])[0]?.count ?? 0;
  }

  async confirmMemory(id: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE memories
      SET status = 'confirmed', updated_at = now()
      WHERE id = ${id} AND status = 'pending' AND ${NOT_HIDDEN}
    `);
    return affectedRows(result) > 0;
  }

  async rejectMemory(id: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE memories
      SET status = 'rejected', confidence = 0, updated_at = now()
      WHERE id = ${id} AND status = 'pending' AND ${NOT_HIDDEN}
    `);
    return affectedRows(result) > 0;
  }

  async autoConfirmOldPending(daysOld = 7): Promise<number> {
    // H3/MINJA (R3, Jun 3): AI-extracted-from-chat memories must NEVER be
    // promoted to `confirmed` on age alone — a backdated poisoned memory would
    // otherwise be surfaced by retrieve() as architect-stated fact. Gate on
    // provenance: the chat-extraction source value is `'extraction'` (the only
    // value the MemoryExtractor writes to memories.source — see extractor.ts:150
    // /:249). It requires an explicit human confirm; all other sources keep prior
    // behavior. NOTE (Jun 7 fix): the prior literal list also included
    // 'extract'/'extractSession' — but those are audit-METADATA labels
    // (extractor.ts:175/:267), NOT memory_source enum values, so the enum cast
    // threw `invalid input value for enum memory_source: "extract"` and aborted
    // the entire nightly synthesis cycle every run since Jun 4.
    const result = await this.db.execute(sql`
      UPDATE memories
      SET status = 'confirmed', updated_at = now()
      WHERE status = 'pending' AND ${NOT_HIDDEN}
        AND created_at < now() - ${daysOld + ' days'}::interval
        AND (source IS NULL OR source NOT IN ('extraction'))
    `);
    return affectedRows(result);
  }
}
