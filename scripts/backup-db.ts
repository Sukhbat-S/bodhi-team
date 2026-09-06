#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { resolveBackupDirectory } from '@seneca/core';
import { backupRetentionPlan, createPostgresBackup, restoreBackupDrill, verifyBackup } from './lib/postgres-backup.js';

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    'env-file': { type: 'string' }, 'local-root': { type: 'string' }, 'offsite-root': { type: 'string' },
    file: { type: 'string' }, keep: { type: 'string' }, 'receipt-root': { type: 'string' },
  } });
  const command = positionals[0];
  if (positionals.length !== 1 || !['create', 'verify', 'verify-latest', 'restore-drill', 'retention-plan'].includes(command)) {
    throw new Error('Usage: backup-db.ts create|verify|restore-drill|retention-plan [--env-file PATH] [--local-root PATH] [--offsite-root PATH] [--file PATH] [--receipt-root PATH] [--keep N]');
  }
  const env = values['env-file'] ? { ...process.env, ...parse(readFileSync(values['env-file'])) } : process.env;
  const root = resolve(values['local-root'] ?? resolveBackupDirectory(env));
  if (command === 'retention-plan') return backupRetentionPlan(root, Number(values.keep ?? 14));
  if (command === 'verify-latest') {
    const candidates = readdirSync(root).filter(name => /^bodhi_.*\.dump$/.test(name)).map(name => join(root, name)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
    if (!candidates[0]) throw new Error('No manifested continuity backup is available for integrity verification');
    const result = await verifyBackup(candidates[0]);
    return { file: result.file, sha256: result.sha256, integrity: result.integrity, restore: 'not-performed' };
  }
  if (command === 'verify') {
    if (!values.file) throw new Error('--file required');
    const result = await verifyBackup(values.file);
    return { file: result.file, sha256: result.sha256, integrity: result.integrity, restore: 'not-performed' };
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required via environment or explicit --env-file');
  if (command === 'restore-drill') {
    if (!values.file) throw new Error('--file required');
    return restoreBackupDrill(env.DATABASE_URL, values.file, resolve(values['receipt-root'] ?? join(root, 'restore-receipts')));
  }
  const backup = await createPostgresBackup(env.DATABASE_URL, root, values['offsite-root'] ?? env.BODHI_BACKUP_OFFSITE_ROOT);
  return { file: backup.path, sha256: backup.manifest.sha256, bytes: backup.manifest.bytes,
    integrity: backup.manifest.integrity, restore: backup.manifest.restore, offsite: backup.offsite,
    retention: await backupRetentionPlan(root, Number(values.keep ?? 14)) };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    // The library never includes private SQL/credentials in its own errors.
    console.error(error instanceof Error && !('query' in error) ? error.message : 'Backup operation failed');
    process.exitCode = 1;
  });
}
