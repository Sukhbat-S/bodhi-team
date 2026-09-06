import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv.indexOf('--output');
await build({ absWorkingDir: root, entryPoints: ['scripts/lib/release-contract.ts'], outfile: output < 0 ? resolve(root, 'scripts/lib/release-contract.mjs') : resolve(process.argv[output + 1]),
  platform: 'node', target: 'node24', bundle: true, format: 'esm', legalComments: 'none',
  banner: { js: '// Generated from release-contract.ts by scripts/build-release-contract.mjs. Do not edit.' } });
