// ============================================================
// BODHI — system_audit (Phase 33 C1, May 25, 2026)
// Run via: npx tsx packages/db/src/migrations/apply-system-audit.ts
//
// Append-only audit trail of side-effecting tools. Stores hash + length
// + non-sensitive metadata; NEVER stores payload bytes. A future refactor
// that bypasses the redactor cannot leak — there's nothing to leak.
//
// Idempotent.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const db = getDb();
  console.log("[apply-system-audit] Connecting...");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS system_audit (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      actor TEXT NOT NULL,
      target TEXT,
      payload_hash TEXT,
      payload_length INTEGER,
      metadata JSONB,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `));
  console.log("[apply-system-audit] table ensured");

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS system_audit_kind_ts ON system_audit (kind, ts DESC);
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS system_audit_actor_ts ON system_audit (actor, ts DESC);
  `));
  console.log("[apply-system-audit] indexes ensured");

  console.log("[apply-system-audit] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-system-audit] FAILED:", err);
  process.exit(1);
});
