# Codex harness templates

Owner-neutral templates for running BODHI under Codex. Install with `node scripts/install-harness.mjs --harness codex` (dry run), then `--apply`. See [the orchestration guide](../../docs/dual-harness-orchestration.md).

| File | Goes to | How |
| --- | --- | --- |
| `AGENTS.md.global-template` | `~/.codex/AGENTS.md` | Fill the placeholders and merge by hand. |
| `config.snippet.toml` | `~/.codex/config.toml` | Printed with `$BODHI_ROOT` rendered; merge by hand. Registers the MCP server with `BODHI_ENV_FILE` (primary path). |
| `hooks.snippet.json` | `~/.codex/hooks.json` | Printed rendered; merge by hand. Codex asks you to trust the hook on first run. |
| `marketplace.snippet.json` | `~/.agents/plugins/marketplace.json` | Alternative to the MCP block: merge by hand, link `~/plugins/bodhi` to `integrations/codex-plugin/bodhi`, then `codex plugin add bodhi@personal`. The plugin cannot pass `BODHI_ENV_FILE`, so it finds `.env` only when the checkout is `~/bodhi` or `~/Documents/bodhi`. |

Skills: the installer links `.agents/skills` (project) and, with `--user-skills`, `~/.agents/skills` into `templates/personal/skills`.

If you use the plugin: Codex caches it by version. After an upgrade that changes `integrations/codex-plugin/bodhi`, reinstall it (`codex plugin add bodhi@personal`; if Codex keeps the old copy, `codex plugin remove bodhi@personal` first) and confirm in a fresh task that the BODHI namespace exposes exactly 24 tools.

No Codex agent or role files are needed: Codex workers inherit the parent's model family and take effort per task.
