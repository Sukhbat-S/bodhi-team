---
name: accessibility-audit
description: Audit a bounded web interface for accessibility barriers using emitted semantics, keyboard and focus behavior, contrast and reflow measurements, pointer behavior, forms, dynamic announcements, and applicable WCAG 2.2 criteria. Use for evidence-backed accessibility review; do not use for aesthetic critique, usability research, legal certification, or implementation.
---

# Accessibility audit

Audit whether a bounded web interface can be perceived, operated, understood, and interpreted through the relevant access paths. Judge emitted behavior against applicable criteria; do not turn an automated scan, DOM inspection, screenshot, or code diff into a conformance claim.

## Freeze the audit brief

Identify the smallest decision-useful scope:

- product and current build;
- target user task, route or complete bounded flow, starting state, and safe stopping point;
- viewport, zoom or reflow state, input modalities, browser, and assistive-technology combinations actually available;
- relevant variants such as errors, dialogs, status updates, responsive states, and authentication;
- target standard and level when declared.

For web content, use WCAG 2.2 Level AA as the default reference only when the project does not name another current requirement. A bounded audit is not a WCAG conformance evaluation. A conformance claim requires complete pages, every responsive variation, complete processes, all applicable success criteria, relied-upon technologies, and appropriate browser/assistive-technology evidence.

Infer harmless details from the request and emitted interface. Ask one concise question only when the missing task, scope, target standard, or safe stop would materially change the audit.

## Establish evidence authority

Inspect the emitted route before relying on source, a diff, design documentation, or an automated checker. Use the browser surface selected by the user. When the in-app Browser is selected, stay on it and do not substitute standalone Playwright. Keep the audit read-only and stop before consequential submission, purchase, deletion, account, or permission changes.

Combine direct manual evidence with automation when available:

- computed accessibility semantics, names, roles, values, states, and relationships;
- a real keyboard path and observable focus movement;
- measured text and non-text contrast;
- text resize, zoom, reflow, and spacing behavior;
- pointer, touch-target, gesture, and dragging evidence when applicable;
- emitted errors, instructions, status messages, and focus management;
- relevant browser and assistive-technology interoperability.

Automated results are candidate evidence, not a verdict. A DOM or accessibility-tree snapshot cannot prove screen-reader interoperability, speech output, cognitive accessibility, or the absence of barriers. A screenshot cannot prove keyboard behavior, focus order, announcements, zoom, or dynamic recovery. Mark unavailable evidence `UNVERIFIED`.

## Perform the audit

Read [the audit method](references/audit-method.md) before evaluating. Inspect only applicable lanes:

1. structure, semantics, text alternatives, names, roles, values, and relationships;
2. keyboard operation, focus order, focus visibility, focus management, and traps;
3. text and non-text contrast, color dependence, resize, reflow, and text spacing;
4. pointer and touch alternatives, cancellation, dragging, gestures, and target size;
5. labels, instructions, errors, recovery, authentication, and redundant entry;
6. dynamic status messages, live regions, dialogs, and state changes;
7. time limits, moving or flashing content, media alternatives, and motion when applicable;
8. page language, headings, landmarks, reading order, and consistency.

For each applicable criterion, classify the scoped evidence as `PASS`, `FAIL`, `UNVERIFIED`, or `NOT APPLICABLE`. Do not infer a pass from missing evidence or manufacture a failure for an inapplicable criterion.

## Record findings

Create one finding per underlying barrier. Include:

- stable review-local ID and lane;
- applicable WCAG criterion, level, or other declared authority;
- user context, input or assistive-technology path, and reproduction steps;
- expected accessible behavior and emitted behavior;
- route, state, viewport, zoom, element, measurement, and tool/manual evidence;
- likely impact and affected access path without inventing prevalence;
- severity and confidence;
- smallest credible remediation direction, without implementation unless separately requested.

Name confirmed passes and native semantics worth preserving. Incorrect ARIA can be worse than absent ARIA; do not recommend adding roles when native HTML already supplies the required semantics and behavior.

## Return a decision-ready audit

Lead with:

1. **Scope and claim boundary** — route or process, states, standard/level, viewport, inputs, browser/assistive-technology matrix, and why this is or is not a conformance evaluation.
2. **Evidence matrix** — manual checks, automated checks, measurements, and unavailable evidence.
3. **Access-path result** — what happened through keyboard, semantics, reflow, pointer, form, and dynamic-state paths.
4. **Findings** — evidence-linked barriers ordered by severity and criterion.
5. **Preserve** — accessible behavior and native semantics that should survive revision.
6. **Verdict** — `PASS`, `PASS WITH POLISH`, `NEEDS WORK`, or `BLOCK`, followed by every unverified or not-applicable lane.

`PASS` means no material barrier was found in the fully exercised scope; it is never shorthand for site-wide conformance. Use `PASS WITH POLISH` only for advisory improvements beyond the target requirement, not to hide missing evidence. Any confirmed target-criterion failure is normally `NEEDS WORK`. Use `BLOCK` for a keyboard trap, an inaccessible scoped critical path, or materially false accessibility semantics that can cause an unsafe or destructive action. When the declared primary task cannot be completed through a required in-scope access path and no equivalent accessible path exists, the scoped verdict is `BLOCK` even if another modality can complete it. Ordinary failures do not automatically block.

Do not create a report file unless requested. Do not claim legal compliance, certify a product, estimate affected-user prevalence, claim usability or user-research findings, redesign visual style, or implement fixes in this audit.

Return concrete corrections and unverified evidence gaps to the primary task. Do not write memory,
modify skills, or persist interface content from an audit run.

## Governed learning receipt

Invoke `$skill-evolution` only when this run produces a concrete correction, rejection, workaround,
routing, context, reference, quality, verification, safety, or agent-boundary signal. A clean audit
creates no learning receipt or write. Keep any receipt sanitized; never persist interface content,
accessibility-tree output, screenshots, prompts, responses, reasoning, transcripts, or raw tool output.
