import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { entities, entityMemories, memories, personalGoals, type Database } from "@seneca/db";
import { normalizeEntityName, type EntityType } from "./entity-service.js";

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const ENTITY_TYPES = new Set<EntityType>(["person", "project", "topic", "organization", "place"]);
const MEMORY_TYPES = new Set(["fact", "decision", "pattern", "preference", "event", "goal"] as const);
const GOAL_STATUSES = new Set(["active", "paused", "completed", "abandoned"] as const);

export class FoundationImportValidationError extends Error {}
export class FoundationImportConflictError extends Error {}

export interface ReviewedFoundationPacket {
  schemaVersion: 1;
  packetId: string;
  owner: { name: string; aliases: string[] };
  assistant: { name: string };
  review: { reviewedBy: string; reviewedAt: string; approvedCompletePrivateImport: true };
  source: { kind: string; reference: string; capturedAt: string; note?: string };
  entities: Array<{
    key: string;
    name: string;
    type: EntityType;
    realityStatus?: "real" | "fictional" | "hypothetical" | "uncertain" | "unknown";
    aliases?: string[];
    subtype?: string;
    description?: string;
    importance?: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
    evidenceMentionCount?: number;
  }>;
  memories: Array<{
    key: string;
    type: "fact" | "decision" | "pattern" | "preference" | "event" | "goal";
    content: string;
    importance?: number;
    tags?: string[];
    entityKeys?: string[];
  }>;
  goals: Array<{
    key: string;
    projectKey: string;
    title: string;
    outcome: string;
    successCriteria?: string[];
    constraints?: string[];
    priority?: number;
    status?: "active" | "paused" | "completed" | "abandoned";
    targetDate?: string | null;
  }>;
}

export interface FoundationImportEnvironment {
  ownerName: string;
  ownerAliases: string[];
  assistantName: string;
}

export interface FoundationImportResult {
  packetId: string;
  contentHash: string;
  applied: boolean;
  counts: { entities: number; memories: number; entityLinks: number; goals: number };
  items: { entities: Record<string, string>; memories: Record<string, string>; goals: Record<string, string> };
}

type Embedder = (texts: string[]) => Promise<number[][]>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationImportValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], required: string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new FoundationImportValidationError(`${field}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!(key in value)) throw new FoundationImportValidationError(`${field}.${key} is required`);
  }
}

function text(value: unknown, field: string, max = 20_000): string {
  if (typeof value !== "string" || !value.trim()) throw new FoundationImportValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new FoundationImportValidationError(`${field} exceeds ${max} characters`);
  return normalized;
}

function key(value: unknown, field: string): string {
  const normalized = text(value, field, 120);
  if (!KEY_RE.test(normalized)) throw new FoundationImportValidationError(`${field} is invalid`);
  return normalized;
}

function stringArray(value: unknown, field: string, maxItems = 100, maxItem = 2_000): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new FoundationImportValidationError(`${field} must be an array of at most ${maxItems} items`);
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maxItem));
  if (new Set(result.map((item) => item.toLocaleLowerCase())).size !== result.length) {
    throw new FoundationImportValidationError(`${field} contains duplicates`);
  }
  return result;
}

function isoDate(value: unknown, field: string): string {
  const normalized = text(value, field, 100);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(normalized)) {
    throw new FoundationImportValidationError(`${field} must be an ISO date`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new FoundationImportValidationError(`${field} must be an ISO date`);
  return parsed.toISOString();
}

function optionalScore(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new FoundationImportValidationError(`${field} must be a number from 0 to 1`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new FoundationImportValidationError(`${field} must be a non-negative integer`);
  }
  return Number(value);
}

function uniqueItemKeys(items: Array<{ key: string }>, field: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) throw new FoundationImportValidationError(`${field} contains duplicate key ${item.key}`);
    seen.add(item.key);
  }
}

export function validateReviewedFoundationPacket(value: unknown): ReviewedFoundationPacket {
  const root = record(value, "packet");
  exactKeys(root, ["schemaVersion", "packetId", "owner", "assistant", "review", "source", "entities", "memories", "goals"], ["schemaVersion", "packetId", "owner", "assistant", "review", "source", "entities", "memories", "goals"], "packet");
  if (root.schemaVersion !== 1) throw new FoundationImportValidationError("packet.schemaVersion must be 1");

  const owner = record(root.owner, "packet.owner");
  exactKeys(owner, ["name", "aliases"], ["name", "aliases"], "packet.owner");
  const assistant = record(root.assistant, "packet.assistant");
  exactKeys(assistant, ["name"], ["name"], "packet.assistant");
  const review = record(root.review, "packet.review");
  exactKeys(review, ["reviewedBy", "reviewedAt", "approvedCompletePrivateImport"], ["reviewedBy", "reviewedAt", "approvedCompletePrivateImport"], "packet.review");
  if (review.approvedCompletePrivateImport !== true) {
    throw new FoundationImportValidationError("packet.review.approvedCompletePrivateImport must be true");
  }
  const source = record(root.source, "packet.source");
  exactKeys(source, ["kind", "reference", "capturedAt", "note"], ["kind", "reference", "capturedAt"], "packet.source");

  if (!Array.isArray(root.entities) || root.entities.length > 100) throw new FoundationImportValidationError("packet.entities must be an array of at most 100 items");
  const parsedEntities = root.entities.map((raw, index) => {
    const item = record(raw, `packet.entities[${index}]`);
    exactKeys(item, ["key", "name", "type", "realityStatus", "aliases", "subtype", "description", "importance", "firstSeenAt", "lastSeenAt", "evidenceMentionCount"], ["key", "name", "type"], `packet.entities[${index}]`);
    if (!ENTITY_TYPES.has(item.type as EntityType)) throw new FoundationImportValidationError(`packet.entities[${index}].type is invalid`);
    const firstSeenAt = item.firstSeenAt === undefined ? undefined : isoDate(item.firstSeenAt, `packet.entities[${index}].firstSeenAt`);
    const lastSeenAt = item.lastSeenAt === undefined ? undefined : isoDate(item.lastSeenAt, `packet.entities[${index}].lastSeenAt`);
    if (firstSeenAt && lastSeenAt && new Date(firstSeenAt).getTime() > new Date(lastSeenAt).getTime()) {
      throw new FoundationImportValidationError(`packet.entities[${index}].firstSeenAt must be before or equal to lastSeenAt`);
    }
    return {
      key: key(item.key, `packet.entities[${index}].key`),
      name: text(item.name, `packet.entities[${index}].name`, 500),
      type: item.type as EntityType,
      realityStatus: item.realityStatus === undefined ? undefined : (() => { const value = text(item.realityStatus, `packet.entities[${index}].realityStatus`, 40) as ReviewedFoundationPacket["entities"][number]["realityStatus"]; if (!["real", "fictional", "hypothetical", "uncertain", "unknown"].includes(value!)) throw new FoundationImportValidationError(`packet.entities[${index}].realityStatus is invalid`); return value; })(),
      aliases: stringArray(item.aliases, `packet.entities[${index}].aliases`, 50, 500),
      subtype: item.subtype === undefined ? undefined : text(item.subtype, `packet.entities[${index}].subtype`, 200),
      description: item.description === undefined ? undefined : text(item.description, `packet.entities[${index}].description`, 2_000),
      importance: optionalScore(item.importance, `packet.entities[${index}].importance`),
      firstSeenAt,
      lastSeenAt,
      evidenceMentionCount: optionalNonNegativeInteger(item.evidenceMentionCount, `packet.entities[${index}].evidenceMentionCount`),
    };
  });
  uniqueItemKeys(parsedEntities, "packet.entities");

  if (!Array.isArray(root.memories) || root.memories.length > 250) throw new FoundationImportValidationError("packet.memories must be an array of at most 250 items");
  const entityKeys = new Set(parsedEntities.map((item) => item.key));
  const parsedMemories = root.memories.map((raw, index) => {
    const item = record(raw, `packet.memories[${index}]`);
    exactKeys(item, ["key", "type", "content", "importance", "tags", "entityKeys"], ["key", "type", "content"], `packet.memories[${index}]`);
    if (!MEMORY_TYPES.has(item.type as never)) throw new FoundationImportValidationError(`packet.memories[${index}].type is invalid`);
    const refs = stringArray(item.entityKeys, `packet.memories[${index}].entityKeys`, 25, 120);
    for (const ref of refs) if (!entityKeys.has(ref)) throw new FoundationImportValidationError(`packet.memories[${index}] references unknown entity ${ref}`);
    return {
      key: key(item.key, `packet.memories[${index}].key`),
      type: item.type as ReviewedFoundationPacket["memories"][number]["type"],
      content: text(item.content, `packet.memories[${index}].content`),
      importance: optionalScore(item.importance, `packet.memories[${index}].importance`),
      tags: stringArray(item.tags, `packet.memories[${index}].tags`, 50, 200),
      entityKeys: refs,
    };
  });
  uniqueItemKeys(parsedMemories, "packet.memories");

  if (!Array.isArray(root.goals) || root.goals.length > 50) throw new FoundationImportValidationError("packet.goals must be an array of at most 50 items");
  const parsedGoals = root.goals.map((raw, index) => {
    const item = record(raw, `packet.goals[${index}]`);
    exactKeys(item, ["key", "projectKey", "title", "outcome", "successCriteria", "constraints", "priority", "status", "targetDate"], ["key", "projectKey", "title", "outcome"], `packet.goals[${index}]`);
    const priority = item.priority === undefined ? 3 : item.priority;
    if (!Number.isInteger(priority) || Number(priority) < 1 || Number(priority) > 5) throw new FoundationImportValidationError(`packet.goals[${index}].priority must be an integer from 1 to 5`);
    const status = item.status === undefined ? "active" : item.status;
    if (!GOAL_STATUSES.has(status as never)) throw new FoundationImportValidationError(`packet.goals[${index}].status is invalid`);
    let targetDate: string | null | undefined;
    if (item.targetDate === null) targetDate = null;
    else if (item.targetDate !== undefined) targetDate = isoDate(item.targetDate, `packet.goals[${index}].targetDate`);
    return {
      key: key(item.key, `packet.goals[${index}].key`),
      projectKey: text(item.projectKey, `packet.goals[${index}].projectKey`, 500),
      title: text(item.title, `packet.goals[${index}].title`, 500),
      outcome: text(item.outcome, `packet.goals[${index}].outcome`),
      successCriteria: stringArray(item.successCriteria, `packet.goals[${index}].successCriteria`, 50),
      constraints: stringArray(item.constraints, `packet.goals[${index}].constraints`, 50),
      priority: Number(priority),
      status: status as ReviewedFoundationPacket["goals"][number]["status"],
      targetDate,
    };
  });
  uniqueItemKeys(parsedGoals, "packet.goals");

  const packet: ReviewedFoundationPacket = {
    schemaVersion: 1,
    packetId: key(root.packetId, "packet.packetId"),
    owner: { name: text(owner.name, "packet.owner.name", 500), aliases: stringArray(owner.aliases, "packet.owner.aliases", 50, 500) },
    assistant: { name: text(assistant.name, "packet.assistant.name", 500) },
    review: { reviewedBy: text(review.reviewedBy, "packet.review.reviewedBy", 500), reviewedAt: isoDate(review.reviewedAt, "packet.review.reviewedAt"), approvedCompletePrivateImport: true },
    source: { kind: text(source.kind, "packet.source.kind", 200), reference: text(source.reference, "packet.source.reference", 2_000), capturedAt: isoDate(source.capturedAt, "packet.source.capturedAt"), ...(source.note === undefined ? {} : { note: text(source.note, "packet.source.note", 2_000) }) },
    entities: parsedEntities,
    memories: parsedMemories,
    goals: parsedGoals,
  };
  return packet;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(item).sort().map((name) => [name, stable(item[name])]));
  }
  return value;
}

export function foundationPacketHash(packet: ReviewedFoundationPacket): string {
  return createHash("sha256").update(JSON.stringify(stable(packet))).digest("hex");
}

function unionEntityAliases(canonicalName: string, existing: unknown, candidateName: string, candidateAliases: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>([normalizeEntityName(canonicalName)]);
  for (const alias of [
    ...(Array.isArray(existing) ? existing.filter((value): value is string => typeof value === "string") : []),
    candidateName,
    ...candidateAliases,
  ]) {
    const normalized = normalizeEntityName(alias);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(alias);
  }
  return result;
}

function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLocaleLowerCase()));
}

export function assertFoundationEnvironment(packet: ReviewedFoundationPacket, environment: FoundationImportEnvironment): void {
  if (packet.owner.name !== environment.ownerName.trim()) {
    throw new FoundationImportValidationError(`packet owner ${packet.owner.name} does not match installation owner ${environment.ownerName.trim()}`);
  }
  if (packet.assistant.name !== environment.assistantName.trim()) {
    throw new FoundationImportValidationError(`packet assistant ${packet.assistant.name} does not match installation assistant ${environment.assistantName.trim()}`);
  }
  const installedAliases = lowerSet(environment.ownerAliases);
  for (const alias of packet.owner.aliases) {
    if (!installedAliases.has(alias.toLocaleLowerCase())) throw new FoundationImportValidationError(`packet owner alias ${alias} is not configured on this installation`);
  }
  const subjectNames = lowerSet([environment.ownerName, ...environment.ownerAliases]);
  for (const entity of packet.entities) {
    if (subjectNames.has(entity.name.toLocaleLowerCase()) || entity.aliases?.some((alias) => subjectNames.has(alias.toLocaleLowerCase()))) {
      throw new FoundationImportValidationError(`owner subject must not be imported as entity ${entity.key}`);
    }
    if (entity.name.toLocaleLowerCase() === environment.assistantName.trim().toLocaleLowerCase()) {
      throw new FoundationImportValidationError(`assistant must not be imported as entity ${entity.key}`);
    }
  }
}

export async function importReviewedFoundation(
  db: Database,
  packetInput: unknown,
  environment: FoundationImportEnvironment,
  embedder: Embedder,
): Promise<FoundationImportResult> {
  const packet = validateReviewedFoundationPacket(packetInput);
  assertFoundationEnvironment(packet, environment);
  const contentHash = foundationPacketHash(packet);

  const prior = await db.execute(sql`
    SELECT content_hash AS "contentHash", imported_counts AS counts, imported_items AS items
    FROM foundation_imports WHERE packet_id = ${packet.packetId} LIMIT 1
  `) as unknown as Array<{ contentHash: string; counts: FoundationImportResult["counts"]; items: FoundationImportResult["items"] }>;
  if (prior[0]) {
    if (prior[0].contentHash !== contentHash) throw new FoundationImportConflictError(`packet ${packet.packetId} already exists with a different content hash`);
    return { packetId: packet.packetId, contentHash, applied: false, counts: prior[0].counts, items: prior[0].items };
  }

  const embeddings = await embedder(packet.memories.map((item) => item.content));
  if (embeddings.length !== packet.memories.length || embeddings.some((item) => !Array.isArray(item) || item.length !== 1024 || item.some((value) => !Number.isFinite(value)))) {
    throw new FoundationImportValidationError("embedder must return one finite 1024-dimension vector per memory");
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${packet.packetId}))`);
    const lockedPrior = await tx.execute(sql`
      SELECT content_hash AS "contentHash", imported_counts AS counts, imported_items AS items
      FROM foundation_imports WHERE packet_id = ${packet.packetId} LIMIT 1
    `) as unknown as Array<{ contentHash: string; counts: FoundationImportResult["counts"]; items: FoundationImportResult["items"] }>;
    if (lockedPrior[0]) {
      if (lockedPrior[0].contentHash !== contentHash) throw new FoundationImportConflictError(`packet ${packet.packetId} already exists with a different content hash`);
      return { packetId: packet.packetId, contentHash, applied: false, counts: lockedPrior[0].counts, items: lockedPrior[0].items };
    }

    const items: FoundationImportResult["items"] = { entities: {}, memories: {}, goals: {} };
    let createdEntities = 0;
    for (const entity of packet.entities) {
      const aliases = entity.aliases ?? [];
      // Compare the full identity set in both directions. The former SQL path
      // checked candidate.name against existing.name/aliases, but missed the
      // common case where candidate.alias matched an existing primary name.
      // That created duplicate canonical rows during reviewed corpus imports.
      const identity = new Set([entity.name, ...aliases].map(normalizeEntityName));
      const existing = await tx.execute(sql`
        SELECT id::text AS id, name, type, aliases, subtype, description, importance,
               mention_count AS "mentionCount", first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
        FROM entities ORDER BY created_at, id
      `) as unknown as Array<{
        id: string;
        name: string;
        type: EntityType;
        aliases: unknown;
        subtype: string | null;
        description: string | null;
        importance: number;
        mentionCount: number;
        firstSeenAt: Date | null;
        lastSeenAt: Date | null;
      }>;
      const match = existing.find((candidate) => {
        if (candidate.type !== entity.type) return false;
        const candidateAliases = Array.isArray(candidate.aliases)
          ? candidate.aliases.filter((value): value is string => typeof value === "string")
          : [];
        return [candidate.name, ...candidateAliases]
          .map(normalizeEntityName)
          .some((name) => identity.has(name));
      });
      let id = match?.id;
      if (!id) {
        const created = await tx.insert(entities).values({
          name: entity.name,
          type: entity.type,
          aliases,
          subtype: entity.subtype ?? null,
          description: entity.description ?? null,
          importance: entity.importance ?? 0.5,
          ...(entity.firstSeenAt ? { firstSeenAt: new Date(entity.firstSeenAt) } : {}),
          ...(entity.lastSeenAt ? { lastSeenAt: new Date(entity.lastSeenAt) } : {}),
          ...(entity.evidenceMentionCount !== undefined ? { mentionCount: entity.evidenceMentionCount } : {}),
        }).returning({ id: entities.id });
        id = created[0].id;
        createdEntities += 1;
      } else {
        if (!match) throw new FoundationImportValidationError(`entity ${entity.key} could not be resolved after matching`);
        const mergedAliases = unionEntityAliases(match.name, match.aliases, entity.name, aliases);
        const firstSeenAt = entity.firstSeenAt ? sql`LEAST(first_seen_at, ${entity.firstSeenAt}::timestamptz)` : sql`first_seen_at`;
        const lastSeenAt = entity.lastSeenAt ? sql`GREATEST(last_seen_at, ${entity.lastSeenAt}::timestamptz)` : sql`last_seen_at`;
        await tx.execute(sql`
          UPDATE entities
          SET aliases = ${JSON.stringify(mergedAliases)}::jsonb,
              subtype = COALESCE(subtype, ${entity.subtype ?? null}),
              description = COALESCE(description, ${entity.description ?? null}),
              importance = GREATEST(importance, ${entity.importance ?? 0.5}),
              mention_count = GREATEST(mention_count, ${entity.evidenceMentionCount ?? 0}),
              first_seen_at = ${firstSeenAt},
              last_seen_at = ${lastSeenAt},
              updated_at = now()
          WHERE id = ${id}::uuid
        `);
      }
      items.entities[entity.key] = id;
    }

    let entityLinks = 0;
    for (const [index, memory] of packet.memories.entries()) {
      const tags = [...new Set([...(memory.tags ?? []), "foundation", `foundation-import:${packet.packetId}`])];
      const created = await tx.insert(memories).values({
        type: memory.type,
        content: memory.content,
        embedding: embeddings[index],
        source: "manual",
        importance: memory.importance ?? 0.7,
        tags,
        status: "confirmed",
        scope: "foundational",
      }).returning({ id: memories.id });
      const memoryId = created[0].id;
      items.memories[memory.key] = memoryId;
      for (const entityKey of memory.entityKeys ?? []) {
        const entityId = items.entities[entityKey];
        await tx.insert(entityMemories).values({ entityId, memoryId, role: "related" }).onConflictDoNothing();
        // Reviewed packets already carry the authoritative evidence count and
        // first/last-seen dates on their entity definitions. Linking the
        // packet's context/relationship memories must not make historical
        // evidence look newly mentioned at import time or double-count it.
        entityLinks += 1;
      }
    }

    for (const goal of packet.goals) {
      const created = await tx.insert(personalGoals).values({
        projectKey: goal.projectKey,
        title: goal.title,
        outcome: goal.outcome,
        successCriteria: goal.successCriteria ?? [],
        constraints: goal.constraints ?? [],
        priority: goal.priority ?? 3,
        status: goal.status ?? "active",
        targetDate: goal.targetDate ? new Date(goal.targetDate) : null,
        observationScopes: [],
        completedAt: goal.status === "completed" ? new Date() : null,
      }).returning({ id: personalGoals.id });
      items.goals[goal.key] = created[0].id;
    }

    const counts = { entities: createdEntities, memories: packet.memories.length, entityLinks, goals: packet.goals.length };
    await tx.execute(sql`
      INSERT INTO foundation_imports (
        packet_id, owner_name, assistant_name, content_hash, reviewed_by,
        reviewed_at, source_metadata, imported_items, imported_counts
      ) VALUES (
        ${packet.packetId}, ${packet.owner.name}, ${packet.assistant.name}, ${contentHash},
        ${packet.review.reviewedBy}, ${packet.review.reviewedAt}::timestamptz,
        ${JSON.stringify(packet.source)}::jsonb, ${JSON.stringify(items)}::jsonb,
        ${JSON.stringify(counts)}::jsonb
      )
    `);
    return { packetId: packet.packetId, contentHash, applied: true, counts, items };
  });
}
