// BODHI — schema migration ledger bootstrap
//
// Explicit, additive, idempotent bootstrap for fresh databases. The verified
// runner also ensures this table before a release migration so an upgrade from
// an older installation can adopt the ledger without a separate manual step.

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS bodhi_schema_migrations (
  migration_id text NOT NULL,
  checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  release_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied', 'skipped', 'failed')),
  backup_reference text,
  backup_checksum char(64),
  before_fingerprint text,
  after_fingerprint text,
  before_row_counts jsonb,
  after_row_counts jsonb,
  error text,
  PRIMARY KEY (migration_id, applied_at)
);
CREATE INDEX IF NOT EXISTS bodhi_schema_migrations_latest_idx
  ON bodhi_schema_migrations (migration_id, applied_at DESC);
`;

async function main(): Promise<void> {
  const db = getDb();
  await db.execute(sql.raw(LEDGER_DDL));
  console.log("[apply-schema-migrations-ledger] ledger ensured");
}

main().catch((error) => {
  console.error("[apply-schema-migrations-ledger] FAILED:", error);
  process.exit(1);
});
