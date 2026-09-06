---
name: graphic-design-production
description: "Use when producing a bounded graphic design artifact that must move from brief and cited sources through concept, deterministic layout, Image2 imagery, independent critique, and a locally verified export."
---

# Graphic Design Production

Produce one reviewable design artifact at a time. This is an owner-neutral production
workflow: do not infer brand truths, private preferences, permanent agent identities, or
publication authority. Keep the work local until the exact external approval envelope is
accepted.

## Operating contract

- Start with a written brief: audience, message, language, dimensions, deliverables,
  accessibility constraints, allowed references, and the local output directory.
- Build a small context packet from only the brief and explicitly allowed sources. Give every
  source a safe ID and provenance. Exclude private messages, memory contents, credentials,
  unrelated files, hidden metadata, and raw personal data. Never put source contents or prompts
  in the manifest.
- Instantiate temporary role cards for this run only: brief owner, source curator, concept
  lead, layout builder, Image2 image maker, and independent critic. They are checklists, not
  permanent personas or agents. A fresh critic may be a bounded internal worker when the active
  outcome-based worker rule permits it; never create a roster or persist role identity.
- Treat the following sequence as a gate, in order:

  1. **Brief** — record the acceptance criteria and stop conditions.
  2. **Sources** — select, sanitize, and cite only allowed references.
  3. **Concept** — state the visual thesis, hierarchy, tone, and rejected alternatives.
  4. **Layout** — define a grid, type scale, spacing, color roles, and asset placement.
  5. **Image2 imagery** — generate or select imagery only through an available approved local
     image capability; retain a safe asset ID and hash, never private prompt context.
  6. **Deterministic SVG/HTML** — export fixed dimensions and viewBox, explicit font stack,
     local or embedded assets, stable ordering, and no time/random/external URL dependencies.
  7. **Independent critique** — use a fresh temporary critic context to inspect hierarchy,
     typography, Mongolian glyph coverage, contrast, spacing, legibility, and consistency.
  8. **Corrections** — apply only evidence-backed fixes. Allow at most two correction rounds;
     increment the count after each round. After round two, surface unresolved issues instead
     of silently iterating.
  9. **Verified export** — run `scripts/emit_artifact_manifest.py`, re-read the manifest,
     recompute hashes, and record the emitted result. This proves only the declared local files
     and export checks. A successful file write, screenshot, or tool response alone is not
     behavioral verification.

- A critique is independent only when a fresh critic receives the exact artifact and acceptance
  criteria without the maker's self-justification. `independent: true` is a caller declaration,
  never proof. The parent must bind the critic's native identity and the exact artifact/review
  hashes before treating the review as verified. Until then, independence and behavioral review
  remain unverified even when critique metadata says `pass`.
- Make the Mongolian check explicit whenever Mongolian text is in scope. Verify the actual
  required glyphs in the text-bearing export and verify an explicit `font-family` declaration;
  packaged font files are checked only when supplied. A declaration is not proof of visual
  rendering, so disclose any render-level check that was not performed.
- Do not call external publication, upload, account, messaging, ad, or social tools from this
  skill. Local generation and export stop before publication. If publication is requested,
  request one exact approval envelope containing: account, site/channel, destination and
  audience, complete content or diff, attachments, visibility, and material side effects.
  Execute only that approved action once and verify the emitted destination state; a changed
  account, audience, attachment, visibility, or side effect requires a new envelope.
- After local verification, return concrete corrections, unresolved risks, and reusable workflow
  evidence to the primary task. Temporary roles never write durable memory or modify skills.

## Required artifact evidence

Use the compact contract in [references/artifact-contract.md](references/artifact-contract.md).
The v2 manifest is written outside the artifact directory so it cannot hash itself. Its
`production-metadata` scope records safe caller-declared workflow and critique metadata plus
deterministic export checks. Its `export-determinism` scope records only the two export stages
and rejects production references, critique, imagery, and corrections. Both scopes report
behavioral review as unverified and native reviewer verification as not performed.

Run the local checker with a command shaped like:

```bash
python3 scripts/emit_artifact_manifest.py \
  --artifact-dir /tmp/design-run/artifact \
  --manifest /tmp/design-run/manifest.json \
  --title "bounded production" --evidence-scope production-metadata \
  --brief-id brief-001 \
  --source-id source-001 --concept-id concept-001 --layout-id layout-001 \
  --imagery-id image2-001 --critique-json /tmp/design-run/artifact/critique.json \
  --font-family "Noto Sans" --required-glyphs "ӨөҮү" --corrections 0 \
  --stage brief --stage sources --stage concept --stage layout \
  --stage image2-imagery --stage deterministic-svg-html \
  --stage independent-critique --stage corrections --stage verified-export
```

The command is read-only with respect to the design inputs: it reads and hashes the declared
artifact directory and writes only the requested manifest. Its workflow stages and critique
fields remain caller declarations until the parent verifies the fresh critic. Run the isolated
canary only to exercise deterministic export behavior:

```bash
python3 scripts/run_canary.py --workspace /tmp/graphic-design-production-canary
```

The canary emits only SVG/HTML, an `export-determinism` v2 manifest, stable artifact hashes, and
a re-read summary in the supplied temporary workspace. It performs no imagery or critique and
cannot certify the production workflow or independent review. See
[references/privacy-and-approval.md](references/privacy-and-approval.md) for packet and publication
boundaries.

## Governed learning receipt

Invoke `$skill-evolution` only when this run produces concrete correction, rejection, workaround,
routing, context, reference, quality, verification, safety, or agent-boundary evidence. A clean run
creates no learning receipt or write. Keep any receipt sanitized and task-scoped; never include source,
artifact, prompt, or conversation content.
