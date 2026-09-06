---
name: skill-evolution
description: Record compact evidence when governed BODHI skill runs produce concrete learning signals, review skill usage and candidates, and resolve approved proposals without editing skills or creating agents. Use receipt mode only for a signal-bearing tracked run; use review mode only when explicitly requested.
---

# Evolve governed skills

Operate in one of two modes. Never record this controller's own execution.

## Receipt mode

A governed skill invokes this mode after its primary work only when the run produced a concrete correction, rejection, workaround, routing, context, reference, quality, verification, safety, or agent-boundary signal. A clean run does not invoke this mode and creates no receipt or write.

Before recording, attribute the observation to the skill. Read [the receipt contract](references/receipt-contract.md) and identify the specific missing or misleading guidance, the observed consequence, and a reusable correction with a checkable result. A product defect correctly caught by the skill is project evidence, not a skill failure. Do not infer a skill defect merely because a test failed. If attribution is uncertain, keep it in the project outcome for review rather than creating a learning candidate.

1. Identify the exact native task, project namespace, governed skill hash, result disposition, verification state, and durable outcome checkpoint when one exists. Resolve only declared project aliases; preserve an explicit unknown namespace after boundary whitespace validation.
2. Record one signal-bearing receipt with `record_skill_run`. When it belongs to a durable outcome, pass that exact `checkpoint_id`; it must already match the same provider, native task, and project binding. Never record it unbound and expect a later checkpoint save to attach it automatically. An unbound compatibility receipt is only a task-level summary when no durable outcome exists.
3. Treat an outcome-bound receipt and its signal set as immutable. Identical replay for the same task, project, skill hash, and checkpoint returns the original. A changed disposition, verification state, dependency set, completion time, or signal set conflicts; a separate outcome uses its own checkpoint UUID.
4. Include only concrete evidence observed during the run. Never include prompts, responses, reasoning, messages, transcripts, raw tool output, private source text, or secrets. Read [the receipt contract](references/receipt-contract.md) when classifying a signal.
5. Keep ordinary learning silent. Surface a direct correction, rejection, safety failure, or failed emitted-result verification immediately and compactly. If BODHI is unavailable, do not block the primary result; mention the receipt failure only when concrete material evidence would otherwise be lost.

Never invent an improvement to satisfy the protocol. Do not infer retirement from missing telemetry.

## Review mode

Use this mode only when the owner explicitly asks to review skill usage, learning evidence, or candidate decisions.

1. Use `list_skill_usage` for aggregates and freshness. Live use is counted once per provider/task/project/skill hash even when that task has several outcomes. Keep `taskUses` separate from `legacyRollupTaskUses`; coverage may overlap, so never add them or claim an exact combined total. The conservative disposition order is aggregate history, not verification authority. Absence is **unverified**, never **unused**.
2. Use `list_skill_learning_candidates` for evidence, severity, status, and the next permitted transition. Preserve exact candidate IDs internally while describing them semantically to the owner.
3. Approve or dismiss only after the owner chooses the exact candidate and action. Dismissal requires his reason. Approval records acceptance but changes no files.
4. Materialization belongs to a later implementation task: an approved candidate, durable skill or agent artifact, and exact same-project completed checkpoint whose frozen completion disposition was passed and whose `effectiveVerification.state` remains `passed` are required. The effective receipt subject revision must match the artifact hash. Historical completion state, raw receipt counts, or an unrelated passed root cannot authorize materialization by itself.

This skill has no authority to edit skill or agent files. Approved skill changes use `$skill-creator` separately. V1 may evaluate an agent candidate but never creates a permanent specialist or registry.

## Direct edits versus candidate materialization

The candidate-materialization requirements above apply to approved learning candidates. A direct user request to edit a skill is ordinary scoped implementation using skill-creator and proportionate validation; it does not require candidate admission. This controller still cannot edit files. A separate visible task requires the global task-boundary approval, even when candidate verification needs isolation.
