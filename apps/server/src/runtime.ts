// BODHI pure-substrate composition root.
//
// Native Codex tasks own reasoning and execution. This process owns only
// durable state, policy, checkpoints, audit receipts, and deterministic
// maintenance. Keeping model clients out of this file makes that boundary
// structural rather than dependent on an environment flag.

import { sql } from "drizzle-orm";
import { getDb } from "@seneca/db";
import { EntityService, InsightGenerator, MemoryService } from "@seneca/memory";
import { LibraryService } from "@seneca/library";
import { Scheduler } from "@seneca/scheduler";
import { loadConfig } from "./config.js";
import { createAuditService } from "./lib/audit.js";
import { SystemEventsService } from "./services/system-events.js";
import { createTrustTiersService } from "./services/trust-tiers.js";

export async function createRuntime() {
  console.log("🌳  BODHI substrate starting...\n");

  const config = loadConfig();
  console.log(`  Environment: ${config.NODE_ENV}`);
  console.log(`  Port: ${config.PORT}`);
  console.log("  Reasoning: native Codex only (no server-side model runtime)");

  const db = getDb(config.DATABASE_URL);
  console.log("  Database: connected");

  async function keepAlive() {
    try {
      await db.execute(sql`SELECT 1`);
      console.log("[keepalive] database ping OK");
    } catch (error) {
      console.error("[keepalive] database ping failed:", error);
    }
  }

  const systemEvents = new SystemEventsService(db);
  const trustTiersService = createTrustTiersService();
  const audit = createAuditService(db);

  const memoryService = new MemoryService(db, config.VOYAGE_API_KEY, audit);
  const entityService = new EntityService(db);
  const insightGenerator = new InsightGenerator(memoryService);
  const libraryService = new LibraryService(db, config.VOYAGE_API_KEY);

  try {
    const index = await libraryService.index(null);
    console.log(
      index.totals.chunks > 0
        ? `  Library: ${index.totals.domains} domain(s), ${index.totals.sources} source(s), ${index.totals.chunks} chunks (explicit retrieval only)`
        : "  Library: empty",
    );
  } catch (error) {
    console.warn("  Library: unavailable at boot:", error instanceof Error ? error.message : error);
  }

  const scheduler = new Scheduler({
    timezone: config.TIMEZONE,
    systemEvents,
  });
  console.log("  Scheduler: deterministic substrate maintenance only");

  return {
    config,
    db,
    systemEvents,
    trustTiersService,
    audit,
    memoryService,
    entityService,
    insightGenerator,
    libraryService,
    scheduler,
    keepAlive,
  };
}

export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
