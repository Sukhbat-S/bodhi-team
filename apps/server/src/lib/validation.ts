import type { Context } from "hono";

/**
 * Canonical UUID v-agnostic shape guard. A `:id` param that feeds a Postgres
 * `uuid` column otherwise reaches the query and throws `invalid input syntax
 * for type uuid`, surfacing as a generic 500 instead of a clean client 400.
 * Shared UUID guard for retained substrate routes.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard a route param at the top of a handler:
 *   const bad = badUuid(c, id); if (bad) return bad;
 * Returns a 400 Response when `id` is not a UUID, else null (proceed).
 */
export function badUuid(c: Context, id: string): Response | null {
  return UUID_RE.test(id) ? null : c.json({ error: "invalid id (UUID expected)" }, 400);
}
