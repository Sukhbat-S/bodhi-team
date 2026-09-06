// ============================================================
// BODHI — Entity Service
// Track people, projects, topics linked to memories
// ============================================================

import { eq, desc, sql, and, or } from "drizzle-orm";
import { entities, entityMemories, memories } from "@seneca/db";
import type { Database } from "@seneca/db";
import { memoryNotSuppressed, memoryVisible } from "./visibility.js";

export type EntityType = "person" | "project" | "topic" | "organization" | "place";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  subtype: string | null;
  aliases: string[] | null;
  description: string | null;
  importance: number;
  mentionCount: number;
  status: "active" | "archived" | "hidden";
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface EntityWithRelations extends Entity {
  memories: Array<{
    id: string;
    content: string;
    type: string;
    importance: number;
    createdAt: Date;
    role: string | null;
  }>;
  relatedEntities: Array<Entity & { sharedMemoryCount: number }>;
}

export interface EntityGraphData {
  nodes: Array<Entity>;
  edges: Array<{
    sourceId: string;
    targetId: string;
    sharedMemoryCount: number;
  }>;
}

export interface MergeCandidateCluster {
  key: string;
  entities: Array<Pick<Entity, "id" | "name" | "type" | "mentionCount" | "lastSeenAt">>;
  totalMentions: number;
  kind: "exact_normalized" | "domain_suffix";
}

/**
 * Mongolian Cyrillic → simplified Latin map for de-duplication.
 * Lossy on purpose so Cyrillic and Latin spellings can converge.
 * Multi-char letters (е→ye, ё→yo, ю→yu, я→ya, х→kh, ц→ts, ч→ch, ш→sh)
 * are listed first so the replace pass catches them before single chars.
 */
const CYRILLIC_TO_LATIN: ReadonlyArray<readonly [string, string]> = [
  ["ё", "yo"], ["ю", "yu"], ["я", "ya"], ["х", "kh"],
  ["ц", "ts"], ["ч", "ch"], ["ш", "sh"], ["щ", "sh"],
  ["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"],
  ["е", "e"], ["ж", "j"], ["з", "z"], ["и", "i"], ["й", "i"],
  ["к", "k"], ["л", "l"], ["м", "m"], ["н", "n"], ["о", "o"],
  ["ө", "o"], ["п", "p"], ["р", "r"], ["с", "s"], ["т", "t"],
  ["у", "u"], ["ү", "u"], ["ф", "f"], ["ы", "y"], ["э", "e"],
  ["ъ", ""],  ["ь", ""],
];

/** Cyrillic → Latin, then drop common Latin diacritics (ü→u, ö→o, …). */
function transliterateMongolianCyrillic(s: string): string {
  let out = s;
  for (const [cyr, lat] of CYRILLIC_TO_LATIN) {
    out = out.split(cyr).join(lat);
  }
  // Strip remaining combining marks (NFD then remove diacritics)
  return out.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Canonical form used to match near-duplicate entity names.
 * Deliberately loose — we want to PROPOSE merges, not auto-apply. Users
 * still pick which name wins and can reject the suggestion.
 *
 * Cyrillic-aware so equivalent spellings can normalize to one key.
 */
export function normalizeEntityName(name: string): string {
  const lowered = name.toLowerCase().trim();
  const transliterated = transliterateMongolianCyrillic(lowered);
  return transliterated
    .replace(/["'`“”‘’]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip a trailing TLD-ish suffix. "example.com" → "example". */
function stripDomainSuffix(name: string): string {
  return name.replace(/\.(com|ai|app|io|org|net|dev|co|so)$/i, "");
}

/**
 * Names that refer to the local owner — these should never surface as
 * entities-to-look-at. The owner is the watcher,
 * not a thread. The extractor still creates rows for these (it's
 * cheaper than gating writes), but read-side queries filter them out.
 *
 * CANONICAL definition (BODHI master-plan spec #14). Server read-side
 * queries (`/api/entities/active`, `/api/memories/emerging-goals`)
 * import this array and interpolate it into their `LOWER(name) NOT IN
 * (...)` clauses instead of re-declaring the literal. The dashboard
 * copy (EmergingGoals.tsx) cannot import this Node package and keeps a
 * mirror with a sync comment.
 *
 * Owner names are read at call time because `.env` is loaded after module
 * imports. Transliterated cases are handled by `isSubjectEntity()`.
 */
export const SUBJECT_NAMES: readonly string[] = ["me", "i", "myself"];

export function configuredSubjectNames(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const ownerNames = [env.BODHI_OWNER_NAME, ...(env.BODHI_OWNER_ALIASES?.split(",") ?? [])]
    .map((name) => name?.trim().toLowerCase())
    .filter((name): name is string => Boolean(name));
  return [...new Set([...ownerNames, ...SUBJECT_NAMES])];
}

/** Returns true if this name refers to the subject of BODHI. */
export function isSubjectEntity(name: string): boolean {
  const normalized = new Set(configuredSubjectNames().map(normalizeEntityName));
  return normalized.has(normalizeEntityName(name));
}

/**
 * SQL fragment that excludes SUBJECT-class entities from a query.
 * Use as: `.where(sql`${notSubjectClause()}` AND ...)`.
 * Drizzle-friendly — uses NOT IN over the normalized list.
 */
function notSubjectSql(tableAlias = "entities") {
  const list = configuredSubjectNames();
  // We compare to LOWER(name) for simple cases; transliteration falls through to
  // app-side filtering on read since SQL-side normalize is over-engineering
  // for the small SUBJECT set.
  const literals = sql.join(
    list.map((n) => sql`${n}`),
    sql`, `,
  );
  return sql`LOWER(${sql.raw(`${tableAlias}.name`)}) NOT IN (${literals})`;
}

export class EntityService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async findOrCreate(
    name: string, type: EntityType, aliases?: string[], subtype?: string | null,
    options?: { distinctIdentity?: boolean },
  ): Promise<Entity> {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 500
      || !["person", "project", "topic", "organization", "place"].includes(type)) {
      throw new Error("A valid entity name and type are required");
    }
    if (aliases && (!Array.isArray(aliases) || aliases.length > 100 || aliases.some((alias) => typeof alias !== "string" || !alias.trim() || alias.length > 500))) {
      throw new Error("Entity aliases must be at most 100 nonempty names");
    }
    name = name.trim();
    const normalized = (value: string) => normalizeEntityName(stripDomainSuffix(value));
    const inputNames = new Set([name, ...aliases ?? []].map(normalized).filter(Boolean));
    if (!inputNames.size) throw new Error("Entity name must contain an identity");
    return this.db.transaction(async (tx) => {
      // One small substrate-wide identity lock also serializes intersecting
      // alias sets. A per-name lock would miss alias/name races.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-entity-identity'))`);
      const sameType = await tx.select().from(entities).where(eq(entities.type, type));
      const matches = sameType.filter((row) => [row.name, ...row.aliases ?? []].some((value) => inputNames.has(normalized(value))));
      if (!options?.distinctIdentity && matches.length > 1) {
        throw new Error("Entity identity is ambiguous; use an existing entity UUID or explicitly create a distinct identity");
      }
      const match = !options?.distinctIdentity ? matches[0] : undefined;
      if (match) {
        const combined = [...new Set([...(match.aliases ?? []), ...aliases ?? [], ...(match.name !== name ? [name] : [])])];
        const [updated] = await tx.update(entities).set({ aliases: combined, subtype: match.subtype ?? subtype ?? null, updatedAt: new Date() })
          .where(eq(entities.id, match.id)).returning();
        return this.toEntity(updated);
      }
      const [created] = await tx.insert(entities).values({ name, type, subtype: subtype ?? null, aliases: aliases ?? [] }).returning();
      return this.toEntity(created);
    });
  }

  async linkToMemory(
    entityId: string,
    memoryId: string,
    role?: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-entity-evidence'))`);
      // Serialize against correction/forget and refuse late links to suppressed
      // rows. Pending extraction links are permitted, but never surface as truth.
      const rows = await tx.execute(sql`
        SELECT id FROM memories WHERE id = ${memoryId}::uuid
          AND ${memoryNotSuppressed()} FOR UPDATE
      `);
      if (rows.length === 0) throw new Error("Memory is unavailable for linking");
      const inserted = await tx.insert(entityMemories)
        .values({ entityId, memoryId, role }).onConflictDoNothing()
        .returning({ id: entityMemories.id });
      if (inserted.length === 0) return;
      await tx.update(entities).set({
        mentionCount: sql`${entities.mentionCount} + 1`,
        lastSeenAt: new Date(), updatedAt: new Date(),
      }).where(eq(entities.id, entityId));
    });
  }

  async getEntity(id: string): Promise<EntityWithRelations | null> {
    const [entity] = await this.db
      .select()
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1);

    if (!entity) return null;

    // Get linked memories
    const linkedMemories = await this.db
      .select({
        id: memories.id,
        content: memories.content,
        type: memories.type,
        importance: memories.importance,
        createdAt: memories.createdAt,
        role: entityMemories.role,
      })
      .from(entityMemories)
      .innerJoin(memories, eq(entityMemories.memoryId, memories.id))
      .where(and(eq(entityMemories.entityId, id), memoryVisible("memories")))
      .orderBy(desc(memories.createdAt))
      .limit(50);

    // Get co-occurring entities (share memories with this entity)
    const coOccurring = await this.db.execute(sql`
      SELECT e.*, COUNT(DISTINCT em2.memory_id) as shared_memory_count
      FROM entities e
      JOIN entity_memories em2 ON em2.entity_id = e.id
      JOIN memories m ON m.id = em2.memory_id
      WHERE ${memoryVisible("m")} AND e.status = 'active' AND em2.memory_id IN (
        SELECT memory_id FROM entity_memories WHERE entity_id = ${id}
      )
      AND e.id != ${id}
      GROUP BY e.id
      ORDER BY shared_memory_count DESC
      LIMIT 20
    `);

    return {
      ...this.toEntity(entity),
      memories: linkedMemories.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
        importance: m.importance,
        createdAt: m.createdAt,
        role: m.role,
      })),
      relatedEntities: (coOccurring as any[]).map((r: any) => ({
        ...this.toEntity(r),
        sharedMemoryCount: Number(r.shared_memory_count),
      })),
    };
  }

  async list(
    opts: {
      type?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ entities: Entity[]; total: number }> {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;

    const conditions = [];
    // Exclude archived/hidden entities (extraction noise) from the list API,
    // which feeds the every-turn AI context via EntityContextProvider.
    conditions.push(eq(entities.status, "active"));
    if (opts.type) {
      conditions.push(eq(entities.type, opts.type));
    }
    if (opts.search) {
      conditions.push(sql`(
        name ILIKE ${"%" + opts.search + "%"} OR
        description ILIKE ${"%" + opts.search + "%"}
      )`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await this.db
      .select()
      .from(entities)
      .where(where)
      .orderBy(desc(entities.mentionCount))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(entities)
      .where(where);

    return {
      entities: results.map((r) => this.toEntity(r)),
      total: Number(count),
    };
  }

  async getGraph(opts?: { minMentions?: number; limit?: number }): Promise<EntityGraphData> {
    const minMentions = Math.max(1, opts?.minMentions ?? 1);
    const limit = Math.min(1000, Math.max(10, opts?.limit ?? 200));

    // Get entities above the mention-count threshold. SUBJECT-class
    // owner entities are filtered out — the owner is the
    // watcher, not a thread. Belt-and-suspenders: SQL filters the
    // simple Latin cases; app-side filter catches Cyrillic transliterations.
    const allEntitiesRaw = await this.db
      .select()
      .from(entities)
      .where(sql`mention_count >= ${minMentions} AND status = 'active' AND ${notSubjectSql("entities")}`)
      .orderBy(desc(entities.mentionCount))
      .limit(limit);
    const allEntities = allEntitiesRaw.filter((e) => !isSubjectEntity(e.name));

    if (allEntities.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Constrain edges to the node id set so we don't return orphan edges
    // whose endpoints were cut off by the LIMIT. Default shared-memory
    // threshold = 2 (drops single-memory incidentals that cause hairball on
    // dense graphs). Fall back to >= 1 if the graph is sparse (< 10 edges)
    // so new / small deployments don't render empty.
    //
    // Note: Drizzle's sql tag interpolates JS arrays as record tuples, not
    // Postgres arrays, so `ANY(${nodeIds}::uuid[])` errors with
    // "cannot cast type record to uuid[]". Use sql.join to build a
    // parameterized IN list instead.
    const nodeIds = allEntities.map((e) => e.id);
    const idList = sql.join(
      nodeIds.map((id) => sql`${id}::uuid`),
      sql`, `
    );

    const runEdgeQuery = (minShared: number) =>
      this.db.execute(sql`
        SELECT
          em1.entity_id as source_id,
          em2.entity_id as target_id,
          COUNT(DISTINCT em1.memory_id) as shared_memory_count
        FROM entity_memories em1
        JOIN entity_memories em2
          ON em1.memory_id = em2.memory_id
          AND em1.entity_id < em2.entity_id
        JOIN memories m ON m.id = em1.memory_id
        WHERE ${memoryVisible("m")} AND em1.entity_id IN (${idList})
          AND em2.entity_id IN (${idList})
        GROUP BY em1.entity_id, em2.entity_id
        HAVING COUNT(DISTINCT em1.memory_id) >= ${minShared}
        ORDER BY shared_memory_count DESC
        LIMIT 500
      `);

    let edges = await runEdgeQuery(2);
    if ((edges as any[]).length < 10) {
      edges = await runEdgeQuery(1);
    }

    return {
      nodes: allEntities.map((r) => this.toEntity(r)),
      edges: (edges as any[]).map((r: any) => ({
        sourceId: r.source_id,
        targetId: r.target_id,
        sharedMemoryCount: Number(r.shared_memory_count),
      })),
    };
  }

  async getEntityMemories(
    entityId: string,
    limit = 20
  ): Promise<Array<{
    id: string;
    content: string;
    type: string;
    importance: number;
    createdAt: Date;
    role: string | null;
  }>> {
    return this.db
      .select({
        id: memories.id,
        content: memories.content,
        type: memories.type,
        importance: memories.importance,
        createdAt: memories.createdAt,
        role: entityMemories.role,
      })
      .from(entityMemories)
      .innerJoin(memories, eq(entityMemories.memoryId, memories.id))
      .where(and(eq(entityMemories.entityId, entityId), memoryVisible("memories")))
      .orderBy(desc(memories.createdAt))
      .limit(limit);
  }

  async merge(keepId: string, mergeId: string): Promise<void> {
    await this.mergeCluster(keepId, [mergeId]);
  }

  /** One reviewed cluster is one atomic operation, including alias/link transfer. */
  async mergeCluster(keepId: string, mergeIds: string[]): Promise<{ keepId: string; mergedIds: string[]; linkedMemories: number }> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(keepId) || !Array.isArray(mergeIds) || mergeIds.length < 1 || mergeIds.length > 25
      || mergeIds.some((id) => typeof id !== "string" || !uuid.test(id) || id.toLowerCase() === keepId.toLowerCase())
      || new Set(mergeIds.map((id) => id.toLowerCase())).size !== mergeIds.length) {
      throw new Error("Merge requires one keeper and 1..25 distinct loser UUIDs");
    }
    keepId = keepId.toLowerCase();
    mergeIds = mergeIds.map((id) => id.toLowerCase());
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-entity-identity'))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-entity-evidence'))`);
      const ids = [keepId, ...mergeIds].sort();
      const rows = await tx.select().from(entities)
        .where(sql`${entities.id} IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`)
        .orderBy(entities.id).for("update");
      if (rows.length !== ids.length) throw new Error("Merge keeper or loser does not exist");
      const keeper = rows.find((row) => row.id === keepId)!;
      const losers = mergeIds.map((id) => rows.find((row) => row.id === id)!);
      for (const loser of losers) {
        await tx.execute(sql`
          INSERT INTO entity_memories (entity_id, memory_id, role, created_at)
          SELECT ${keepId}::uuid, memory_id, role, created_at FROM entity_memories WHERE entity_id = ${loser.id}::uuid
          ON CONFLICT (entity_id, memory_id) DO NOTHING
        `);
        await tx.delete(entities).where(eq(entities.id, loser.id));
      }
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(entityMemories)
        .where(eq(entityMemories.entityId, keepId));
      const aliases = [...new Set([...(keeper.aliases ?? []), ...losers.flatMap((row) => [row.name, ...row.aliases ?? []])])];
      await tx.update(entities).set({ aliases, mentionCount: Number(count), updatedAt: new Date() }).where(eq(entities.id, keepId));
      return { keepId, mergedIds: mergeIds, linkedMemories: Number(count) };
    });
  }

  /** Similar names are review candidates, never automatic identity decisions. */
  async listMergeCandidates(): Promise<MergeCandidateCluster[]> {
    const all = await this.db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        mentionCount: entities.mentionCount,
        lastSeenAt: entities.lastSeenAt,
      })
      .from(entities);

    // Group by normalized form
    const byKey = new Map<string, typeof all>();
    for (const e of all) {
      const key = normalizeEntityName(e.name);
      const list = byKey.get(key) ?? [];
      list.push(e);
      byKey.set(key, list);
    }

    const clusters: MergeCandidateCluster[] = [];
    const seenIds = new Set<string>();

    // Exact-normalized clusters (≥ 2 members)
    for (const [key, group] of byKey) {
      if (group.length < 2) continue;
      clusters.push({
        key,
        entities: group
          .map((g) => ({
            id: g.id,
            name: g.name,
            type: g.type as EntityType,
            mentionCount: g.mentionCount,
            lastSeenAt: g.lastSeenAt,
          }))
          .sort((a, b) => b.mentionCount - a.mentionCount),
        totalMentions: group.reduce((s, g) => s + g.mentionCount, 0),
        kind: "exact_normalized",
      });
      for (const g of group) seenIds.add(g.id);
    }

    // Domain-suffix pairs: for each entity with a TLD suffix, find a
    // non-suffixed twin. Only pair if the twin exists AND the pair isn't
    // already captured by an exact_normalized cluster.
    for (const e of all) {
      if (seenIds.has(e.id)) continue;
      const stripped = stripDomainSuffix(e.name);
      if (stripped === e.name) continue;
      const strippedKey = normalizeEntityName(stripped);
      const twins = (byKey.get(strippedKey) ?? []).filter((t) => t.id !== e.id);
      if (twins.length === 0) continue;
      clusters.push({
        key: strippedKey,
        entities: [e, ...twins]
          .map((g) => ({
            id: g.id,
            name: g.name,
            type: g.type as EntityType,
            mentionCount: g.mentionCount,
            lastSeenAt: g.lastSeenAt,
          }))
          .sort((a, b) => b.mentionCount - a.mentionCount),
        totalMentions: [e, ...twins].reduce((s, g) => s + g.mentionCount, 0),
        kind: "domain_suffix",
      });
      seenIds.add(e.id);
      for (const t of twins) seenIds.add(t.id);
    }

    return clusters.sort((a, b) => b.totalMentions - a.totalMentions);
  }

  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    recentlyActive: Entity[];
  }> {
    // All counts exclude archived rows (code-symbol noise) so the dashboard's
    // "N entities" label matches what the graph actually draws (active only).
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(entities)
      .where(eq(entities.status, "active"));

    const typeCounts = await this.db
      .select({
        type: entities.type,
        count: sql<number>`count(*)`,
      })
      .from(entities)
      .where(eq(entities.status, "active"))
      .groupBy(entities.type);

    const recent = await this.db
      .select()
      .from(entities)
      .where(eq(entities.status, "active"))
      .orderBy(desc(entities.lastSeenAt))
      .limit(10);

    const byType: Record<string, number> = {};
    for (const tc of typeCounts) {
      byType[tc.type] = Number(tc.count);
    }

    return {
      total: Number(count),
      byType,
      recentlyActive: recent.map((r) => this.toEntity(r)),
    };
  }

  async getRecentlyActive(days = 7, limit = 10): Promise<Entity[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const results = await this.db
      .select()
      .from(entities)
      .where(sql`last_seen_at >= ${since.toISOString()}`)
      .orderBy(desc(entities.mentionCount))
      .limit(limit);

    return results.map((r) => this.toEntity(r));
  }

  async update(
    id: string,
    data: { name?: string; description?: string; aliases?: string[]; type?: EntityType }
  ): Promise<Entity | null> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.aliases !== undefined) updates.aliases = data.aliases;
    if (data.type !== undefined) updates.type = data.type;

    const [result] = await this.db
      .update(entities)
      .set(updates)
      .where(eq(entities.id, id))
      .returning();

    return result ? this.toEntity(result) : null;
  }

  async remove(id: string): Promise<boolean> {
    await this.db.delete(entities).where(eq(entities.id, id));
    return true;
  }

  private toEntity(row: any): Entity {
    return {
      id: row.id,
      name: row.name,
      type: row.type as EntityType,
      subtype: row.subtype ?? null,
      aliases: row.aliases as string[] | null,
      description: row.description,
      importance: row.importance,
      mentionCount: row.mention_count ?? row.mentionCount ?? 0,
      status: row.status ?? "active",
      firstSeenAt: new Date(row.first_seen_at ?? row.firstSeenAt),
      lastSeenAt: new Date(row.last_seen_at ?? row.lastSeenAt),
      createdAt: new Date(row.created_at ?? row.createdAt),
    };
  }
}
