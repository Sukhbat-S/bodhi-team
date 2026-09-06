import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, closeSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readdir, writeFile, copyFile, chmod, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import postgres from 'postgres';

export type BackupFingerprint = { schemaSha256: string; tables: Record<string, { count: number; fingerprint: string }>; securitySha256?: string };
export type BackupManifest = { contractVersion: 1; file: string; sha256: string; bytes: number; createdAt: string; evidence: BackupFingerprint; integrity: 'archive-readable'; restore: 'not-performed' };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Credentials travel only in the child environment, never command arguments or logs. */
export function postgresEnvironment(connection: string): NodeJS.ProcessEnv {
  const url = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected a PostgreSQL URL');
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'C', TZ: 'UTC', PGOPTIONS: '-c timezone=UTC',
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '10' };
  for (const [key, value] of url.searchParams) {
    if (key !== 'sslmode') throw new Error('Unsupported connection option for backup');
    env.PGSSLMODE = value;
  }
  return env;
}

export function runPostgres(program: string, args: string[], env: NodeJS.ProcessEnv, stdout?: number): Buffer {
  const result = spawnSync(program, args, { env, stdio: ['ignore', stdout ?? 'pipe', 'pipe'], timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  // PostgreSQL errors may include private SQL values; keep subprocess output out of receipts.
  if (result.error || result.status !== 0) throw new Error(`${program} failed (status ${result.status ?? 'unavailable'})`);
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
}

export async function fileHash(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

export function schemaHash(bytes: Buffer): string {
  // pg_dump 17+ generates a random psql restriction key on each invocation.
  return hash(bytes.toString('utf8').replace(/^\\(?:un)?restrict .*$/gm, '').replace(/^-- Dumped .*$/gm, ''));
}

export async function databaseFingerprint(sql: postgres.Sql | postgres.TransactionSql, env: NodeJS.ProcessEnv, snapshot?: string): Promise<BackupFingerprint> {
  const relations = await sql.unsafe<{ schemaname: string; tablename: string }[]>(`
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname, tablename`);
  const tables: BackupFingerprint['tables'] = {};
  for (const { schemaname, tablename } of relations) {
    // Row multiset hash: no private values leave PostgreSQL. Stable across row order.
    const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const rows = await sql.unsafe<{ count: number; fingerprint: string }[]>(`
      SELECT count(*)::int AS count,
        md5(COALESCE(string_agg(digest, '' ORDER BY digest), '')) AS fingerprint
      FROM (SELECT md5(to_jsonb(t)::text) AS digest FROM ${identifier(schemaname)}.${identifier(tablename)} AS t) AS rows`);
    tables[`${schemaname}.${tablename}`] = rows[0];
  }
  const schema = runPostgres('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', ...(snapshot ? ['--snapshot', snapshot] : [])], env);
  const security = await sql.unsafe(`SELECT jsonb_build_object(
    'relations', (SELECT jsonb_agg(jsonb_build_array(n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner),
      (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(c.relacl,
        acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) a)) ORDER BY n.nspname, c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'),
    'functions', (SELECT jsonb_agg(jsonb_build_array(n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner),
      (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(p.proacl, acldefault('f', p.proowner))) a)) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'),
    'schemas', (SELECT jsonb_agg(jsonb_build_array(nspname, pg_get_userbyid(nspowner),
      (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(nspacl, acldefault('n', nspowner))) a)) ORDER BY nspname)
      FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),
    'defaultPrivileges', (SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(d.defaclrole),
      COALESCE(n.nspname, ''), d.defaclobjtype,
      (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(d.defaclacl) a))
      ORDER BY pg_get_userbyid(d.defaclrole), COALESCE(n.nspname, ''), d.defaclobjtype)
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace)
  )::text AS state`);
  return { schemaSha256: schemaHash(schema), tables, securitySha256: hash(String(security[0].state)) };
}

async function privateRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) throw new Error('Backup root must be absolute');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Backup root must be a real directory');
  return realpathSync(root);
}

export async function createPostgresBackup(connection: string, root: string, offsiteRoot?: string): Promise<{ path: string; manifest: BackupManifest; offsite: string | null }> {
  const local = await privateRoot(root);
  const env = postgresEnvironment(connection);
  const createdAt = new Date().toISOString();
  const path = join(local, `bodhi_${createdAt.replaceAll(/[-:.TZ]/g, '')}_${randomUUID().slice(0, 8)}.dump`);
  const fd = openSync(path, 'wx', 0o600);
  const sql = postgres(connection, { max: 1, onnotice: () => {}, connection: { timezone: 'UTC' } });
  let evidence: BackupFingerprint;
  try {
    evidence = await sql.begin('isolation level repeatable read read only', async (tx) => {
      const [{ snapshot }] = await tx.unsafe<{ snapshot: string }[]>("SELECT pg_export_snapshot() AS snapshot");
      const result = await databaseFingerprint(tx, env, snapshot);
      runPostgres('pg_dump', ['--format=custom', '--snapshot', snapshot], env, fd);
      return result;
    });
  } finally { closeSync(fd); await sql.end(); }
  runPostgres('pg_restore', ['--list', path], env);
  const manifest: BackupManifest = { contractVersion: 1, file: basename(path), sha256: await fileHash(path), bytes: statSync(path).size,
    createdAt, evidence, integrity: 'archive-readable', restore: 'not-performed' };
  // A manifest is the completion marker. Partial backups remain unverified; no caller-path deletion.
  await writeFile(`${path}.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let offsite: string | null = null;
  if (offsiteRoot) {
    const remote = await privateRoot(offsiteRoot);
    if (remote === local) throw new Error('Offsite and local roots must differ');
    offsite = join(remote, basename(path));
    await copyFile(path, offsite, constants.COPYFILE_EXCL);
    await chmod(offsite, 0o600);
    if (await fileHash(offsite) !== manifest.sha256) throw new Error('Offsite copy hash mismatch');
    await writeFile(`${offsite}.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return { path, manifest, offsite };
}

export async function verifyBackup(path: string): Promise<BackupManifest> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Backup must be a regular file');
  const manifest = JSON.parse(readFileSync(`${path}.json`, 'utf8')) as BackupManifest;
  if (manifest.contractVersion !== 1 || manifest.file !== basename(path) || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || manifest.bytes !== info.size || !manifest.evidence?.schemaSha256 || !manifest.evidence.tables) throw new Error('Invalid backup manifest');
  if (await fileHash(path) !== manifest.sha256) throw new Error('Backup checksum mismatch');
  runPostgres('pg_restore', ['--list', path], { PATH: process.env.PATH, LANG: 'C' });
  return manifest;
}

/** Inventory only. Deletion requires an exact independently approved plan. */
export async function backupRetentionPlan(root: string, keep: number): Promise<{ keep: string[]; candidates: string[] }> {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Retention keep must be a positive integer');
  const directory = realpathSync(root);
  const names = (await readdir(directory)).filter((name) => /^bodhi_[a-zA-Z0-9_-]+\.(dump|sql\.gz)$/.test(name));
  const regular = [];
  for (const name of names) {
    const path = join(directory, name), info = await lstat(path);
    if (info.isFile() && !info.isSymbolicLink()) regular.push({ path, modified: info.mtimeMs });
  }
  regular.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  return { keep: regular.slice(0, keep).map((f) => f.path), candidates: regular.slice(keep).map((f) => f.path) };
}

export async function restoreBackupDrill(connection: string, path: string, receiptRoot: string): Promise<{ database: string; receipt: string; verified: boolean }> {
  const manifest = await verifyBackup(path); // before any database mutation
  const source = new URL(connection);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw new Error('Restore drills require a local PostgreSQL host');
  const database = `bodhi_restore_drill_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(connection); target.pathname = `/${database}`;
  const targetEnv = postgresEnvironment(target.toString());
  const adminUrl = new URL(connection); adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  let created = false;
  try {
    await admin`CREATE DATABASE ${admin(database)}`; created = true;
    runPostgres('pg_restore', ['--exit-on-error', '--single-transaction', '--dbname', database, path], targetEnv);
    const restored = postgres(target.toString(), { max: 1, onnotice: () => {}, connection: { timezone: 'UTC' } });
    let actual: BackupFingerprint;
    try { actual = await databaseFingerprint(restored, targetEnv); } finally { await restored.end(); }
    if (JSON.stringify(actual) !== JSON.stringify(manifest.evidence)) throw new Error('Restored schema or row fingerprints differ from the backup snapshot');
    const root = await privateRoot(receiptRoot), receipt = join(root, `${database}.json`);
    await writeFile(receipt, JSON.stringify({ contractVersion: 1, backup: resolve(path), backupSha256: manifest.sha256,
      database, verifiedAt: new Date().toISOString(), schemaSha256: actual.schemaSha256,
      securitySha256: actual.securitySha256, tables: actual.tables, restore: 'passed', isolation: 'new-local-database' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { database, receipt, verified: true };
  } finally {
    // Only the random database successfully created by this invocation is disposable.
    if (created) await admin`DROP DATABASE ${admin(database)}`;
    await admin.end();
  }
}
