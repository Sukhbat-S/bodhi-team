# Skill-learning receipt contract

## Result and verification

- Result: `accepted`, `revised`, `discarded`, or `failed`.
- Verification: `passed`, `failed`, `not-required`, or `unverified`.
- Keep each sanitized signal summary factual and at most 500 characters.
- Use a stable lowercase `learningKey` for the same underlying behavior across tasks.

## Attribute the learning before selecting a signal

A signal belongs here only when the evidence supports a change to the skill or its execution guidance. Establish three things: the specific guidance gap or misrouting, its observed consequence, and a reusable correction with a way to test it. Express these compactly within the existing summary limit; no new fields or schema are required.

- A project test fails because the product has a bug, and the verification skill correctly reports it: retain project failure evidence; do not classify the skill as failed.
- A requested provider is unavailable or a credential is absent: report the operational blocker. Record a skill signal only if the workflow ignored a required prerequisite or misrepresented readiness.
- The skill claims success from a build although its consumer uses stale configuration: a skill/execution verification failure, with the missing consumer check as the proposed correction.
- A documented save sequence omits an API-required field and a faithful execution fails: a guidance workaround, with the exact contract correction and a readback test.
- The user dislikes a design: preserve the preference or project revision. It becomes skill learning only if a repeatable process defect is established, such as skipping an explicitly requested comparison.

Keep skill-run result and verification separate from the project's result. A verification workflow may perform correctly while establishing that the project failed. Never turn that project failure into a skill-run failure solely to populate telemetry.

Existing receipts and candidate states remain unchanged. During review, group similar evidence and distinguish project defects, operational blockers, skill gaps and uncertain attribution in the report. Do not auto-dismiss, reclassify stored history, or infer resolution from this distinction.

## Signals

- `correction` or `rejection`: the owner directly corrected or rejected material skill behavior.
- `workaround`: the skill completed only through a repeatable deviation from its current method.
- `routing-miss`: the skill triggered when another route was needed, or failed to trigger when it was needed.
- `missing-context`: the skill lacked a stable context input required for its outcome.
- `stale-reference`: a governed reference no longer matched current authoritative evidence.
- `quality-gap`: the result missed a concrete acceptance criterion without a more precise signal type.
- `verification-failure`: the skill execution or its claimed result failed required verification; not merely a product defect the skill correctly detected.
- `safety-failure`: a permission, privacy, security, or blast-radius boundary failed.
- `agent-boundary`: repeated evidence suggests that different tools, permissions, effort, isolated context, preloaded skills, or a return contract may justify later native agent evaluation.

## Candidate behavior

Direct correction, rejection, safety failure, and verification failure are material immediately. Ordinary evidence creates a candidate only after the same learning key appears in three distinct native tasks. Missing telemetry can create an audit question after 90 days but is never retirement evidence.

Use change type `update`, `split`, `merge`, `retire`, `new-skill`, or `agent-evaluation`. Entirely new repeatable workflows continue through verified `workflow_candidates`; do not duplicate that route here.

An agent candidate requires three distinct verified runs before it is eligible for a native canary. Materialized evaluation evidence must describe a temporary, non-permanent prototype, passed mandatory assertions, no quality or safety regression, and either a fixed baseline failure or at least 20% improvement in turns, rework, or latency. A permanent specialist additionally requires the owner's explicit approval in a later task.

A materialized skill artifact must name the target skill, carry a SHA-256, prove an isolated canary and fresh discovery, and retain a Git rollback reference. These are evidence fields on the checkpoint artifact, not authority for this controller to edit files.
