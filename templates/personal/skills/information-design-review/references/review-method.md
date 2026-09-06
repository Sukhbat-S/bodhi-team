# Information-design review method

This method translates durable information-design principles into a bounded interface review. It is a diagnostic, not a universal layout recipe.

## 1. User job and information roles

Name the decision or understanding the surface exists to support. Classify visible content by role:

- **primary:** the fact, state, decision, or object that answers the user's immediate job;
- **secondary:** comparison, cause, context, or next action needed to interpret the primary;
- **tertiary:** provenance, metadata, controls, or detail used after orientation;
- **supporting:** labels, boundaries, or navigation that make the other roles legible.

A structural failure exists when the rendered priority contradicts these roles, not merely when the reviewer prefers a different layout.

## 2. Landing zone, hierarchy, and scan path

Inspect the macro read before local detail:

1. What receives attention first?
2. Does it answer or orient the primary job?
3. What is read second and third?
4. Can the user move from overview to detail without losing context?

Position is the most reliable hierarchy carrier. Size, value, contrast, whitespace, and isolation can reinforce it. Multiple elements using the same strong variables compete rather than form a hierarchy. A useful surface supports both a macro pattern and local inspection; simplification that removes necessary comparison or context can be as harmful as clutter.

## 3. Grouping, composition, and sequence

Judge whether spatial relationships match conceptual relationships:

- proximity groups related items;
- alignment exposes shared roles and comparison axes;
- containment marks a real boundary rather than filling a grid;
- sequence follows the user's decision order;
- controls sit near the content or consequence they govern;
- repeated structures keep a stable grammar.

Flag a container, divider, or section only when its implied relationship is false, redundant, or costly. Do not reject panels or grids categorically.

## 4. Comparison and representation faithfulness

Ask “compared to what?” for quantities, states, and alternatives. Important comparisons should remain within eyespan or use a stable repeated frame. Exact values and trends may need different representations; one should not crowd out the other.

Check that the visual variable can carry the information type:

- position and length are strong for ordered or quantitative comparison;
- size can express magnitude but area can exaggerate differences;
- lightness can express order;
- hue and shape are better for categories than quantities;
- motion can attract attention but belongs to interaction/motion review unless the current state is directly evidenced.

A structural finding is justified when the encoding creates a false order, hides the comparator, changes grammar between peers, or makes unrelated variation look meaningful.

## 5. Density rhythm and non-redundant ink

Density is the amount of decision-relevant information carried per region, not the number of pixels or cards. Inspect:

- whether borders, icons, labels, prose, and spacing carry information or repeat it;
- whether repeated rows remain compact enough to compare;
- whether real section changes receive enough separation;
- whether secondary chrome competes with data or evidence;
- whether detail is removed at the cost of context.

Prefer deleting redundant marks before adding whitespace. Preserve dense micro/macro surfaces when overview and local detail reinforce each other.

## 6. Responsive information priority

Review responsive behavior as reprioritization, not proportional shrinking:

- the primary job and its evidence survive;
- lower-priority metadata collapses, moves, or becomes available on demand;
- grouping remains conceptually true after reflow;
- comparison does not become an accidental horizontal scavenger hunt;
- alternate representations preserve the task when a graph or dense table cannot.

When only one static width is available, describe other widths as unverified rather than predicting behavior from code alone.

## Evidence and finding discipline

Separate three layers:

- **Observation:** what the emitted surface visibly does.
- **Structural diagnosis:** which relationship, priority, or comparison is weakened.
- **Likely impact:** a calibrated inference about orientation, scanning, comparison, or decision effort.

Use this severity scale:

- **Critical:** the primary information is materially false, hidden, or structurally unusable; normally `BLOCK`.
- **High:** the primary task is materially slowed, reversed, or error-prone; `NEEDS WORK`.
- **Medium:** meaningful scanning, grouping, comparison, or responsive friction; usually `NEEDS WORK`.
- **Low:** bounded polish with no material task risk; `PASS WITH POLISH` when nothing higher remains.

Confidence reflects evidence quality, not rhetorical certainty. Live route and state evidence may support high confidence; a static image or ambiguous user job usually does not.

## Lane boundaries

- Observe typography or color only as hierarchy evidence; do not choose the visual system.
- Do not judge transition timing, feedback, control states, or motion grammar.
- Do not certify semantics, keyboard behavior, contrast, or accessibility compliance.
- Do not map findings to usability heuristics or claim observed user behavior.
- Do not implement fixes unless a later task explicitly authorizes implementation.

## Source lineage

The method draws on Jacques Bertin's visual-variable and reading-level framework, Edward Tufte's comparison, data-ink, layering, and micro/macro principles, Stephen Few's dashboard and scan-surface practice, and Anne Treisman's work on pre-attentive visual attention. These sources inform the diagnostic; current product evidence and declared constraints decide the verdict.
