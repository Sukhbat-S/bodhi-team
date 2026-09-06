// ============================================================
// BODHI — Entity `status` lifecycle tier (entity-extraction noise fix, Jun 9)
// Run via:  npx tsx scripts/verified-migrate.ts \
//             packages/db/src/migrations/apply-entities-status.ts
//
// The LLM entity extractor captured ~241/728 `topic` entities that are code
// symbols (React component names, .tsx files, packages, model IDs, ENV
// constants). They pollute the entity graph AND the every-turn AI context
// (entity-provider.ts injects an unfiltered list). This column adds a lifecycle
// tier so retrieval/graph/list can exclude `archived` rows WITHOUT deleting
// them — reversible, auditable.
//
// Additive + idempotent (enum guarded by duplicate_object; column by
// IF NOT EXISTS). Designed to pass scripts/verified-migrate.ts' additive gate.
// The row backfill that flips noise rows to 'archived' is a SEPARATE,
// architect-approved UPDATE (scripts/archive-code-symbol-entities.ts --apply)
// — it is non-additive and intentionally NOT part of this migration.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const STATUS_ENUM_DDL = `
DO $$ BEGIN
  CREATE TYPE entity_status AS ENUM ('active', 'archived', 'hidden');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
`;

const ADD_COLUMN_DDL = `
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS status entity_status NOT NULL DEFAULT 'active';
`;

async function main() {
  const db = getDb();
  console.log("[apply-entities-status] Connecting to DB...");

  await db.execute(sql.raw(STATUS_ENUM_DDL));
  console.log("[apply-entities-status] entity_status enum ensured (active | archived | hidden)");

  await db.execute(sql.raw(ADD_COLUMN_DDL));
  console.log("[apply-entities-status] status column ensured (default 'active')");

  console.log("[apply-entities-status] Done.");
  console.log("");
  console.log("Next: existing rows all default to 'active'. The code-symbol archive");
  console.log("(topic entities matching isCodeSymbol -> archived) is a SEPARATE");
  console.log("architect-approved UPDATE — scripts/archive-code-symbol-entities.ts --apply.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-entities-status] FAILED:", err);
  process.exit(1);
});
