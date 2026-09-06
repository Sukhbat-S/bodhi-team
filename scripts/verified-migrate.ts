// ============================================================
// BODHI — Verified autonomous additive-migration runner
// Run via: npx tsx scripts/verified-migrate.ts <path-to-apply-*.ts>
//
// The verified-autonomous-execution proof-of-concept (May 30, 2026).
// docs/DECISION-LOAD-AUDIT-MAY30.md: the one execution slice where the
// architect's load is real (the manual `npx tsx apply-X.ts` keystroke),
// the authority already exists (`apply_supabase_migration_self_authored`
// is auto-do), and a CONCRETE, AUTOMATABLE verification gate makes
// autonomy safe. Autonomy is safe exactly to the degree it is verified.
//
// SCOPE / THREAT MODEL (honest, post bodhi-security May 30). This gate makes
// autonomy safe ONLY for a CONSTRAINED file shape: a migration in
// packages/db/src/migrations/apply-*.ts that imports only the boilerplate
// (dotenv/client/drizzle), runs no arbitrary code, and issues literal additive
// SQL. It is NOT a sandbox for untrusted or free-form TypeScript — a static
// scan cannot bound what arbitrary executed code does. The path allowlist +
// CODE_FORBIDDEN denylist + import allowlist enforce that shape so the SQL-token
// gate is meaningful. If migrations ever come from a lower-trust source than the
// architect's own hand, replace this with a SQL-aware parser over `.sql` files.
//
// The gate. A migration is auto-applied ONLY if ALL pass:
//   1. STATIC: path is an allowlisted apply-*.ts; no arbitrary-code primitives
//      (child_process/exec/eval/require/dynamic-import/fetch/fs-write/template
//      interpolation); imports allowlisted; ZERO destructive SQL tokens
//      (DROP <obj>/TRUNCATE/DELETE/UPDATE..SET/ALTER..DROP/lossy ALTER TYPE/
//      GRANT/REVOKE/EXECUTE/drizzle-kit/RENAME); ≥1 additive shape present.
//      Scanned over COMMENT-STRIPPED source. Any miss → HARD HALT.
//   2. RUN: execute the migration once (must exit 0).
//   3. IDEMPOTENT: re-run; assert the schema fingerprint is byte-identical
//      across the two runs (the second run changed nothing — proves the
//      IF-NOT-EXISTS guards hold).
//   3.5 NO-DESTRUCTION (a real safety boundary, added May 30 per bodhi-security;
//      coverage extended Jun 4): diff the BEFORE→AFTER schema SETs; if ANY
//      existing table/column/enum-label/INDEX/CONSTRAINT/POLICY/FUNCTION/TRIGGER/
//      SEQUENCE is gone, a DROP slipped past the lexical gate (string-concat /
//      runtime-assembled DDL) → HALT. Inspects the actual DB delta, not source
//      text, so it is obfuscation-proof. (Jun 4: previously diffed only
//      tables/columns/enum-labels — a runtime-assembled DROP INDEX/CONSTRAINT/
//      POLICY left those three identical and passed. Now all object classes.)
//   3.6 DATA-PRESERVATION (the row boundary, added Jun 4 per bodhi-security):
//      a DELETE/TRUNCATE/UPDATE leaves every schema SET identical, so 3.5 is
//      blind to it. Snapshot per-table count(*) and HALT if any table present
//      both before+after LOST rows. DB-delta, obfuscation-proof.
//   4. CONFIRM: every object the DDL declares (table/column/type) is now
//      present in information_schema.
//   5. NO drizzle-kit: never invoked (also hard-blocked in db/package.json).
//
// Mutating runs require an immutable manifest, declared schema baseline, and
// verified private backup. Failed runs restore and compare schema/data readback;
// any mismatch remains an explicit rollback failure.
// ============================================================

import "dotenv/config";
import { chmodSync, readFileSync, existsSync, openSync, closeSync, lstatSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getDb, closeDb } from "@seneca/db";
import {
  BODHI_SCHEMA_MIGRATIONS_DDL,
  executeSchemaMigration,
  migrationIdFromPath,
  sha256Hex,
  validateSchemaMigrationManifest,
  type BackupEvidence,
  type SchemaMigration,
  type SchemaMigrationLedger,
  type SchemaMigrationLedgerRecord,
  type SchemaMigrationRuntime,
  type SchemaEvidence as ReleaseSchemaEvidence,
} from "@seneca/db";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { databaseFingerprint, postgresEnvironment, runPostgres } from "./lib/postgres-backup.js";

// ---- TS compiler API (the structural top-level gate, R4 Jun 4) ----
// The top-level "inert" decision is made by AST node TYPE, never by regex. The
// hand-rolled brace/string tokenizer (R2) was bypassed AGAIN by R3 (a tagged-
// template laundered through a declaration RHS — `const q = fetch`http://x``),
// because a tokenizer can't see that the RHS is a TaggedTemplateExpression. The
// red-team verdict was explicit: "the hand-rolled tokenizer will keep losing
// this arms race shape-by-shape" → the fix is STRUCTURAL. We parse the migration
// as a module and walk its MODULE-SCOPE statements with the real TS parser.
//
// `typescript` is a dev dependency, resolvable from the repo root (verified
// `require.resolve('typescript')` → node_modules/typescript, v5.9.3). We load it
// lazily through createRequire so that — in the unlikely event it is ever NOT
// resolvable — staticGate falls back to the tightened regex tokenizer rather
// than throwing. The AST path is the real boundary; the regex is the floor.
let _ts: typeof import("typescript") | null | undefined;
function loadTs(): typeof import("typescript") | null {
  if (_ts !== undefined) return _ts;
  try {
    const req = createRequire(import.meta.url);
    _ts = req("typescript") as typeof import("typescript");
  } catch {
    _ts = null;
  }
  return _ts;
}

// Destructive / non-additive tokens. Presence of ANY → hard halt.
// Scanned against the whole source (conservative: a script that even
// mentions these stays architect-run). Word-boundary anchored.
// Destructive / non-additive SQL token shapes. Scanned over comment-stripped
// source. (bodhi-security May 30: denylist over executed TS can never be sound
// on its own — see CODE_FORBIDDEN + IMPORT allowlist + path allowlist below,
// which together constrain the file to literal-SQL additive migrations.)
const FORBIDDEN: { re: RegExp; label: string }[] = [
  { re: /\bDROP\s+TABLE\b/i, label: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, label: "DROP COLUMN" },
  { re: /\bDROP\s+(TYPE|INDEX|SCHEMA|VIEW|MATERIALIZED|FUNCTION|TRIGGER|POLICY|SEQUENCE|DATABASE|ROLE|CONSTRAINT|EXTENSION)\b/i, label: "DROP <object>" },
  { re: /\bTRUNCATE\b/i, label: "TRUNCATE" },
  { re: /\bDELETE\s+FROM\b/i, label: "DELETE FROM" },
  { re: /\bUPDATE\b[\s\S]{0,80}\bSET\b/i, label: "UPDATE ... SET (alias-proof)" },
  { re: /\bALTER\s+[\s\S]{0,40}\bDROP\b/i, label: "ALTER ... DROP" },
  { re: /\bALTER\s+(TABLE\s+\S+\s+)?ALTER\s+COLUMN\b[\s\S]{0,60}\bTYPE\b/i, label: "ALTER COLUMN ... TYPE (lossy cast)" },
  { re: /\b(GRANT|REVOKE)\b/i, label: "GRANT/REVOKE" },
  // SQL dynamic EXECUTE (always whitespace-then-target); NOT the JS `db.execute(` method.
  { re: /(?<![.\w])EXECUTE\s/i, label: "EXECUTE (dynamic SQL)" },
  { re: /\bdrizzle-kit\b/i, label: "drizzle-kit" },
  { re: /\bRENAME\s+(TO|COLUMN)\b/i, label: "RENAME (non-additive)" },
  // ---- Additive-only DML/DDL denylist (finding #25, Jun 4) ----
  // Defense-in-depth ONLY — a lexical denylist over executed TS is NOT sound
  // (runtime string assembly always defeats it; that is why GATE 3.6 row-counts
  // are the real data-preservation boundary). These fast-fail the obvious
  // non-additive shapes an additive schema migration never legitimately needs:
  // data writes (INSERT/COPY/MERGE — backfills route to run_data_backfill_update
  // = await), and side-effecting object creation the schema-set/row-count diffs
  // cannot fully model (functions/procedures/triggers, SECURITY DEFINER).
  { re: /\bINSERT\s+INTO\b/i, label: "INSERT INTO (data write — backfills are await-tier)" },
  { re: /\bCOPY\b/i, label: "COPY (incl FROM PROGRAM — OS-command primitive)" },
  { re: /\bMERGE\b/i, label: "MERGE (data write)" },
  { re: /\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|RULE|EVENT\s+TRIGGER|AGGREGATE)\b/i, label: "CREATE FUNCTION/PROCEDURE/TRIGGER/RULE (side-effecting object)" },
  { re: /\bCREATE\s+OR\s+REPLACE\b/i, label: "CREATE OR REPLACE (mutates an existing object in place)" },
  { re: /\bSECURITY\s+DEFINER\b/i, label: "SECURITY DEFINER (privilege-escalation surface)" },
];

// Arbitrary-code primitives — a migration must be DECLARATIVE SQL, never run
// shell/network/dynamic code. Any hit hard-halts (closes the RCE class: an
// additive token in a comment no longer launders `execSync(...)`).
const CODE_FORBIDDEN: { re: RegExp; label: string }[] = [
  { re: /\bchild_process\b/, label: "child_process" },
  { re: /\b(execSync|execFileSync|exec|spawnSync|spawn|fork)\s*\(/, label: "process spawn" },
  { re: /\beval\s*\(/, label: "eval(" },
  { re: /\bnew\s+Function\s*\(/, label: "new Function(" },
  { re: /\brequire\s*\(/, label: "require(" },
  { re: /\bimport\s*\(/, label: "dynamic import(" },
  { re: /\b(fetch|XMLHttpRequest)\s*\(/, label: "network fetch" },
  { re: /\b(writeFileSync|writeFile|unlinkSync|rmSync|rm)\s*\(/, label: "fs write/delete" },
  { re: /\bprocess\.env\s*\[/, label: "dynamic process.env access" },
  { re: /`[^`]*\$\{/, label: "template-literal interpolation (non-literal SQL)" },
];

// A migration may import ONLY these. Anything else → halt (e.g. importing
// child_process, node:fs, or a sibling that itself runs code).
const ALLOWED_IMPORTS = new Set([
  "dotenv/config",
  "../client.js",
  "drizzle-orm",
]);

// Strip // line comments and block comments before the SQL/code scans, so a
// comment can neither obfuscate a forbidden token nor false-positive an additive one.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// Additive shapes — at least one must be present, else we won't auto-run an
// arbitrary script (it might do nothing schema-shaped, or something opaque).
const ADDITIVE: RegExp[] = [
  /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i,
  /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i,
  /\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i,
  /\bCREATE\s+TYPE\b/i, // guarded by a DO/duplicate_object block per the BODHI convention
];

// Object-name extraction for the CONFIRM gate.
function declaredObjects(src: string): { columns: { table: string; column: string }[]; tables: string[]; types: string[] } {
  const columns: { table: string; column: string }[] = [];
  const tables: string[] = [];
  const types: string[] = [];
  // ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <c>
  for (const m of src.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)) {
    columns.push({ table: m[1].toLowerCase(), column: m[2].toLowerCase() });
  }
  for (const m of src.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)) {
    tables.push(m[1].toLowerCase());
  }
  for (const m of src.matchAll(/CREATE\s+TYPE\s+(\w+)/gi)) {
    types.push(m[1].toLowerCase());
  }
  return { columns, tables, types };
}

export class VerifiedMigrationFailure extends Error {
  constructor(public readonly stage: string, detail: string) {
    super(detail);
    this.name = "VerifiedMigrationFailure";
  }
}

function fail(stage: string, detail: string): never {
  console.error(`\n[verified-migrate] ✗ GATE FAILED (${stage})`);
  console.error(`[verified-migrate]   ${detail}`);
  console.error(`[verified-migrate]   HALTED — surfacing to the architect. Migration NOT auto-applied.`);
  process.exitCode = 2;
  throw new VerifiedMigrationFailure(stage, detail);
}

// A structured snapshot of the public schema: the SET of every table, column,
// and enum label. Returned as sorted string keys so it both string-compares
// (idempotency gate) AND set-diffs (destruction gate) — the latter is the real
// safety boundary: it inspects the actual schema delta, so NO source-text
// obfuscation (string-concat DROP, String.fromCharCode, runtime assembly) can
// hide a destroyed object. (bodhi-security May 30: a lexical denylist over
// executed TS can never be sound; a DB-delta assertion can.)
export interface Snapshot {
  tables: Set<string>;
  columns: Set<string>; // "table.column"
  enumLabels: Set<string>; // "type:label"
  // ---- Integrity/security object classes (finding #4, Jun 4) ----
  // GATE 3.5 claims to be the obfuscation-proof boundary, but it only diffed
  // tables/columns/enum-labels — a runtime-assembled DROP INDEX / DROP
  // CONSTRAINT / DROP POLICY left those three sets byte-identical and sailed
  // through. Snapshot these classes too so a set-diff detects their removal.
  indexes: Set<string>; // "table.indexname"
  constraints: Set<string>; // "table.conname:contype"
  policies: Set<string>; // "table.policyname"
  functions: Set<string>; // "function(argtypes)"
  triggers: Set<string>; // "table.triggername"
  sequences: Set<string>; // "sequencename"
  // ---- Data-preservation (finding #2/#3, Jun 4) ----
  // Per-table live row counts. A DELETE/TRUNCATE/UPDATE leaves the schema SET
  // identical, so only a row-count delta catches a data wipe. count(*) per
  // public base table — exact on this small single-user DB (vs n_live_tup which
  // is an estimate that lags VACUUM/ANALYZE and could mask a wipe).
  rowCounts: Map<string, number>;
}

async function snapshot(db: ReturnType<typeof getDb>): Promise<Snapshot> {
  const cols = (await db.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY table_name, column_name
  `)) as unknown as { table_name: string; column_name: string }[];
  const enums = (await db.execute(sql`
    SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    ORDER BY t.typname, e.enumsortorder
  `)) as unknown as { typname: string; enumlabel: string }[];
  const tables = (await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `)) as unknown as { table_name: string }[];

  // ---- Integrity/security object classes (finding #4) ----
  const indexes = (await db.execute(sql`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'public' ORDER BY tablename, indexname
  `)) as unknown as { tablename: string; indexname: string }[];
  const constraints = (await db.execute(sql`
    SELECT rel.relname AS table_name, c.conname, c.contype
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' ORDER BY rel.relname, c.conname
  `)) as unknown as { table_name: string; conname: string; contype: string }[];
  const policies = (await db.execute(sql`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' ORDER BY tablename, policyname
  `)) as unknown as { tablename: string; policyname: string }[];
  const functions = (await db.execute(sql`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' ORDER BY p.proname, args
  `)) as unknown as { proname: string; args: string }[];
  const triggers = (await db.execute(sql`
    SELECT c.relname AS table_name, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `)) as unknown as { table_name: string; tgname: string }[];
  const sequences = (await db.execute(sql`
    SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_schema = 'public' ORDER BY sequence_name
  `)) as unknown as { sequence_name: string }[];

  // ---- Data-preservation: per-table row counts (finding #2/#3) ----
  // count(*) per BASE TABLE — exact, not estimate. The table list above includes
  // views; restrict the counts to base tables (count(*) on a view could be slow
  // or fail). Identifiers come from pg catalogs (not user source) and are quoted.
  const baseTables = (await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)) as unknown as { table_name: string }[];
  const rowCounts = new Map<string, number>();
  for (const { table_name } of baseTables) {
    // table_name is a catalog-sourced public identifier; double-quote-escape it.
    const safe = `"${table_name.replace(/"/g, '""')}"`;
    const r = (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${safe}`))) as unknown as { n: number }[];
    rowCounts.set(table_name, r[0]?.n ?? 0);
  }

  return {
    tables: new Set(tables.map((r) => r.table_name)),
    columns: new Set(cols.map((r) => `${r.table_name}.${r.column_name}`)),
    enumLabels: new Set(enums.map((r) => `${r.typname}:${r.enumlabel}`)),
    indexes: new Set(indexes.map((r) => `${r.tablename}.${r.indexname}`)),
    constraints: new Set(constraints.map((r) => `${r.table_name}.${r.conname}:${r.contype}`)),
    policies: new Set(policies.map((r) => `${r.tablename}.${r.policyname}`)),
    functions: new Set(functions.map((r) => `${r.proname}(${r.args})`)),
    triggers: new Set(triggers.map((r) => `${r.table_name}.${r.tgname}`)),
    sequences: new Set(sequences.map((r) => r.sequence_name)),
    rowCounts,
  };
}

// Stable string form for the idempotency gate (run1 === run2).
function fingerprintOf(s: Snapshot): string {
  // Schema-object sets only — these are what the idempotency gate (run1===run2)
  // asserts are unchanged on re-run (IF-NOT-EXISTS/IF-EXISTS guards hold). Row
  // counts are deliberately EXCLUDED here: the data-preservation boundary is the
  // before→after delta in GATE 3.6, not run1→run2 (a re-run of a clean additive
  // migration changes no rows, but folding counts in would make idempotency
  // brittle against any unrelated concurrent write during the two runs).
  return JSON.stringify({
    tables: [...s.tables].sort(),
    columns: [...s.columns].sort(),
    enumLabels: [...s.enumLabels].sort(),
    indexes: [...s.indexes].sort(),
    constraints: [...s.constraints].sort(),
    policies: [...s.policies].sort(),
    functions: [...s.functions].sort(),
    triggers: [...s.triggers].sort(),
    sequences: [...s.sequences].sort(),
  });
}

function releaseEvidence(s: Snapshot): ReleaseSchemaEvidence {
  const objectKeys = new Set<string>([
    ...s.tables,
    ...s.columns,
    ...s.enumLabels,
    ...s.indexes,
    ...s.constraints,
    ...s.policies,
    ...s.functions,
    ...s.triggers,
    ...s.sequences,
  ]);
  return { fingerprint: fingerprintOf(s), rowCounts: s.rowCounts, objectKeys, capturedAt: new Date().toISOString() };
}

type ReleaseAuthority = { releaseVersion: string; migration: SchemaMigration; manifestPath: string };

function releaseManifestPath(): string {
  return path.resolve(process.env.BODHI_RELEASE_MANIFEST || path.join(process.cwd(), ".release", "manifest.json"));
}

/** Resolve the exact ordered release entry and bind it to the source bytes. */
function loadReleaseAuthority(target: string, source: string): ReleaseAuthority | null {
  const manifestPath = releaseManifestPath();
  if (!existsSync(manifestPath)) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("MANIFEST", `release manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const releaseVersion = parsed?.releaseVersion;
  const compatibility = parsed?.compatibility;
  const migrations = parsed?.migrations;
  if (typeof releaseVersion !== "string" || !compatibility || !Array.isArray(migrations)) {
    fail("MANIFEST", "release manifest is missing releaseVersion, compatibility, or migrations");
  }
  const normalized = {
    formatVersion: 1,
    releaseVersion,
    schemaFrom: compatibility.schemaFrom,
    schemaTo: compatibility.schemaTo,
    migrations,
  };
  const errors = validateSchemaMigrationManifest(normalized);
  if (errors.length) fail("MANIFEST", errors.join("; "));
  const relativeTarget = path.relative(process.cwd(), target).split(path.sep).join("/");
  const migration = migrations.find((candidate: SchemaMigration) => candidate.path === relativeTarget) as SchemaMigration | undefined;
  if (!migration) fail("MANIFEST", `${relativeTarget} is not listed in the ordered release migration manifest`);
  const expectedId = migrationIdFromPath(relativeTarget);
  if (expectedId !== migration.id) fail("MANIFEST", `${relativeTarget} has an id/path mismatch in the release manifest`);
  const actualChecksum = sha256Hex(source);
  if (actualChecksum !== migration.checksum) fail("MANIFEST", `${migration.id} checksum does not match the shipped source bytes`);
  return { releaseVersion, migration, manifestPath };
}

class PostgresMigrationLedger implements SchemaMigrationLedger {
  constructor(private readonly db: ReturnType<typeof getDb>) {}

  async ensure(): Promise<void> {
    await this.db.execute(sql.raw(BODHI_SCHEMA_MIGRATIONS_DDL));
  }

  async latest(migrationId: string): Promise<SchemaMigrationLedgerRecord | null> {
    const result = await this.db.execute(sql`
      SELECT migration_id, checksum, applied_at, release_version, outcome,
             backup_reference, backup_checksum, before_fingerprint, after_fingerprint,
             before_row_counts, after_row_counts, error
      FROM bodhi_schema_migrations
      WHERE migration_id = ${migrationId}
      ORDER BY applied_at DESC
      LIMIT 1
    `);
    const row = (result as unknown as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      migrationId: String(row.migration_id),
      checksum: String(row.checksum),
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
      releaseVersion: String(row.release_version),
      outcome: String(row.outcome) as "applied" | "skipped" | "failed",
      ...(row.backup_reference ? { backupReference: String(row.backup_reference) } : {}),
      ...(row.backup_checksum ? { backupChecksum: String(row.backup_checksum) } : {}),
      ...(row.before_fingerprint ? { beforeFingerprint: String(row.before_fingerprint) } : {}),
      ...(row.after_fingerprint ? { afterFingerprint: String(row.after_fingerprint) } : {}),
      ...(row.before_row_counts ? { beforeRowCounts: row.before_row_counts as Record<string, number> } : {}),
      ...(row.after_row_counts ? { afterRowCounts: row.after_row_counts as Record<string, number> } : {}),
      ...(row.error ? { error: String(row.error) } : {}),
    };
  }

  async append(record: SchemaMigrationLedgerRecord): Promise<void> {
    const before = record.beforeRowCounts ? JSON.stringify(record.beforeRowCounts) : null;
    const after = record.afterRowCounts ? JSON.stringify(record.afterRowCounts) : null;
    await this.db.execute(sql`
      INSERT INTO bodhi_schema_migrations
        (migration_id, checksum, applied_at, release_version, outcome,
         backup_reference, backup_checksum, before_fingerprint, after_fingerprint,
         before_row_counts, after_row_counts, error)
      VALUES
        (${record.migrationId}, ${record.checksum}, ${record.appliedAt}, ${record.releaseVersion}, ${record.outcome},
         ${record.backupReference ?? null}, ${record.backupChecksum ?? null}, ${record.beforeFingerprint ?? null}, ${record.afterFingerprint ?? null},
         ${before}::jsonb, ${after}::jsonb, ${record.error ?? null})
    `);
  }
}

function backupPathForAuthority(): string {
  const value = process.env.BODHI_MIGRATION_BACKUP_PATH;
  if (!value || !path.isAbsolute(value)) {
    fail("BACKUP", "BODHI_MIGRATION_BACKUP_PATH must be an absolute destination under an existing backup directory");
  }
  if (!existsSync(path.dirname(value))) fail("BACKUP", `backup directory does not exist: ${path.dirname(value)}`);
  if (existsSync(value)) fail("BACKUP", `refusing to overwrite existing backup: ${value}`);
  return value;
}

function pgBackup(url: string, target: string): BackupEvidence {
  const fd = openSync(target, "wx", 0o600);
  try { runPostgres("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], postgresEnvironment(url), fd); }
  finally { closeSync(fd); }
  const bytes = readFileSync(target);
  if (bytes.length === 0) fail("BACKUP", "pg_dump produced an empty backup artifact");
  runPostgres("pg_restore", ["--list", target], postgresEnvironment(url));
  return { reference: target, createdAt: new Date().toISOString(), checksum: sha256Hex(bytes) };
}

export function verifyMigrationBackup(backup: BackupEvidence): void {
  const info = lstatSync(backup.reference);
  if (!info.isFile() || info.isSymbolicLink() || sha256Hex(readFileSync(backup.reference)) !== backup.checksum) {
    throw new Error("migration backup checksum or file identity mismatch");
  }
}

function pgRestore(url: string, backup: BackupEvidence): void {
  verifyMigrationBackup(backup);
  runPostgres("pg_restore", ["--clean", "--if-exists", "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
    "--dbname", postgresEnvironment(url).PGDATABASE!, backup.reference], postgresEnvironment(url));
}

// The destruction gate: anything present in `before` but absent in `after` is
// a DROP/destruction, regardless of how the DDL was written. Additive
// migrations only ADD — they never remove an existing object.
export function destroyedObjects(before: Snapshot, after: Snapshot): string[] {
  const gone: string[] = [];
  for (const t of before.tables) if (!after.tables.has(t)) gone.push(`table ${t}`);
  for (const c of before.columns) if (!after.columns.has(c)) gone.push(`column ${c}`);
  for (const e of before.enumLabels) if (!after.enumLabels.has(e)) gone.push(`enum label ${e}`);
  // Integrity/security object classes (finding #4) — a DROP INDEX / DROP
  // CONSTRAINT / DROP POLICY / DROP FUNCTION / DROP TRIGGER / DROP SEQUENCE
  // leaves the table/column/enum sets identical but removes a real object.
  for (const i of before.indexes) if (!after.indexes.has(i)) gone.push(`index ${i}`);
  for (const k of before.constraints) if (!after.constraints.has(k)) gone.push(`constraint ${k}`);
  for (const p of before.policies) if (!after.policies.has(p)) gone.push(`policy ${p}`);
  for (const f of before.functions) if (!after.functions.has(f)) gone.push(`function ${f}`);
  for (const tg of before.triggers) if (!after.triggers.has(tg)) gone.push(`trigger ${tg}`);
  for (const s of before.sequences) if (!after.sequences.has(s)) gone.push(`sequence ${s}`);
  return gone;
}

// GATE 3.6 DATA-PRESERVATION (finding #2/#3) — the row-count boundary. An
// additive migration ADDS schema; it never removes DATA. A DELETE/TRUNCATE/
// UPDATE-that-nulls leaves every schema set byte-identical (so destroyedObjects
// returns []), but drops the live row count of an existing table. For every
// table present in BOTH before and after, flag any table whose row count
// DECREASED. This inspects the DB delta, not source text, so it is immune to
// runtime SQL assembly (concat / fromCharCode / base64) exactly the way the
// schema set-diff is. (A table newly created by the migration, or one dropped —
// both already caught by destroyedObjects — is not double-counted here: we only
// compare tables present on BOTH sides.)
export function dataLosses(before: Snapshot, after: Snapshot): string[] {
  const losses: string[] = [];
  for (const [table, beforeCount] of before.rowCounts) {
    if (!after.rowCounts.has(table)) continue; // table dropped → destroyedObjects owns it
    const afterCount = after.rowCounts.get(table)!;
    if (afterCount < beforeCount) {
      losses.push(`${table}: ${beforeCount} → ${afterCount} rows (lost ${beforeCount - afterCount})`);
    }
  }
  return losses;
}

// Pure classifier for GATE 1 — exported so the security-critical logic is
// unit-testable without a DB or subprocess (the gate itself is now defense-in-
// depth behind the DB-delta NO-DESTRUCTION gate, but it's the fast-fail boundary
// and a regex regression here is exactly the class that re-opened the bypass).
export interface StaticVerdict {
  ok: boolean;
  stage?: string;
  reason?: string;
}

export function staticGate(rawSrc: string, basename: string): StaticVerdict {
  if (!/^apply-[\w-]+\.ts$/.test(basename)) {
    return { ok: false, stage: "RESOLVE", reason: `target must be apply-*.ts (got ${basename})` };
  }
  // `src` is comment-stripped for the LEXICAL gates only (CODE_FORBIDDEN /
  // IMPORT / FORBIDDEN / ADDITIVE). The structure gate below must NOT see it:
  // stripComments() is string-boundary-unaware (a `//` inside a string literal
  // truncates the rest of that physical line), which (a) HIDES a following
  // module-scope ACE after a `"…//…"` literal and (b) FALSE-REJECTS a legit
  // `sql.raw("…; // ok")`. The TS parser handles comments natively, so the AST
  // gate runs on rawSrc (see topLevelStructureViolation's contract :436-437).
  const src = stripComments(rawSrc);
  const codeHit = CODE_FORBIDDEN.find((f) => f.re.test(src));
  if (codeHit) return { ok: false, stage: "STATIC", reason: `non-declarative code: ${codeHit.label}` };

  // ---- IMPORT GATE — EXHAUSTIVE ALLOWLIST (finding #1, Jun 4) ----
  // The old scan keyed ONLY on the `from "X"` clause, so a side-effect import
  // `import "./payload.js";` (no binding, no `from`) was never iterated and
  // never checked — tsx evaluates that module at load time, BEFORE main(),
  // i.e. arbitrary-code-execution past the gate. We now scan BOTH import shapes
  // and treat the allowlist as exhaustive: ANY module reference (binding-import,
  // side-effect-import, or `export … from`) not in ALLOWED_IMPORTS halts.
  // `from`-bearing: `import x from "M"`, `import {x} from "M"`, `import "...";` via
  // `export {x} from "M"`, `import type {x} from "M"`. (Dynamic import() and
  // require() are already hard-blocked by CODE_FORBIDDEN above.)
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!ALLOWED_IMPORTS.has(m[1])) return { ok: false, stage: "STATIC", reason: `disallowed import "${m[1]}"` };
  }
  // Side-effect imports (no binding, no `from`): `import "M";`. These have no
  // `from` clause so the loop above can never see them. Match them explicitly
  // and reject any module not on the allowlist (e.g. `import "dotenv/config";`
  // still passes because it IS on the allowlist).
  for (const m of src.matchAll(/(?:^|[;{}\n])\s*import\s+["']([^"']+)["']\s*;?/gm)) {
    if (!ALLOWED_IMPORTS.has(m[1])) {
      return { ok: false, stage: "STATIC", reason: `disallowed side-effect import "${m[1]}"` };
    }
  }

  const hit = FORBIDDEN.find((f) => f.re.test(src));
  if (hit) return { ok: false, stage: "STATIC", reason: `forbidden token: ${hit.label}` };
  if (!ADDITIVE.some((re) => re.test(src))) {
    return { ok: false, stage: "STATIC", reason: "no recognized additive DDL" };
  }

  // ---- MODULE-SCOPE STRUCTURE GATE (finding #1; AST-based, R4 Jun 4) ----
  // The threat model (header :12-20) is only true if the file's MODULE SCOPE is
  // NOTHING but allowlisted imports + the single async main() (+ its one call) +
  // genuinely-inert declarations. A module-scope statement OUTSIDE main() — a
  // bare call expression, a global assignment, an IIFE, a tagged-template laundered
  // through a declaration RHS — executes the moment tsx loads the file, before any
  // gate can observe a DB effect. This gate is now a real TypeScript AST walk
  // (typescript@5.9.3, resolvable from the repo root): "inert" is decided by AST
  // node TYPE, never by regex — a TaggedTemplateExpression is structurally never
  // inert anywhere, closing the R3 bypass class (`const q = fetch`http://x``)
  // that the hand-rolled tokenizer kept losing shape-by-shape. A migration that
  // wants to run code must do it INSIDE main(), where GATE 2/3/3.5/3.6 observe the
  // DB delta. Falls back to a tightened regex floor only if typescript is ever
  // unresolvable.
  // Pass rawSrc (NOT the comment-stripped src) — the function's contract
  // (:436-437) requires raw source so the TS parser tokenizes string/comment
  // boundaries correctly. Feeding the stripped src re-opens the `//`-in-string
  // class the parser is meant to close.
  const structErr = topLevelStructureViolation(rawSrc);
  if (structErr) return { ok: false, stage: "STATIC", reason: structErr };

  return { ok: true };
}

// Reject any module-scope (top-level) statement that EXECUTES CODE at load time
// other than the single async main() entry invocation. Returns a reason string
// on violation, else null. Operates on the RAW source (the TS parser handles
// comments natively — stripComments is for the lexical gates, not this one).
//
// Threat model (finding #1, closed structurally R4): tsx evaluates the file's
// MODULE SCOPE at load, BEFORE any DB-delta gate can observe an effect. So the
// only safe module-scope forms in a BODHI additive migration are:
//   - allowlisted imports (already validated upstream)
//   - the single `async function main()` declaration (its BODY is NOT module
//     scope — db.execute etc. run there, gated by GATE 2/3/3.5/3.6)
//   - the one `main()` / `main().catch(...)` entry invocation
//   - genuinely-inert `const/let/var` declarations whose every initializer is a
//     literal, a NoSubstitutionTemplateLiteral, or an allowlisted sql/sql.raw
//     builder call over literal args
// EVERYTHING else at module scope is rejected. "Inert" is decided by AST node
// TYPE — a TaggedTemplateExpression is structurally never inert ANYWHERE (incl.
// inside a declarator init, getter, or default value), a CallExpression (except
// the allowlisted sql builder + main()) runs at load, a TemplateExpression WITH
// substitutions interpolates at load, etc. This replaces the hand-rolled
// tokenizer (R2) that R3 bypassed by laundering a tagged template through a
// declaration RHS; a real parser sees the RHS node type and cannot be fooled
// shape-by-shape.
function topLevelStructureViolation(src: string): string | null {
  const ts = loadTs();
  if (!ts) {
    // FAIL-CLOSED (finding #5, Jun 4): the LIVE gate must NOT silently degrade
    // to the weaker regex floor when its real enforcement engine is missing.
    // Autonomous security code that swaps its enforcement model without a signal
    // is a hole — a missing dependency would quietly halve the gate's strength
    // on exactly the run where the architect is trusting it most. So the live
    // path REJECTS (returns a violation reason → staticGate ok:false) rather
    // than calling the floor. The regex floor remains a separately-EXPORTED,
    // separately-TESTED function (topLevelStructureViolationRegex) so its
    // shapes stay pinned, but it is never the live enforcement path.
    return "AST structure gate unavailable (typescript unresolvable) — failing closed; this migration stays architect-run";
  }
  return astStructureViolation(ts, src);
}

// The AST gate. Walk MODULE-SCOPE statements only (function bodies are a
// separate scope and are NOT inspected — code there runs inside main(), gated
// by the DB-delta gates). ACCEPT only the four permitted forms; REJECT anything
// else with a precise reason.
function astStructureViolation(ts: typeof import("typescript"), src: string): string | null {
  const sf = ts.createSourceFile("migration.ts", src, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);

  // An initializer is INERT iff it is a literal, a no-substitution template
  // (backtick string with NO `${}`), or an allowlisted sql/sql.raw(...) builder
  // call over inert args. A TaggedTemplateExpression, a TemplateExpression WITH
  // substitutions, a NewExpression, an arrow/function expression, an `await`, a
  // non-sql CallExpression, etc. are all NON-inert. Decided by node TYPE.
  const isInertInitializer = (node: import("typescript").Expression): boolean => {
    // Unwrap `as T` / `satisfies T` / parenthesized wrappers — they don't execute.
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return isInertInitializer(node.expression);
    if (ts.isParenthesizedExpression(node)) return isInertInitializer(node.expression);

    // A TaggedTemplateExpression is NEVER inert — the tag fn runs at load. This is
    // the R3 bypass class; an AST check sees it regardless of where it hides.
    if (ts.isTaggedTemplateExpression(node)) return false;

    // Plain literals: string, number, bigint, regex, true/false/null.
    if (
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isBigIntLiteral(node) ||
      ts.isRegularExpressionLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword
    ) {
      return true;
    }

    // A NoSubstitutionTemplateLiteral is a backtick string with NO `${}` — inert
    // data (the dominant real-migration shape: `const DDL = `…SQL…``). A
    // TemplateExpression (WITH substitutions) is NOT inert: the `${}` evaluate.
    if (node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) return true;
    if (ts.isTemplateExpression(node)) return false;

    // The ONLY permitted module-scope call: the drizzle-orm `sql` builder —
    // `sql(...)` or `sql.raw(...)` / `sql.<id>(...)` — whose every argument is
    // itself inert. This merely WRAPS a literal into a query object; it does not
    // touch the DB (that needs db.execute, INSIDE main()). Any other call runs
    // arbitrary code at load → reject.
    if (ts.isCallExpression(node)) {
      if (!isSqlBuilderCallee(ts, node.expression)) return false;
      return node.arguments.every((a) => isInertInitializer(a));
    }

    // Everything else (NewExpression, ArrowFunction, FunctionExpression,
    // AwaitExpression, Identifier, PropertyAccess, ObjectLiteral with getters,
    // etc.) is treated as NON-inert at module scope. Conservative by design.
    return false;
  };

  for (const stmt of sf.statements) {
    // (a) Imports — allowlist already enforced by staticGate's import scan.
    //     Import-equals (`import x = require(...)`) is a CallExpression-equivalent
    //     load-time effect and is caught by CODE_FORBIDDEN's require( rule, but
    //     also reject it structurally here.
    if (ts.isImportDeclaration(stmt)) continue;
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) continue; // `export {x} from "M"`
    if (ts.isImportEqualsDeclaration(stmt)) {
      return `module-scope import-equals not allowed: "${snippet(src, stmt)}"`;
    }

    // (b) The single `async function main()` declaration. Its body is a separate
    //     scope and is intentionally NOT walked.
    if (ts.isFunctionDeclaration(stmt)) {
      if (stmt.name?.text === "main") continue;
      return `module-scope function other than main() not allowed: "${snippet(src, stmt)}"`;
    }

    // (c) Inert variable declarations: const/let/var with every initializer inert.
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        // A declarator with NO initializer (`let x;`) is inert (no load-time code),
        // but a binding-pattern or computed name is unusual — accept only a plain
        // identifier name with an inert (or absent) initializer.
        if (!ts.isIdentifier(decl.name)) {
          return `module-scope destructuring/computed declaration not allowed: "${snippet(src, stmt)}"`;
        }
        if (decl.initializer && !isInertInitializer(decl.initializer)) {
          return `module-scope non-inert initializer not allowed: "${snippet(src, decl.initializer)}"`;
        }
      }
      continue;
    }

    // (d) The lone top-level entry: an ExpressionStatement that is `main()`,
    //     `await main()` (illegal at module top level without top-level-await, but
    //     reject anyway via the await branch), or `main().catch(<fn>)`.
    if (ts.isExpressionStatement(stmt)) {
      const reason = checkEntryExpression(ts, stmt.expression, src);
      if (reason === null) continue;
      return reason;
    }

    // Anything else at module scope (a labeled statement, a top-level for/if/try,
    // a class declaration, an empty statement is harmless but we reject for
    // tightness, a top-level await ExpressionStatement is handled above, etc.).
    if (stmt.kind === ts.SyntaxKind.EmptyStatement) continue; // a lone `;` is inert
    return `module-scope statement outside main() not allowed: "${snippet(src, stmt)}"`;
  }
  return null;
}

// Is this callee the allowlisted drizzle-orm `sql` builder? Accept the bare
// identifier `sql` and member chains rooted at it (`sql.raw`, `sql.identifier`).
// Anything else (a different identifier, a computed `sql["raw"]`, a call result
// `getSql().raw`) is NOT the builder.
function isSqlBuilderCallee(ts: typeof import("typescript"), callee: import("typescript").Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === "sql";
  if (ts.isPropertyAccessExpression(callee)) {
    // `sql.raw`, `sql.x.y` — root must be the `sql` identifier; no computed access.
    return isSqlBuilderCallee(ts, callee.expression);
  }
  // Computed member (`sql["raw"]`), call-result member, etc. → not the builder.
  return false;
}

// The ONE permitted top-level call expression: the main() entry invocation,
// optionally with a `.catch(<arrow|fn|identifier>)` tail. Reject a bare
// `await main()` (top-level await is its own load-order hazard) and any other
// call. Returns null if it IS the permitted entry, else a reason string.
function checkEntryExpression(
  ts: typeof import("typescript"),
  expr: import("typescript").Expression,
  src: string
): string | null {
  // `await main()` — top-level await; reject (the threat model assumes a single
  // synchronous main() kickoff, and TLA changes module-evaluation ordering).
  if (ts.isAwaitExpression(expr)) {
    return `module-scope top-level await not allowed: "${snippet(src, expr)}"`;
  }
  if (!ts.isCallExpression(expr)) {
    return `module-scope statement outside main() not allowed: "${snippet(src, expr)}"`;
  }

  // Case 1: `main()` directly.
  if (ts.isIdentifier(expr.expression) && expr.expression.text === "main") {
    return null; // ok
  }

  // Case 2: `main().catch(...)` — a property-access call (`.catch`/`.then`/
  // `.finally`) whose ultimate receiver is the `main()` call. Walk down any chain
  // of property-access calls (`main().catch(...).finally(...)`) to confirm the
  // root receiver is `main()`.
  //
  // BUT the handler ARGUMENT is evaluated EAGERLY at module load, BEFORE the
  // promise settles (finding #2, Jun 4). `main().catch(audit`x`)` runs the
  // `audit` tag NOW; `main().then(evil())` calls `evil()` NOW; `.finally(new X())`
  // constructs NOW. Confirming the receiver is main() is necessary but NOT
  // sufficient — the only legitimate deferred-handler forms are an inline
  // function (ArrowFunction / FunctionExpression — its body is a separate scope,
  // not module scope) or a bare Identifier reference to an already-defined
  // handler (`main().catch(handleErr)` — a reference, no call). EVERY other
  // argument shape (CallExpression, TaggedTemplateExpression, NewExpression,
  // TemplateExpression-with-substitutions, AwaitExpression, …) executes at load
  // and is rejected. We validate the args at EVERY link in the chain, since each
  // `.then/.catch/.finally(arg)` evaluates its arg eagerly.
  if (ts.isPropertyAccessExpression(expr.expression)) {
    // Collect every call in the chain (outermost = expr, inner = receivers) so we
    // inspect the args of each `.then/.catch/.finally(...)` invocation.
    let node: import("typescript").Expression = expr;
    while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const argReason = handlerArgsViolation(ts, node, src);
      if (argReason) return argReason;
      node = node.expression.expression; // step to the receiver of this `.x(...)`
    }
    // After unwinding the chain, the root receiver must be exactly `main()`.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "main"
    ) {
      return null; // ok — root is main(), every handler arg is a deferred form
    }
  }

  return `module-scope call other than main() entry not allowed: "${snippet(src, expr)}"`;
}

// Every argument passed to a `.then/.catch/.finally(...)` in the entry chain is
// evaluated EAGERLY at module load (finding #2, Jun 4). The ONLY load-safe
// argument forms are a deferred handler — an inline ArrowFunction /
// FunctionExpression (its body is a separate scope), or a bare Identifier
// reference to an already-bound handler (no call, no construction). Anything
// else (a CallExpression `evil()`, a TaggedTemplateExpression `audit`x``, a
// NewExpression `new X()`, a TemplateExpression with substitutions, an await,
// a member-access that could be a getter, etc.) runs code at load. Returns a
// reason string on the first non-deferred arg, else null. `call` is a chain
// link whose callee is a PropertyAccessExpression — but the property may be any
// method; if it is NOT a then/catch/finally handler-receiving method the whole
// chain is rejected upstream as "call other than main() entry", so here we
// simply require every arg of every chain link to be a deferred form (strictly
// conservative — a legitimate entry chain never passes a non-handler arg).
function handlerArgsViolation(
  ts: typeof import("typescript"),
  call: import("typescript").CallExpression,
  src: string
): string | null {
  for (const arg of call.arguments) {
    if (
      ts.isArrowFunction(arg) ||
      ts.isFunctionExpression(arg) ||
      ts.isIdentifier(arg)
    ) {
      continue; // a deferred handler (inline fn) or a bare handler reference
    }
    return `module-scope handler argument runs code at load (only an inline function or a bare handler identifier is allowed): "${snippet(src, arg)}"`;
  }
  return null;
}

// A short, single-line snippet of a node's source text for violation messages.
function snippet(src: string, node: import("typescript").Node): string {
  const start = node.getStart ? node.getStart() : node.pos;
  const text = src.slice(start, node.end).replace(/\s+/g, " ").trim();
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

// ---- REGEX FALLBACK (floor only; used iff `typescript` is unresolvable) ----
// The AST gate above is the real boundary. This is the tightened R3 fix kept as
// a floor: move the tagged-template rejection BEFORE the inert-declaration check,
// AND in the inert-RHS branch reject any RHS where an identifier or member-chain
// abuts the collapsed string sentinel (the laundered tagged template). It is
// strictly more conservative than R2 but is NOT the recommended path — if you
// ever see this fire, restore `typescript` to the dependency tree so the AST
// walk runs. (Verified resolvable at build time; this branch is dead in
// practice, retained for fail-safety.)
export function topLevelStructureViolationRegex(src: string): string | null {
  let out = "";
  let depth = 0;
  let i = 0;
  const STR = '"STR"';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      if (depth === 0) out += STR;
      continue;
    }
    if (ch === "{") { if (depth === 0) out += "{}"; depth++; i++; continue; }
    if (ch === "}") { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0) out += ch;
    i++;
  }

  const units = out.split(/[;\n]/).map((u) => u.trim()).filter((u) => u.length > 0 && u !== "{}");

  const isMainEntry = (u: string) =>
    /^(await\s+)?main\s*\(\s*\)(\s*\.catch\s*\(\s*(\([^)]*\)|[\w$]+)?\s*(=>)?\s*\{\}\s*\))?$/.test(u);
  // The laundered-tagged-template detector: an identifier or member-chain abutting
  // the sentinel, ANYWHERE in the RHS (R3 fix — check this BEFORE inert-decl).
  const hasTaggedTemplate = (u: string) => /[\w$](?:\s*\.\s*[\w$]+)*"STR"/.test(u);
  const isInertDeclaration = (u: string): boolean => {
    const declMatch = /^(export\s+)?(const|let|var)\s+[\w$]+(\s*:\s*[^=]+)?\s*=\s*([\s\S]*)$/.exec(u);
    if (!declMatch) return false;
    const rhs = declMatch[4].trim();
    if (hasTaggedTemplate(rhs)) return false; // laundered tagged template → not inert
    if (!/\(/.test(rhs)) return true;
    return /^sql\s*(\.\s*[\w$]+\s*)?\(\s*(?:"STR"\s*,?\s*)*\)$/.test(rhs);
  };
  const isMainDecl = (u: string) =>
    /^(export\s+)?async\s+function\s+main\s*\(\s*\)\s*(:\s*[\w<>.\[\]| ]+)?\s*(\{\})?$/.test(u);
  const isImport = (u: string) => /^import\b/.test(u) || /^export\s+(type\s+)?\{[^}]*\}\s*from\b/.test(u);

  for (const u of units) {
    // R3 fix: tagged-template check FIRST, before isInertDeclaration can classify
    // a laundered `const q = fetch`…`` as inert.
    if (hasTaggedTemplate(u)) {
      return `top-level tagged-template call not allowed: "${u.slice(0, 60)}"`;
    }
    if (isImport(u) || isInertDeclaration(u) || isMainDecl(u) || isMainEntry(u)) continue;
    if (/^["\w]*[)\].,]*$/.test(u) && !/\(/.test(u)) continue;
    return `top-level statement outside main() not allowed: "${u.slice(0, 60)}"`;
  }
  return null;
}

// ============================================================
// CONTAINMENT (Phase ②, Jun 4 — bodhi-security MIGRATE-CONTAINMENT)
//
// The gates above (1 / 2 / 3 / 3.5 / 3.6 / 4) make a BYPASS catastrophic-resistant
// at the DB layer. This block makes a bypass NON-CATASTROPHIC at the PROCESS layer,
// so the two defenses are independent: even a verified migration runs with the
// minimum capability it needs and nothing more.
//
// Threat before this block: `spawnSync("npx",["tsx",target],{env:process.env})`
// gave the child EVERY secret in process.env (Anthropic/Voyage/Telegram/Google/
// Supabase keys, the API bearer token) AND, because the DB role is the superuser
// `macbookpro`, the SQL `COPY … FROM PROGRAM 'cmd'` primitive = OS command
// execution. A single gate miss therefore = full credential theft + RCE.
//
// Two active containment layers (defense-in-depth). A least-priv DB role is a
// future third layer after shared ownership is deliberately established; the
// manifest release path currently requires one owner connection for atomic
// run/backup/restore authority (see scripts/setup-migrate-role.sql):
//   (1) ENV-SCRUB — the child gets a MINIMAL env: only the DB URL + the few
//       runtime PATH and node/npm vars tsx needs to resolve and run. Every API key /
//       token is dropped. A bypass cannot read what is not there.
//   (2) SANDBOX — wrap the spawn in macOS `sandbox-exec` with an SBPL profile
//       that (a) DENIES outbound network except localhost / unix-socket (local
//       Postgres still connects; external exfil + SSRF is blocked at the kernel),
//       and (b) DENIES reading the repo secret files (.env, .google-token.json,
//       *.key, *.pem) — belt-and-suspenders behind the env-scrub. Falls back to
//       the scrubbed env alone (with a loud warning) if sandbox-exec is missing
//       or the profile fails to load — never breaks migrations.
// ============================================================

// Env vars the tsx child genuinely needs to RESOLVE + RUN. Everything else
// (API keys, tokens, OAuth creds) is dropped. DATABASE_URL (or a dedicated
// MIGRATE_DATABASE_URL for local/legacy verification) is added separately.
// The manifest release executor overrides that selection with DATABASE_URL so
// run and rollback cannot diverge by owner. Conservative allowlist, not a denylist: a NEW
// secret added to .env later is dropped by default, not leaked by default.
const ENV_KEEP = [
  "PATH",        // resolve node / npx / tsx
  "HOME",        // npm/npx config + dlx cache live under ~
  "TMPDIR",      // npx materializes packages into a temp dir
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_ENV",
  "NPM_CONFIG_CACHE",
  "npm_config_cache",
  "npm_config_prefix",
  "npm_config_registry",
  "COREPACK_HOME",
];

/**
 * Build the MINIMAL environment for the migration child. Only the DB URL + the
 * resolution/runtime vars above survive; every API key / token in process.env
 * is dropped. Exported + pure so the scrub is unit-testable without a spawn.
 *
 * MIGRATE_DATABASE_URL, if set, takes precedence for local/legacy verification.
 * The manifest-authorized release executor overrides this with the canonical
 * owner DATABASE_URL until the shared-owner design in setup-migrate-role.sql is
 * explicitly adopted.
 */
export function buildScrubbedEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of ENV_KEEP) {
    const v = source[k];
    if (v !== undefined) out[k] = v;
  }
  const dbUrl = source.MIGRATE_DATABASE_URL || source.DATABASE_URL;
  if (dbUrl) out.DATABASE_URL = dbUrl;
  return out;
}

/**
 * The SBPL (sandbox profile language) source. `allow default` keeps tsx's broad
 * filesystem resolution working (a `deny default` allowlist is unmaintainable
 * for npx/tsx's sprawling node_modules + dlx-cache access), then SUBTRACTS the
 * two capabilities a migration must never have:
 *   - outbound network beyond localhost / unix-socket (blocks exfil + SSRF; the
 *     local Postgres on 127.0.0.1:5432 / its unix socket still connects)
 *   - reading the repo secret files by BASENAME (symlink-robust regex; literal
 *     paths break under /tmp→/private/tmp and the worktree symlink). This is
 *     belt-and-suspenders behind the env-scrub — a bypass that tries to re-read
 *     .env off disk to recover the keys the scrub removed is denied too.
 * Exported + pure so the profile shape is unit-testable.
 *
 * NOTE on `remote ip`: macOS SBPL only accepts `*` or `localhost` as the host
 * token in a `remote ip` clause (verified — `127.0.0.1:*` is a load error), so
 * loopback is expressed via the `localhost` keyword, which covers IPv4+IPv6
 * loopback. unix-socket is allowed explicitly for socket-style PG connections.
 */
export function buildSandboxProfile(): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny network-outbound)",
    '(allow network-outbound (remote unix-socket))',
    '(allow network-outbound (remote ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    // Secret files — deny by basename so symlinks (/tmp, the worktree) can't
    // alias around a literal path. Mirrors the .gitignore secret set.
    '(deny file-read* (regex #"(^|/)\\.env$"))',
    '(deny file-read* (regex #"(^|/)\\.env\\.[^/]*$"))',
    '(deny file-read* (regex #"(^|/)\\.google-token\\.json$"))',
    '(deny file-read* (regex #"\\.key$"))',
    '(deny file-read* (regex #"\\.pem$"))',
  ].join("\n");
}

/**
 * Is `sandbox-exec` available on this host? (macOS only; absent on Linux/CI.)
 * Probes with a trivial allow-all profile + a no-op so we never claim sandboxing
 * we can't deliver.
 */
function sandboxExecAvailable(): boolean {
  try {
    const probe = spawnSync("sandbox-exec", ["-p", "(version 1)(allow default)", "true"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return probe.status === 0 && !probe.error;
  } catch {
    return false;
  }
}

function runMigration(target: string, attempt: number, databaseUrlOverride?: string): void {
  const env = buildScrubbedEnv(process.env);
  if (databaseUrlOverride) env.DATABASE_URL = databaseUrlOverride;
  if (!env.DATABASE_URL) {
    // The scrub dropped everything except the DB URL; if even that is missing the
    // migration cannot connect. Fail loudly rather than spawn a doomed child.
    fail("RUN", "no DATABASE_URL (or MIGRATE_DATABASE_URL) in the environment — the scrubbed child cannot reach Postgres.");
  }

  const useSandbox = sandboxExecAvailable();
  const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  if (!existsSync(tsxCli)) {
    fail("RUN", `local tsx runtime not found: ${tsxCli}`);
  }
  const childArgs = [tsxCli, target];
  let res: SpawnSyncReturns<Buffer>;
  if (useSandbox) {
    const profile = buildSandboxProfile();
    console.log(`[verified-migrate] run ${attempt}: sandbox-exec ${process.execPath} ${tsxCli} ${target} (network: localhost-only · secrets: scrubbed)`);
    res = spawnSync("sandbox-exec", ["-p", profile, process.execPath, ...childArgs], {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: process.cwd(),
      env,
      timeout: 120_000, // hard ceiling — no unbounded autonomous index builds/hangs
    });
    // A sandbox-exec PROFILE error (bad SBPL) exits 64/65 BEFORE running the child
    // and is NOT a migration failure — fall back to the scrubbed-env-only path so
    // a profile regression never silently blocks legitimate migrations. (The
    // env-scrub — the layer that removes the secrets — still applies.)
    if (res.error || res.status === 64 || res.status === 65) {
      console.warn(`[verified-migrate] ⚠ sandbox-exec failed to apply the profile (status ${res.status}${res.error ? `, ${res.error.message}` : ""}). Falling back to SCRUBBED-ENV-ONLY (network NOT jailed). Secrets are still removed; surface to the architect to restore the sandbox.`);
      res = spawnSync(process.execPath, childArgs, {
        stdio: ["ignore", "inherit", "inherit"],
        cwd: process.cwd(),
        env,
        timeout: 120_000,
      });
    }
  } else {
    console.warn(`[verified-migrate] ⚠ sandbox-exec not available on this host — running with SCRUBBED-ENV-ONLY (network NOT jailed). Secrets are still removed.`);
    console.log(`[verified-migrate] run ${attempt}: ${process.execPath} ${tsxCli} ${target} (secrets: scrubbed)`);
    res = spawnSync(process.execPath, childArgs, {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: process.cwd(),
      env,
      timeout: 120_000,
    });
  }

  if (res.signal === "SIGTERM") {
    fail("RUN", `migration exceeded the 120s timeout on run ${attempt} (killed). Long migrations stay architect-run.`);
  }
  if (res.status !== 0) {
    fail("RUN", `migration exited with status ${res.status} on run ${attempt}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const arg = argv.find((candidate) => candidate !== "--dry-run");
  if (!arg) {
    console.error("usage: npx tsx scripts/verified-migrate.ts [--dry-run] <path-to-apply-*.ts>");
    process.exit(1);
  }
  const target = path.resolve(process.cwd(), arg);
  if (!existsSync(target)) fail("RESOLVE", `target not found: ${target}`);
  // Path allowlist: only the canonical migrations dir (the apply-*.ts shape is
  // re-checked inside staticGate so the pure classifier is self-contained).
  const MIGRATIONS_DIR = path.resolve(process.cwd(), "packages/db/src/migrations");
  if (path.dirname(target) !== MIGRATIONS_DIR) {
    fail("RESOLVE", `target must live in packages/db/src/migrations/ (got ${path.relative(process.cwd(), target)}). Arbitrary paths are not auto-runnable.`);
  }

  const rawSrc = readFileSync(target, "utf8");
  console.log(`[verified-migrate] target: ${path.relative(process.cwd(), target)}`);

  // ---- GATE 1: STATIC — literal additive SQL, no arbitrary code ----
  // (Pure, exported, unit-tested. Defense-in-depth behind GATE 3.5.)
  const verdict = staticGate(rawSrc, path.basename(target));
  if (!verdict.ok) fail(verdict.stage || "STATIC", verdict.reason || "static gate failed");
  console.log("[verified-migrate] ✓ gate 1 STATIC — literal additive SQL · no destructive tokens · no arbitrary code · imports allowlisted");

  const want = declaredObjects(stripComments(rawSrc));

  // Release installs bind a migration to an immutable manifest entry and use
  // the ledger/evidence state machine below. Local legacy invocations retain
  // the historical gates, but are never treated as release-authorized.
  const authority = loadReleaseAuthority(target, rawSrc);
  if (dryRun) {
    console.log(`[verified-migrate] dry-run: PASS (static gate; no database, ledger, backup, or migration effects)`);
    if (authority) console.log(`[verified-migrate] dry-run: release ${authority.releaseVersion}, migration ${authority.migration.id}, order ${authority.migration.order}, checksum ${authority.migration.checksum}`);
    else console.log("[verified-migrate] dry-run: no .release/manifest.json; legacy migration path is not release-authorized");
    return;
  }

  if (!authority) fail("MANIFEST", "mutation requires an immutable release manifest and declared baseline; legacy direct execution is disabled");
  const baseline = process.env.BODHI_MIGRATION_BASELINE_SHA256;
  if (!baseline || !/^[a-f0-9]{64}$/.test(baseline)) fail("BASELINE", "BODHI_MIGRATION_BASELINE_SHA256 must name the reviewed live schema fingerprint");
  const db = getDb();

  if (authority) {
    const ledger = new PostgresMigrationLedger(db);
    const scrubbed = buildScrubbedEnv(process.env);
    if (!scrubbed.DATABASE_URL) fail("RUN", "no DATABASE_URL (or MIGRATE_DATABASE_URL) in the environment — the scrubbed child cannot reach Postgres.");
    const recoveryDatabaseUrl = process.env.DATABASE_URL;
    if (!recoveryDatabaseUrl) fail("BACKUP", "DATABASE_URL is required for the owner-authorized backup and rollback connection.");
    let attempt = 0;
    const runtime: SchemaMigrationRuntime = {
      expectedBeforeFingerprint: baseline,
      verifyBackup: async (backup) => verifyMigrationBackup(backup),
      // The migration child may use a least-privilege MIGRATE_DATABASE_URL,
      // but a full-cluster backup/clean restore must use the canonical owner
      // connection. Mixing those roles caused rollback to fail on objects the
      // migration role cannot own.
      backup: async () => pgBackup(recoveryDatabaseUrl, backupPathForAuthority()),
      snapshot: async () => {
        const structural = releaseEvidence(await snapshot(db));
        const reader = postgres(recoveryDatabaseUrl, { max: 1, onnotice: () => {}, connection: { timezone: "UTC" } });
        try {
          const actual = await databaseFingerprint(reader, postgresEnvironment(recoveryDatabaseUrl));
          return { ...structural, fingerprint: actual.schemaSha256,
            dataFingerprints: new Map(Object.entries(actual.tables).map(([table, evidence]) => [table, evidence.fingerprint])) };
        } finally { await reader.end(); }
      },
      // Keep the release attempt, evidence queries, backup, and rollback under
      // the same owner-authorized connection. A separately owned
      // MIGRATE_DATABASE_URL cannot ALTER or restore the owner's objects; mixing
      // roles made both the migration and rollback fail in the live bootstrap.
      // Re-enable a distinct role here only after the documented shared-owner
      // transfer has been completed and emission-verified.
      run: async () => runMigration(target, ++attempt, recoveryDatabaseUrl),
      restore: async (backup) => pgRestore(recoveryDatabaseUrl, backup),
    };
    // The release executor performs run + replay and records both successful
    // and failed attempts. The declared-object confirmation remains a final
    // readback because manifest checksums cannot describe catalog state.
    const result = await executeSchemaMigration(authority.migration, authority.releaseVersion, ledger, runtime);
    const missing: string[] = [];
    for (const t of want.tables) {
      const r = await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${t} LIMIT 1`);
      if ((r as unknown[]).length === 0) missing.push(`table ${t}`);
    }
    for (const c of want.columns) {
      const r = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=${c.table} AND column_name=${c.column} LIMIT 1`);
      if ((r as unknown[]).length === 0) missing.push(`column ${c.table}.${c.column}`);
    }
    for (const ty of want.types) {
      const r = await db.execute(sql`SELECT 1 FROM pg_type WHERE typname=${ty} LIMIT 1`);
      if ((r as unknown[]).length === 0) missing.push(`type ${ty}`);
    }
    if (missing.length > 0) fail("CONFIRM", `declared objects absent after migration: ${missing.join(", ")}`);
    if (result.status === "skipped") {
      console.log(`[verified-migrate] ✅ release migration already applied — ledger replay skipped (${authority.migration.id})`);
    } else {
      console.log(`[verified-migrate] ✅ release migration applied + replayed + evidenced (${authority.migration.id})`);
    }
    await closeDb();
    return;
  }

  // ---- GATE 2 + 3: RUN twice, assert idempotent ----
  const before = await snapshot(db);
  runMigration(target, 1);
  const afterRun1 = await snapshot(db);
  runMigration(target, 2);
  const afterRun2 = await snapshot(db);

  if (fingerprintOf(afterRun1) !== fingerprintOf(afterRun2)) {
    fail("IDEMPOTENT", "schema fingerprint changed between run 1 and run 2 — migration is NOT idempotent (missing an IF NOT EXISTS guard).");
  }
  console.log("[verified-migrate] ✓ gate 2 RUN — both runs exited 0");
  console.log("[verified-migrate] ✓ gate 3 IDEMPOTENT — second run was a zero-op (fingerprint identical)");

  // ---- GATE 3.5: NO DESTRUCTION (the real safety boundary) ----
  // Inspect the actual schema delta, not the source text. An additive migration
  // only ADDS objects; if anything that existed BEFORE is gone AFTER, a DROP
  // slipped past the lexical gate (string-concat / runtime-assembled DDL). HALT.
  const destroyed = destroyedObjects(before, afterRun1);
  if (destroyed.length > 0) {
    fail("NO-DESTRUCTION", `migration DESTROYED existing schema objects (additive migrations must not): ${destroyed.join(", ")}. The DB-delta gate caught what the source scan cannot.`);
  }
  console.log("[verified-migrate] ✓ gate 3.5 NO-DESTRUCTION — zero existing objects dropped (verified at DB layer, obfuscation-proof)");
  if (fingerprintOf(before) === fingerprintOf(afterRun1)) {
    console.log("[verified-migrate]   (note: schema unchanged — objects already existed; additive + idempotent, safe)");
  }

  // ---- GATE 3.6: DATA PRESERVATION (the row-count boundary) ----
  // A DELETE/TRUNCATE/UPDATE leaves every schema set identical, so GATE 3.5 is
  // blind to it. Compare per-table row counts before→after: an additive
  // migration must not REMOVE data. Obfuscation-proof (inspects the DB delta).
  const wiped = dataLosses(before, afterRun1);
  if (wiped.length > 0) {
    fail("DATA-PRESERVATION", `migration DESTROYED row data (additive migrations must not remove data): ${wiped.join(", ")}. The row-count gate caught what both the source scan and the schema set-diff cannot.`);
  }
  console.log("[verified-migrate] ✓ gate 3.6 DATA-PRESERVATION — no existing table lost rows (verified by count(*) delta, obfuscation-proof)");

  // ---- GATE 4: CONFIRM declared objects exist ----
  const missing: string[] = [];
  for (const t of want.tables) {
    const r = await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${t} LIMIT 1`);
    if ((r as unknown[]).length === 0) missing.push(`table ${t}`);
  }
  for (const c of want.columns) {
    const r = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=${c.table} AND column_name=${c.column} LIMIT 1`);
    if ((r as unknown[]).length === 0) missing.push(`column ${c.table}.${c.column}`);
  }
  for (const ty of want.types) {
    const r = await db.execute(sql`SELECT 1 FROM pg_type WHERE typname=${ty} LIMIT 1`);
    if ((r as unknown[]).length === 0) missing.push(`type ${ty}`);
  }
  if (missing.length > 0) {
    fail("CONFIRM", `declared objects absent after migration: ${missing.join(", ")}`);
  }
  const declared = [
    ...want.tables.map((t) => `table ${t}`),
    ...want.columns.map((c) => `column ${c.table}.${c.column}`),
    ...want.types.map((t) => `type ${t}`),
  ];
  console.log(`[verified-migrate] ✓ gate 4 CONFIRM — present: ${declared.length ? declared.join(", ") : "(no parseable object names — run succeeded)"}`);

  // ---- GATE 5: drizzle-kit never invoked (enforced by gate 1 + db/package.json) ----
  console.log("[verified-migrate] ✓ gate 5 NO-DRIZZLE-KIT — never invoked");

  console.log(`\n[verified-migrate] ✅ all gates green — migration applied autonomously + verified.`);
  await closeDb();
  process.exit(0);
}

// Run only when invoked directly (not when imported by the test, which would
// otherwise trigger main()'s process.exit). ESM __filename via import.meta.url.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(async (err) => {
    console.error("[verified-migrate] UNEXPECTED FAILURE:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(err instanceof VerifiedMigrationFailure ? 2 : 1);
  });
}
