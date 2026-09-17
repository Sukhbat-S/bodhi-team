# Dual-harness orchestration: one substrate, Codex and Claude Code

BODHI is the substrate: confirmed memory, entities, trust policy, parked commitments, durable outcomes and verification receipts, served locally over one HTTP API and one MCP server. Codex and Claude Code are peer harnesses on top of it ([ADR-004](decisions/ADR-004-peer-harness-claude-code.md)). The active harness owns reasoning, tools, task history and delegation. BODHI never runs a model, a task queue or an agent roster.

## The layers

| Layer | Codex | Claude Code | Shared source |
| --- | --- | --- | --- |
| Instructions | `~/.codex/AGENTS.md`, project `AGENTS.md` | `~/.claude/CLAUDE.md`, project `CLAUDE.md` = `@AGENTS.md` | `templates/codex/AGENTS.md.global-template`, `templates/claude-code/CLAUDE.md.global-template` |
| Skills | `.agents/skills`, optional `~/.agents/skills` | `.claude/skills`, optional `~/.claude/skills` | `templates/personal/skills` (symlinks only) |
| Identity hook | `~/.codex/hooks.json` SessionStart | `~/.claude/settings.json` SessionStart | `scripts/harness-session-lifecycle.sh codex` or `claude-code` |
| Compaction | native | PreCompact checkpoint and post-compaction recall hooks | `templates/claude-code/hooks/` |
| Workers | inherit the parent model family, effort per task | `bodhi-scout`, `bodhi-crit`, `bodhi-impl` agent cards | `templates/claude-code/agents/` |
| Memory and policy | `bodhi` MCP server (or the plugin) | `bodhi` MCP server | `integrations/codex-plugin/bodhi/mcp/launch.sh` (24 tools), registered with `BODHI_ENV_FILE` |

`scripts/install-harness.mjs` links the skills, copies the agent cards, writes a thin project `CLAUDE.md` if none exists, and prints every configuration block to merge by hand. It is a dry run until `--apply`.

The identity hook injects `BODHI_PROVIDER`, `BODHI_NATIVE_TASK_ID` and `BODHI_PROJECT`. `$session-save` binds an outcome under that provider key, so a Claude Code outcome and a Codex outcome on the same project are distinct and both durable.

## When to use which

- **Codex** when the work benefits from saved projects, visible task history, Activity, Handoff between tasks, or its browser and computer-use tools.
- **Claude Code** when the work benefits from a head model orchestrating named, resumable workers with worktree isolation, or when compaction hooks keep a long session oriented.
- **Either** for ordinary implementation. Pick the one you are already in; switching harnesses mid-outcome costs more than it saves. The same skills, trust policy, memory and verification rules apply in both.

## The head and worker pattern

One session is the **head** (orchestrator). It frames the work, reads the trust policy, dispatches bounded workers, reviews their diffs and owns commit, push and merge. Workers do one brief each and return compact, evidence-anchored summaries.

**Claude Code routing** (placeholders are filled in your global `CLAUDE.md`):

- The strongest model available to you is the head. It keeps design, judgment and the final diff review.
- An Opus-class model runs implementation (`bodhi-impl`) and review or audit (`bodhi-crit`, `bodhi-scout`). The shipped cards say `model: opus`; pass the model explicitly on every dispatch as well.
- A Sonnet-class model runs bulk research and wide file sweeps.
- Two or three workers in parallel as the normal ceiling, and workers that do not spawn their own workers. The settings snippet enforces both through `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, documented in the Claude Code environment-variable reference and honoured from Claude Code v2.1.217. On an older version they are ignored, so keep the ceiling by instruction.

**Substitute your available models.** The roles matter, not the names. If you have no Opus-class access, give implementation and review the strongest model you can run at volume, and keep the head on your strongest model. If the head and the workers must share one model, the pattern still pays for decorrelation and context isolation; only the quota argument weakens. Edit the `model:` line in `~/.claude/agents/bodhi-*.md` (`sonnet`, `opus`, `haiku`, a full model ID, or `inherit`) rather than the templates.

**Tune effort per role.** The shipped cards set no `effort`, so a worker inherits the session's effort level. If you want fixed levels, add an `effort:` line (`low`, `medium`, `high`, `xhigh` or `max`; available levels depend on the model) to your installed copy. A reasonable start: high for audits (`bodhi-scout`), medium for diff review (`bodhi-crit`), the highest level you can afford for implementation (`bodhi-impl`). Raise effort when a worker's return misses evidence; lower it when reviews are slow and uniformly clean.

**Codex routing:** omit the model so workers inherit the parent's model family, choose reasoning effort per task, start with at most three workers, and resolve an issue in the parent after two failed revision loops.

### Why

- **Decorrelated review.** A worker briefed with ground truth and pointers, never the head's conclusion, can refuse the framing. A reviewer given the conclusion only confirms it. The value of dispatch is an independent reading.
- **Quota protection.** If the head model is quota-limited, it never runs worker jobs. Its budget goes to judgment and review; volume goes to the models that can absorb it.
- **Context isolation.** Edit churn, build logs and research dumps stay in the worker. The head keeps a clean context for decisions, which matters more on long sessions than raw capacity.
- **One owner of irreversible steps.** Workers never commit, push or merge. The working tree stays dirty with their edits, so the head's review and the trust policy stay in the loop. `$session-save` runs only in the head, because a worker would save outcomes tied to its own state.

## Identical rules in both harnesses

- **Trust policy first.** Read the live trust tiers before a side-effecting action: `auto-do` runs, `notify` runs and flags, `await` stops for approval. Blast radius gates, not file count.
- **Verify at the destination.** A deploy is checked at its URL, a configuration change at the running process's readback, a UI change in the rendered page. A green build or a successful tool call is not that check (`$verify-by-emission`).
- **Commit discipline.** Only the head commits, after reviewing the diff. No `--no-verify`, no interactive rebases or editors.
- **Memory discipline.** Search memory when the answer needs another session's decision; store only on explicit request or for a clearly non-obvious confirmed fact; never store transcripts or secrets.

## The learning rule

A mistake or correction becomes one sentence in the file of the right scope before the session ends: the repository's `AGENTS.md` for a project mistake, the global instruction file for a cross-project one, BODHI memory for personal truth. The owner accepts or rejects the sentence in the moment. A queue of "lessons" is not learning.

Proof is a cold start: a fresh session in that folder, in either harness, answers the question the sentence was meant to change. If it does not, the sentence is wrong or in the wrong file.

Skills follow the same rule at a larger grain. Before deleting or rewriting a skill, measure whether it fires with `skill-evals/` (`claude plugin eval`); usage counts alone misdiagnose. Capability skills that a stronger model makes unnecessary are deleted; taste and contract skills stay.

## Recommended plugins

Optional. Nothing in BODHI depends on them; install only what you will use, from the official marketplaces.

- **superpowers** (Claude Code official marketplace): verification-before-completion, systematic debugging, planning and review workflows. `bodhi-impl` names two of its skills as affinities and works without them.
- **Claude Code built-ins:** `/code-review` for published pull requests and `/security-review` for a deeper security pass complement `bodhi-crit`.
- **Codex bundled plugins:** browser and computer-use tools for rendered-page verification.
