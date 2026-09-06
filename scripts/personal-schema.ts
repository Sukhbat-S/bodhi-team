#!/usr/bin/env tsx
// Exact schema plan and verified recovery for an owner-approved local release.
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import postgres from 'postgres';
import { parse } from 'dotenv';
import { createPostgresBackup, databaseFingerprint, postgresEnvironment, runPostgres, verifyBackup, type BackupFingerprint } from './lib/postgres-backup.js';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, 'env-file': { type: 'string' },
    file: { type: 'string' }, 'backup-root': { type: 'string' }, 'approved-plan-sha256': { type: 'string' } } });
  const root = resolve(values.root ?? resolve(import.meta.dirname, '..'));
  const env = values['env-file'] ? { ...process.env, ...parse(readFileSync(values['env-file'])) } : process.env;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL or explicit --env-file required');
  const parsed = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('Personal schema operations require a local database');
  const childEnv = postgresEnvironment(env.DATABASE_URL);
  const planBytes = readFileSync(resolve(root, 'configs/personal-schema-plan.json'));
  const plan = JSON.parse(planBytes.toString());
  const planHash = createHash('sha256').update(planBytes).digest('hex');
  const bytesFor = (entry: { path: string; sha256?: string; checksum?: string }) => {
    if (!/^(packages\/db\/bootstrap\/personal-v[12]\.sql|packages\/db\/src\/migrations\/next-era-outcomes-(?:stage[12]|rollback)\.sql)$/.test(entry.path)) throw new Error('Unexpected schema plan path');
    const bytes = readFileSync(resolve(root, entry.path));
    if (createHash('sha256').update(bytes).digest('hex') !== (entry.sha256 ?? entry.checksum)) throw new Error('Schema plan bytes changed');
    return bytes;
  };
  bytesFor(plan.source); bytesFor(plan.target); bytesFor(plan.rollback);
  for (const migration of plan.migrations) bytesFor(migration);
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {}, connection: { timezone: 'UTC' } });
  const snapshot = () => databaseFingerprint(sql, childEnv);
  try {
    const action = positionals[0];
    if (positionals.length !== 1 || !['inspect', 'backup', 'apply', 'restore'].includes(action)) throw new Error('Expected inspect, backup, apply or restore');
    if (action === 'backup') {
      if (!values['backup-root']) throw new Error('--backup-root required');
      const result = await createPostgresBackup(env.DATABASE_URL, resolve(values['backup-root']));
      console.log(JSON.stringify({ file: result.path, sha256: result.manifest.sha256, schemaFingerprint: result.manifest.evidence.schemaSha256 }));
      return;
    }
    const before = await snapshot();
    if (action === 'inspect') {
      console.log(JSON.stringify({ fingerprint: before.schemaSha256, sourceMatch: before.schemaSha256 === plan.source.fingerprint,
        targetMatch: before.schemaSha256 === plan.target.fingerprint, approvedPlanSha256: planHash })); return;
    }
    if (values['approved-plan-sha256'] !== planHash) throw new Error('Mutation requires the exact independently approved schema-plan SHA-256');
    if (action === 'apply') {
      if (before.schemaSha256 === plan.target.fingerprint) { console.log(JSON.stringify({ status: 'unchanged', fingerprint: before.schemaSha256 })); return; }
      if (before.schemaSha256 !== plan.source.fingerprint) throw new Error('Live schema differs from the declared supported baseline');
      if (!values.file) throw new Error('--file must identify the verified pre-migration backup');
      const backup = await verifyBackup(values.file);
      if (JSON.stringify(backup.evidence) !== JSON.stringify(before)) throw new Error('Backup no longer matches the quiescent database');
      // Both reviewed stages commit as one transaction. Strip only their explicit
      // outer transaction delimiters; PL/pgSQL block bodies remain unchanged.
      await sql.begin(async (tx) => {
        for (const migration of plan.migrations) {
          const ddl = bytesFor(migration).toString('utf8').replace(/^BEGIN;\s*$/gm, '').replace(/^COMMIT;\s*$/gm, '');
          await tx.unsafe(ddl);
        }
      });
      const after = await snapshot();
      if (after.schemaSha256 !== plan.target.fingerprint) throw new Error('Migration emitted an unexpected schema; keep service stopped and restore the verified backup');
      console.log(JSON.stringify({ status: 'applied', fingerprint: after.schemaSha256, migrationChecksums: plan.migrations.map((m: { checksum: string }) => m.checksum) }));
      return;
    }
    if (!values.file) throw new Error('--file required for approved recovery');
    const backup = await verifyBackup(values.file);
    if (![plan.source.fingerprint, plan.target.fingerprint].includes(backup.evidence.schemaSha256)) throw new Error('Backup is outside the supported recovery baseline');
    if (JSON.stringify(before) === JSON.stringify(backup.evidence)) { console.log(JSON.stringify({ status: 'unchanged', fingerprint: before.schemaSha256, rowsAndPermissionsVerified: true })); return; }
    runPostgres('pg_restore', ['--clean', '--if-exists', '--exit-on-error', '--single-transaction', '--dbname', childEnv.PGDATABASE!, values.file], childEnv);
    if (backup.evidence.schemaSha256 === plan.source.fingerprint) await sql.unsafe(bytesFor(plan.rollback).toString('utf8'));
    const restored = await snapshot();
    if (JSON.stringify(restored) !== JSON.stringify(backup.evidence)) throw new Error('Recovery readback differs from the backup schema, rows or permissions; keep service stopped');
    console.log(JSON.stringify({ status: 'restored', fingerprint: restored.schemaSha256, backupSha256: backup.sha256, rowsAndPermissionsVerified: true }));
  } finally { await sql.end(); }
}
main().catch((error) => { console.error(error instanceof Error && !('query' in error) ? error.message : 'Schema operation failed; service must remain stopped'); process.exitCode = 1; });
