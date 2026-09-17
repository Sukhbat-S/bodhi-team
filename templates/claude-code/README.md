# Claude Code harness templates

Owner-neutral templates for running BODHI under Claude Code. Install with `node scripts/install-harness.mjs --harness claude-code` (dry run), then `--apply`. See [the orchestration guide](../../docs/dual-harness-orchestration.md).

| File | Goes to | How |
| --- | --- | --- |
| `CLAUDE.md.global-template` | `~/.claude/CLAUDE.md` | Fill the placeholders and merge by hand. |
| `CLAUDE.md.project-template` | `CLAUDE.md` in this checkout | Written by the installer when absent. |
| `agents/bodhi-*.md` | `~/.claude/agents/` | Copied by the installer; a differing card is kept unless `--force` (which backs it up first). Cards pin `model: opus` and no `effort`; adjust your installed copy (see the orchestration guide). |
| `settings.snippet.json` | `~/.claude/settings.json` | Printed with `$BODHI_ROOT` rendered; merge by hand. |
| `hooks/*.sh` | stay here | Referenced from the settings snippet, so an upgrade updates them in place. |

## AGENTS.md

A project `CLAUDE.md` is only `@AGENTS.md` plus one line. `AGENTS.md` itself is private and owner-specific, so it is gitignored and never shipped. The fresh-install bootstrap renders it from `templates/personal/AGENTS.md.tpl`. A source checkout without one should copy that template to `AGENTS.md`, fill the owner and assistant names, and keep it at mode 0600.

## Requirements

- `jq` on `PATH` (the identity and compaction hooks use it).
- The BODHI MCP server registered at user scope; the installer prints the exact `claude mcp add` command.
- Optional: the superpowers plugin, named as a skill affinity by `bodhi-impl`.

The settings snippet's `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` are documented in the Claude Code environment-variable reference and need Claude Code v2.1.217 or later. Nothing here carries a head-model pin, a permission mode, or a token.
