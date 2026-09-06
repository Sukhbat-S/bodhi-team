// ============================================================
// BODHI — additive project-scoped checkpoint provider bindings
//
// Existing checkpoint_provider_refs rows remain readable compatibility data.
// All new bindings use this table so one native task can preserve independent
// checkpoints for multiple explicitly scoped projects without rewriting or
// backfilling existing rows.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS work_checkpoints_id_project_uidx
  ON work_checkpoints (id, project_key);

CREATE TABLE IF NOT EXISTS checkpoint_project_provider_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL,
  project_key text NOT NULL,
  provider text NOT NULL,
  native_task_id text NOT NULL,
  host_id text,
  working_directory text,
  task_url text,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkpoint_project_provider_refs_checkpoint_project_fkey
    FOREIGN KEY (checkpoint_id, project_key)
    REFERENCES work_checkpoints (id, project_key) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_project_provider_refs_native_project_uidx
  ON checkpoint_project_provider_refs (provider, native_task_id, project_key);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_project_provider_refs_primary_provider_uidx
  ON checkpoint_project_provider_refs (checkpoint_id, provider) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS checkpoint_project_provider_refs_checkpoint_idx
  ON checkpoint_project_provider_refs (checkpoint_id);
`;

async function main() {
  const db = getDb();
  console.log("[checkpoint-project-provider-refs] Connecting to DB...");
  await db.execute(sql.raw(DDL));
  console.log("[checkpoint-project-provider-refs] project-scoped bindings ensured");
  console.log("[checkpoint-project-provider-refs] Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[checkpoint-project-provider-refs] FAILED:", error);
  process.exit(1);
});
