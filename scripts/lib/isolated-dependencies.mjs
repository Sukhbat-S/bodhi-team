#!/usr/bin/env node
// macOS dependency preparation: no owner environment or private state is attached.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const PRIVATE_PATHS = ['.env', 'AGENTS.md', 'private', 'backups', 'logs', 'data', 'exports', 'onboarding', 'profiles', '.bodhi'];
const quote = (path) => JSON.stringify(path);

export function isolatedBuildContext(stageRoot) {
  if (process.platform !== 'darwin' || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Isolated dependency builds require macOS and Node 24');
  const root = realpathSync(stageRoot);
  if (!lstatSync(stageRoot).isDirectory() || lstatSync(stageRoot).isSymbolicLink()) throw new Error('Stage must be a real directory');
  for (const name of PRIVATE_PATHS) if (existsSync(join(root, name))) throw new Error(`Private state must not be attached before dependency preparation: ${name}`);
  const scratch = mkdtempSync(join(root, '.dependency-build-'));
  mkdirSync(join(scratch, 'tmp')); mkdirSync(join(scratch, 'cache'));
  writeFileSync(join(scratch, 'empty.npmrc'), '', { mode: 0o600 });
  writeFileSync(join(scratch, 'empty-global.npmrc'), '', { mode: 0o600 });
  const nodeRoot = dirname(dirname(realpathSync(process.execPath)));
  const profile = `(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library/Apple") (subpath "/Library/Developer") (subpath "/private/preboot") (subpath "/private/var/db/dyld") (subpath "/opt/homebrew")
  (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/null") (literal "/private/etc/resolv.conf") (literal "/private/var/run/resolv.conf") (literal "/private/etc/hosts") (literal "/Library/Preferences/com.apple.networkd.plist")
  (subpath ${quote(nodeRoot)}) (subpath ${quote(root)}))
(allow file-write* (subpath ${quote(root)}) (literal "/dev/null"))
(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.logger") (global-name "com.apple.logd") (global-name "com.apple.cfprefsd.daemon") (global-name "com.apple.mDNSResponder") (global-name "com.apple.networkd") (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.SystemConfiguration.DNSConfiguration") (global-name "com.apple.trustd.agent"))
(allow network-outbound (literal "/private/var/run/mDNSResponder") (remote tcp "*:443") (remote udp "*:53"))`;
  const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: join(scratch, 'tmp'),
    CI: 'true', NO_COLOR: '1', LANG: 'en_US.UTF-8', npm_config_cache: join(scratch, 'cache'), npm_config_userconfig: join(scratch, 'empty.npmrc'),
    npm_config_globalconfig: join(scratch, 'empty-global.npmrc'), npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false' };
  return {
    root, scratch, env,
    run(command, args, extraEnv = {}) {
      const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, command, ...args], {
        cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) {
        const error = new Error(`Isolated build command failed: ${command} (status ${result.status ?? 'unavailable'}, error ${result.error?.code ?? 'none'}, signal ${result.signal ?? 'none'}): ${(result.stderr ?? '').slice(-3000)}`);
        error.capturedStdout = result.stdout;
        throw error;
      }
      return result.stdout;
    },
    close() { rmSync(scratch, { recursive: true, force: true }); },
  };
}

export function proveBuildIsolation(stageRoot, privateProbeFile) {
  const context = isolatedBuildContext(stageRoot);
  try {
    const result = JSON.parse(context.run(process.execPath, ['-e', `
      const fs = require('node:fs');
      const exposed = ['DATABASE_URL','VOYAGE_API_KEY','BODHI_API_TOKEN','OPENAI_API_KEY','BODHI_BUILD_SECRET_SENTINEL'].some((key) => process.env[key]);
      let readable = false; try { fs.readFileSync(process.argv[1]); readable = true; } catch (error) { if (!['EACCES','EPERM'].includes(error.code)) throw error; }
      process.stdout.write(JSON.stringify({ ownerEnvironmentAbsent: !exposed, privateFileDenied: !readable }));
    `, realpathSync(privateProbeFile)]));
    if (!result.ownerEnvironmentAbsent || !result.privateFileDenied) throw new Error('Dependency build isolation probe failed');
    return result;
  } finally { context.close(); }
}

export function prepareDependencies(stageRoot, privateProbeFile) {
  const proof = proveBuildIsolation(stageRoot, privateProbeFile);
  const context = isolatedBuildContext(stageRoot);
  let failed = false;
  try {
    context.run('/opt/homebrew/bin/npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    // The one required native binding builds before owner files or credentials exist.
    context.run('/opt/homebrew/bin/npm', ['rebuild', 'better-sqlite3', '--ignore-scripts=false'], { npm_config_ignore_scripts: 'false' });
    context.run('/opt/homebrew/bin/npm', ['run', '_build:workspaces', '--ignore-scripts']);
    const emitted = JSON.parse(context.run(process.execPath, ['-e', `const DB=require('better-sqlite3');const db=new DB(':memory:');const value=db.prepare('select 42 as n').get().n;db.close();process.stdout.write(JSON.stringify({sqlite:value,node:process.versions.node}));`]));
    if (emitted.sqlite !== 42 || !emitted.node.startsWith('24.')) throw new Error('Native binding/runtime probe failed');
    return { ...proof, nativeBinding: 'passed', workspaceBuild: 'passed', node: emitted.node };
  } catch (error) { failed = true; throw error; } finally { if (!failed) context.close(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'private-probe': { type: 'string' }, 'probe-only': { type: 'boolean' } } });
    if (!values.root || !values['private-probe']) throw new Error('--root and --private-probe are required');
    console.log(JSON.stringify(values['probe-only'] ? proveBuildIsolation(resolve(values.root), values['private-probe']) : prepareDependencies(resolve(values.root), values['private-probe'])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
