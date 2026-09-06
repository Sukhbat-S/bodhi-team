---
name: information-design-review
description: Review a bounded interface for information hierarchy, composition, grouping, density, scan path, and responsive priority from emitted evidence. Use for structural UI critique; do not use for visual styling, interaction or motion review, accessibility certification, usability heuristics, or implementation.
---

# Information design review

Review how an interface organizes meaning. Judge whether the structure helps a named user perceive priority, relationships, comparison, and detail at the required viewport. Do not turn this lane into a general “looks good” review.

## Freeze the review brief

Identify the smallest decision-useful scope before inspecting:

- product and current build or artifact;
- target user and primary job;
- route, screen, component, or bounded region;
- starting state and relevant data condition;
- viewport or device, including a second width only when responsive priority matters;
- current design constitution or product constraints, when one exists.

Infer harmless details from the request and emitted surface. Ask one concise question only when the missing user job, surface, or viewport would materially change the structural judgment. Do not silently expand one region into a whole-product audit.

## Establish evidence authority

For a live interface, inspect the emitted surface before relying on code, a diff, design document, or screenshot. Record the actual route, viewport, visible state, and data condition. Treat historical specifications as leads unless they match current emitted behavior.

Use the browser surface selected by the user. When the in-app Browser is selected, stay on it and do not substitute standalone Playwright. Browser inspection is read-only: do not submit consequential forms, mutate data, or cross the requested stopping point.

A screenshot or static mockup supports only visible-structure findings. Mark responsive behavior, hidden states, interaction consequences, persistence, and downstream effects unverified unless direct evidence exists.

## Perform the structural read

Read [the review method](references/review-method.md) before evaluating. Inspect the surface through six dimensions:

1. user job and information roles;
2. landing zone and hierarchy;
3. grouping, composition, and sequence;
4. comparison and representation faithfulness;
5. density rhythm and non-redundant ink;
6. responsive information priority.

Separate what is visible from what is inferred. Typography and color may be evidence that hierarchy succeeds or fails, but selecting fonts, palettes, tokens, animation, or component styling belongs to another lane.

## Record findings

Create one finding per underlying structural condition. Each finding contains:

- stable review-local ID;
- dimension;
- observation;
- emitted evidence: route or artifact, state, viewport, and element or region;
- likely impact on scanning, comparison, orientation, or decision effort;
- severity and confidence;
- smallest credible design direction, without implementation.

Preserve strengths explicitly. A dense surface is not automatically defective, and a quiet surface is not automatically clear. Do not manufacture findings to fill every dimension.

## Return a decision-ready review

Lead with:

1. **Scope and evidence limits** — user job, surface, state, viewport, and unavailable evidence.
2. **Structural reading** — intended hierarchy, scan path, grouping, density, comparison model, and responsive priority.
3. **Findings** — evidence-linked records ordered by severity.
4. **Preserve** — structural choices that already work and should survive revision.
5. **Verdict** — `PASS`, `PASS WITH POLISH`, `NEEDS WORK`, or `BLOCK`, followed by unreviewed lanes.

Use `BLOCK` only when a current project hard law is violated or the information structure makes the scoped primary task materially impossible or misleading. Ordinary hierarchy or density problems are `NEEDS WORK`; bounded low-risk improvements are `PASS WITH POLISH`.

Do not create a report file unless requested. Do not claim user-research findings, accessibility compliance, conversion impact, complete visual-system coherence, interaction quality, or comprehensive product coverage. This review does not authorize implementation.

Return concrete corrections and unreviewed lanes to the primary task. Do not write memory, modify
skills, or persist interface content from a review run.

## Governed learning receipt

Invoke `$skill-evolution` only when this run produces a concrete correction, rejection, workaround,
routing, context, reference, quality, verification, safety, or agent-boundary signal. A clean review
creates no learning receipt or write. Keep any receipt sanitized; never persist interface content,
screenshots, prompts, responses, reasoning, transcripts, or raw tool output.
