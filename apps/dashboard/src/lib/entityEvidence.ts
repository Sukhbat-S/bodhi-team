import type { DayMemoriesResponse, MemoryHistogramResponse } from "../api";
import type { MergeCluster } from "../components/entities/EntitiesRail";

export interface EntityRecord {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  mentionCount: number;
  importance: number;
  aliases: string[] | null;
  description: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

export interface EntityEdgeRecord {
  sourceId: string;
  targetId: string;
  sharedMemoryCount: number;
}

export interface EntityDetailRecord extends EntityRecord {
  memories: Array<{ id: string; content: string; type: string; importance: number; createdAt: string }>;
  relatedEntities: Array<EntityRecord & { sharedMemoryCount: number }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function validEntity(value: unknown): value is EntityRecord {
  if (!record(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.mentionCount === "number" &&
    Number.isFinite(value.mentionCount) &&
    typeof value.importance === "number" &&
    (value.aliases === null || (Array.isArray(value.aliases) && value.aliases.every((alias) => typeof alias === "string"))) &&
    stringOrNull(value.description) &&
    (value.subtype === undefined || stringOrNull(value.subtype)) &&
    (value.firstSeenAt === undefined || stringOrNull(value.firstSeenAt)) &&
    (value.lastSeenAt === undefined || stringOrNull(value.lastSeenAt))
  );
}

export function isEntityGraphResponse(value: unknown): value is { nodes: EntityRecord[]; edges: EntityEdgeRecord[] } {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
  return value.nodes.every(validEntity) && value.edges.every((edge) =>
    record(edge) &&
    typeof edge.sourceId === "string" &&
    typeof edge.targetId === "string" &&
    typeof edge.sharedMemoryCount === "number" &&
    Number.isFinite(edge.sharedMemoryCount),
  );
}

export function isEntityStatsResponse(value: unknown): value is { total: number; byType: Record<string, number> } {
  if (!record(value) || typeof value.total !== "number" || !record(value.byType)) return false;
  return Object.values(value.byType).every((count) => typeof count === "number" && Number.isFinite(count));
}

export function isEntityDetailResponse(value: unknown, expectedId: string): value is EntityDetailRecord {
  if (!validEntity(value) || value.id !== expectedId || !record(value)) return false;
  if (!Array.isArray(value.memories) || !Array.isArray(value.relatedEntities)) return false;
  return value.memories.every((memory) =>
    record(memory) &&
    typeof memory.id === "string" &&
    typeof memory.content === "string" &&
    typeof memory.type === "string" &&
    typeof memory.importance === "number" &&
    typeof memory.createdAt === "string",
  ) && value.relatedEntities.every((entity) =>
    validEntity(entity) && typeof (entity as unknown as Record<string, unknown>).sharedMemoryCount === "number",
  );
}

export function isMergeCandidatesResponse(value: unknown): value is { clusters: MergeCluster[] } {
  if (!record(value) || !Array.isArray(value.clusters)) return false;
  return value.clusters.every((cluster) =>
    record(cluster) &&
    typeof cluster.key === "string" &&
    (cluster.kind === "exact_normalized" || cluster.kind === "domain_suffix") &&
    typeof cluster.totalMentions === "number" &&
    Array.isArray(cluster.entities) &&
    cluster.entities.every((entity) =>
      record(entity) &&
      typeof entity.id === "string" &&
      typeof entity.name === "string" &&
      typeof entity.type === "string" &&
      typeof entity.mentionCount === "number" &&
      stringOrNull(entity.lastSeenAt),
    ),
  );
}

export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isMemoryHistogramResponse(value: unknown): value is MemoryHistogramResponse & { timeZone: string } {
  if (!record(value) || !Array.isArray(value.days) || !isIanaTimeZone(value.timeZone)) return false;
  return value.days.every((day) =>
    record(day) && /^\d{4}-\d{2}-\d{2}$/.test(String(day.day)) &&
    typeof day.count === "number" && Number.isFinite(day.count) && day.count >= 0,
  );
}

export function isDayMemoriesResponse(value: unknown, date: string, timeZone: string): value is DayMemoriesResponse {
  if (!record(value) || !Array.isArray(value.memories)) return false;
  if (value.date !== undefined && value.date !== date) return false;
  if (value.timeZone !== timeZone) return false;
  return value.memories.every((memory) =>
    record(memory) &&
    typeof memory.id === "string" &&
    typeof memory.content === "string" &&
    typeof memory.type === "string" &&
    typeof memory.importance === "number" &&
    typeof memory.createdAt === "string" &&
    Array.isArray(memory.entities) &&
    memory.entities.every((entity) =>
      record(entity) && typeof entity.id === "string" && typeof entity.name === "string" && typeof entity.type === "string",
    ),
  );
}

export function dayKeyInTimeZone(value: Date | string, timeZone: string): string | null {
  if (!isIanaTimeZone(timeZone)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function timeInTimeZone(value: string, timeZone: string): string {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(date.getTime()) || !isIanaTimeZone(timeZone)) return "—:—";
  return date.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
}
