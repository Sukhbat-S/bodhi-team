// BODHI — ordered PostgreSQL schema-release authority
//
// This module deliberately keeps the release contract and migration state
// machine independent from postgres-js.  The executable migration runner can
// provide a real database adapter, while tests and release validation use the
// same code with an empty in-memory fixture.  No function in this module opens
// a connection or performs a filesystem backup by itself.

import { createHash } from "node:crypto";

export const SCHEMA_RELEASE_FORMAT = 1 as const;
export const MIGRATION_OUTCOMES = ["applied", "skipped", "failed"] as const;
export type MigrationOutcome = (typeof MIGRATION_OUTCOMES)[number];
export type MigrationClassification = "additive" | "reversible" | "destructive";

export interface SchemaMigration {
  /** 1-based position in the release's ordered migration plan. */
  order: number;
  /** Stable identifier; changing it creates a new migration. */
  id: string;
  /** Repository-relative path to the migration source. */
  path: string;
  /** SHA-256 of the exact source bytes shipped in the release. */
  checksum: string;
  classification: MigrationClassification;
  /** A human-readable rollback procedure, or null for additive migrations. */
  rollback: string | null;
  /** Destructive changes never run through the automatic release path. */
  requiresOwnerApproval: boolean;
}

export interface SchemaMigrationManifest {
  formatVersion: typeof SCHEMA_RELEASE_FORMAT;
  releaseVersion: string;
  schemaFrom: number;
  schemaTo: number;
  migrations: SchemaMigration[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MIGRATION_ID = /^[a-z0-9][a-z0-9._-]*$/;
const MIGRATION_PATH = /^packages\/db\/src\/migrations\/apply-[a-z0-9][a-z0-9_-]*\.ts$/;

export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function migrationIdFromPath(path: string): string | null {
  const match = /^packages\/db\/src\/migrations\/(apply-[a-z0-9][a-z0-9_-]*)\.ts$/.exec(path);
  return match?.[1] ?? null;
}

export function validateSchemaMigrationManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["schema migration manifest must be an object"];
  if (value.formatVersion !== SCHEMA_RELEASE_FORMAT) errors.push("formatVersion must be 1");
  if (typeof value.releaseVersion !== "string" || !VERSION.test(value.releaseVersion)) {
    errors.push("releaseVersion must be semantic version text");
  }
  if (!Number.isInteger(value.schemaFrom) || (value.schemaFrom as number) < 0) errors.push("schemaFrom must be a non-negative integer");
  if (!Number.isInteger(value.schemaTo) || (value.schemaTo as number) < 0) errors.push("schemaTo must be a non-negative integer");
  if (Number.isInteger(value.schemaFrom) && Number.isInteger(value.schemaTo) && (value.schemaTo as number) < (value.schemaFrom as number)) {
    errors.push("schema range must be ordered");
  }
  if (!Array.isArray(value.migrations)) {
    errors.push("migrations must be an array");
    return errors;
  }

  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const [index, candidate] of value.migrations.entries()) {
    const prefix = `migrations[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const expectedOrder = index + 1;
    if (candidate.order !== expectedOrder) errors.push(`${prefix}.order must be ${expectedOrder}`);
    if (typeof candidate.id !== "string" || !MIGRATION_ID.test(candidate.id)) {
      errors.push(`${prefix}.id is invalid`);
    } else if (seenIds.has(candidate.id)) {
      errors.push(`${prefix}.id is duplicated`);
    } else {
      seenIds.add(candidate.id);
    }
    if (typeof candidate.path !== "string" || !MIGRATION_PATH.test(candidate.path)) {
      errors.push(`${prefix}.path is not an allowed migration path`);
    } else if (seenPaths.has(candidate.path)) {
      errors.push(`${prefix}.path is duplicated`);
    } else {
      seenPaths.add(candidate.path);
      const derivedId = migrationIdFromPath(candidate.path);
      if (typeof candidate.id === "string" && derivedId !== candidate.id) errors.push(`${prefix}.id does not match path`);
    }
    if (typeof candidate.checksum !== "string" || !SHA256.test(candidate.checksum)) errors.push(`${prefix}.checksum must be lowercase SHA-256`);
    if (!["additive", "reversible", "destructive"].includes(String(candidate.classification))) errors.push(`${prefix}.classification is invalid`);
    if (!(candidate.rollback === null || typeof candidate.rollback === "string")) errors.push(`${prefix}.rollback must be text or null`);
    if (candidate.classification === "reversible" && (typeof candidate.rollback !== "string" || !candidate.rollback.trim())) {
      errors.push(`${prefix} reversible migration needs rollback`);
    }
    if (typeof candidate.requiresOwnerApproval !== "boolean") errors.push(`${prefix}.requiresOwnerApproval must be boolean`);
    if (candidate.classification === "destructive" && candidate.requiresOwnerApproval !== true) {
      errors.push(`${prefix} destructive migration requires owner approval`);
    }
  }
  if (Number.isInteger(value.schemaFrom) && Number.isInteger(value.schemaTo) &&
      (value.schemaTo as number) - (value.schemaFrom as number) !== value.migrations.length) {
    errors.push("schema range must equal the ordered migration count");
  }
  return errors;
}

export function createSchemaMigrationManifest(
  releaseVersion: string,
  migrations: Array<Omit<SchemaMigration, "order">>,
  schemaFrom = 0,
): SchemaMigrationManifest {
  const manifest: SchemaMigrationManifest = {
    formatVersion: SCHEMA_RELEASE_FORMAT,
    releaseVersion,
    schemaFrom,
    schemaTo: schemaFrom + migrations.length,
    migrations: migrations.map((migration, index) => ({ ...migration, order: index + 1 })),
  };
  const errors = validateSchemaMigrationManifest(manifest);
  if (errors.length) throw new Error(`invalid schema migration manifest: ${errors.join("; ")}`);
  return manifest;
}

export interface SchemaEvidence {
  /** Stable schema fingerprint captured from the live database. */
  fingerprint: string;
  /** Exact count(*) values for existing base tables. */
  rowCounts: ReadonlyMap<string, number>;
  /** Optional object-key set used to prove that no existing object vanished. */
  objectKeys?: ReadonlySet<string>;
  capturedAt?: string;
  /** Whole-row multiset fingerprints, used to verify exact rollback state. */
  dataFingerprints?: ReadonlyMap<string, string>;
}

export interface BackupEvidence {
  /** Opaque local backup path or receipt identifier; never a secret. */
  reference: string;
  createdAt: string;
  /** SHA-256 of the exact backup artifact bytes. */
  checksum: string;
}

export function validateBackupEvidence(value: unknown): string[] {
  if (!isRecord(value)) return ["backup evidence must be an object"];
  const errors: string[] = [];
  if (typeof value.reference !== "string" || !value.reference.trim()) errors.push("backup reference is required");
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) errors.push("backup createdAt must be an ISO timestamp");
  if (typeof value.checksum !== "string" || !SHA256.test(value.checksum)) errors.push("backup checksum must be lowercase SHA-256");
  return errors;
}

export interface SchemaMigrationLedgerRecord {
  migrationId: string;
  checksum: string;
  appliedAt: string;
  releaseVersion: string;
  outcome: MigrationOutcome;
  backupReference?: string;
  backupChecksum?: string;
  beforeFingerprint?: string;
  afterFingerprint?: string;
  beforeRowCounts?: Record<string, number>;
  afterRowCounts?: Record<string, number>;
  error?: string;
}

export interface SchemaMigrationLedger {
  ensure(): Promise<void>;
  latest(migrationId: string): Promise<SchemaMigrationLedgerRecord | null>;
  append(record: SchemaMigrationLedgerRecord): Promise<void>;
}

export interface SchemaMigrationRuntime {
  /** Reviewed schema baseline; adapters for live execution must supply it. */
  expectedBeforeFingerprint?: string;
  verifyBackup(backup: BackupEvidence): Promise<void>;
  backup(): Promise<BackupEvidence>;
  snapshot(): Promise<SchemaEvidence>;
  run(migration: SchemaMigration): Promise<void>;
  /** Restore the pre-migration backup after a failed run or failed evidence gate. */
  restore(backup: BackupEvidence): Promise<void>;
}

export interface MigrationExecutionResult {
  status: "applied" | "skipped";
  migrationId: string;
  backup?: BackupEvidence;
  before?: SchemaEvidence;
  after?: SchemaEvidence;
  replay?: SchemaEvidence;
}

/**
 * PostgreSQL DDL for the durable migration ledger.  There is one append-only
 * row per attempt.  `latest()` selects the newest attempt, which means a
 * failed migration remains visible while a later same-checksum retry can
 * succeed without erasing the failure evidence.
 */
export const BODHI_SCHEMA_MIGRATIONS_DDL = `
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
ALTER TABLE bodhi_schema_migrations
  ADD COLUMN IF NOT EXISTS backup_checksum char(64);
`;

export function ledgerRecordForFailure(
  migration: SchemaMigration,
  releaseVersion: string,
  error: unknown,
  backup?: BackupEvidence,
  before?: SchemaEvidence,
  after?: SchemaEvidence,
): SchemaMigrationLedgerRecord {
  return makeLedgerRecord(migration, releaseVersion, "failed", backup, before, after, errorMessage(error));
}

export async function executeSchemaMigration(
  migration: SchemaMigration,
  releaseVersion: string,
  ledger: SchemaMigrationLedger,
  runtime: SchemaMigrationRuntime,
): Promise<MigrationExecutionResult> {
  // Validate the migration's shape independently of its position in the
  // release. The full release manifest enforces order 1..N; wrapping an order
  // 2+ entry as a one-item manifest would incorrectly require order=1.
  const manifestErrors = validateSchemaMigrationManifest({
    formatVersion: SCHEMA_RELEASE_FORMAT,
    releaseVersion,
    schemaFrom: 0,
    schemaTo: 1,
    migrations: [{ ...migration, order: 1 }],
  }).filter((error) => !error.includes("schema range must equal"));
  if (manifestErrors.length) throw new Error(`invalid migration: ${manifestErrors.join("; ")}`);
  if (migration.classification === "destructive" || migration.requiresOwnerApproval) {
    throw new Error(`migration ${migration.id} is owner-approval gated`);
  }

  const baseline = await runtime.snapshot();
  if (runtime.expectedBeforeFingerprint && baseline.fingerprint !== runtime.expectedBeforeFingerprint) {
    throw new Error("live schema differs from the declared migration baseline");
  }
  await ledger.ensure();
  const previous = await ledger.latest(migration.id);
  // A migration ID always binds immutable bytes, including a failed attempt.
  // A correction uses a new ID and preserves the original failure evidence.
  if (previous && previous.checksum !== migration.checksum) {
    throw new Error(`migration ${migration.id} checksum mismatch: ledger has ${previous.checksum}, release has ${migration.checksum}`);
  }
  if (previous?.outcome === "applied" || previous?.outcome === "skipped") {
    await ledger.append({
      migrationId: migration.id,
      checksum: migration.checksum,
      appliedAt: new Date().toISOString(),
      releaseVersion,
      outcome: "skipped",
      ...(previous.backupReference ? { backupReference: previous.backupReference } : {}),
      ...(previous.backupChecksum ? { backupChecksum: previous.backupChecksum } : {}),
      beforeFingerprint: baseline.fingerprint, afterFingerprint: baseline.fingerprint,
      beforeRowCounts: rowCountsObject(baseline.rowCounts), afterRowCounts: rowCountsObject(baseline.rowCounts),
    });
    return { status: "skipped", migrationId: migration.id };
  }

  let backup: BackupEvidence | undefined;
  let before: SchemaEvidence | undefined;
  let after: SchemaEvidence | undefined;
  try {
    backup = await runtime.backup();
    const backupErrors = validateBackupEvidence(backup);
    if (backupErrors.length) throw new Error(`invalid backup evidence: ${backupErrors.join("; ")}`);
    await runtime.verifyBackup(backup);
    before = await runtime.snapshot();
    await runtime.run(migration);
    after = await runtime.snapshot();
    await runtime.run(migration);
    const replay = await runtime.snapshot();
    const evidenceErrors = verifySchemaEvidence(before, after, replay);
    if (evidenceErrors.length) throw new Error(evidenceErrors.join("; "));
    await ledger.append(makeLedgerRecord(migration, releaseVersion, "applied", backup, before, after));
    return { status: "applied", migrationId: migration.id, backup, before, after, replay };
  } catch (error) {
    // Restore is best effort but is attempted for every failure after backup;
    // the original failure is retained in the ledger and surfaced to the caller.
    if (backup) {
      try {
        await runtime.verifyBackup(backup);
        await runtime.restore(backup);
        const restored = await runtime.snapshot();
        if (!before || restored.fingerprint !== before.fingerprint
          || JSON.stringify(rowCountsObject(restored.rowCounts)) !== JSON.stringify(rowCountsObject(before.rowCounts))
          || (before.dataFingerprints && JSON.stringify([...restored.dataFingerprints ?? []].sort()) !== JSON.stringify([...before.dataFingerprints].sort()))) {
          throw new Error("rollback readback differs from the pre-migration schema or data");
        }
      } catch (restoreError) {
        error = new Error(`${errorMessage(error)}; rollback failed: ${errorMessage(restoreError)}`);
      }
    }
    await ledger.append(ledgerRecordForFailure(migration, releaseVersion, error, backup, before, after));
    throw error;
  }
}

export function verifySchemaEvidence(before: SchemaEvidence, after: SchemaEvidence, replay: SchemaEvidence): string[] {
  const errors: string[] = [];
  if (after.fingerprint !== replay.fingerprint) errors.push("schema fingerprint changed during idempotent replay");
  const schemaLoss = (left: SchemaEvidence, right: SchemaEvidence, phase: string): void => {
    if (!left.objectKeys || !right.objectKeys) return;
    const destroyed = [...left.objectKeys].filter((key) => !right.objectKeys!.has(key)).sort();
    if (destroyed.length) errors.push(`${phase}: schema objects removed: ${destroyed.join(", ")}`);
  };
  const rowLoss = (left: SchemaEvidence, right: SchemaEvidence, phase: string): void => {
    for (const [table, count] of left.rowCounts) {
      const rightCount = right.rowCounts.get(table);
      if (rightCount !== undefined && rightCount < count) errors.push(`${phase}: ${table}: ${count} → ${rightCount} rows (data loss)`);
    }
  };
  schemaLoss(before, after, "migration");
  schemaLoss(after, replay, "idempotent replay");
  rowLoss(before, after, "migration");
  rowLoss(after, replay, "idempotent replay");
  return errors;
}

export function rowCountsObject(counts: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function makeLedgerRecord(
  migration: SchemaMigration,
  releaseVersion: string,
  outcome: MigrationOutcome,
  backup?: BackupEvidence,
  before?: SchemaEvidence,
  after?: SchemaEvidence,
  error?: string,
): SchemaMigrationLedgerRecord {
  return {
    migrationId: migration.id,
    checksum: migration.checksum,
    appliedAt: new Date().toISOString(),
    releaseVersion,
    outcome,
    ...(backup ? { backupReference: backup.reference } : {}),
    ...(backup ? { backupChecksum: backup.checksum } : {}),
    ...(before ? { beforeFingerprint: before.fingerprint, beforeRowCounts: rowCountsObject(before.rowCounts) } : {}),
    ...(after ? { afterFingerprint: after.fingerprint, afterRowCounts: rowCountsObject(after.rowCounts) } : {}),
    ...(error ? { error } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
