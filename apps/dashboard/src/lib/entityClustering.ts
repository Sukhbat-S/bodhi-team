export type EntityCluster = "pastWeek" | "pastMonth" | "pastYear" | "older";

export interface ClusterableEntity {
  name: string;
  type: string;
  mentionCount: number;
  lastSeenAt?: string | null;
}

const DAY_MS = 86_400_000;

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function clusterFor(entity: ClusterableEntity, now = Date.now()): EntityCluster {
  const seenAt = timestamp(entity.lastSeenAt);
  if (!Number.isFinite(seenAt)) return "older";
  const days = Math.max(0, (now - seenAt) / DAY_MS);
  if (days <= 7) return "pastWeek";
  if (days <= 30) return "pastMonth";
  if (days <= 365) return "pastYear";
  return "older";
}

/**
 * Group by literal recency, then sort by stored last-seen timestamp, mention
 * count, type and name. No inferred priority or subtype weighting participates.
 */
export function groupByCluster<T extends ClusterableEntity>(
  entities: T[],
  now = Date.now(),
): { cluster: EntityCluster; entities: T[] }[] {
  const buckets: Record<EntityCluster, T[]> = {
    pastWeek: [],
    pastMonth: [],
    pastYear: [],
    older: [],
  };

  for (const entity of entities) buckets[clusterFor(entity, now)].push(entity);

  const compare = (a: T, b: T) =>
    timestamp(b.lastSeenAt) - timestamp(a.lastSeenAt) ||
    b.mentionCount - a.mentionCount ||
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name);
  for (const cluster of Object.keys(buckets) as EntityCluster[]) buckets[cluster].sort(compare);

  const order: EntityCluster[] = ["pastWeek", "pastMonth", "pastYear", "older"];
  return order.filter((cluster) => buckets[cluster].length > 0).map((cluster) => ({
    cluster,
    entities: buckets[cluster],
  }));
}

export const CLUSTER_LABEL: Record<EntityCluster, string> = {
  pastWeek: "seen in past 7 days",
  pastMonth: "seen 8–30 days ago",
  pastYear: "seen 31–365 days ago",
  older: "older or date unavailable",
};

export const CLUSTER_DESCRIPTION: Record<EntityCluster, string> = {
  pastWeek: "newest first, then mentions",
  pastMonth: "newest first, then mentions",
  pastYear: "newest first, then mentions",
  older: "known dates first, then mentions",
};
