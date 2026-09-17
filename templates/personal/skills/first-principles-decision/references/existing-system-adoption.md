# Reuse versus build: the bounded adoption trial

Use this branch when the choice is whether a built-in, upstream, or already-installed capability can meet a concrete need before custom infrastructure is added, and when replacing a duplicated system. Reuse is a hypothesis to test, not a prohibition on custom work. Recommend the smallest maintainable path that meets the actual requirement.

## Frame the requirement

State the required outcome, essential constraints, existing owner of the capability, and acceptance evidence. Challenge a proposed subsystem when a configuration change, existing command, deletion, or thin adapter could achieve the same result. Preserve requirements that protect correctness, privacy, reliability, or user control; do not remove them simply to make an available tool fit.

Inspect capabilities already available in the scoped environment before searching a broad marketplace. Read relevant callers and contracts, not just package names or marketing descriptions. Separate installed, callable, documented, and experimentally verified availability. Verify load-bearing external product claims against current official sources when external products enter the comparison.

## Compare a few real options

Consider the current system, a plausible existing capability, and custom implementation only where materially different. Include doing nothing when the need is already met. For each serious option assess:

- Coverage of must-have behavior and the precise remaining gap.
- Integration and migration work, including compatibility and data ownership.
- Recurring maintenance, operational burden, usage costs, and failure recovery.
- Lock-in, reversibility, dependencies, and any loss of control or observability.

Use supported costs or explicit qualitative estimates; do not invent pricing, effort, or reliability metrics. Account for adapter upkeep and upstream change risk alongside custom-system ownership. A feature listed in documentation is not proof that this environment can use it.

## Run a bounded trial

Before the trial, name one representative input or failure condition, expected observable result, permitted side effects, and stop condition. Prefer read-only invocation or isolated temporary artifacts. Reuse the same acceptance condition across options when feasible. Do not install, migrate, purchase, deploy, or change permissions merely to finish a comparison; prepare the concrete proposal when additional authorization is required.

Observe the actual output and evaluate it against the requirement. A green command proves only what it checked. If a trial cannot run, report the exact missing access or evidence and keep the recommendation provisional; never call a documentation comparison a successful trial.

## Recommend and hand off

Lead with adopt, adapt, keep, or build, followed by decisive evidence, remaining gaps, and the smallest authorized next step. Explain what would reverse the recommendation. Custom work is justified when a material requirement remains unmet and its ownership cost is acceptable; a thin extension may be better than either wholesale adoption or replacement.

Do not build the proposed system during an evaluation-only request. When implementation is already authorized, carry the chosen approach through the relevant delivery workflow. Route demand uncertainty to `$product-discovery` rather than expanding this technical fit assessment into it. Do not reopen a settled implementation choice without new evidence.
