# Usability heuristics lens

Inspect an interface as an expert reviewer. Findings are potential usability problems, not observations of real user behavior. A heuristic violation is not automatically a defect: context and available alternatives can justify a tradeoff.

## Scope additions for this lens

Beyond the shared brief, freeze the target user group, one task or bounded flow, and the heuristic set, defaulting to Nielsen's 10 usability heuristics.

Traverse the task once to learn the system, then traverse it again to discover issues against the declared heuristics. Familiarization before discovery is part of the method, not an optional warm-up.

## Declare the evaluator mode

- **Single model pass:** default. Label coverage as one expert-model pass; do not imply completeness.
- **Independent model passes:** use only when the user asks for a rigorous or independent review and native task isolation is available. Freeze one identical brief, keep evaluators blind to one another, and consolidate only after every pass. Three model passes are not three independent human experts.
- **Human-team packet:** prepare the frozen brief and finding schema for independent human evaluators; do not fabricate their observations.

Do not create a permanent evaluator agent or start another model runtime. Native tasks remain temporary outcome workers under the active execution contract.

## Finding structure for this lens

Separate, in every finding:

- **Observation:** what the interface visibly or interactively did.
- **Heuristic mapping:** why that observed state conflicts with the selected principle.
- **Likely consequence:** a calibrated inference, never reported as observed user behavior.
- **Recommendation:** the smallest design direction that addresses the issue without pretending there is only one valid implementation.

For multiple evaluators, preserve individual findings until all passes finish. Then cluster duplicates, retain evaluator count and disagreements, and distinguish supported problems from contextual tradeoffs.

Assign severity only after discovery and consolidation, using the 0–4 rubric below, and explain frequency, impact, and persistence. A single-model severity is provisional.

## Lens-specific return

Add to the shared return shape:

- **Decision buckets:** fix now, validate with users, acceptable tradeoff, or insufficient evidence.
- **Coverage and unknowns:** task steps and heuristics inspected, disagreements, inaccessible states, and the smallest next evidence needed.


## Method

Use this reference while conducting a heuristic evaluation. It compresses the operational method; the linked primary sources remain authoritative.

### Source basis

- [How to Conduct a Heuristic Evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/) — narrow scope, independent evaluation, familiarization and discovery passes, consolidation, and the boundary with user research.
- [10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/) — canonical heuristic set and contextual-exception warning.
- [Severity Ratings for Usability Problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/) — frequency, impact, persistence, and the 0–4 severity scale.
- [Nielsen and Molich, 1990](https://doi.org/10.1145/97243.97281) — original evidence that individual evaluators find different subsets and aggregation improves coverage.

### Nielsen's 10 heuristics

Use the official names and evaluate them in the context of the frozen user task:

1. **Visibility of system status:** Does the interface reveal current state and timely outcomes?
2. **Match between system and the real world:** Does language and ordering fit the target user's concepts?
3. **User control and freedom:** Can the user exit, cancel, reverse, or recover from unwanted actions?
4. **Consistency and standards:** Do words, controls, and patterns follow internal and relevant platform conventions?
5. **Error prevention:** Does the design remove or constrain likely high-cost mistakes before they occur?
6. **Recognition rather than recall:** Is needed context visible or easily retrievable at the decision point?
7. **Flexibility and efficiency of use:** Can both newer and experienced users complete frequent work efficiently?
8. **Aesthetic and minimalist design:** Does every visible element support the task rather than compete with it?
9. **Help users recognize, diagnose, and recover from errors:** Are errors clear, specific, and actionable?
10. **Help and documentation:** Is task-focused help findable and available where it is needed?

The names are a framework, not a checklist that makes every deviation a defect. Map a finding only when the observed state and task context support the connection.

### Finding record

Use one record per distinct issue:

| Field | Requirement |
|---|---|
| ID | Stable within the review, such as `HE-01`. |
| Task step and state | Exact point in the frozen flow, including route or screen. |
| Observation | Visible or interactive behavior only. |
| Evidence | Route, viewport or device, state, and screenshot or DOM/runtime signal when useful. |
| Heuristic | One primary heuristic; add a secondary only when independently justified. |
| Likely consequence | Explicit inference about possible confusion, effort, error, or recovery cost. |
| Severity | `0–4`, assigned after discovery, with its basis. |
| Confidence | High, medium, or low based on evidence quality and contextual uncertainty. |
| Recommendation | Smallest credible design direction, not an unrequested implementation. |
| Next evidence | User test, analytics, domain evidence, or none when the issue is directly supported. |

### Severity pass

Rate only after the complete issue set has been consolidated:

- `0` — not a usability problem in the evaluated context;
- `1` — cosmetic issue with negligible task effect;
- `2` — minor issue, low-priority correction;
- `3` — major issue, important to correct;
- `4` — usability catastrophe that should block release of the evaluated flow.

Explain the rating through:

- **Frequency:** how commonly the condition is likely to occur in the scoped task;
- **Impact:** how difficult or costly it would be to overcome;
- **Persistence:** whether it disappears after learning or repeatedly interferes.

Do not manufacture frequency from a single inspection. When real usage evidence is absent, state the assumption and keep the severity provisional.

### Consolidation and disposition

Cluster findings by the same underlying interface condition, not merely by shared heuristic. Preserve which independent evaluator found each issue and any meaningful disagreement.

Place every consolidated finding into exactly one bucket:

- **Fix now:** high-confidence interface evidence with material task impact.
- **Validate with users:** consequence, frequency, terminology, mental model, or contextual tradeoff remains uncertain.
- **Acceptable tradeoff:** a deliberate exception whose constraints and alternatives justify it.
- **Insufficient evidence:** the required state or behavior was inaccessible or only inferred.

Empty coverage under a heuristic means no issue was observed in the scoped pass, not that the product satisfies that heuristic globally.
