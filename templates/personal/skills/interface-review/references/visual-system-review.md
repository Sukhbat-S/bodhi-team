# Visual system lens

Review whether an interface expresses a coherent visual language appropriate to its product and task. Judge relationships in the emitted surface, not isolated swatches, raw token names, or personal taste.

## Scope additions for this lens

Beyond the shared brief, freeze the surface's reading or working register; the current design constitution, token source, or declared visual direction when one exists; and one or two current comparison surfaces when cross-surface coherence matters. Do not invent a brand personality or treat a historical design document as current authority.

Use computed styles or current token definitions to explain an observed relationship, not as substitutes for seeing the relationship in context.

## Dimensions

1. typographic roles and hierarchy;
2. color roles, semantics, and contextual relationships;
3. spacing rhythm and token coherence;
4. geometry, borders, and depth;
5. personality and signature;
6. cross-surface family resemblance and library capture.

Typography, color, and spacing may contribute to information hierarchy, but this lens judges the visual language used to express the structure. Reorganizing content, redesigning interactions, choosing motion, certifying accessibility, or implementing fixes belongs to another lens or another skill.

## Lens-specific judgment

Difference is not automatically drift: editorial and dashboard surfaces may be siblings rather than twins. Do not treat a preferred style as a universal rule.

In the returned reading, cover type roles, color roles, spacing and token grammar, geometry and depth, signature, and family resemblance.

`BLOCK` applies when current authority explicitly labels a rule hard, absolute, or release-blocking, or when visual encoding is materially false or makes the scoped primary state illegible. A prohibition does not become a hard law merely because it says "no" or "never." Multiple serious inconsistencies, token drift, or personality violations may still be `NEEDS WORK`.


## Method

This method turns visual-system judgment into evidence-linked diagnostics without reducing design to token counting or subjective preference.

### 1. Typographic roles and hierarchy

Inventory functional roles before judging individual faces:

- reading voice for sustained or reflective text;
- interface voice for controls and compact language;
- data voice when alignment or tabular comparison matters;
- display or signature voice only when the product has earned one.

Inspect family, size, weight, leading, measure, casing, tracking, alignment, and numeral treatment as a system. A role should remain recognizable across surfaces. Hierarchy usually needs the fewest variables that clearly express the difference; changing size, weight, color, case, and background for one level creates redundant signal.

Flag typography when it changes the content's register, destroys readable rhythm, assigns the same role several incompatible treatments, or uses novelty as identity. Do not require a particular typeface without current product evidence.

### 2. Color roles and contextual relationships

Classify color by job:

- canvas and surface separation;
- primary, secondary, and disabled text;
- action or accent;
- semantic state such as success, warning, or failure;
- data categorization or magnitude;
- decorative or signature use.

Color is relational: evaluate it beside its real neighbors, at its rendered area and saturation. A token's hex, HSL, RGB, or OKLCH notation is not a verdict. Check whether the same color role keeps the same meaning, whether several accents compete, whether status colors contradict their labels, and whether decoration can be mistaken for data.

Visual-system review may flag apparent legibility or color-only meaning for dedicated accessibility verification, but it does not certify contrast ratios or color-vision compliance.

### 3. Spacing rhythm and token coherence

Look for a small grammar rather than arithmetic purity:

- repeated objects share interior and inter-item rhythms;
- section changes receive visibly different separation;
- optical alignment corrects shapes without creating unexplained drift;
- semantic aliases express roles rather than exposing raw palette values;
- component-specific tokens exist only when a shared role cannot express the need.

Raw values are not automatically defects, and a perfect scale does not guarantee good composition. Flag repeated unexplained exceptions, near-duplicate tokens, or a borrowed component whose defaults introduce a second spacing language.

### 4. Geometry, borders, and depth

Radius, border weight, shadow, blur, and elevation should express stable relationships such as containment, selection, interactivity, or layering. Inspect whether peers share a grammar and whether different levels look intentionally different.

Flag depth when every object becomes a card, shadows and borders duplicate the same boundary, unrelated radii create multiple product personalities, or decorative glass/glow competes with content. A flat system is not inherently more coherent than a layered one; the relationship must be legible and consistent.

### 5. Personality and signature

Translate declared product qualities into observable visual choices. Personality may live in type voice, proportion, material treatment, imagery, illustration, or one uncommon signature. It should reinforce the task instead of functioning as decoration applied afterward.

Review for two opposite failures:

- **genericity:** the surface could belong to any template or category peer;
- **costume:** several effects, metaphors, or fashionable conventions compete to announce identity.

One coherent signature is often stronger than distributed novelty. Preserve restraint when restraint is itself the product's character. Project-specific prohibitions—such as no avatar, mascot, gradient, or luxury register—apply only when current authority declares them.

### 6. Cross-surface coherence and library capture

Compare roles, not pixels. Sibling surfaces should share enough typography, semantic color, spacing, geometry, and control grammar to feel related while adapting to their reading or working register.

Flag:

- the same semantic role rendered differently without a product reason;
- a new component importing its source library's radius, shadows, spacing, or color language;
- global consistency that erases a necessary register difference;
- local exceptions propagating into new global tokens before being proven.

When a seed component is involved, separate the useful behavior from its visual baggage. Name what aligns, what needs translation, and what should not propagate.

### Evidence and finding discipline

Separate:

- **Observation:** the emitted visual relationship.
- **System diagnosis:** the role, token, or family resemblance that is inconsistent or unsupported.
- **Likely impact:** a calibrated inference about legibility, semantic recognition, trust, or identity.

Use this severity scale:

- **Critical:** current authority explicitly identifies a hard, absolute, or release-blocking law, or visual encoding materially lies about state; normally `BLOCK`. Imperative wording alone does not establish a hard law.
- **High:** a primary reading/state role is illegible or system meaning reverses across the scoped surface; `NEEDS WORK`.
- **Medium:** meaningful type, color, token, geometry, or identity incoherence; usually `NEEDS WORK`.
- **Low:** bounded polish with no material task or semantic risk; `PASS WITH POLISH` when nothing higher remains.

Confidence reflects evidence quality. A live route plus computed/token evidence may support high confidence; a screenshot without design authority usually does not.

### Lane boundaries

- Do not restructure content, grouping, density, or responsive priority; route those to information-design review.
- Do not judge feedback, control lifecycle, transition timing, motion grammar, or reduced-motion behavior.
- Do not certify contrast, semantics, keyboard access, focus, or accessibility compliance.
- Do not map findings to usability heuristics or claim observed user behavior.
- Do not implement fixes unless a later task explicitly authorizes implementation.

### Source lineage

The method draws on Ellen Lupton and Robert Bringhurst for typographic role and rhythm, Josef Albers for contextual color perception, design-token practice for semantic aliases and component ownership, and Christopher Alexander's pattern-language framing for coherent personality across local variation. These sources inform the diagnostic; current emitted evidence and declared product direction decide the verdict.
