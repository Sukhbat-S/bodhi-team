---
name: skill-behavior-evaluation
description: Evaluate whether a skill changes observable task outcomes using bounded realistic cases, source identity, and actual outputs. Use for skill behavior tests or audits of evaluation evidence; registry parity belongs to audit-skill-matrix and learning decisions to skill-evolution.
---

# Evaluate skill behavior

Establish what the evidence proves about a specific skill version. An evaluation report is not authority to promote a skill, certify its author, approve a learning candidate, or change runtime configuration.

## Frame the test

Bind the question to immutable inputs: exact skill bundle and resources, bundle hash, task fixture hash, permitted tools and effects, expected observable outcome, forbidden effects, and stopping condition. Resolve the repository's bundle-hash implementation when governance metadata will consume the result; a hash of SKILL.md alone is not a bundle hash. Preserve a file inventory or immutable snapshot so later source changes are detectable.

Keep a realistic held-out task separate from examples used to edit the skill. Freeze the task and outcome criteria before testing. If the evaluator already saw the expected answer or the case drove the revision, label it a development case; never rename it held-out. Avoid adding cases merely to inflate coverage.

For comparisons, keep task inputs, tools, permissions, and model/effort constant where feasible; report differences. Compare completed outcomes, errors, unsupported claims, and unnecessary effects. Better wording or a longer answer is not evidence of better behavior. A correct baseline remains a baseline success. Do not claim general reliability from a small selected sample.

## Execute or audit

Use an authorized independent native worker when realistic forward-testing benefits from isolation and active tool policy permits delegation. Give it only the request, frozen skill, minimum raw inputs, resource boundary, and output location; withhold intended answers, prior conclusions, and author commentary. Isolate generated files and avoid inherited task history. Preserve its native identity and actual configuration as evidence; unknown provenance remains unknown. Do not create a visible task without the required user request. Never launch a model runtime, create permanent agents, or recreate task coordination in BODHI.

If independence, tools, or permissions are unavailable, complete an evidence audit or bounded simulation and state that limitation. Do not present your own practical application as independent validation. Existing evaluation artifacts may be audited without rerunning their actions.

Review bounded actual tool results, destination readback, and delivered task artifacts against the frozen criteria. Preserve only task-relevant sanitized evidence, excluding private logs and transcripts. A worker's assertion that it succeeded is insufficient where an observable result is required. Mark unavailable checks unverified rather than failing or passing them by inference.

Distinguish these evidence classes in every conclusion:

- **Static:** structure, references, hashes, or manifest metadata checked; behavior not executed.
- **Simulation:** proposed choices against supplied facts; no real effects verified.
- **Native execution:** actual tools and task outputs observed within the declared isolated boundary; state what was exercised.
- **Live observation:** the relevant real consumer or destination emitted the required result under authorized conditions; limit claims to that version and environment.

## Report and stop

Return source identity, case status (held-out/development/unknown), execution class, observed outcomes with exact evidence references, comparison where available, and remaining uncertainty. Separate a tested skill defect from a product failure it correctly reported. Recommend only the smallest next test needed to resolve a material gap. A static canary checker validates declared metadata; it cannot authenticate reviewer independence or turn simulated decisions into live proof. Do not alter canary states or candidate decisions as part of this evaluation.

## Governed learning receipt

Invoke `$skill-evolution` in receipt mode only for a concrete defect or supported correction attributable to this evaluation workflow, with observed consequence and a reusable check. A clean evaluation writes nothing. A defect in the evaluated skill is evidence for its owner's review, not an invented failure of the evaluator. Honor no-write scope: return a sanitized proposed signal instead of recording. Never approve candidates, self-certify, or count one case as several independent runs.
