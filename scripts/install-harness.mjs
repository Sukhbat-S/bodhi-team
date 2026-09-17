#!/usr/bin/env node
// Install the owner-neutral harness layer for Codex and Claude Code.
//
// Dry run by default: prints every planned change and the configuration to
// merge by hand. `--apply` writes only links and copies it can prove are safe:
//   - skill discovery symlinks into templates/personal/skills
//     (Codex: .agents/skills; Claude Code: .claude/skills and skill-evals/skills;
//     with --user-skills also ~/.agents/skills and ~/.claude/skills),
//   - Claude Code agent cards in ~/.claude/agents,
//   - a thin project CLAUDE.md when none exists.
// It never merges settings, never edits ~/.codex/config.toml, ~/.codex/hooks.json,
// ~/.claude/settings.json or global instruction files, never reads .env values,
// and never replaces a real file or directory that it did not create.
// Re-running is idempotent. `--force` backs up and replaces a differing agent card
// or project CLAUDE.md, and repoints a foreign skill symlink.
//
// `--unlink [--root <installed-checkout>]` removes only the project skill links
// (.agents/skills, .claude/skills, skill-evals/skills) whose target resolves into
// that checkout's templates/personal/skills, for example before a sealed-package
// upgrade, whose inventory refuses symlinks. It changes nothing else.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HARNESSES = ['codex', 'claude-code'];
const USAGE = [
  'usage: node scripts/install-harness.mjs [--harness codex|claude-code|both] [--user-skills] [--skills-only] [--force] [--apply]',
  '       node scripts/install-harness.mjs --unlink [--root <checkout>] [--apply]',
].join('\n');

function parseArguments(argv) {
  const options = { harness: 'both', apply: false, force: false, userSkills: false, skillsOnly: false, unlink: false, root: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--user-skills') options.userSkills = true;
    else if (argument === '--skills-only') options.skillsOnly = true;
    else if (argument === '--unlink') options.unlink = true;
    else if (argument === '--root') options.root = argv[++index] ?? '';
    else if (argument === '--harness') options.harness = argv[++index] ?? '';
    else if (argument.startsWith('--harness=')) options.harness = argument.slice('--harness='.length);
    else if (argument === '--help' || argument === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error(`unknown argument: ${argument}\n${USAGE}`); process.exit(2); }
  }
  if (![...HARNESSES, 'both'].includes(options.harness)) { console.error(`--harness must be codex, claude-code or both\n${USAGE}`); process.exit(2); }
  if (options.root !== null && (!options.unlink || !options.root)) { console.error(`--root <checkout> is accepted only with --unlink\n${USAGE}`); process.exit(2); }
  return { ...options, harnesses: options.harness === 'both' ? HARNESSES : [options.harness] };
}

const options = parseArguments(process.argv.slice(2));
const root = options.root ? resolve(options.root) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = homedir();
const skillSource = join(root, 'templates/personal/skills');
const counts = { create: 0, ok: 0, prune: 0, replace: 0, skip: 0 };
const verb = (word) => (options.apply ? word : `would ${word}`);
const show = (path) => (path.startsWith(root + sep) ? path.slice(root.length + 1) : path.startsWith(home + sep) ? `~/${path.slice(home.length + 1)}` : path);
const report = (kind, text) => { counts[kind] += 1; console.log(`  ${kind.padEnd(7)} ${text}`); };

function entryStat(path) {
  try { return lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function resolvesTo(linkPath, expected) {
  try { return realpathSync(linkPath) === realpathSync(expected); } catch { return false; }
}

function pointsIntoSkillSource(linkPath) {
  const target = resolve(dirname(linkPath), readlinkSync(linkPath));
  return target.startsWith(skillSource + sep) || target.startsWith(realpathSync(skillSource) + sep);
}

const PROJECT_SKILL_ROOTS = ['.agents/skills', '.claude/skills', 'skill-evals/skills'];

if (options.unlink) {
  if (!existsSync(skillSource)) { console.error(`not a BODHI checkout (no templates/personal/skills): ${root}`); process.exit(1); }
  console.log(`BODHI skill unlink (${options.apply ? 'apply' : 'dry run'}) · root: ${root}`);
  for (const relativeRoot of PROJECT_SKILL_ROOTS) {
    const directory = join(root, relativeRoot);
    if (!existsSync(directory)) continue;
    console.log(`\n${relativeRoot}`);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const link = join(directory, entry.name);
      if (!entry.isSymbolicLink()) { report('skip', `${entry.name}: not a symlink; left untouched`); continue; }
      if (!pointsIntoSkillSource(link)) { report('skip', `${entry.name}: points outside templates/personal/skills (${readlinkSync(link)}); left untouched`); continue; }
      if (options.apply) unlinkSync(link);
      report('prune', `${verb('remove')} ${entry.name}`);
    }
  }
  console.log(`\n${counts.prune} ${options.apply ? 'removed' : 'to remove'} · ${counts.skip} left untouched`);
  if (!options.apply) console.log('Dry run: nothing was removed. Re-run with --apply.');
  process.exit(0);
}

const skills = JSON.parse(readFileSync(join(root, 'configs/personal-skill-matrix.json'), 'utf8')).skills.map((skill) => skill.name);
for (const name of skills) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid skill name in matrix: ${name}`);
  if (!existsSync(join(skillSource, name, 'SKILL.md'))) throw new Error(`skill template is missing: ${name}`);
}

function linkSkillRoot(directory, relative) {
  console.log(`\n${show(directory)}`);
  for (const name of skills) {
    const link = join(directory, name);
    const target = relative ? `../../templates/personal/skills/${name}` : join(skillSource, name);
    const stat = entryStat(link);
    if (!stat) {
      if (options.apply) { mkdirSync(directory, { recursive: true }); symlinkSync(target, link, 'dir'); }
      report('create', `${verb('link')} ${name} -> ${target}`);
    } else if (!stat.isSymbolicLink()) {
      report('skip', `${name}: a real file or directory is in place; left untouched`);
    } else if (resolvesTo(link, join(skillSource, name))) {
      report('ok', name);
    } else if (options.force || pointsIntoSkillSource(link)) {
      if (options.apply) { unlinkSync(link); symlinkSync(target, link, 'dir'); }
      report('replace', `${verb('repoint')} ${name} -> ${target}`);
    } else {
      report('skip', `${name}: symlink points elsewhere (${readlinkSync(link)}); use --force to repoint`);
    }
  }
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const link = join(directory, entry.name);
    if (!entry.isSymbolicLink() || skills.includes(entry.name)) continue;
    if (!pointsIntoSkillSource(link)) continue;
    if (options.apply) unlinkSync(link);
    report('prune', `${verb('remove')} retired skill link ${entry.name}`);
  }
}

function backupPath(path) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  let candidate = `${path}.bak-${stamp}`;
  for (let suffix = 1; existsSync(candidate); suffix += 1) candidate = `${path}.bak-${stamp}-${suffix}`;
  return candidate;
}

function installFile(source, destination, mode) {
  const stat = entryStat(destination);
  const bytes = readFileSync(source);
  if (!stat) {
    if (options.apply) { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes, { mode, flag: 'wx' }); }
    report('create', `${verb('write')} ${show(destination)}`);
  } else if (!stat.isFile()) {
    report('skip', `${show(destination)} is not a regular file; left untouched`);
  } else if (readFileSync(destination).equals(bytes)) {
    report('ok', show(destination));
  } else if (options.force) {
    const backup = backupPath(destination);
    if (options.apply) { copyFileSync(destination, backup); writeFileSync(destination, bytes, { mode }); }
    report('replace', `${verb('back up')} to ${show(backup)} and ${verb('replace')} ${show(destination)}`);
  } else {
    report('skip', `${show(destination)} differs from the template; use --force to back up and replace`);
  }
}

const render = (text, escape) => text.split('$BODHI_ROOT').join(escape(root));
const jsonText = (value) => JSON.stringify(value).slice(1, -1);
const shellWord = (value) => (/^[A-Za-z0-9_./:@%+=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`);
const printBlock = (title, body) => console.log(`\n--- ${title} ---\n${body.trimEnd()}\n--- end ---`);

console.log(`BODHI harness install (${options.apply ? 'apply' : 'dry run'}) · harness: ${options.harness} · root: ${root}`);

for (const harness of options.harnesses) {
  console.log(`\n== ${harness}: skill discovery (${skills.length} skills)`);
  if (harness === 'codex') {
    linkSkillRoot(join(root, '.agents/skills'), true);
    if (options.userSkills) linkSkillRoot(join(home, '.agents/skills'), false);
  } else {
    linkSkillRoot(join(root, '.claude/skills'), true);
    if (existsSync(join(root, 'skill-evals/.claude-plugin/plugin.json'))) linkSkillRoot(join(root, 'skill-evals/skills'), true);
    if (options.userSkills) linkSkillRoot(join(home, '.claude/skills'), false);
  }
}

if (!options.skillsOnly) {
  const launcher = join(root, 'integrations/codex-plugin/bodhi/mcp/launch.sh');
  const envFile = join(root, '.env');

  if (options.harnesses.includes('claude-code')) {
    console.log('\n== claude-code: agents and instructions');
    for (const card of ['bodhi-scout.md', 'bodhi-crit.md', 'bodhi-impl.md']) {
      installFile(join(root, 'templates/claude-code/agents', card), join(home, '.claude/agents', card), 0o644);
    }
    installFile(join(root, 'templates/claude-code/CLAUDE.md.project-template'), join(root, 'CLAUDE.md'), 0o644);
    printBlock('merge by hand into ~/.claude/settings.json (hooks; subagent env limits need Claude Code v2.1.217 or later)',
      render(readFileSync(join(root, 'templates/claude-code/settings.snippet.json'), 'utf8'), jsonText));
    printBlock('register the BODHI MCP server for Claude Code (user scope)',
      `claude mcp add bodhi --scope user --env ${shellWord(`BODHI_ENV_FILE=${envFile}`)} -- /bin/bash ${shellWord(launcher)}\nclaude mcp list`);
    console.log(`\nGlobal instructions: review templates/claude-code/CLAUDE.md.global-template, fill its placeholders, and merge it into ~/.claude/CLAUDE.md yourself.`);
  }

  if (options.harnesses.includes('codex')) {
    console.log('\n== codex: MCP server, hooks and instructions');
    printBlock('merge by hand into ~/.codex/config.toml (its [mcp_servers.bodhi] block equals: codex mcp add bodhi --env BODHI_ENV_FILE=... -- /bin/bash .../launch.sh)',
      render(readFileSync(join(root, 'templates/codex/config.snippet.toml'), 'utf8'), jsonText));
    printBlock('merge by hand into ~/.codex/hooks.json',
      render(readFileSync(join(root, 'templates/codex/hooks.snippet.json'), 'utf8'), jsonText));
    printBlock('alternative to [mcp_servers.bodhi]: the bodhi plugin (finds .env only when this checkout is ~/bodhi or ~/Documents/bodhi)',
      `${readFileSync(join(root, 'templates/codex/marketplace.snippet.json'), 'utf8').trimEnd()}\n\n# merge the entry above into ~/.agents/plugins/marketplace.json, then:\nmkdir -p ~/plugins && ln -sfn ${shellWord(join(root, 'integrations/codex-plugin/bodhi'))} ~/plugins/bodhi\ncodex plugin add bodhi@personal`);
    console.log(`\nGlobal instructions: review templates/codex/AGENTS.md.global-template, fill its placeholders, and merge it into ~/.codex/AGENTS.md yourself.`);
  }

  console.log('\n== checks');
  if (/["$`\\]/.test(root)) console.log('  warn    this checkout path contains a quote, dollar sign, backtick or backslash: quote the hook commands by hand before merging them.');
  if (!existsSync(join(root, 'AGENTS.md'))) console.log('  warn    AGENTS.md is missing: the fresh-install bootstrap renders it from templates/personal/AGENTS.md.tpl; copy and fill that template for a source checkout.');
  if (spawnSync('jq', ['--version'], { stdio: 'ignore' }).status !== 0) console.log('  warn    jq is not on PATH: the identity and compaction hooks need it (brew install jq).');
  if (!existsSync(envFile)) console.log('  warn    .env is missing: the MCP server and hooks need this installation\'s private environment file.');
}

console.log(`\n${counts.create} create · ${counts.replace} replace · ${counts.prune} prune · ${counts.ok} ok · ${counts.skip} skipped`);
if (!options.apply) console.log('Dry run: nothing was written. Re-run with --apply to make the file changes above; configuration blocks are always merged by hand.');
