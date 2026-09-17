#!/usr/bin/env node
// Link the owner-neutral skill templates into project skill discovery.
// Kept for `npm run skills:install`; the harness installer owns the logic:
// dry run by default, --apply to write, idempotent, and retired skill links are pruned.
// Defaults to Codex project discovery (.agents/skills); pass --harness both for .claude/skills too.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
const installer=fileURLToPath(new URL('./install-harness.mjs',import.meta.url));
const result=spawnSync(process.execPath,[installer,'--skills-only',...(args.some(a=>a==='--harness'||a.startsWith('--harness='))?[]:['--harness','codex']),...args],{stdio:'inherit'});
process.exitCode=result.status??1;
