---
name: visual-system-review
description: Review a bounded interface for typography, color semantics, spacing and tokens, shape and depth, personality, and cross-surface visual coherence from emitted evidence. Use for visual-system QA; do not use for information architecture, interaction or motion review, accessibility certification, usability heuristics, or implementation.
---

# Visual system review

Review whether an interface expresses a coherent visual language appropriate to its product and task. Judge relationships in the emitted surface, not isolated swatches, raw token names, or personal taste.

## Freeze the review brief

Identify the smallest decision-useful scope:

- product and current build or artifact;
- route, screen, component, or bounded region;
- viewport and visible state;
- the surface's reading or working register;
- current design constitution, token source, or declared visual direction when one exists;
- one or two current comparison surfaces when cross-surface coherence matters.

Infer harmless details from the request and emitted interface. Ask one concise question only when the missing product direction, surface, or comparison anchor would materially change the verdict. Do not invent a brand personality or treat a historical design document as current authority.

## Establish evidence authority

Inspect the emitted surface before relying on a diff, component gallery, token file, or prose specification. Record the actual route or artifact, viewport, visible state, and relevant comparison surfaces. Use computed styles or current token definitions to explain an observed relationship, not as substitutes for seeing the relationship in context.

Use the browser surface selected by the user. When the in-app Browser is selected, stay on it and do not substitute standalone Playwright. Keep browser work read-only and stop before any consequential action.

A static image supports visible visual-system findings only. Mark responsive variation, hidden states, computed values, interaction feedback, and downstream behavior unverified unless direct evidence exists.

## Perform the visual-system read

Read [the review method](references/review-method.md) before evaluating. Inspect six dimensions:

1. typographic roles and hierarchy;
2. color roles, semantics, and contextual relationships;
3. spacing rhythm and token coherence;
4. geometry, borders, and depth;
5. personality and signature;
6. cross-surface family resemblance and library capture.

Typography, color, and spacing may contribute to information hierarchy, but this lane judges the visual language used to express the structure. Reorganizing content, redesigning interactions, choosing motion, certifying accessibility, or implementing fixes belongs elsewhere.

## Record findings

Create one finding per underlying system condition. Include:

- stable review-local ID;
- dimension;
- observation;
- emitted evidence: route or artifact, state, viewport, element or region, and computed/token evidence when useful;
- likely impact on legibility, semantic consistency, recognition, or identity;
- severity and confidence;
- smallest credible visual-system direction, without specifying implementation unless the user asks later.

Preserve strengths explicitly. Difference is not automatically drift: editorial and dashboard surfaces may be siblings rather than twins. Do not manufacture issues to fill every dimension or treat a preferred style as a universal rule.

## Return a decision-ready review

Lead with:

1. **Scope and evidence limits** — surface, state, viewport, register, design authority, and comparison anchors.
2. **System reading** — type roles, color roles, spacing/token grammar, geometry/depth, signature, and family resemblance.
3. **Findings** — evidence-linked records ordered by severity.
4. **Preserve** — visual decisions that already work and should survive revision.
5. **Verdict** — `PASS`, `PASS WITH POLISH`, `NEEDS WORK`, or `BLOCK`, followed by unreviewed lanes.

Use `BLOCK` only when current authority explicitly labels a rule hard, absolute, or release-blocking, or when visual encoding is materially false or makes the scoped primary state illegible. A prohibition does not become a hard law merely because it says “no” or “never.” Multiple serious inconsistencies, token drift, or personality violations may still be `NEEDS WORK`; bounded low-risk refinement is `PASS WITH POLISH`.

Do not create a report file unless requested. Do not claim accessibility compliance, observed user behavior, conversion impact, interaction quality, information-architecture quality, or comprehensive product coverage. This review does not authorize implementation.

Return concrete corrections and unreviewed lanes to the primary task. Do not write memory, modify
skills, or persist interface content from a review run.

## Governed learning receipt

Invoke `$skill-evolution` only when this run produces a concrete correction, rejection, workaround,
routing, context, reference, quality, verification, safety, or agent-boundary signal. A clean review
creates no learning receipt or write. Keep any receipt sanitized; never persist interface content,
screenshots, prompts, responses, reasoning, transcripts, or raw tool output.
