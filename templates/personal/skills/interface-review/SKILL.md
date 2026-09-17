---
name: interface-review
description: Reviews a bounded interface or flow and reports where it breaks, with evidence, severity, and location. Use for "go through this screen and tell me where it breaks", "review this flow", "audit this page"; interfaces that "read like two different products" or show "type, spacing, color drift"; a screen that is hard to scan or hides what matters first; "where users get stuck" in a flow; "buttons give no feedback", "the drawer feels off", "nothing happens while it saves"; and accessibility barriers such as keyboard traps, focus, contrast, or screen-reader semantics.
---

# Interface review

One review lane with five lenses. Pick the lens the symptom names, produce the evidence first, then judge. Do not answer an interface question from source code, a diff, or memory of how the screen used to look.

## 1. Route to a lens

| Symptom the user describes | Lens | Reference |
|---|---|---|
| "reads like a different product", type/color/spacing drift, tokens, radii, shadows, personality | Visual system | [visual-system-review](references/visual-system-review.md) |
| hard to scan, wrong thing is loudest, grouping, density, what to see first, responsive priority | Information design | [information-design-review](references/information-design-review.md) |
| no feedback on click, unclear loading or failure, control states, transitions, reduced motion | Interaction and motion | [interaction-motion-review](references/interaction-motion-review.md) |
| users get stuck, a flow is confusing, expert pass over a task against declared heuristics | Usability heuristics | [heuristic-evaluation](references/heuristic-evaluation.md) |
| keyboard, focus, contrast, reflow, target size, labels, announcements, WCAG criteria | Accessibility | [accessibility-audit](references/accessibility-audit.md) |

Pick the smallest lens set that covers the request; one or two is normal. "Tell me where this breaks" with no further signal means information design plus interaction, and accessibility when the surface is a real web page. Name the lenses used and the lenses left unreviewed. Read the chosen reference before judging against it.

## 2. Produce the artifact first

Start by emitting the evidence, not by reading the repository. The first tool call of a review is a capture, not a glob.

- Live web surface: open the route and capture the rendered screen at the scoped viewport, then the specific element, state, or accessibility-tree fragment the lens needs.
- Running app without a browser: capture the emitted state the lens needs — computed styles, a keyboard traversal transcript, measured contrast, a state-by-state interaction log, or timestamped captures across the outcome window.
- No running surface: say so, then review only what a supplied screenshot, artifact, or component render actually shows, and mark every other lane unverified.

Use the browser surface the user selected. When the in-app Browser is selected, stay on it and do not substitute standalone Playwright. Keep the review read-only: no purchases, sends, deletions, account changes, or other consequential submissions. Use a fixture or stop before the consequential step.

A static image supports visible-state findings only. Responsive behavior, hidden states, timing, recovery, persistence, announcements, and downstream effects are `UNVERIFIED` until direct evidence exists. Source, a diff, a design document, a token file, or a component story explains an observed relationship; none of them replaces seeing it.

## 3. Freeze the scope

Before capturing, fix the smallest decision-useful scope:

- product and current build or artifact;
- target user and the one task or bounded region under review;
- route, screen, or component, with a starting state and a safe stopping point;
- viewport and input modality, plus a second width only when responsive priority matters;
- the current design authority, declared standard, or token source when one exists;
- comparison surfaces only when cross-surface coherence is the question.

Infer harmless details from the request and the emitted surface. Ask one concise question only when a missing task, surface, viewport, or safe stop would materially change the verdict. Do not expand one region into a whole-product audit, and do not invent a brand personality, a user population, or a requirement the project never declared.

## 4. Record findings

One finding per underlying condition, never one per symptom. Each finding carries:

- a stable review-local ID and the lens it came from;
- the observation, stated as what the interface did;
- location and emitted evidence: route or artifact, state, viewport, input modality, element or region, plus the measurement, computed value, or criterion when one applies;
- likely impact, marked as an inference and never reported as observed user behavior;
- severity and confidence;
- the smallest credible direction, without implementation unless the user asks later.

Preserve strengths explicitly: name what already works and should survive revision. Difference is not drift, density is not defect, and motion is not decoration. Do not manufacture a finding to fill an empty lens.

## 5. Return the review

1. **Scope and evidence limits** — surface, state, viewport, authority, lenses used, and everything left unverified.
2. **Reading** — what the lens found the interface to be doing, before the defect list.
3. **Findings** — evidence-linked records ordered by severity, each with its location.
4. **Preserve** — decisions that already work.
5. **Verdict** — `PASS`, `PASS WITH POLISH`, `NEEDS WORK`, or `BLOCK`, followed by the unreviewed lanes.

Use `BLOCK` only when current authority explicitly labels a rule hard, absolute, or release-blocking; when the scoped critical path cannot be completed or perceived through a required access path; or when the interface is materially false in a way that can cause an unsafe or destructive action. Imperative wording alone does not make a hard law. Material failures are normally `NEEDS WORK`; bounded low-risk refinement is `PASS WITH POLISH`.

Do not create a report file unless asked. Do not claim conformance certification, user-research findings, conversion impact, or comprehensive product coverage. A review does not authorize implementation; hand implementation to the relevant build workflow only when the user asks for it.
