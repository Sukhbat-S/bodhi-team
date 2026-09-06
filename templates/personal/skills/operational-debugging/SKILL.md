---
name: operational-debugging
description: Diagnose a real unexplained failure, regression, hang, or incorrect runtime result with competing causes and discriminating probes, then verify the smallest authorized repair. Use for operational debugging across tools and providers; not routine factual explanations or formal security scans.
---

# Operational Debugging

Resolve the reported symptom with evidence proportional to its impact. Stay within the affected system and the user's authorized scope. Use provider-specific documentation or tools when relevant; do not impose a universal logs → browser → deployment sequence.

## Establish the failure

Identify the exact operation, target and environment, expected result, observed result, and smallest reproducible input. Preserve a sanitized error and relevant timing or revision. Distinguish a user's reported observation from a reproduction made during this run. For an uncertain external write, inspect the destination before considering a retry.

Reproduce safely when possible. For stateful or consequential failures, prefer a disposable fixture, read-only observation, or a boundary probe that cannot reach persistent mutation. If reproduction is unavailable, say what evidence supports the diagnosis and what remains untested.

## Discriminate causes

Keep the few plausible competing explanations that would change the next action. Choose the cheapest probe whose possible results distinguish them; predict those results before running it. Trace the failing operation across actual boundaries, such as declared input schema → serialization → route → service validation → persistence. An error message locates a rejection, but does not alone explain its cause.

Use current source to explain behavior and emitted state to establish what actually happened. Check deployed or running identity when stale code or configuration is plausible. Apply `$verify-by-emission` when claiming that a running consumer adopted a change. Missing logs justify a targeted probe, not automatic broad instrumentation. Keep credentials and private payloads out of evidence.

Revise the hypothesis when a probe contradicts it. If probes stop discriminating, name the missing observable and pursue an available independent source; do not cycle through equivalent retries or infer a cause from silence.

## Repair and verify

When repair is authorized, make the smallest change addressing the demonstrated cause. In a read-only investigation, deliver the concrete repair or workaround and its limitations without applying it. Do not broaden access, change permissions, restart unrelated services, deploy, or clear state as speculative remedies. A targeted restart needs evidence that the affected process is stale and authorization for that action.

Replay the original failing operation or its faithful isolated equivalent after a repair, then check the nearest meaningful regression or preserved invariant. A build passing is not symptom resolution. Separate a workaround that bypasses the failure from a fix of the underlying contract. Stop when the requested outcome and relevant checks pass; if blocked, report the precise unresolved boundary rather than claiming success.

Return the cause and confidence, decisive evidence, repair or proposed change, original-symptom result, regression result, and material limits. Keep the report as small as the investigation permits.

## Governed learning receipt

Invoke `$skill-evolution` in receipt mode only for a concrete defect in this workflow's guidance or execution, with its consequence and reusable correction. A product defect correctly diagnosed is project evidence, not itself a skill-learning signal. Clean runs write nothing. Keep receipts sanitized and task-scoped, bind outcome evidence to the exact outcome, and never let receipt failure block the primary result.
