export { getDb, closeDb, type Database } from "./client.js";
export * from "./schema/index.js";
export {
  openStateDb,
  _closeStateDb,
  withWriteRetry,
  type RetryOpts,
} from "./state-db.js";
export {
  runStateMigrations,
  getStateDbVersion,
} from "./state-migrations/runner.js";
export {
  BODHI_SCHEMA_MIGRATIONS_DDL,
  SCHEMA_RELEASE_FORMAT,
  MIGRATION_OUTCOMES,
  createSchemaMigrationManifest,
  executeSchemaMigration,
  ledgerRecordForFailure,
  migrationIdFromPath,
  rowCountsObject,
  sha256Hex,
  validateSchemaMigrationManifest,
  validateBackupEvidence,
  verifySchemaEvidence,
  type BackupEvidence,
  type MigrationClassification,
  type MigrationExecutionResult,
  type MigrationOutcome,
  type SchemaEvidence,
  type SchemaMigration,
  type SchemaMigrationLedger,
  type SchemaMigrationLedgerRecord,
  type SchemaMigrationManifest,
  type SchemaMigrationRuntime,
} from "./schema-release.js";
export {
  buildOrderedMigrationManifest,
  type MigrationManifestSource,
} from "./migrations/manifest.js";
