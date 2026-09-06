// ============================================================
// BODHI — Additive migration: session_messages durable queue columns
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-session-messages-queue-cols.ts
//
// Phase 1a of the cross-session coordination build. Extends session_messages
// from a fire-and-forget broadcast log into a durable, dedup'd, ack'd message
// queue (clawdaemon-pattern). Five additive columns with safe defaults so
// every existing row stays valid:
//   - content_hash    SHA-256 dedup key (nullable; legacy rows get NULL)
//   - kind            taxonomy: broadcast | claim | stop | wip (default 'broadcast')
//   - acknowledged    consumed-flag (default false)
//   - acknowledged_at timestamp the message was ack'd (nullable)
//   - expires_at      TTL, set on insert by Phase 1b (nullable)
//
// Idempotent + additive-only (ADD COLUMN IF NOT EXISTS). Designed to pass
// scripts/verified-migrate.ts' additive gate. No backfill, no DROP, no
// ALTER TYPE, no RENAME. Server routes + the reaper land in Phase 1b.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const COLUMNS_DDL = `
ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'broadcast';
ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS acknowledged boolean NOT NULL DEFAULT false;
ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS expires_at timestamptz;
`;

async function main() {
  const db = getDb();
  console.log("[session-messages-queue-cols-migration] Connecting to DB...");
  await db.execute(sql.raw(COLUMNS_DDL));
  console.log("[session-messages-queue-cols-migration] columns ensured: content_hash, kind, acknowledged, acknowledged_at, expires_at");
  console.log("[session-messages-queue-cols-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[session-messages-queue-cols-migration] FAILED:", err);
  process.exit(1);
});
