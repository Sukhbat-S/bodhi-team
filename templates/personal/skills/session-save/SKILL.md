---
name: session-save
description: Save one explicitly identified personal BODHI outcome when the owner invokes $session-save, using client-owned checkpoint identity, compare-and-swap updates, explicit verification lineage, and a frozen completion manifest.
---

# Save one explicit outcome

Run only after explicit `$session-save` invocation. The invocation authorizes the bounded continuity
writes below; it does not authorize another task, external action, publication, deployment,
migration, destructive change, or memory outside the active capture policy.

## 1. Ground identity before writing

Identify the exact native Codex task, provider, outcome, project namespace, repository or artifact
state, decisions, unresolved commitments, and emitted verification. Treat task titles and summaries
as labels, never identity. Preserve unrelated owner changes.

Resolve only enumerated project keys and approved aliases through the shared project-identity policy.
For an explicit unknown namespace, preserve its spelling, case, Unicode, separators, and embedded
known names after boundary whitespace validation. Never lowercase it, take a path basename, or
rewrite stored keys implicitly.

If no durable outcome, decision, artifact, commitment, or unfinished work exists, report that no
checkpoint is required and perform no continuity or learning write.

## 2. Create, select, and update explicitly

Use one checkpoint UUID as the durable outcome identity. Never choose an outcome by title, objective
similarity, recency, task liveness, or a terminal checkpoint with the same objective.

1. For a new outcome, generate one client UUID and retain it across retries. Call `save_checkpoint`
   with `mode: create`, that `checkpoint_id`, the exact `project_key`, immutable `objective`, and
   exact provider/task reference. Send no summary, decisions, actions, or other content in this
   command. Identical replay returns the same outcome without mutation; changed identity conflicts.
2. Creation does not select the outcome. When it should become current, read the current selection
   for the exact provider/task/project, then call `mode: select` with the target `checkpoint_id` and
   `expected_current_checkpoint_id` set to the observed UUID or explicit `null`. Send no content
   fields. Selection replay is idempotent; a different current target conflicts.
3. Read the exact checkpoint UUID and retain its returned `contentHash`. Call `mode: update` with
   the same `checkpoint_id`, the unchanged `objective` from exact readback, full intended nonterminal content, and `expected_content_hash`
   (`expectedContentHash` in the HTTP contract). On a conflict, reload and reconcile; never
   overwrite a concurrent generation or select another
   outcome. Explicit update and completion do not change current selection.

Do not use compatibility save for new work. An omitted mode may create only the first legacy outcome
or update one unambiguous nonterminal match; multiple or terminal matches must fail closed. A terminal
objective is immutable and never resumed: create a new outcome UUID, optionally with the terminal
checkpoint as explicit parent when that lineage is true.

## 3. Attach artifacts and record explicit claims

Attach every durable artifact to the exact checkpoint before completion using its semantic label,
exact local path or URL, version, and SHA-256 when available. Attach references, not bodies. Identical
attachment replay may return the original; never replace a terminal artifact.

For each claim required by completion, call `record_verification` with explicit client-owned IDs:
the MCP fields `receipt_id`, `claim_receipt_id`, `subject_revision`, and
`supersedes_receipt_id` correspond to HTTP `receiptId`, `claimReceiptId`, `subjectRevision`, and
`supersedesReceiptId`.

- First check: generate `receipt_id` once, set `claim_receipt_id` to that same UUID, provide the exact
  64-character `subject_revision`, and omit `supersedes_receipt_id`.
- Recheck of the same claim and subject revision: generate a new `receipt_id`, retain the original
  `claim_receipt_id`, and set `supersedes_receipt_id` to the current head. A changed subject revision
  or unrelated check starts a new root.

Include the expected signal, observed signal, evidence source, status, and observation time. Replay
the same receipt UUID only with the same normalized payload. Never correlate legacy receipts from
matching prose or timestamps, branch lineage, or mutate an existing receipt.

## 4. Complete with a frozen manifest

If required work remains, keep the outcome paused and skip completion. Finishing a save does not finish the underlying task.

After all artifacts and required claim receipts read back, call `complete_checkpoint` once with the
exact outcome UUID, summary, remaining-work disposition, verification state, and
`completion_receipt_ids` (`completionReceiptIds` over HTTP) containing the distinct current head
for every required claim. Passed or
failed completion requires a nonempty manifest. `not-required` requires an empty manifest and zero
verification receipts. Exact completion replay must preserve the original manifest and payload.

Read the checkpoint back in one coherent generation. `effectiveVerification.state` is the current
authority: `passed`, `failed`, `pending`, `contradicted`, `not-required`, or `unavailable`. Historical
`completionVerificationState`, the frozen manifest, terminal content hash, and raw receipt counts
remain history and never change. A later immutable successor may change effective verification but
does not rewrite the completion, manifest, artifact, or objective. A later effective pass does not
turn a historically failed completion into a passed completion; record a new outcome when that is
the truth. Label legacy completions without explicit lineage as unavailable.

## 5. Capture knowledge and learning safely

Automatically store only directly stated, durable, unambiguous, non-sensitive facts, preferences,
decisions, goals, and commitments that materially help future work. Deduplicate first and preserve
origin provenance. Review inferred, sensitive, ambiguous, or third-party material with the owner.
Never store transcripts, prompts, reasoning, credentials, raw private messages, intimate facts,
uncertain dictation, temporary task state, or unrelated information.

Invoke `$skill-evolution` only when this save produced a concrete correction, failed write/readback,
routing defect, safety issue, or workaround. Pass this exact checkpoint UUID when the receipt belongs
to the durable outcome. BODHI never attaches an earlier unbound receipt automatically. Bound receipt
replay is immutable; a different outcome uses its own checkpoint. A clean save or normal
no-checkpoint result creates no learning receipt or write.

## 6. Return a compact receipt

Report the human project and outcome, create/select/update/completion disposition, artifact count,
current effective-verification state, memory stored/reviewed/failed counts, and first next action.
If historical completion state or raw counts are useful, label them historical and do not present
them as current verification. Omit opaque IDs, absolute paths, secrets, and transcript content from
normal output. Use exact full IDs for lookups, checkpoint payloads, source references, mutations, and replay. Do not display opaque IDs or canonical paths in a normal session receipt. Do not shorten or truncate an ID for display; omit it unless explicitly requested for debugging or audit.

Before normal output, remove raw UUID-shaped values matching the hexadecimal `8-4-4-4-12` UUID form, including UUIDv7, and raw absolute paths, including any embedded inside stored next actions. Clickable artifact links may retain exact absolute targets behind human-readable labels. Resolve a human response back to exact internal identity before mutation; never act on a fuzzy title match.
