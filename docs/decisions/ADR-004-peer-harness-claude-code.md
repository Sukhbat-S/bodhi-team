# ADR-004: Peer harnesses — Codex and Claude Code over one BODHI substrate

- **Status:** accepted
- **Accepted:** 2026-09-11 (upstream); adopted by this distribution in 1.1.0-preview.2
- **Decision owner:** the BODHI owner
- **Supersedes:** the earlier rule that Codex was the only reasoning and execution harness. Every other substrate invariant stands.

## Context

BODHI was first built with Codex as its only operating surface. The argument was against *multiplicity*: a second surface could create conflicting task identity, duplicated context injection and more failure modes. The concrete failure behind that rule was continuity inferred from project-tagged history instead of native task identity.

That identity problem was solved structurally, not by having one harness. Work checkpoints carry no provider column; native identity lives in `checkpoint_project_provider_refs`, keyed on `(provider, native_task_id, project_key)`, with one primary reference per provider per checkpoint. The MCP write path already accepts any valid provider string. The scheduler's `executionOwner` is descriptive. The substrate was provider-neutral already; only instructions, hooks and skill prose were Codex-specific.

Meanwhile owners use Codex and Claude Code side by side, and neither subsumes the other:

- **Claude Code** provides named, resumable subagents, per-subagent worktree isolation, and hook events such as PreCompact and PostCompact that Codex does not expose.
- **Codex** provides saved projects, visible task history, Activity and Handoff that Claude Code does not.
- **Outcome evidence.** Without an adapter, Claude Code work left no checkpoints or receipts in BODHI, so durable truth was silently incomplete for one of two active harnesses.

## Decision

> BODHI owns truth; whichever harness is active owns execution. Harness identity is a foreign reference, never a branch in the substrate.

Codex and Claude Code are **peer reasoning and execution harnesses**. BODHI remains the sole owner of confirmed memory, entities, trust policy, parking, durable outcomes and verification receipts. Each harness binds outcomes under its own provider key: `codex` and `claude-code`.

A **harness adapter** is exactly three things: a SessionStart hook that injects the trusted identity triple (`BODHI_PROVIDER`, `BODHI_NATIVE_TASK_ID`, `BODHI_PROJECT`), an instruction include, and skill-discovery symlinks into the single skill source. It is never a runtime, a task registry, a coordination inbox or a second memory.

The BODHI server's deterministic maintenance scheduler stays in the server. Neither harness schedules jobs against BODHI.

## Invariants

1. Provider keys are `codex` and `claude-code`, validated by the existing checkpoint provider pattern.
2. There is one skill source (`templates/personal/skills` in this distribution). Every discovery root (`.agents/skills`, `.claude/skills`, and optionally `~/.agents/skills` and `~/.claude/skills`) contains only symlinks into that source.
3. A project `CLAUDE.md` is a thin include of `AGENTS.md`: first line `@AGENTS.md`, at most three more lines, no headings or further includes. `AGENTS.md` stays the single project instruction owner.
4. No substrate code path branches on provider beyond validation and echo. Retirement filters name retired *concepts*, never a vendor.
5. `bodhi-scout`, `bodhi-crit` and `bodhi-impl` are Claude Code's native subagent mechanism, not a BODHI agent roster. Codex delegation needs no persona files.
6. Skill bodies are harness-neutral except a clearly labelled harness-routing section in `session-start`.

## Consequences

- The policy packet drops its vendor-name filters and accepts a validated, echoed `provider` query parameter (additive; contract version unchanged). Trust-tier action classes and reviewed memories that mention Claude or subagents now reach both harnesses. Owners should review such rows before upgrading.
- `scripts/harness-session-lifecycle.sh` is the shared identity hook, taking the provider as its argument. Each harness wires it into its own SessionStart hook configuration (`templates/codex/hooks.snippet.json`, `templates/claude-code/settings.snippet.json`).
- The status literals `native Codex (outside BODHI server)`, `reasoning: "native-codex"` and the scheduler's `executionOwner: "codex"` are **deliberately not renamed**. They answer "does the server host a model?" (no); renaming them is behavior-free churn.
- Retired orchestration endpoints (`/api/sessions`, `/api/agent-dispatches`, `/api/architect-inbox`) stay retired.

## Ownership cost

One shared shell script and its test, one installer, harness templates, and one hook entry in each harness's user settings. No migrations, no new tables, no new routes.

## Exit path

Remove the project `CLAUDE.md`, the `.claude/skills` symlinks, the Claude Code agent cards and hook entries. Checkpoints bound under `claude-code` remain readable history.

## Reversal

Returning to a single harness requires a new ADR with the observed failure that dual identity caused and outcome evidence from a real workflow. A preference for one vendor's interface is insufficient.
