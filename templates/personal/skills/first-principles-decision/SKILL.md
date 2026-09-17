---
name: first-principles-decision
description: Frames a consequential choice, attacks its weakest assumption, and returns one recommendation with the evidence that would reverse it. Use for "should I take this on or drop it", "I keep going back and forth on this", "is this worth doing at all", "think this through with me properly", "what would make me change my mind".
---

# First-Principles Decision

Improve the owner's judgment, not merely the answer. Keep the owner as the decision owner and never treat a recommendation as permission for an external action.

## Select the mode

- **Do with me** is the default. Frame the choice, challenge it, and recommend a path.
- **Teach me** applies when the owner asks to learn, practice, or think it through without help. Ask exactly one material question, end the turn, and wait for the owner's attempt before revealing yours. Read [the mode guide](references/modes.md).
- **Audit me** applies when the owner supplies an existing decision or decision record for critique. Diagnose its framing, evidence, alternatives, and follow-through before offering a replacement. Read [the mode guide](references/modes.md).

Use the language of the conversation. Output in any language must read aloud naturally.

## Start compactly

For an ordinary consequential choice, return only what helps decide:

1. **Decision** — state the choice precisely.
2. **Objective** — name the outcome being optimized.
3. **Challenge** — identify the weakest requirement, assumption, avoidance pattern, or premature solution framing.
4. **Recommendation** — choose a path and state why it wins.
5. **Next evidence** — identify the smallest action or observation that most reduces uncertainty.

Ask only for missing information that could materially change the recommendation. If the current evidence supports only a provisional choice, say so and name what would reverse it.

## Expand when the stakes demand it

Use the full method when the choice is hard to reverse, materially costly, strategically load-bearing, personally consequential, or unusually uncertain. Read [the full decision method](references/full-method.md). Do not inflate a routine choice into a memo.

When the choice is reuse versus build — whether a built-in, upstream, or already-installed capability can meet the need before custom infrastructure is added — run the bounded adoption trial in [the reuse-versus-build branch](references/existing-system-adoption.md) and let its observed result, not a documentation comparison, carry the recommendation.

Challenge false requirements, motivated reasoning, sunk-cost attachment, and avoidance directly. Separate current facts from testimony, assumptions, and unknowns. When an unstable external fact is load-bearing, verify it from a current primary source before relying on it.

## Confirmed decisions

A recommendation is not a decision. Treat the decision as confirmed only after the owner explicitly selects or accepts it, or directs implementation after seeing the choice. Silence, continued exploration, and the assistant beginning unrequested work do not count.

When a decision becomes confirmed:

1. Prepare one compact record containing the decision, rationale, strongest rejected alternative, load-bearing assumptions, reversibility, review trigger, source task, and date.
2. Exclude secrets, intimate third-party material, transient details, and trivial choices.
3. If BODHI tools are available, search project-scoped memories for an equivalent record before writing. Use the current canonical project identity; use `bodhi` for a genuinely projectless personal decision.
4. If no equivalent exists, call `store_memory` with `type: decision`, `scope: session-active`, importance in the normalized 0–1 range and proportional to consequence, and tags for the project plus `first-principles-decision`.
5. Search again and observe the stored record before saying it persisted. Report a duplicate as already preserved rather than writing another.
6. If BODHI, authorization, canonical project identity, or read-back verification is unavailable, say `decision not persisted`. Never create an insecure file fallback and never retry an uncertain write automatically.

`$session-save` remains responsible for the broader task checkpoint, artifacts, verification, unfinished work, and handoff. It is not required after every confirmed decision.

