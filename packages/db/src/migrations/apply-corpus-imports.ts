// BODHI reviewed private-corpus import receipts.
// Run via:
//   npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-corpus-imports.ts

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS corpus_imports (
  packet_id text PRIMARY KEY,
  owner_name text NOT NULL,
  assistant_name text NOT NULL,
  content_hash text NOT NULL,
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  source_metadata jsonb NOT NULL,
  file_manifest jsonb NOT NULL,
  imported_counts jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corpus_imports_hash_chk CHECK (length(content_hash) = 64)
);
`;

const INDEX_DDL = `
CREATE INDEX IF NOT EXISTS corpus_imports_owner_imported_idx
  ON corpus_imports (owner_name, imported_at DESC);
`;

async function main(): Promise<void> {
  const db = getDb();
  await db.execute(sql.raw(TABLE_DDL));
  await db.execute(sql.raw(INDEX_DDL));
  console.log("[corpus-imports-migration] receipt table and index ensured");
  process.exit(0);
}

main().catch((error) => {
  console.error("[corpus-imports-migration] FAILED:", error);
  process.exit(1);
});
