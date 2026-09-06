---
name: session-start
description: Start owner-requested personal BODHI continuity in the active task after the objective is known, using only exact task and project evidence and narrowly relevant context. Invoke only when the owner explicitly requests $session-start.
---

# Start personal BODHI continuity

Run only after explicit `$session-start` invocation. Use the substantive objective stated with the
invocation; if none exists, ask one short question. Do not inspect checkpoints, memories, sibling
tasks, automations, or transcripts before the objective is known.

## 1. Verify only the continuity needed

Call `get_substrate_status` through the configured BODHI MCP. Use configured native metadata or
clients; do not shell to a presumed port or inspect credentials and private logs. If status is
unavailable, continue where safe and state that durable continuity is unavailable. Never invent a
filesystem fallback or claim a read succeeded without evidence.

## 2. Bind the current task and project

Use the exact native Codex task ID supplied by the runtime and `provider=codex`. Select the canonical
lowercase project slug from trusted saved-project metadata or the owner's private project policy.
Normalize case, Unicode, separators, and declared legacy aliases only; never fuzzy-match a task
title. Project tags guide retrieval and checkpoint identity but are not memory access walls.

If the topic does not belong to a declared project, use the owner's canonical personal project.
If project identity would materially change a write and cannot be proven, continue without a
checkpoint and ask one concise project question only when persistence becomes necessary.

## 3. Restore continuity only when it helps the objective

Call `get_checkpoint` for the exact provider task plus project first. If none exists, call
`find_checkpoints` for that project and select only the newest relevant `paused` or `active`
checkpoint. Label this explicitly as a fallback; never present it as the current task's exact
checkpoint. Ignore terminal or unrelated checkpoints.

Retrieve only the checkpoint decisions, verified artifacts, unresolved commitments, and next
actions relevant to the stated objective. Do not recreate task history, transcripts, terminal
state, locks, or agent rosters.

## 4. Retrieve the minimum relevant knowledge

Call `get_project_context` and `search_memories` with a narrow topic query and canonical project
tag. Search the owner's complete memory pool; legacy domain input may be used only as an
`origin-domain:*` provenance filter. Retrieve the minimum facts and decisions needed for the task.

Sensitive recall requires an explicit owner request. Never retrieve credentials, raw private
messages, intimate third-party material, unrelated memories, or transcript-like content for a
temporary worker. Treat retrieved memory as fallible context and verify consequential claims
against current code, official sources, or emitted state.

## 5. Continue in the active task

Stay in the task where the owner asked. A separate visible task still requires the exact choice or
native constraint defined by the active operating agreement. This skill does not authorize task
creation, navigation, repository writes, external actions, or persistence.

Report startup compactly: substrate status, exact or fallback checkpoint disposition, and counts
of relevant items retrieved. Do not expose opaque IDs, absolute paths, secrets, or private memory
content in the status line.

Invoke `$skill-evolution` only when this run produces a concrete correction, workaround, routing,
context, verification, safety, or agent-boundary signal. A clean start creates no learning receipt
or write.
