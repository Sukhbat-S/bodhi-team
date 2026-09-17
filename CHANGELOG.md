# Changelog

## 1.1.0-preview.2

- Codex and Claude Code are peer harnesses over one substrate (ADR-004). New `templates/claude-code/` (global and project instruction templates, `bodhi-scout`/`bodhi-crit`/`bodhi-impl` agent cards, settings snippet, PreCompact and post-compaction recall hooks) and `templates/codex/` (global instructions, `config.toml`, `hooks.json` and plugin marketplace snippets).
- `scripts/install-harness.mjs` (`npm run harness:install`): dry run by default, `--apply` to link skills into `.agents/skills` and `.claude/skills` (optionally the user roots), copy agent cards and write a thin `CLAUDE.md`; prints all configuration to merge by hand. `npm run skills:install` now delegates to it, is idempotent, and prunes links to retired skills.
- New harness identity hook `scripts/harness-session-lifecycle.sh` (`codex` or `claude-code`): a SessionStart hook that injects the native task identity used by `$session-start` and `$session-save`. Wire it with `templates/codex/hooks.snippet.json` or `templates/claude-code/settings.snippet.json`. The policy packet accepts and echoes a validated `provider`, no longer filters trust-tier classes or memories by vendor name or model codename (only the `model-routing` and `quota` tags are excluded), and drops its project-specific main-push branch.
- Learning loop retired: skill-learning and workflow-candidate routes, services and the scheduler job are removed. The MCP server exposes 24 tools (was 30) and the scheduler retains 8 jobs (was 9). Codex plugin version bumped and bundle regenerated; reinstall the plugin. No schema changes or migrations; the retired tables remain untouched.
- LaunchAgent install kicks the job after bootstrap; the MCP start banner counts tools from the live registry.
- Skills: `session-start` and `session-save` are harness-neutral with Claude Code routing; descriptions rewritten as typed triggers; `interface-review`, `first-principles-decision`, `product-discovery`, and the MIT-licensed forks `emil-design-eng` and `better-ui` added; eight skills retired or merged (see README).
- `skill-evals/` wrapper for measuring skill firing with `claude plugin eval`, with one example case.
- `docs/dual-harness-orchestration.md`: head-and-worker pattern, model routing, shared commit and verification rules, the learning rule.
- Privacy gate: the owner-neutral content check also rejects the maintainer's personal, family, client and business identity terms, email addresses and non-loopback IPv4 literals, with tests. Three behaviour-bearing tokens are exempt exactly: the default IANA time zone, one column of a retired manual migration, and one `briefing_type` enum value in the hash-bound schema baselines. Project-specific trust-tier seeds, taxonomy examples and a retired scheduler trigger name were neutralized.

- The MCP server resolves `.env` from `BODHI_ENV_FILE`, then `BODHI_PROJECT_DIR`/`BODHI_ROOT`/`BODHI_PROJECT`, the working directory, `~/bodhi` and `~/Documents/bodhi`; the owner-specific `~/projects/owned/bodhi` defaults are gone. Registering with `BODHI_ENV_FILE` is the documented path.
- `install-harness.mjs --unlink [--root DIR]` removes only generated skill links, for sealed-package upgrades.

Known limits: harness configuration is printed, not merged. The Codex plugin, which cannot pass `BODHI_ENV_FILE`, finds `.env` only when the checkout is `~/bodhi` or `~/Documents/bodhi`. Sealed-package upgrades require `install-harness.mjs --unlink` first (see README). The Claude Code subagent limits in the settings snippet need Claude Code v2.1.217 or later.

## 1.1.0-preview.1

- Fresh private team-distribution history, separated from the personal development repository.
- Owner-neutral local substrate, dashboard, MCP adapter and macOS bootstrap/upgrade tooling.
- Workflow discovery, existing-system adoption, operational debugging, component-driven UI and skill behavior evaluation templates.
- Improved verification and outcome-saving guidance.
- Entity preview state now resets when its entity changes.
- Curated release boundaries, integrity manifest and publication privacy check.

Known limits: preview release; fresh-machine installation and external providers are not certified by source build/tests. Each owner needs independent local data, credentials and permissions. No personal data migration is included.
