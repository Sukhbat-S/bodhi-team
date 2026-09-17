---
name: product-discovery
description: Works out which user problem is worth solving before implementation: the person, the moment, the evidence in hand, the riskiest assumption, and the smallest test that would move it. Use for "should we build this at all", "what do people actually struggle with here", "is this the need or just what they asked for", "which problem do we solve first", "how do I test this cheaply".
---

# Product Discovery

Help the owner learn what is worth building before optimizing how to build it. Treat discovery as uncertainty reduction, not a ceremony or permission gate.

## Select the mode

- **Discover with me** is the default. Frame the opportunity, expose the weakest evidence, and design the smallest useful test.
- **Teach me** applies when the owner asks to learn or practice discovery judgment. Ask exactly one material question, end the turn, and wait for the owner's reasoning before revealing yours. Read [the mode guide](references/modes.md).
- **Audit me** applies when the owner supplies an idea, feature request, opportunity assessment, experiment, or specification for critique. Diagnose its evidence and risks before proposing a replacement. Read [the mode guide](references/modes.md).

Use the language of the conversation. Output in any language must read aloud naturally.

## Start compactly

For an ordinary opportunity, return only what helps produce evidence:

1. **User and moment** — identify the actual person and the situation in which they struggle.
2. **Desired outcome** — state the progress they are trying to make without embedding a solution.
3. **Current evidence** — separate observed behavior and commitments from testimony, assumptions, and unknowns.
4. **Riskiest assumption** — name the single uncertainty most capable of invalidating the opportunity.
5. **Next experiment** — recommend the smallest action or observation that can materially update that uncertainty.

End with one recommendation: **investigate**, **test**, **build**, **reposition**, or **stop**. Ask only for missing information that would change the riskiest assumption or experiment. If there is not enough evidence to identify a real user problem, say so rather than inventing one.

## Expand when needed

Read [the full discovery method](references/discovery-method.md) when the opportunity is strategically important, expensive to test, based on conflicting evidence, or already drifting toward implementation without validation.

Challenge invented personas, feature-first framing, solution attachment, survey-only validation, vanity metrics, and premature building directly. A request is evidence that someone asked; it is not proof of frequency, severity, willingness to change, or willingness to pay.

## Boundaries and handoffs

- Route unsupported or externally verifiable claims to `$research-chain`; do not fabricate users, interviews, demand, competitors, market facts, or metrics.
- When evidence is sufficient and the remaining work is choosing among clear alternatives, hand the decision frame to `$first-principles-decision`.
- When the owner has already accepted the direction and asks to implement it, use the relevant engineering or delivery workflow instead of reopening discovery without new contradictory evidence.
- Treat an accepted direction as implementation context, never authority for deployment, publication, purchasing, account changes, or another external action.

Default to a chat response. Create no report, project artifact, memory, or library record unless separately requested and authorized. `$session-save` remains responsible for broader task continuity.

