---
name: workflow-discovery
description: Map an existing operational process from evidence, including actors, inputs, decisions, exceptions, and handoffs. Use to understand how work happens today before redesign or automation; do not use for product demand discovery or an already-specified implementation.
---

# Workflow Discovery

Produce an evidence-backed account of how a bounded piece of work reaches its outcome. Discover the current process before proposing a replacement. A written procedure describes intended behavior; it does not prove people or systems follow it.

## Establish the boundary

Identify the trigger, completion condition, process owner, and unit of work. Use the requested scope; if context is incomplete, map the supported portion and label the missing boundary. Ask only when a missing fact prevents useful progress or would materially change the map.

Inspect a small representative case using authorized artifacts, code, emitted state, or participant accounts. Prefer an ordinary case plus a material exception when available. Do not open broad private logs or contact participants merely to complete the map. If no actual case is available, deliver a documented or inferred process and explicitly state that execution has not been observed.

## Trace the work

For each consequential step, capture only the details that explain its behavior:

- Actor or system and the action it owns.
- Input, source of truth, and resulting output or state change.
- Decision rule, including who can override it.
- Handoff destination and evidence that the next actor accepted the work.
- Exception, retry, escalation, or abandonment path.

Distinguish **observed execution**, **implemented behavior**, **stated procedure**, **participant testimony**, and **assumption/unknown** beside relevant claims. Cite the specific source. Never turn absent evidence into proof that a step never occurs, or infer frequency and delay from one case. Preserve conflicting accounts rather than smoothing them into one ideal workflow.

Follow identifiers and artifacts across handoffs when permitted. Look especially for manual reconciliation, duplicate entry, hidden queues, rejected inputs, and completion that exists in one system but is missing in another. Do not manufacture these problems when evidence shows a simple process.

## Return the map

Use a compact sequence or table; add a diagram only when branches or actor handoffs become easier to understand visually. Include the trigger and end state, consequential decisions and exceptions, supporting evidence, and the few unknowns that could change the map.

Separate the current process from improvement proposals. Name the most consequential supported friction or uncertainty and the smallest observation that would resolve it. Mapping alone does not authorize implementation, interviews, account access, or changes to the process.

Use product-discovery when the unresolved question is whether a user problem is worth solving; use first-principles-decision when choosing among established alternatives. An accepted implementation request should continue in its delivery workflow without reopening discovery unnecessarily.

## Governed learning receipt

Invoke `$skill-evolution` in receipt mode only for a concrete gap in this skill's guidance that caused an observed correction, failure, or workaround, with a reusable correction and checkable result. A process defect correctly discovered is project evidence, not a skill defect. A clean run creates no receipt or write. Record at most one sanitized task-level receipt; exclude private source content and do not let receipt failure block the result.
