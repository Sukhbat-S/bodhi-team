---
name: verify-by-emission
description: Proves a behavior claim from the signal the running system actually emits — the live response, the process's own readback, the rendered page — rather than from a diff, a passing test, or a tool call that returned success. Use for "verify the cron actually fires", "did the restart really pick up the new env", "is it live or just deployed", "check it in the browser, not the code".
---

# Verify by Emission

Use this skill when correctness depends on which configuration or behavior the running consumer actually uses. A saved setting, passing build, or successful tool call does not prove that a process adopted the change. Pure prose edits without a behavior claim need only an appropriate content check.

Use [outcome acceptance](references/outcome-acceptance.md) when technical checks may miss the requested result, and [integration readiness](references/integration-readiness.md) when the claim spans an installed artifact, configuration and downstream consumer. Read only the relevant reference.

## Choose the evidence

Optimize time to a trustworthy result, not the number of checks. Identify the claim and the cheapest reliable observation that would expose it being wrong; keep this planning internal for routine work.

- **Default to one decisive check, not one tool call.** An exact destination readback can establish a saved record without a browser visit. It cannot establish runtime adoption or a working user interaction. Add evidence only for an uncovered material claim.
- **Batch repeated checks.** For imports, compare expected keys, fields and control totals against destination records together. Samples can support UI review, but cannot establish complete import coverage or financial reconciliation.
- **Reuse valid evidence.** Do not repeat a passed check when its subject revision, destination and relevant runtime state remain applicable. Changed code, data, deployment, session or dependencies invalidate only the affected claims; mutable external state may need a fresh read.
- **Escalate for consequences or contradictions.** Money, stock, payroll activation, access control and destructive operations need relevant independent expectations, reconciliation or failure-path checks. One superficial readback is not enough. Low-risk edits do not inherit that entire procedure.
- **Stop when the scoped claims pass.** Do not add screenshots, another tool, a receipt or a second read merely for reassurance. If evidence is missing or conflicting, report the exact limit and choose a bounded discriminating check; do not loop through equivalent probes.

Use the narrowest relevant current source:

- **Codex model, effort, or context:** bind the check to the exact native task and host. Read the task's emitted model/effort metadata and reported context-window value, using native task tools or narrowly selected fields from its exact rollout. Configuration and model catalogs explain those values but do not replace runtime evidence. A client label need not equal the backend request setting; report that distinction when relevant.
- **New-task features:** verify activation in a fresh task when initialization occurs at task startup, then exercise the requested behavior. Do not infer continuity across a context transition from the feature flag alone.
- **Hooks and plugins:** verify the actual hook event or fresh skill/tool discovery. A hook file or installed cache directory alone does not establish that the hook fired or the plugin loaded.
- **BODHI state or API behavior:** read the exact persisted record or live response through the relevant narrow operation. Verify the intended project and destination.
- **Scheduling:** identify the scheduler that owns the job. Codex tasks use native scheduling evidence; BODHI retains deterministic maintenance jobs. Its trigger endpoint remains valid for retained job types and returns a retired-capability response for retired types. Trigger a job only when that exact action is authorized, then inspect the emitted run/event evidence.

Distinguish three claims: the value was saved, the running consumer adopted it, and the intended behavior succeeded. Report only the levels actually observed. Keep missing, stale, or conflicting evidence unverified rather than inferring success.

Inspect only the metadata needed for the claim. Do not dump authentication files, secrets, transcripts, model instructions, or private reasoning. Use the current authenticated tool or established client for protected requests; never print credentials to construct a check.

Restart or reload only the affected process when it holds stale configuration and the action is authorized. Do not restart unrelated services or imply that a fresh task updates an already-running task.

## Browser and visual behavior

Use the browser when the claim concerns interaction, appearance or visible delivery—not automatically after every data write. Bind the actual URL/route and the relevant result to the same rendered state; collect them together when supported.

For interaction claims, exercise the affected flow and inspect its resulting control/DOM state; add a destination readback only when persistence is claimed. For visual claims, inspect the visible result and the relevant runtime signal (for example viewport width for responsive layout). A screenshot is useful when appearance matters, not a mandatory artifact for every check. Compare the evidence with the acceptance condition without unrelated navigation.

For preview delivery, distinguish requested, opened, and visible. A queued open request or a temporary browser tab is not proof that the requested content is visible in the user’s task. Use available native tab/panel evidence and confirm the right destination before claiming it is shown. Do not use voice-only tools in text mode.

A successful resize, click, navigation, or screenshot call proves only that the action returned. If the route, viewport/runtime, DOM, or visible state disagree, preserve the disagreement and report the behavior as unverified. Do not infer rendered behavior from source or CSS alone. When the owner selects the in-app browser, verify on that surface rather than substituting standalone Playwright.

## Finish at the right scope

Report the result, decisive evidence and any material limitation concisely. Record formal expected/observed signals or a verification receipt only when the applicable checkpoint or workflow requires them; this skill does not start a saving workflow. Do not automatically retry an uncertain external write.

Once the relevant fresh evidence passes, finish. Broaden or repeat verification only for new changes, failures, stale evidence, or an unresolved concern. This skill does not add an approval gate or expand the authorized action.

When evaluating efficiency, compare elapsed time and tool calls on equivalent scoped tasks while checking retained error detection. Treat a 10× improvement as a target, never as established by shorter instructions or a single favorable example.

