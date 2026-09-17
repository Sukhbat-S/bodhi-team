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
// Topology (`--platform`, auto-detected when omitted):
//   - macos: the harness and BODHI both run on macOS.
//   - wsl: the harness runs inside the same Linux or WSL2 distribution as BODHI
//     (recommended on Windows): skill symlinks, hooks and stdio MCP are Linux-native.
//     Auto-detected on any Linux host.
//   - windows-host: BODHI runs in WSL2 and Codex or Claude Code runs on Windows. Run the
//     installer inside that WSL distribution. Skills and agent cards are copied (Windows
//     cannot follow WSL symlinks) into the Windows profile (%USERPROFILE%, found through WSL
//     interop or given with --windows-home); every copy carries a marker, and only marked
//     copies are refreshed or pruned. MCP and hook commands are printed through
//     `wsl.exe -d <distro> --exec ...`, so the server, .env and hooks stay inside WSL.
//
// `--unlink [--root <installed-checkout>]` removes only the project skill links
// (.agents/skills, .claude/skills, skill-evals/skills) whose target resolves into
// that checkout's templates/personal/skills, for example before a sealed-package
// upgrade, whose inventory refuses symlinks. It changes nothing else.
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HARNESSES = ['codex', 'claude-code'];
const USAGE = [
  'usage: node scripts/install-harness.mjs [--harness codex|claude-code|both] [--platform macos|wsl|windows-host [--windows-home <path>]] [--user-skills] [--skills-only] [--force] [--apply]',
  '       node scripts/install-harness.mjs --unlink [--root <checkout>] [--apply]',
  '--platform is auto-detected when omitted: macos on macOS, wsl on Linux and WSL2. Pass windows-host, inside WSL, for Codex or Claude Code running on Windows.',
].join('\n');

function parseArguments(argv) {
  const options = { harness: 'both', apply: false, force: false, userSkills: false, skillsOnly: false, unlink: false, root: null, platform: null, windowsHome: null };
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
    else if (argument === '--platform') options.platform = argv[++index] ?? '';
    else if (argument.startsWith('--platform=')) options.platform = argument.slice('--platform='.length);
    else if (argument === '--windows-home') options.windowsHome = argv[++index] ?? '';
    else if (argument === '--help' || argument === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error(`unknown argument: ${argument}\n${USAGE}`); process.exit(2); }
  }
  if (![...HARNESSES, 'both'].includes(options.harness)) { console.error(`--harness must be codex, claude-code or both\n${USAGE}`); process.exit(2); }
  if (options.root !== null && (!options.unlink || !options.root)) { console.error(`--root <checkout> is accepted only with --unlink\n${USAGE}`); process.exit(2); }
  if (options.platform !== null && !['macos', 'wsl', 'windows-host'].includes(options.platform)) { console.error(`--platform must be macos, wsl or windows-host\n${USAGE}`); process.exit(2); }
  if (options.windowsHome !== null && (options.platform !== 'windows-host' || !options.windowsHome)) { console.error(`--windows-home <path> is accepted only with --platform windows-host\n${USAGE}`); process.exit(2); }
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

const fail = (message) => { console.error(message); process.exit(1); };
const isWsl = process.platform === 'linux' && (Boolean(process.env.WSL_DISTRO_NAME) || (() => { try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch { return false; } })());
const topology = options.platform ?? (process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'wsl' : null);
if (topology === null) fail(`unsupported host ${process.platform}: run the installer on macOS, or inside Linux or WSL2`);
if (topology === 'macos' && process.platform !== 'darwin') fail('--platform macos requires macOS');
if (topology !== 'macos' && process.platform !== 'linux') fail(`--platform ${topology} runs inside the Linux or WSL2 distribution that holds this checkout`);
const topologyLabel = topology === 'wsl' && !isWsl ? 'linux' : topology;
const distro = process.env.WSL_DISTRO_NAME ?? '';
let windowsHome = null;
if (topology === 'windows-host') {
  if (!/^[A-Za-z0-9._-]+$/.test(distro)) fail('--platform windows-host must run inside the WSL distribution that holds this checkout (WSL_DISTRO_NAME is missing or unusual)');
  if (/^docker-desktop/i.test(distro)) fail(`refusing the ${distro} distribution: it belongs to Docker Desktop. Run the installer inside the BODHI distribution, for example: wsl.exe -d Ubuntu-24.04`);
  if (Number(process.versions.node.split('.')[0]) !== 24 || /^\/mnt\//.test(process.execPath)) fail(`--platform windows-host needs the Linux-native Node 24 that runs BODHI (found ${process.execPath} ${process.version}); the printed MCP command pins it`);
  if (!/^[A-Za-z0-9_.\/+@-]+$/.test(root)) fail('--platform windows-host needs a checkout path of letters, digits and . _ - + @ only: the printed wsl.exe commands pass it unquoted so PowerShell, cmd, TOML and JSON all read it the same way');
  windowsHome = options.windowsHome ? resolve(options.windowsHome) : (() => {
    // With [interop] appendWindowsPath=false, cmd.exe is off PATH but WSL interop still runs it by full path.
    const profile = ['cmd.exe', '/mnt/c/Windows/System32/cmd.exe'].map((cmd) => spawnSync(cmd, ['/d', '/c', 'echo %USERPROFILE%'], { encoding: 'utf8', cwd: existsSync('/mnt/c') ? '/mnt/c' : undefined })).find((result) => result.status === 0);
    const windowsPath = profile ? profile.stdout.trim() : '';
    const converted = windowsPath && !windowsPath.includes('%') ? spawnSync('wslpath', ['-u', windowsPath], { encoding: 'utf8' }) : null;
    return converted?.status === 0 ? converted.stdout.trim() : null;
  })();
  if (!windowsHome) fail('cannot locate the Windows user profile through WSL interop; pass --windows-home with the /mnt path of %USERPROFILE%');
  try { if (!statSync(windowsHome).isDirectory()) throw new Error(); } catch { fail(`Windows user profile is not a directory: ${windowsHome}`); }
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

const COPY_MARKER = '.bodhi-harness-copy';
function treeDigest(directory) {
  const hash = createHash('sha256');
  const walk = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (!prefix && entry.name === COPY_MARKER) continue;
      const path = join(current, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { hash.update(`d ${relativePath}\n`); walk(path, relativePath); }
      else if (entry.isFile()) { hash.update(`f ${relativePath}\n`); hash.update(readFileSync(path)); }
      else hash.update(`o ${relativePath}\n`);
    }
  };
  walk(directory, '');
  return hash.digest('hex');
}

// Windows-side harnesses cannot follow symlinks that live in the WSL filesystem, so
// windows-host installs real copies. Only a directory carrying COPY_MARKER is ever
// refreshed or pruned; anything else is left alone unless --force backs it up first.
function copySkillRoot(directory) {
  console.log(`\n${show(directory)} (copies)`);
  for (const name of skills) {
    const destination = join(directory, name);
    const source = join(skillSource, name);
    const stat = entryStat(destination);
    const install = () => {
      rmSync(destination, { recursive: true, force: true });
      cpSync(source, destination, { recursive: true });
      writeFileSync(join(destination, COPY_MARKER), 'Copied by BODHI scripts/install-harness.mjs --platform windows-host. Re-run it to refresh; it replaces or prunes only directories carrying this file.\n');
    };
    if (!stat) {
      if (options.apply) { mkdirSync(directory, { recursive: true }); install(); }
      report('create', `${verb('copy')} ${name}`);
    } else if (stat.isSymbolicLink() || !stat.isDirectory()) {
      report('skip', `${name}: not a real directory; left untouched`);
    } else if (!existsSync(join(destination, COPY_MARKER))) {
      if (options.force) {
        // Back up outside the discovery root, so the harness never loads the backup as a second skill.
        const backup = backupPath(join(dirname(directory), '.bodhi-harness-backups', basename(directory), name));
        if (options.apply) { mkdirSync(dirname(backup), { recursive: true }); renameSync(destination, backup); install(); }
        report('replace', `${verb('move')} ${name} to ${show(backup)} and ${verb('copy')} ${name}`);
      } else {
        report('skip', `${name}: a directory this installer did not copy is in place; use --force to back it up and replace`);
      }
    } else if (treeDigest(destination) === treeDigest(source)) {
      report('ok', name);
    } else {
      if (options.apply) install();
      report('replace', `${verb('refresh')} ${name}`);
    }
  }
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!entry.isDirectory() || skills.includes(entry.name) || !existsSync(join(path, COPY_MARKER))) continue;
    if (options.apply) rmSync(path, { recursive: true, force: true });
    report('prune', `${verb('remove')} retired skill copy ${entry.name}`);
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

// windows-host: every command crosses into WSL as plain, unquoted words, which PowerShell,
// cmd, Git Bash, TOML and JSON all pass through unchanged. `--exec` skips the default shell,
// so nothing is parsed twice; /usr/bin/env carries the variables WSL would not forward.
const wslWords = (...words) => ['wsl.exe', '-d', distro, '--exec', ...words];
function windowsHostHookCommand(command) {
  const match = /^(BODHI_ROOT="\$BODHI_ROOT" )?bash "\$BODHI_ROOT\/([^"]+)"((?: [a-z-]+)*)$/.exec(command);
  if (!match) throw new Error(`hook command has no Windows-host rendering: ${command}`);
  const environment = match[1] ? ['/usr/bin/env', `BODHI_ROOT=${root}`] : [];
  return wslWords(...environment, '/bin/bash', `${root}/${match[2]}`, ...match[3].split(' ').filter(Boolean)).join(' ');
}
function windowsHostHooks(text) {
  const value = JSON.parse(text);
  for (const groups of Object.values(value.hooks)) for (const group of groups) for (const hook of group.hooks) hook.command = windowsHostHookCommand(hook.command);
  return `${JSON.stringify(value, null, 2)}\n`;
}
const CODEX_MCP_BLOCK = '[mcp_servers.bodhi]\ncommand = "/bin/bash"\nargs = ["$BODHI_ROOT/integrations/codex-plugin/bodhi/mcp/launch.sh"]\n\n[mcp_servers.bodhi.env]\nBODHI_ENV_FILE = "$BODHI_ROOT/.env"\n';
// BODHI_NODE pins the Linux Node 24 running this installer, so a Windows node or npm on the
// interop PATH can never be selected and no login shell is needed to find Node.
const mcpWords = () => wslWords('/usr/bin/env', `BODHI_ENV_FILE=${join(root, '.env')}`, `BODHI_NODE=${process.execPath}`, '/bin/bash', join(root, 'integrations/codex-plugin/bodhi/mcp/launch.sh'));
function windowsHostCodexConfig(text) {
  if (!text.includes(CODEX_MCP_BLOCK)) throw new Error('templates/codex/config.snippet.toml changed: update the windows-host rendering in install-harness.mjs');
  const [command, ...args] = mcpWords();
  return text.replace(CODEX_MCP_BLOCK, `[mcp_servers.bodhi]\ncommand = ${JSON.stringify(command)}\nargs = [${args.map((arg) => JSON.stringify(arg)).join(', ')}]\n`);
}

console.log(`BODHI harness install (${options.apply ? 'apply' : 'dry run'}) · harness: ${options.harness}${topology === 'macos' ? '' : ` · platform: ${topologyLabel}${topology === 'windows-host' ? ` (WSL distribution ${distro}, Windows profile ${windowsHome})` : ''}`} · root: ${root}`);

for (const harness of options.harnesses) {
  console.log(`\n== ${harness}: skill discovery (${skills.length} skills)`);
  if (topology === 'windows-host') {
    copySkillRoot(join(windowsHome, harness === 'codex' ? '.agents/skills' : '.claude/skills'));
  } else if (harness === 'codex') {
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
      installFile(join(root, 'templates/claude-code/agents', card), join(windowsHome ?? home, '.claude/agents', card), 0o644);
    }
    installFile(join(root, 'templates/claude-code/CLAUDE.md.project-template'), join(root, 'CLAUDE.md'), 0o644);
    if (topology === 'windows-host') {
      const settings = readFileSync(join(root, 'templates/claude-code/settings.snippet.json'), 'utf8');
      printBlock('merge by hand into %USERPROFILE%\\.claude\\settings.json on Windows (hooks run inside WSL; subagent env limits need Claude Code v2.1.217 or later)', windowsHostHooks(settings));
      printBlock('register the BODHI MCP server for Claude Code on Windows (user scope; PowerShell or cmd)',
        `claude mcp add bodhi --scope user -- ${mcpWords().join(' ')}\nclaude mcp list`);
      console.log('\nGlobal instructions: review templates/claude-code/CLAUDE.md.global-template, fill its placeholders, and merge it into %USERPROFILE%\\.claude\\CLAUDE.md yourself.');
    } else {
      printBlock('merge by hand into ~/.claude/settings.json (hooks; subagent env limits need Claude Code v2.1.217 or later)',
        render(readFileSync(join(root, 'templates/claude-code/settings.snippet.json'), 'utf8'), jsonText));
      printBlock('register the BODHI MCP server for Claude Code (user scope)',
        `claude mcp add bodhi --scope user --env ${shellWord(`BODHI_ENV_FILE=${envFile}`)} -- /bin/bash ${shellWord(launcher)}\nclaude mcp list`);
      console.log(`\nGlobal instructions: review templates/claude-code/CLAUDE.md.global-template, fill its placeholders, and merge it into ~/.claude/CLAUDE.md yourself.`);
    }
  }

  if (options.harnesses.includes('codex')) {
    console.log('\n== codex: MCP server, hooks and instructions');
    if (topology === 'windows-host') {
      printBlock('merge by hand into %USERPROFILE%\\.codex\\config.toml on Windows (the MCP server runs inside WSL through wsl.exe)',
        windowsHostCodexConfig(readFileSync(join(root, 'templates/codex/config.snippet.toml'), 'utf8')));
      printBlock('merge by hand into %USERPROFILE%\\.codex\\hooks.json on Windows (the hook runs inside WSL)',
        windowsHostHooks(readFileSync(join(root, 'templates/codex/hooks.snippet.json'), 'utf8')));
      console.log('\nThe bodhi plugin alternative is unavailable from Windows: it cannot reach this WSL checkout\'s .env. Use the [mcp_servers.bodhi] block above.');
      console.log('Global instructions: review templates/codex/AGENTS.md.global-template, fill its placeholders, and merge it into %USERPROFILE%\\.codex\\AGENTS.md yourself.');
    } else {
      printBlock('merge by hand into ~/.codex/config.toml (its [mcp_servers.bodhi] block equals: codex mcp add bodhi --env BODHI_ENV_FILE=... -- /bin/bash .../launch.sh)',
        render(readFileSync(join(root, 'templates/codex/config.snippet.toml'), 'utf8'), jsonText));
      printBlock('merge by hand into ~/.codex/hooks.json',
        render(readFileSync(join(root, 'templates/codex/hooks.snippet.json'), 'utf8'), jsonText));
      printBlock('alternative to [mcp_servers.bodhi]: the bodhi plugin (finds .env only when this checkout is ~/bodhi or ~/Documents/bodhi)',
        `${readFileSync(join(root, 'templates/codex/marketplace.snippet.json'), 'utf8').trimEnd()}\n\n# merge the entry above into ~/.agents/plugins/marketplace.json, then:\nmkdir -p ~/plugins && ln -sfn ${shellWord(join(root, 'integrations/codex-plugin/bodhi'))} ~/plugins/bodhi\ncodex plugin add bodhi@personal`);
      console.log(`\nGlobal instructions: review templates/codex/AGENTS.md.global-template, fill its placeholders, and merge it into ~/.codex/AGENTS.md yourself.`);
    }
  }

  if (topology === 'wsl') {
    console.log(`\n== topology: harness inside ${isWsl ? `WSL${distro ? ` (${distro})` : ''}` : 'Linux'}`);
    console.log('  Install and sign in to Codex CLI and Claude Code inside this distribution, and start them from a Linux shell in your project.');
    console.log('  The skill links, hooks and the stdio MCP server above are Linux-native. Run the claude/codex commands above in that Linux shell.');
    if (isWsl) console.log('  The dashboard is reachable from Windows at http://localhost:PORT through WSL localhost forwarding. To run the harness on Windows instead, re-run with --platform windows-host.');
  } else if (topology === 'windows-host') {
    console.log(`\n== topology: harness on Windows, BODHI inside WSL (${distro})`);
    console.log('  Skills and agent cards are copied into the Windows profile. Re-run this installer after every BODHI upgrade to refresh the copies.');
    console.log('  The MCP server, hooks and .env stay inside WSL; Windows reaches them only through wsl.exe. jq must be installed inside WSL.');
    console.log('  Hooks receive Windows paths as the working directory, so the identity hook reports that path and the compaction note carries no Git state.');
  }

  console.log('\n== checks');
  if (/["$`\\]/.test(root)) console.log('  warn    this checkout path contains a quote, dollar sign, backtick or backslash: quote the hook commands by hand before merging them.');
  if (!existsSync(join(root, 'AGENTS.md'))) console.log('  warn    AGENTS.md is missing: the fresh-install bootstrap renders it from templates/personal/AGENTS.md.tpl; copy and fill that template for a source checkout.');
  if (spawnSync('jq', ['--version'], { stdio: 'ignore' }).status !== 0) console.log(`  warn    jq is not on PATH: the identity and compaction hooks need it (${topology === 'macos' ? 'brew install jq' : 'sudo apt-get install jq'}).`);
  if (topology !== 'macos' && /^\/mnt\/[a-zA-Z]\//.test(root)) console.log('  warn    this checkout is on the Windows filesystem (/mnt): .env cannot stay private there; move BODHI into the Linux filesystem (docs/windows-wsl2.md).');
  if (!existsSync(envFile)) console.log('  warn    .env is missing: the MCP server and hooks need this installation\'s private environment file.');
}

console.log(`\n${counts.create} create · ${counts.replace} replace · ${counts.prune} prune · ${counts.ok} ok · ${counts.skip} skipped`);
if (!options.apply) console.log('Dry run: nothing was written. Re-run with --apply to make the file changes above; configuration blocks are always merged by hand.');
