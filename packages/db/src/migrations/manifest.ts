// Ordered migration-manifest helpers.  Release tooling supplies the exact
// source bytes selected for a release; this module derives stable IDs and
// checksums without reading the live database.

import {
  createSchemaMigrationManifest,
  migrationIdFromPath,
  sha256Hex,
  type MigrationClassification,
  type SchemaMigration,
  type SchemaMigrationManifest,
} from "../schema-release.js";

export interface MigrationManifestSource {
  path: string;
  source: string | Uint8Array;
  classification?: MigrationClassification;
  rollback?: string | null;
  requiresOwnerApproval?: boolean;
}
export function buildOrderedMigrationManifest(
  releaseVersion: string,
  sources: MigrationManifestSource[],
  schemaFrom = 0,
): SchemaMigrationManifest {
  const entries: Array<Omit<SchemaMigration, "order">> = [...sources]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((source) => {
      const id = migrationIdFromPath(source.path);
      if (!id) throw new Error(`invalid migration manifest path: ${source.path}`);
      const classification = source.classification ?? "additive";
      return {
        id,
        path: source.path,
        checksum: sha256Hex(source.source),
        classification,
        rollback: source.rollback ?? null,
        requiresOwnerApproval: source.requiresOwnerApproval ?? classification === "destructive",
      };
    });
  return createSchemaMigrationManifest(releaseVersion, entries, schemaFrom);
}
