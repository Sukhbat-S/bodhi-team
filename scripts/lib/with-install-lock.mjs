// Hold a native PostgreSQL advisory lock for one install root. No task/lock registry.
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
async function main() {
const [targetInput, command, ...args] = process.argv.slice(2);
const root = realpathSync(targetInput);
const require = createRequire(join(root, 'package.json'));
const postgres = require('postgres');
const { parse } = require('dotenv');
const env = parse(readFileSync(join(root, '.env')));
const url = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Upgrade locking requires the local owner database');
const sql = postgres(url.toString(), { max: 1, idle_timeout: 0, max_lifetime: 0, onnotice: () => {} });
let child;
try {
  const [{ acquired }] = await sql`SELECT pg_try_advisory_lock(hashtext(${JSON.stringify(['personal-release', root])})) AS acquired`;
  if (!acquired) throw new Error('Another upgrade owns this installation');
  const code = await new Promise((resolve, reject) => {
    child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, BODHI_INSTALL_LOCK_HELD: '1' } });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
    child.once('error', reject); child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally { await sql.end(); }

}
main().catch(error=>{ console.error(error instanceof Error ? error.message : "Installation lock failed"); process.exitCode=1; });
