# Interaction and motion lens

Review whether an interface makes actions perceivable, reports their real state, and uses motion to explain change. Judge a bounded emitted interaction, not a screenshot, animation concept, code diff, or preferred motion style.

## Scope additions for this lens

Beyond the shared brief, freeze the bounded task, the input modality, and the relevant initial, in-progress, success, failure, empty, refused, or unavailable states, plus the current interaction or motion authority when one exists.

Before acting, inventory the scoped controls at rest on the relevant input modality so hover or focus does not conceal a missing signifier. Record the action, the state before and after, visible feedback, and observable timing or easing when relevant. When claiming that a terminal state never appeared, observe the full expected outcome window or use repeated timestamped checks: a state that may have occurred between samples is unverified, not absent. Distinguish absent feedback from feedback that is too brief or does not persist. When reduced motion is material, compare every visibly or computationally animated element in ready, active, and terminal states — not only the primary container.

A static image can support affordance and visible-control-state findings only. It cannot prove acknowledgement timing, progress, recovery, persistence, transition causality, reduced-motion behavior, or performance.

## Dimensions

1. affordance, signifiers, and mapping;
2. feedback and state visibility;
3. task lifecycle;
4. control states;
5. causal motion and motion-language coherence;
6. reduced motion, responsive choreography, and performance.

Not every task exercises every state. Mark a state not applicable or unreviewed instead of manufacturing a defect. Separate the emitted observation, the interaction diagnosis, and the likely impact.

## Lens-specific judgment

Motion is not automatically decoration, a layout-changing animation is not automatically a performance defect, and an ambient loop is not automatically incoherent. Judge whether it truthfully carries state or relationship, stays below the task's attention threshold, respects motion preferences, and performs in the emitted context.

In the returned reading, give the interaction and state map: trigger, acknowledgement, in-progress behavior, terminal outcomes, recovery, control states, and motion relationships.

`BLOCK` applies when current authority explicitly labels a rule hard, absolute, or release-blocking; when consequential state ambiguity could cause an unsafe duplicate or destructive action; or when the scoped critical path cannot be completed or perceived. Material lifecycle, feedback, control-state, or motion failures are normally `NEEDS WORK`.


## Method

This method turns interaction and motion judgment into evidence-linked diagnostics without reducing the review to universal duration ranges, animation preferences, or a static state checklist.

### 1. Affordance, signifiers, and mapping

Inspect what the user can know before acting:

- whether the action is perceptible on the relevant input modality;
- whether label, placement, shape, icon, cursor, or surrounding context predicts the consequence;
- whether related controls map clearly to the object or region they affect;
- whether destructive, reversible, and mode-changing actions communicate their different consequences.

Hover may reinforce a signifier but should not be the only way to discover an important action. Inventory each scoped action in its resting state before triggering hover or focus, then compare the relevant interactive state. A familiar control can be restrained when its context makes the mapping clear. Flag hidden or misleading signifiers, not aesthetic subtlety by itself.

### 2. Feedback and state visibility

Trace the execution and evaluation loop:

1. immediate acknowledgement that the input was received;
2. truthful in-progress state when work is not immediate;
3. terminal success, failure, cancellation, or refusal;
4. persistent evidence or recovery when the outcome matters after transient feedback disappears.

Feedback strength and duration should match the action's consequence and latency. An unchanged enabled button during an asynchronous write can invite duplicate action; a spinner without the affected object's state can obscure what is happening. Do not require a progress indicator when the result is effectively immediate.

When terminal feedback is transient, observe continuously or take repeated timestamped samples across the expected completion interval. Report whether the state was absent, imperceptibly brief, or visible but not persistent. If the sampling interval could have missed it, mark absence unverified instead of stating that it never emitted.

### 3. Task lifecycle

Exercise the states that are material to the scoped task:

- initial or ready;
- in progress or queued;
- success or completed;
- failure and recovery;
- empty or no result;
- refused, unavailable, or permission-limited.

These absences are not interchangeable. “No records exist,” “the filter has no matches,” “data has not loaded,” and “access is unavailable” require different truthful explanations and next steps. Failure should preserve user input or prior state when recovery needs it. If a state cannot be safely triggered, mark it unreviewed rather than inferring it from code alone.

### 4. Control states

Inspect the relevant subset of:

- default;
- hover where a pointing device applies;
- focus-visible;
- active or pressed;
- selected;
- disabled;
- busy or pending.

Not every control needs every state, but omissions should follow the control's semantics. Busy is not the same as disabled, and selected is not the same as hovered. A disabled action should not conceal the reason or the route to readiness. This lane may note whether a state is visibly distinct; semantic correctness, keyboard parity, focus-order compliance, and assistive-technology behavior require a dedicated accessibility audit.

### 5. Causal motion and motion-language coherence

For each material transition, identify what the movement explains:

- origin and destination;
- containment or spatial relationship;
- state change or task progress;
- recency or newly arrived information;
- continuity across a mode or viewport change.

Motion without one of these jobs may still be expressive, but it should not compete with the task or masquerade as live system state. Duration should follow distance, consequence, frequency, and directness rather than a fixed universal range. Easing and spring behavior should express the product's interaction register consistently.

Continuous ambient motion may pass when it represents current state, remains below the attention threshold, and has a reduced-motion alternative. Layout animation may be justified when spatial continuity matters. Do not diagnose performance from an animated property name alone; use observed or measured jank, blocking, or layout churn in the exercised path.

### 6. Reduced motion, responsive choreography, and performance

When motion is material, exercise the relevant reduced-motion mode. Inventory animated elements in ready, active, and terminal states, including ambient indicators outside the primary task container; compare animation name, duration, iteration, transform, and visible movement where useful. The reduced experience should preserve state, consequence, and feedback while removing or simplifying large translations, parallax, rapid scale, repeated loops, or other nonessential movement. Removing all feedback is not a valid reduced-motion strategy.

At responsive breakpoints, inspect whether choreography still explains relationships or merely compresses desktop movement. A drawer may become an in-place disclosure; a multi-object sequence may become one state change. Preserve the causal story while reducing travel and simultaneity.

Observe latency, dropped frames, delayed input acknowledgement, interruption, and repeat-action behavior. Computed duration and animated-property evidence can support a finding, but the emitted task determines whether performance is material.

### Evidence and finding discipline

Separate:

- **Observation:** what the emitted interface did before, during, and after the action.
- **Interaction diagnosis:** the affordance, lifecycle, control-state, causal-motion, or recovery relationship that is unsupported.
- **Likely impact:** a calibrated inference about prediction, control, continuity, recovery, or trust.

Use this severity scale:

- **Critical:** current authority explicitly identifies a hard, absolute, or release-blocking law; state ambiguity could cause an unsafe duplicate or destructive action; or the scoped critical path cannot be perceived or completed. Normally `BLOCK`; imperative wording alone does not establish a hard law.
- **High:** primary-task feedback, lifecycle, recovery, or control state materially fails; `NEEDS WORK`.
- **Medium:** repeated interaction friction, misleading mapping, or meaningful motion-language incoherence; usually `NEEDS WORK`.
- **Low:** bounded polish with no material task, recovery, or truth risk; `PASS WITH POLISH` when nothing higher remains.

Confidence reflects evidence quality. A live route with exercised states and timing or computed evidence may support high confidence. A screenshot or untriggered code path does not.

### Lane boundaries

- Do not restructure hierarchy, grouping, density, or responsive information priority; route those to information-design review.
- Do not choose typography, color, spacing tokens, shape, depth, or brand personality; route those to visual-system review.
- Do not certify semantic HTML, keyboard parity, focus order, announcements, target size, contrast, or accessibility compliance.
- Do not map findings to a usability heuristic set or claim observed user behavior.
- Do not implement fixes unless a later task explicitly authorizes implementation.

### Source lineage

The method draws on Don Norman for affordance, signifiers, mapping, feedback, and execution/evaluation loops; Val Head for functional motion audits and reduced-motion behavior; and Material motion guidance for purposeful transitions and coherent motion language. These sources inform the diagnostic. Current emitted evidence, task consequence, and declared product authority decide the verdict.
