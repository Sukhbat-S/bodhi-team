#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validatePersonalReleaseManifest } from './release-contract.mjs';

export const DEFAULT_PRIVATE_PATHS = ['.env', 'AGENTS.md', 'private', 'backups', 'logs', 'data', 'exports', 'onboarding', 'profiles', 'configs/persona', '.bodhi', 'configs/project-routing.json', 'configs/skill-matrix.json'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safe = (path) => typeof path === 'string' && path && !path.startsWith('/') && !path.includes('\\') && !/[\x00-\x1f\x7f]/.test(path) && path.split('/').every((part) => part && part !== '.' && part !== '..');
const under = (path, root) => path === root || path.startsWith(root + '/');

export function compareReleaseVersions(left, right) {
  const parse = (value) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) throw new Error('Invalid release version');
    const numbers = match.slice(1, 4).map(Number);
    if (numbers.some((n) => !Number.isSafeInteger(n))) throw new Error('Release version number is too large');
    return { numbers, pre: match[4]?.split('.') };
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return Math.sign(a.numbers[i] - b.numbers[i]);
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1; if (!b.pre) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i]; if (x === y) continue;
    if (x === undefined) return -1; if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function inspectInstalledState(rootInput, extraPrivate = []) {
  const root = realpathSync(rootInput);
  for (const path of extraPrivate) if (!safe(path)) throw new Error('Unsafe explicit private path');
  const manifest = JSON.parse(readFileSync(resolve(root, '.release/manifest.json'), 'utf8'));
  const errors = validatePersonalReleaseManifest(manifest);
  if (errors.length) throw new Error(`Installed release manifest is invalid: ${errors.join('; ')}`);
  const artifacts = new Set(manifest.artifacts.map((artifact) => artifact.path));
  const privatePaths = [...new Set([...DEFAULT_PRIVATE_PATHS, ...extraPrivate])].sort();
  for (const path of privatePaths) if ([...artifacts].some((artifact) => under(artifact, path))) throw new Error(`Private path overlaps immutable release artifacts: ${path}`);
  for (const artifact of manifest.artifacts) {
    const path = resolve(root, artifact.path), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !realpathSync(path).startsWith(root + sep) || sha(readFileSync(path)) !== artifact.sha256) throw new Error(`Installed source drifted: ${artifact.path}`);
  }
  const unknown = [], privateFiles = {};
  const generated = (path) => under(path, 'node_modules') || /^(apps|packages)\/[^/]+\/dist(?:\/|$)/.test(path)
    || path.endsWith('.tsbuildinfo') || ['.release/manifest.json', '.release/installation.json', '.server.pid', '.dashboard.pid'].includes(path);
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = resolve(dir, entry.name), path = relative(root, absolute).split(sep).join('/');
      if (generated(path)) continue;
      const isPrivate = privatePaths.some((prefix) => under(path, prefix));
      if (entry.isSymbolicLink()) throw new Error(`Symlink needs separate preservation review: ${path}`);
      if (entry.isDirectory()) walk(absolute);
      else if (!entry.isFile()) throw new Error(`Special file needs separate preservation review: ${path}`);
      else if (isPrivate) privateFiles[path] = { sha256: sha(readFileSync(absolute)), mode: lstatSync(absolute).mode & 0o777 };
      else if (!artifacts.has(path)) unknown.push(path);
    }
  }
  walk(root);
  return { manifest, privatePaths: privatePaths.filter((path) => existsSync(resolve(root, path))), privateFiles, unknown: unknown.sort() };
}

export function verifyPrivateCopy(root, expected) {
  for (const [path, proof] of Object.entries(expected)) {
    if (!safe(path)) throw new Error('Unsafe private evidence path');
    const target = resolve(root, path), stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || sha(readFileSync(target)) !== proof.sha256 || (stat.mode & 0o777) !== proof.mode) throw new Error(`Private copy does not match preserved evidence: ${path}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, output: { type: 'string' }, preserve: { type: 'string', multiple: true }, evidence: { type: 'string' } } });
    if (positionals[0] === 'compare-version') console.log(compareReleaseVersions(positionals[1], positionals[2]));
    else if (positionals[0] === 'inventory') {
      const result = inspectInstalledState(values.root, values.preserve ?? []);
      if (result.unknown.length) throw new Error(`Unclassified owner files require an explicit --preserve path: ${result.unknown.join(', ')}`);
      if (!values.output) throw new Error('--output required for private preservation inventory');
      writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      console.log(JSON.stringify({ privateFiles: Object.keys(result.privateFiles).length, unknownFiles: 0 }));
    } else if (positionals[0] === 'verify-copy') {
      verifyPrivateCopy(values.root, JSON.parse(readFileSync(values.evidence, 'utf8')).privateFiles);
      console.log(JSON.stringify({ privateCopy: 'verified' }));
    } else throw new Error('Expected inventory, verify-copy, or compare-version');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
