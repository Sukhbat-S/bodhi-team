#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validatePersonalReleaseManifest, ownerNeutralContentError } from './lib/release-contract.mjs';

/** Run this trusted verifier against incoming bytes; never execute an incoming verifier. */
export function verifyRelease(releaseRoot, expectedManifestSha256, prepared = false) {
  const errors = [];
  const root = realpathSync(resolve(releaseRoot));
  const manifestPath = resolve(root, '.release/manifest.json');
  const info = lstatSync(manifestPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Manifest must be a regular file');
  const bytes = readFileSync(manifestPath);
  const manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedManifestSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedManifestSha256) || expectedManifestSha256 !== manifestSha256)) {
    throw new Error('Release identity does not match the independently supplied manifest SHA-256');
  }
  const manifest = JSON.parse(bytes);
  errors.push(...validatePersonalReleaseManifest(manifest));
  if (errors.length) return { passed: false, errors, manifestSha256, identityPinned: Boolean(expectedManifestSha256) };
  const expected = new Set(manifest.artifacts.map((artifact) => artifact.path));
  for (const artifact of manifest.artifacts) {
    try {
      const target = resolve(root, artifact.path), stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || !realpathSync(target).startsWith(root + sep)) throw new Error('not a regular contained file');
      const bytes = readFileSync(target);
      if (ownerNeutralContentError(bytes)) errors.push(`${artifact.path} contains owner-specific content`);
      if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) errors.push(`${artifact.path} hash mismatch`);
    } catch { errors.push(`${artifact.path} cannot be verified`); }
  }
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name), path = relative(root, absolute).split(sep).join('/');
      if (prepared && (path === 'node_modules' || /^(apps|packages)\/[^/]+\/dist$/.test(path) || path.endsWith('.tsbuildinfo'))) continue;
      if (entry.isSymbolicLink()) errors.push(`${path} is an unexpected symbolic link`);
      else if (entry.isDirectory()) walk(absolute);
      else if (!entry.isFile()) errors.push(`${path} is not a regular file`);
      else if (path !== '.release/manifest.json' && !expected.has(path)) errors.push(`${path} is not listed in the manifest`);
    }
  }
  walk(root);
  return { passed: errors.length === 0, errors, manifest, manifestSha256, identityPinned: Boolean(expectedManifestSha256), artifacts: expected.size };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'expected-manifest-sha256': { type: 'string' }, json: { type: 'boolean' }, prepared: { type: 'boolean' } } });
    const result = verifyRelease(values.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'), values['expected-manifest-sha256'], values.prepared);
    if (values.json) console.log(JSON.stringify({ ...result, manifest: undefined }));
    else {
      console.log(`personal release package: ${result.passed ? 'PASS' : 'FAIL'} (${result.artifacts ?? 0} artifacts; ${result.identityPinned ? 'identity pinned' : 'integrity only, identity not pinned'})`);
      for (const error of result.errors) console.error(`- ${error}`);
    }
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
