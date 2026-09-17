# BODHI — team distribution

BODHI is a local, single-user personal truth and control substrate. It stores an owner’s memories, entities, decisions and verification evidence. The active harness, Codex or Claude Code, owns reasoning, tools, tasks, scheduling and delegation; BODHI never runs a model or a task queue.

This repository distributes reusable source and skills. It contains no owner database, personal records, credentials or original private Git history. Each teammate runs a separate instance with their own data and permissions. This is not a shared multi-user server.

## Status

Version 1.1.0-preview.2 is a private preview for technical teammates. Source builds and automated checks are documented in the release notes; a clean-machine installation and every external connector are not yet certified. Initial installation support is macOS (Apple Silicon and Intel), with Node 24, npm 11, Homebrew PostgreSQL 18, pgvector and `jq`. Windows installation is not covered by this preview.

## First installation

1. Download the versioned source package and SHA256SUMS from this repository’s Releases page. Compare its checksum with the release notes before executing it.
2. Extract it to a new directory outside an existing BODHI installation. The release package includes a pinned `.release/manifest.json`; a raw GitHub source ZIP does not.
3. Install the prerequisites above. Review the scripts before running them. Each person needs their own local PostgreSQL account/database and, for semantic embeddings, their own Voyage API access. Do not reuse another owner’s configuration.
4. From the extracted package, run a dry preflight:

```bash
bash scripts/bootstrap-personal-macos.sh --owner "Your name" --assistant "BODHI" --database bodhi_personal --port 4000 --expected-manifest-sha256 MANIFEST_HASH_FROM_RELEASE
```

5. After reviewing the preflight, append `--apply --defer-voyage` to create a fresh local installation without entering a provider key. This creates local private configuration/database state and may register the local service as described by the script. It refuses an existing database, environment file or owner instructions.
6. Add your own Voyage configuration locally, then follow `scripts/activate-personal-voyage-macos.sh --help` usage. Never commit the key. The server stays on loopback by default.
7. Install the harness layer (next section).

## Codex and Claude Code

Both harnesses run over the same substrate, skills, trust policy and memory ([ADR-004](docs/decisions/ADR-004-peer-harness-claude-code.md)). The head-and-worker pattern, model routing, and the rules both harnesses share are in [docs/dual-harness-orchestration.md](docs/dual-harness-orchestration.md).

```bash
npm run harness:install                       # dry run for both harnesses; prints every change and config block
npm run harness:install -- --apply            # write skill links, Claude Code agent cards, thin CLAUDE.md
npm run harness:install -- --apply --user-skills   # also link the skills into ~/.agents/skills and ~/.claude/skills
```

Use `--harness codex` or `--harness claude-code` to install one side only. The installer is idempotent. It never merges settings or edits `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.claude/settings.json` or global instruction files, never reads `.env` values, and never replaces a file it did not create unless you pass `--force` (which backs the file up first). It prints, with this checkout's path filled in:

- **Claude Code:** the `settings.json` hooks (SessionStart identity, PreCompact checkpoint, post-compaction recall) and the documented subagent limits `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (Claude Code v2.1.217 or later); the `claude mcp add bodhi --scope user …` command. Global instructions: `templates/claude-code/CLAUDE.md.global-template`.
- **Codex:** the `config.toml` block that registers the MCP server, the `hooks.json` SessionStart block, and the plugin alternative. Global instructions: `templates/codex/AGENTS.md.global-template`.

Both harnesses run the same bundled MCP server (`integrations/codex-plugin/bodhi/mcp/launch.sh`, 24 tools). Register it with `BODHI_ENV_FILE` pointing at this checkout's private `.env`; that is the supported path wherever the checkout lives. Without it the server looks for `.env` via `BODHI_PROJECT_DIR`/`BODHI_ROOT`, the working directory, then `~/bodhi` and `~/Documents/bodhi`. It refuses a non-loopback endpoint.

## Upgrading from v1.1.0-preview.1

There are **no database schema changes and no migrations** in this release. The upgrade does not edit `.env` or the database.

What changes: the skill-learning loop and workflow candidates are retired (server routes, 6 MCP tools, one scheduler job: the MCP server now has 24 tools and the scheduler 8 jobs); the policy packet accepts a `provider` parameter, no longer hides trust-tier action classes or memories by vendor or model name, and has no project-specific main-push branch; the skill set is replaced (see Included skills); the Codex plugin version is bumped; the MCP server no longer looks for `.env` under `~/projects/owned/bodhi`; the SessionStart identity hook, the Claude Code and Codex harness templates and the installer are new.

Before either path:

1. **Review trust tiers.** Action classes containing `claude` or `subagent`, and main-push classes for a named project other than `bodhi`, were filtered or rewritten by the policy packet before and are passed through after the upgrade. List your tiers and confirm each is what you want:

   ```bash
   curl -fsS http://localhost:PORT/api/trust-tiers | jq -r '.tiers[] | "\(.tier)\t\(.actionClass)"'
   ```

2. **Back up the database** from the current installation: `bash scripts/backup-db.sh`, then `bash scripts/backup-db.sh --verify`.

### A. Source checkout (git clone)

```bash
git pull                                  # or: git fetch --tags && git checkout v1.1.0-preview.2
npm ci                                    # removes node_modules before installing; keep the running service up until the build passes
npm test && npm run build
bash scripts/install-launch-agent.sh      # restarts the owned LaunchAgent and waits for /health
```

If you do not run the LaunchAgent, use `bash scripts/stop.sh && bash scripts/start.sh` instead.

Then:

1. Verify the server: `curl -fsS http://localhost:PORT/health` and `curl -fsS http://localhost:PORT/api/scheduler | jq .contract.retainedJobCount` (expect `8`).
2. Relink skills so retired ones leave discovery: `npm run harness:install`, review, then `npm run harness:install -- --apply` (add `--user-skills` if you want the skills in every project). Stale links to retired skills under `.agents/skills`, `.claude/skills` and `skill-evals/skills` are pruned; real directories are never touched.
3. **Codex (required if you use Codex):**
   - MCP: if you used the `bodhi` plugin, Codex keeps the old 30-tool bundle until it is reinstalled. Prefer the printed `[mcp_servers.bodhi]` block with `BODHI_ENV_FILE` and disable the plugin; the plugin can find `.env` only when this checkout is `~/bodhi` or `~/Documents/bodhi`. If you keep the plugin, run `codex plugin add bodhi@personal` (if the old copy remains, `codex plugin remove bodhi@personal` first).
   - Identity hook (new in this release): merge the printed `hooks.json` block from `templates/codex/hooks.snippet.json`, which runs `scripts/harness-session-lifecycle.sh codex` on SessionStart. Codex asks you to trust it on first run.
   - In a fresh Codex task, confirm the BODHI namespace exposes exactly 24 tools and call `get_substrate_status`.
4. **Claude Code:** run the printed `claude mcp add bodhi --scope user …` command, merge the printed `settings.json` block from `templates/claude-code/settings.snippet.json` (the same identity hook with `claude-code`, plus the compaction hooks), and fill and merge the global `CLAUDE.md` template. Start a fresh session, check `claude mcp list` shows `bodhi` connected, and call `get_substrate_status` once.
5. Optional clean-up: `SKILL_LEARNING_MAINTENANCE_ENABLED` is no longer read; delete that line from `.env` yourself if present. Your generated `AGENTS.md` may still say Codex is the only harness; compare it with `templates/personal/AGENTS.md.tpl` and edit it by hand if you like.

### B. Sealed release package

Use the new package's upgrade script against your installed directory. The upgrade inventory refuses symlinks, so first remove the regenerable skill links with the new package's installer. It removes only links in `.agents/skills`, `.claude/skills` and `skill-evals/skills` whose target resolves into the installed `templates/personal/skills`, and reports anything else it leaves:

```bash
node NEW/scripts/install-harness.mjs --unlink --root INSTALLED            # dry run: lists what would be removed
node NEW/scripts/install-harness.mjs --unlink --root INSTALLED --apply
bash NEW/scripts/upgrade-personal-macos.sh --release NEW --target INSTALLED                                   # preflight
bash NEW/scripts/upgrade-personal-macos.sh --release NEW --target INSTALLED --expected-manifest-sha256 HASH --apply
```

A symlink it reports as left untouched (one pointing elsewhere) still blocks the preflight; move it out of the installed directory yourself. If you created a project `CLAUDE.md` in the installed directory, add `--preserve CLAUDE.md`. No `--approved-schema-plan-sha256` is needed: the schema target is unchanged. After the upgrade, run steps 1–5 of path A from the installed directory.

## Following updates

Watch Releases in GitHub. Each release has a changelog, exact source commit, package checksum and manifest hash. Keep backups and follow the upgrade script's manifest, compatibility and migration checks; do not copy `.env`, databases or tokens between owners.

For source contributors: clone this repository, use Node 24/npm 11, run `npm ci`, `npm test`, and `npm run build`. Changes are not released merely because they are pushed. Run `npm run check:privacy` before publication. To pack committed, reviewed source, run `npm run pack:release -- --output NEW_DIRECTORY`.

## Included skills

Eleven owner-neutral skills under `templates/personal/skills`, linked into both harnesses by the installer:

- Continuity and verification: `session-start`, `session-save` (explicitly invoked), `verify-by-emission`.
- Judgment and research: `research-chain`, `first-principles-decision`, `product-discovery`, `workflow-discovery`.
- Interface work: `interface-review` (visual system, information design, heuristics, motion and accessibility lenses), `component-driven-ui`, and two MIT-licensed forks with upstream attribution and licence text, `emil-design-eng` (motion and feel) and `better-ui` (surface polish).

Retired from preview.1: `accessibility-audit`, `information-design-review` and `visual-system-review` (merged into `interface-review`), `existing-system-adoption` (a branch of `first-principles-decision`), `graphic-design-production`, `operational-debugging`, `skill-behavior-evaluation` (replaced by `skill-evals/`) and `skill-evolution` (the learning loop). Measure a skill's firing with `skill-evals/` before deleting or rewriting it. Static validation and practical trials are not broad behavioral certification; a skill's presence does not prove an external tool is connected.

## Privacy and support

Never upload your `.env`, database, memory exports, backups, tokens or raw private logs when requesting support. Share a minimal sanitized reproduction. The original private development repository is not part of this history. The upstream MIT copyright notice is retained as required attribution.

See [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).
