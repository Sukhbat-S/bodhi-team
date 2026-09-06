import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import type { MemoryService } from "@seneca/memory";
import { NATIVE_CODEX_REASONING } from "../services/reasoning.js";

export interface HealthRoutesDeps {
  db: Database;
  memoryService: MemoryService;
}

/** Health probes verify emitted substrate signals and never invoke a model. */
export function mountHealthRoutes(app: Hono, deps: HealthRoutesDeps): Hono {
  const { db, memoryService } = deps;

  app.get("/health", async (c) => {
    try {
      await db.execute(sql`SELECT 1`);
      return c.json({ status: "healthy", db: "connected", reasoning: NATIVE_CODEX_REASONING, uptime: process.uptime() });
    } catch {
      return c.json({ status: "unhealthy", db: "disconnected", reasoning: NATIVE_CODEX_REASONING, uptime: process.uptime() }, 503);
    }
  });

  app.get("/__smoke", async (c) => {
    const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};

    const databaseStartedAt = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = { ok: true, ms: Date.now() - databaseStartedAt };
    } catch (error) {
      checks.database = { ok: false, error: error instanceof Error ? error.message : "unknown" };
    }

    const memoryStartedAt = Date.now();
    try {
      const stats = await memoryService.getStats();
      checks.memory = { ok: typeof stats.totalMemories === "number", ms: Date.now() - memoryStartedAt };
    } catch (error) {
      checks.memory = { ok: false, error: error instanceof Error ? error.message : "unknown" };
    }

    const ok = Object.values(checks).every((check) => check.ok);
    return c.json({ ok, architecture: "pure-substrate", checks }, ok ? 200 : 503);
  });

  return app;
}
