import { sql, type SQL } from "drizzle-orm";

function column(name: string, alias?: string): SQL {
  return alias ? sql`${sql.identifier(alias)}.${sql.identifier(name)}` : sql`${sql.identifier(name)}`;
}

/** Suppression applies even to operator review queues; history remains stored. */
export function memoryNotSuppressed(alias?: string): SQL {
  return sql`(
    ${column("forgotten_at", alias)} IS NULL
    AND NOT (COALESCE(${column("tags", alias)}, '[]'::jsonb) @> '["do-not-surface"]'::jsonb)
    AND (${column("expires_at", alias)} IS NULL OR ${column("expires_at", alias)} > now())
  )`;
}

/** Ordinary context and relationship evidence must also be confirmed. */
export function memoryVisible(alias?: string): SQL {
  return sql`(${memoryNotSuppressed(alias)} AND ${column("status", alias)} = 'confirmed')`;
}
