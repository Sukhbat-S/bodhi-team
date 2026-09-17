# skill-evals — measurement wrapper over BODHI's skills

`claude plugin eval` runs only against a plugin, so this is the thinnest plugin that can hold the owner-neutral skills: a `plugin.json`, one relative symlink per skill into `templates/personal/skills/`, and eval cases. It is **not** a discovery surface. Nothing loads skills from here in normal sessions, no `SKILL.md` lives here, and a skill is edited at its source under `templates/personal/skills/`.

The distribution ships the wrapper, this README and one example case. Write your own cases in your own phrasing; the phrases you actually type are what a skill description must catch.

## Set up

The per-skill links are generated, not shipped:

```bash
node scripts/install-harness.mjs --harness claude-code --apply
```

This links `skill-evals/skills/<name>` for every skill in `configs/personal-skill-matrix.json`, alongside the `.claude/skills` links. Both are gitignored.

## Run

```bash
claude plugin eval skill-evals --json skill-evals/evals/results/latest.json --model <model> --max-cost-usd <budget>
```

Runs use a throwaway home and working directory. The without-plugin arm sees no skills; the with-plugin arm sees only this plugin's skills. That ablation is the measurement. Results land under `skill-evals/evals/results/` and are gitignored: measurements of a moment, not source.

## What a firing case measures

One prompt per skill describing a situation its description covers, graded by one `tool_used: Skill` grader with `arm: both`, so firing is scored rather than reported as an indicator. Add `nofire-*` controls (ordinary coding or operations requests no skill should claim) with `min: 0, max: 0` to check the other direction.

A firing case does **not** measure whether the skill improves the answer. A skill that fires reliably and changes nothing is a finding for a second, quality-focused phase.

## Layout

```
.claude-plugin/plugin.json   name: bodhi-skills
skills/<name>                -> ../../templates/personal/skills/<name>   (generated, gitignored)
evals/fire-<skill>/          prompt.md + graders/fired.md
evals/nofire-<slug>/         prompt.md + graders/silent.md
evals/results/               run output (gitignored)
```

Prompts never name their own skill. Explicit-only skills (`session-start`, `session-save`) use the `$name` form, as in practice.

Measure firing before deleting or rewriting a skill. Usage counts alone misdiagnose: a skill that is never typed may simply never be offered.
