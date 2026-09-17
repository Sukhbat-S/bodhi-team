# Accessibility lens

Audit whether a bounded web interface can be perceived, operated, understood, and interpreted through the relevant access paths. Judge emitted behavior against applicable criteria; do not turn an automated scan, DOM inspection, screenshot, or code diff into a conformance claim.

## Scope additions for this lens

Beyond the shared brief, freeze the zoom or reflow state, the input modalities and assistive-technology combinations actually available, the relevant variants such as errors, dialogs, status updates, responsive states, and authentication, and the target standard and level when declared.

For web content, use WCAG 2.2 Level AA as the default reference only when the project does not name another current requirement. A bounded audit is not a WCAG conformance evaluation. A conformance claim requires complete pages, every responsive variation, complete processes, all applicable success criteria, relied-upon technologies, and appropriate browser and assistive-technology evidence.

## Evidence this lens requires

Combine direct manual evidence with automation when available:

- computed accessibility semantics, names, roles, values, states, and relationships;
- a real keyboard path and observable focus movement;
- measured text and non-text contrast;
- text resize, zoom, reflow, and spacing behavior;
- pointer, touch-target, gesture, and dragging evidence when applicable;
- emitted errors, instructions, status messages, and focus management;
- relevant browser and assistive-technology interoperability.

Automated results are candidate evidence, not a verdict. A DOM or accessibility-tree snapshot cannot prove screen-reader interoperability, speech output, cognitive accessibility, or the absence of barriers. A screenshot cannot prove keyboard behavior, focus order, announcements, zoom, or dynamic recovery. Mark unavailable evidence `UNVERIFIED`.

## Lanes

Inspect only applicable lanes:

1. structure, semantics, text alternatives, names, roles, values, and relationships;
2. keyboard operation, focus order, focus visibility, focus management, and traps;
3. text and non-text contrast, color dependence, resize, reflow, and text spacing;
4. pointer and touch alternatives, cancellation, dragging, gestures, and target size;
5. labels, instructions, errors, recovery, authentication, and redundant entry;
6. dynamic status messages, live regions, dialogs, and state changes;
7. time limits, moving or flashing content, media alternatives, and motion when applicable;
8. page language, headings, landmarks, reading order, and consistency.

For each applicable criterion, classify the scoped evidence as `PASS`, `FAIL`, `UNVERIFIED`, or `NOT APPLICABLE`. Do not infer a pass from missing evidence or manufacture a failure for an inapplicable criterion.

## Finding additions for this lens

Each finding also carries the applicable WCAG criterion, level, or other declared authority; the user context, input or assistive-technology path, and reproduction steps; the expected accessible behavior beside the emitted behavior; and the zoom and measurement evidence. Do not invent prevalence.

Name confirmed passes and native semantics worth preserving. Incorrect ARIA can be worse than absent ARIA; do not recommend adding roles when native HTML already supplies the required semantics and behavior.

## Lens-specific return

Add to the shared return shape a **claim boundary** stating why this is or is not a conformance evaluation, an **evidence matrix** of manual checks, automated checks, measurements, and unavailable evidence, and an **access-path result** for keyboard, semantics, reflow, pointer, form, and dynamic-state paths.

`PASS` means no material barrier was found in the fully exercised scope; it is never shorthand for site-wide conformance. Use `PASS WITH POLISH` only for advisory improvements beyond the target requirement, not to hide missing evidence. Any confirmed target-criterion failure is normally `NEEDS WORK`. Use `BLOCK` for a keyboard trap, an inaccessible scoped critical path, or materially false accessibility semantics that can cause an unsafe or destructive action. When the declared primary task cannot be completed through a required in-scope access path and no equivalent accessible path exists, the scoped verdict is `BLOCK` even if another modality can complete it.

Do not claim legal compliance, certify a product, or estimate affected-user prevalence.


## Method

This method supports a bounded, evidence-linked web accessibility audit. WCAG 2.2 success criteria are normative; supporting WAI guidance helps interpret and test them. Project-specific accessibility rules may raise the floor but cannot lower an applicable external requirement.

### 1. Scope and claim discipline

Choose one mode:

- **Bounded barrier audit — default.** Evaluate a declared route, component, or task across available access paths. Return scoped findings without a conformance claim.
- **Criterion verification.** Verify one or more named criteria on a frozen state and report `PASS`, `FAIL`, `UNVERIFIED`, or `NOT APPLICABLE` per criterion.
- **Conformance evaluation.** Use only when explicitly requested and when full pages, responsive variations, complete processes, all applicable criteria, relied-upon technologies, representative sampling, evaluator expertise, and relevant browser/assistive-technology combinations are available. Otherwise state exactly why conformance cannot be substantiated and continue only with the supported bounded audit.

WCAG-EM provides the evaluation frame: define scope, explore the product, choose representative views, evaluate the sample, and report findings. A sample can reveal barriers; it does not make an excluded part of a page or process conform.

### 2. Semantics, alternatives, names, roles, values, and relationships

Inspect the computed accessibility semantics and the emitted behavior together:

- page title, language, landmarks, headings, lists, tables, and reading order;
- text alternatives for meaningful non-text content and intentional silence for decoration;
- accessible names and descriptions that match the visible purpose;
- roles, states, values, expanded/selected/pressed/busy relationships, ownership, and labelling;
- native element behavior before custom ARIA.

Representative WCAG references include 1.1.1, 1.3.1, 1.3.2, 2.5.3, 3.1.1, and 4.1.2. Treat an ARIA role as a behavioral promise: a `role="button"` without button keyboard behavior is not repaired semantics. An accessibility tree shows what the browser exposes; actual assistive-technology interoperability remains unverified until exercised in a named combination.

### 3. Keyboard and focus

Run the path from a known starting point with the relevant keys:

- `Tab` and `Shift+Tab` between components;
- `Enter` and `Space` according to the control role;
- arrow keys, `Home`, `End`, or type-ahead only where the widget pattern requires them;
- `Escape` or another documented exit for transient layers;
- focus entry, containment, restoration, and absence of traps.

Record the focus target after each material step. Check focus order against meaning, visible and unobscured focus, persistent operability, and whether pointer-only actions have keyboard equivalents. Representative references include 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11, and the applicable WAI-ARIA pattern. Do not use positive `tabindex` as a general repair for source-order problems.

### 4. Visual perception, resize, and reflow

Measure rather than infer from token names:

- normal text contrast: at least 4.5:1 at Level AA;
- qualifying large text contrast: at least 3:1;
- user-interface components, states, and meaningful graphical objects: at least 3:1 against adjacent colors where the criterion applies;
- meaning does not rely on color alone;
- text can resize to 200% without loss of content or function;
- content reflows at the WCAG 2.2 reference width equivalent to 320 CSS pixels, except content that genuinely requires two-dimensional layout;
- author text-spacing overrides do not cause clipping, overlap, or lost function;
- hover/focus content is dismissible, hoverable, and persistent where applicable.

Representative references include 1.4.1, 1.4.3, 1.4.4, 1.4.10, 1.4.11, 1.4.12, and 1.4.13. Font weight, letter spacing, glow, or an adjacent high-contrast element does not change the measured contrast ratio of failing text.

### 5. Pointer, touch, gestures, dragging, and targets

Inspect whether multipoint or path-based gestures have a simple alternative, whether pointer cancellation avoids harmful down-event activation, whether visible labels appear in accessible names, and whether dragging has a non-drag alternative. At WCAG 2.2 Level AA, Target Size (Minimum) uses 24 by 24 CSS pixels or sufficient spacing, with defined exceptions. Do not turn a 44-pixel advisory target into a universal WCAG AA requirement.

Representative references include 2.5.1, 2.5.2, 2.5.3, 2.5.7, and 2.5.8. Measure the actual target and spacing in the exercised viewport; visual icon size is not necessarily the interactive target size.

### 6. Forms, errors, recovery, and authentication

Exercise initial, invalid, corrected, submitted, and rejected states where safe. Record relevant field values before and after the error before claiming that recovery preserved or destroyed user input:

- every input has a programmatic label and necessary instructions;
- required state, format, and constraints are perceivable before or at error;
- errors are identified in text, associated with the field, and recoverable;
- focus and summary behavior help locate errors without destroying entered data;
- repeated information and authentication do not impose avoidable memory, transcription, or cognitive-test barriers when the applicable criteria require alternatives.

Representative references include 1.3.5, 3.3.1, 3.3.2, 3.3.3, 3.3.7, and 3.3.8. Do not submit real credentials or consequential forms during an audit without the separate authorization that action requires.

### 7. Dynamic status, dialogs, and state changes

Observe what is exposed when content changes without moving focus:

- loading, saved, failed, filtered, or result-count status;
- busy state and completion;
- dialog name, modality, initial focus, containment, close path, and focus restoration;
- expanded, selected, pressed, or current state changes;
- validation messages and asynchronous errors.

Use 4.1.3 for status messages and 4.1.2 for name, role, and value where applicable. A visible message in a plain container is not proven announced. An `aria-live` attribute is not proven interoperable until exercised with a relevant assistive technology; classify the DOM signal separately from the interoperability result.

### 8. Time, movement, flashes, media, and language

When present, inspect time limits, auto-updating or moving content, pause/stop/hide controls, flash thresholds, captions, audio description or alternatives, page language, and language changes. Map motion preferences to project authority or the applicable criterion; `prefers-reduced-motion` is not by itself a blanket WCAG 2.2 Level AA requirement.

Representative references include 1.2.x as applicable, 2.2.1, 2.2.2, 2.3.1, 2.3.3, 3.1.1, and 3.1.2. Route causal-motion quality to interaction-motion review; this lane tests accessibility barriers caused by movement, flashing, time, or missing alternatives.

### Evidence classes

Label each material check:

- **Manual emitted:** keyboard, focus, zoom, reflow, pointer, form, timing, or visual observation.
- **Computed:** accessibility tree, DOM relationships, styles, geometry, contrast calculation, or browser state.
- **Automated:** rule-engine result, retained with rule, version, selector, and whether manually confirmed.
- **Assistive technology:** named browser, AT, version, command/path, and observed output.
- **Unverified:** evidence was unavailable, unsafe to trigger, or outside the declared matrix.

Automation can find candidates and repeat deterministic checks; it cannot determine accessibility as a whole. Confirm every reported failure manually enough to establish applicability and emitted impact.

### Severity and verdict calibration

- **Critical:** keyboard trap, a declared primary task that cannot be completed through a required scoped access path and has no equivalent accessible path, or materially false semantics that can cause an unsafe or destructive action; `BLOCK` even when another modality can complete the task.
- **High:** a primary task is unavailable or materially misleading through a required access path; `NEEDS WORK`.
- **Medium:** a confirmed target-criterion failure with a workaround or reduced scope; `NEEDS WORK`.
- **Low:** advisory improvement beyond the target requirement or bounded non-material friction; `PASS WITH POLISH` only when no criterion failure remains.

Severity describes user impact in the scoped path; it does not replace the binary outcome of an applicable WCAG success criterion. Confidence reflects evidence quality, not impact.

### Lane boundaries

- Do not reorganize hierarchy, grouping, density, or responsive priority except where a criterion directly requires reading or focus order, reflow, or sequence.
- Do not choose typography, color palette, spacing language, personality, or visual identity; measure accessibility properties only.
- Do not evaluate causal motion, delight, or interaction polish beyond accessibility barriers.
- Do not claim observed user behavior or replace evaluation with user research.
- Do not provide legal advice or certify regulatory compliance.
- Do not implement fixes unless a later task explicitly authorizes implementation.

### Primary source lineage

Current as of 2026-08-23:

- WCAG 2.2 Recommendation: https://www.w3.org/TR/WCAG22/
- WCAG Evaluation Methodology 2.0 W3C Group Note: https://www.w3.org/TR/wcag-em-2/
- WAI-ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/
- WAI evaluation-tool limitations: https://www.w3.org/WAI/test-evaluate/tools/selecting/

Use the current normative criterion and its Understanding document when exact applicability or exceptions matter. The links above inform the method; emitted evidence decides the scoped finding.
