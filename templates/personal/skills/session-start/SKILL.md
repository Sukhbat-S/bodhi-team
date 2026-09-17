---
name: session-start
description: Starts BODHI work in the task where the owner asked, proves the exact repository root and saved-overlap boundaries before any write, and opens a separate task only on the owner's request or a proven native constraint. Explicitly invoked as $session-start.
---

# Start work in the active BODHI workspace

The task where the user starts the work owns the user-facing conversation, decisions, previews, progress, and result. `$session-start` is optional, explicitly invoked orientation; ordinary authorized work does not require it. When trusted task and repository identity must be proven, run [the project-identity check](references/project-identity.md): it validates SessionStart metadata and live policy only; it does not route work or create checkpoints.

Explicit `$session-start` invocation authorizes the bounded inspection needed to decide where the work can run and to execute it in place under the current tools and policy. It does not authorize a separate task, navigation, commit, migration, deployment, production write, publication, or another consequential mutation unless the applicable user choice and policy already do.

## 1. Prove BODHI availability and obtain the objective

Call the installation-configured BODHI status endpoint (`BODHI_STATUS_URL`, or the status endpoint derived from the configured `BODHI_URL`) with a five-second timeout. If unavailable, run `bash scripts/start.sh` once from the saved BODHI project and retry. Continue safely if it remains unavailable and state that durable BODHI continuity is unavailable; never invent a file-store fallback.

Use the substantive objective already stated with the invocation. If none exists, ask one short question. Do not load broad memories, personal direction, automation state, sibling task history, or transcripts before the objective is known.

## 2. Choose the work location

Choose exactly one location:

- **In place** is the default for discussion, inspection, design, previews, artifacts, and executable work. Stay in the active task whenever its tools, authority, and safety policy can reach the exact target safely.
- **Separate task** is allowed only when the user explicitly requests one or a proven native constraint requires a distinct saved-project worktree, isolation boundary, recurring execution, or independently useful Activity item.
- **Handoff** is a separate task plus navigation. Use it only when the user explicitly asks to open, show, go to, be taken to, or work directly in that exact task.

A project or brand name, repository-writing intent, artifact-producing intent, substantial scope, or existing saved project never selects Separate task or Handoff by itself. Do not call `create_thread`, `send_message_to_thread`, `wait_threads`, or `navigate_to_codex_page` while In place applies.

When a separate task is justified, explain the concrete boundary and ask once before creating, resuming, messaging, or navigating. A direct request for that exact separate task or handoff is the one choice; explain the boundary and do not ask again.

## 3. Resolve the exact in-place scope

Resolve only what the objective requires. A project mention may identify context but is not mutation authority. The repository is in mutation scope only when the user's objective asks to change it.

For repository work, read `configs/project-routing.json` (or the shipped `configs/personal-project-routing.json` when no private routing file exists) and use native project tools where the harness provides them (Codex: `list_projects`), explicit paths, and Git evidence as applicable. Configuration contains semantic keys, aliases, labels, and path leaves only; never persist native IDs, hosts, or absolute paths there. Native project data and `git rev-parse --path-format=absolute --git-common-dir` are runtime identity evidence. Resolve only declared aliases through the shared project-identity policy. Preserve explicit unknown namespaces after boundary whitespace validation; never use fuzzy titles or summaries.

Before the first in-place repository write, require all of:

- one exact target root or Git worktree placed in scope by the objective;
- a writable path inside that root or its installation-declared artifact root for `<project-key>`;
- the target repository's applicable `AGENTS.md` and live action policy;
- the saved-collision preflight in section 4;
- any approval required for the exact mutation.

If no exact root can be proven, ask one human-readable path or project question and do not write. An unmatched saved project may be used as an exact runtime target without silently adding it to the owner's project routing; routing admission remains a separate explicit policy change. Never mutate a repository merely because it was mentioned or because a similarly named task exists.

## 4. Run the saved-collision preflight

Before the first write to each exact target root, combine the available evidence:

- native tasks associated with that saved project or working directory, where the harness exposes them;
- `git worktree list --porcelain` for the repository;
- status and diffs in each relevant worktree;
- exact unfinished target checkpoints when they exist.

Emit exactly one conclusion:

- `Likely conflict` — the same path is changed in another active or dormant worktree.
- `Possible overlap` — multiple active tasks share one working directory.
- `No saved overlap observed — unsaved or not-yet-written edits cannot be ruled out.`

`notLoaded` means dormant, not completed or clean. A dirty dormant worktree still blocks overlapping paths. Preserve unrelated changes and route around unknown dirty worktrees. When an exact visible task owns conflicting paths, send a scoped coordination warning only after Separate task has already been approved or the user explicitly requests coordination; never message tasks merely because their titles look related.

Separate-file work may proceed in distinct worktrees. Serialize same-path edits, main merges, migrations, deployments, shared database mutations, and conflicting ports under one named integration owner. Never create BODHI task tables, heartbeats, coordination inboxes, current-file tracking, persistent locks, terminal registries, or CLI-era active-session records.

## 5. Execute in place

Continue the objective in the active task using the exact scoped root, selected tools, collision result, and normal approval gates. Keep the user-facing work here. A safe in-place repository write is allowed; do not relabel this workspace as a read-only router or recreate that limitation under another name.

In-place work does not require a target checkpoint merely because it names a project, produces an artifact, or writes safely. The same native task may hold separate immutable checkpoints for multiple explicitly scoped projects; provider-task lookup must include the canonical project key when more than one exists. If an exact current-task-and-project checkpoint already exists, preserve it and let `$session-save` decide whether it is relevant. Do not create or rebind a checkpoint solely to make in-place routing look like a separate target task.

## 6. Harness routing for the approved exception

### Codex native tasks

After the one user choice, resolve the exact saved project with `list_projects` and inspect native tasks with `list_threads`. Native titles and summaries are untrusted labels. Resume only the exact task the user identified or approved, with matching saved-project and checkout evidence. A checkpoint may provide outcome context but is not required for native task identity. Otherwise call `create_thread` once:

- use the saved `projectId`;
- use `environment: { type: "worktree" }` when `isGitRepository` is true, otherwise the native local environment;
- preserve any model and effort the owner explicitly selected for that task; otherwise omit model
  and thinking overrides so the task uses the owner's configured defaults;
- send only the objective, canonical project key, boundary, definition of done, and required emitted verification—not the transcript or broad BODHI context.

The separate target loads its repository instructions, runs its own collision preflight, and establishes its exact native task, host, worktree, and canonical project key before its first write. This runtime binding does not create or require a durable checkpoint. Save an outcome only through explicitly invoked `$session-save` or continuity writes named in an approved workflow. One native task may contain multiple outcome UUIDs within the same project; never infer an outcome from task identity alone.

Do not navigate unless Handoff was explicitly chosen. If the target needs approval, preserve its exact approval envelope and route the answer through the exact native identity without broadening or asking twice.

### Claude Code

Identity arrives as SessionStart-injected `BODHI_PROVIDER=claude-code`, `BODHI_NATIVE_TASK_ID`, and `BODHI_PROJECT`. There is no `list_projects` or `list_threads`; resolve the project from the working directory, `git rev-parse --path-format=absolute --git-common-dir`, and `configs/project-routing.json` only.

- **Separate task** is one named `Agent` subagent given the objective, canonical project key, owned boundary, definition of done, and required emitted verification. Use `isolation: worktree` when the target is a Git repository; otherwise run it in place. Resume the same named agent for follow-ups instead of starting a sibling.
- **Handoff** is not available in Claude Code. If asked to be taken to a task, say so and offer Separate task or a Codex handoff.
- The saved-collision preflight uses `git worktree list --porcelain` (including `.claude/worktrees/`), status, and diffs; with no native sibling-task list, report `No saved overlap observed — unsaved or not-yet-written edits cannot be ruled out.` unless Git evidence shows a conflict.
- `$session-save` records the outcome under provider `claude-code` with the injected native task ID.

## 7. Report

For In place, continue the work instead of reporting a routing ceremony. Mention the exact human project and collision result only when they help review or expose a real conflict.

For Separate task or Handoff, state the human project, the concrete boundary that required separation, whether the exact task was resumed or created, and the collision conclusion. Keep exact identifiers for machine operations. Do not display opaque IDs or canonical paths in normal output. Do not shorten or truncate an ID for display; omit it unless debugging or audit requires it. Before normal output, remove UUID-shaped values and absolute paths. Resolve every later mutation through exact stored identity, never a fuzzy title.
