---
name: verify-by-emission
description: Verify config/runtime and browser/visual claims from the real emitted state, not a diff, green build, tool-success message, or screenshot alone. Use before claiming a model-selection, routing, cron, env-gated, responsive, or interaction behavior works.
---

# Verify by Emission

Use this skill when correctness depends on which configuration or behavior the running consumer actually uses. A saved setting, passing build, or successful tool call does not prove that a process adopted the change. Pure prose edits without a behavior claim need only an appropriate content check.

Use [outcome acceptance](references/outcome-acceptance.md) when technical checks may miss the requested result, and [integration readiness](references/integration-readiness.md) when the claim spans an installed artifact, configuration and downstream consumer. Read only the relevant reference.

## Choose the evidence

State the exact behavior, acceptance condition, and observable that can prove it. Use the narrowest relevant current source:

- **Codex model, effort, or context:** bind the check to the exact native task and host. Read the task's emitted model/effort metadata and reported context-window value, using native task tools or narrowly selected fields from its exact rollout. Configuration and model catalogs explain those values but do not replace runtime evidence. A client label need not equal the backend request setting; report that distinction when relevant.
- **New-task features:** verify activation in a fresh task when initialization occurs at task startup, then exercise the requested behavior. Do not infer continuity across a context transition from the feature flag alone.
- **Hooks and plugins:** verify the actual hook event or fresh skill/tool discovery. A hook file or installed cache directory alone does not establish that the hook fired or the plugin loaded.
- **BODHI state or API behavior:** read the exact persisted record or live response through the relevant narrow operation. Verify the intended project and destination.
- **Scheduling:** identify the scheduler that owns the job. Codex tasks use native scheduling evidence; BODHI retains deterministic maintenance jobs. Its trigger endpoint remains valid for retained job types and returns a retired-capability response for retired types. Trigger a job only when that exact action is authorized, then inspect the emitted run/event evidence.

Distinguish three claims: the value was saved, the running consumer adopted it, and the intended behavior succeeded. Report only the levels actually observed. Keep missing, stale, or conflicting evidence unverified rather than inferring success.

Inspect only the metadata needed for the claim. Do not dump authentication files, secrets, transcripts, model instructions, or private reasoning. Use the current authenticated tool or established client for protected requests; never print credentials to construct a check.

Restart or reload only the affected process when it holds stale configuration and the action is authorized. Do not restart unrelated services or imply that a fresh task updates an already-running task.

## Browser and visual behavior

Bind all evidence to the same rendered state:

1. Read the actual URL or route after navigation.
2. Read an independent runtime or DOM signal appropriate to the claim, such as viewport width, a media-query result, a DOM marker, or the resulting control state.
3. Inspect the visible page state; capture a screenshot when it materially helps review.
4. Compare these observations with the acceptance condition.

For preview delivery, distinguish requested, opened, and visible. A queued open request or a temporary browser tab is not proof that the requested content is visible in the user’s task. Use available native tab/panel evidence and confirm the right destination before claiming it is shown. Do not use voice-only tools in text mode.

A successful resize, click, navigation, or screenshot call proves only that the action returned. If the route, viewport/runtime, DOM, or visible state disagree, preserve the disagreement and report the behavior as unverified. Do not infer rendered behavior from source or CSS alone. When the owner selects the in-app browser, verify on that surface rather than substituting standalone Playwright.

## Finish at the right scope

Record the expected signal, observed result, evidence source, and limitation. Use a verification receipt for material effects when the applicable checkpoint or workflow requires it. Do not automatically retry an uncertain external write.

Once the relevant fresh evidence passes, finish. Broaden or repeat verification only for new changes, failures, stale evidence, or an unresolved concern. This skill does not add an approval gate or expand the authorized action.

## Governed learning receipt

Invoke `$skill-evolution` in receipt mode only when this run exposes concrete correction, workaround, stale-reference, routing, quality, verification, safety, or agent-boundary evidence. A product bug correctly detected is project verification evidence, not itself a learning signal. Record skill learning only for a specific guidance or execution gap, its consequence and a reusable correction; use skill-evolution’s attribution guidance when uncertain. Clean runs create no learning receipt or write. Keep receipts sanitized and task-scoped; never include raw source content or conversation material, and never let receipt failure block the primary result.
