# Graphic design artifact contract

The production output is a local artifact directory plus a manifest kept outside that directory.
Keep only intended exports and bounded production metadata in the artifact directory. Never place
credentials, chat logs, private memory, raw source dumps, or unredacted generation prompts there.

## Evidence scopes

`emit_artifact_manifest.py` emits `graphic-design-artifact/v2` with one explicit scope:

- `production-metadata` records the nine caller-declared production stages, safe production IDs,
  bounded correction count, critique metadata, export checks, and file hashes. It requires source,
  brief, concept, layout, imagery, and critique inputs.
- `export-determinism` records only `deterministic-svg-html` and `verified-export`. It rejects
  production references, critique, imagery, and corrections. The deterministic canary uses this
  scope and creates only SVG/HTML exports.

Both modes emit:

```json
"evidence": {
  "scope": "production-metadata",
  "behavioral_review": "unverified",
  "native_reviewer_verification": "not-performed"
}
```

The scope may be `export-determinism`, but the other two values never become passing claims in
this local manifest. Workflow stages are marked `caller-declared` in both modes.

## Production metadata shape

The relevant v2 fields are:

```json
{
  "schema": "graphic-design-artifact/v2",
  "evidence": {
    "scope": "production-metadata",
    "behavioral_review": "unverified",
    "native_reviewer_verification": "not-performed"
  },
  "artifact": {"title": "safe title", "brief_id": "brief-001"},
  "workflow": {
    "stages": ["brief", "sources", "concept", "layout", "image2-imagery",
                "deterministic-svg-html", "independent-critique", "corrections",
                "verified-export"],
    "stage_evidence": "caller-declared",
    "corrections": 0,
    "critique_verdict": "pass",
    "external_publication": "not-performed"
  },
  "references": {
    "source_ids": ["source-001"],
    "concept_id": "concept-001",
    "layout_id": "layout-001",
    "imagery_id": "image2-001"
  },
  "checks": {
    "deterministic_svg_html": {"verified": true, "files": ["design.svg", "index.html"]},
    "mongolian_glyphs": {"required": ["Ө", "ө", "Ү", "ү"], "missing": [], "verified": true},
    "font_declaration": {"verified": true, "families": ["Noto Sans"]},
    "packaged_fonts": {"requested": false, "files": []}
  },
  "critique": {
    "provided": true,
    "declared_independent": true,
    "independence": "unverified",
    "verdict": "pass",
    "issue_count": 0
  },
  "files": [{"path": "design.svg", "size_bytes": 123, "sha256": "..."}]
}
```

The checker records IDs, counts, declarations, checks, and hashes rather than source prose,
prompts, critique text, or memory. The manifest itself is excluded from `files`, preventing a
self-referential hash. `external_publication` is always `not-performed`; the script cannot publish.

## What is and is not proven

- Hashes prove the bytes read from the declared local artifact directory at manifest time.
- The deterministic export check proves the documented structural checks over local SVG/HTML. It
  does not prove design quality, imagery generation, critique quality, or production-stage execution.
- The glyph check proves required code points occur in UTF-8 text-bearing artifacts when requested.
  The font check proves a declaration and, when supplied, the presence and hash of packaged font
  files. Neither replaces rasterized visual inspection.
- Critique metadata proves only that the caller supplied those fields. `declared_independent: true`
  is never proof of independence, and a declared `pass` is not a verified behavioral review.
- A fresh critic must inspect the exact artifact and acceptance criteria without the maker's
  self-justification. The parent must bind the critic's native identity and the exact artifact and
  review hashes before independent review can count as verified evidence.
- A manifest is stale after any artifact byte changes. Re-run the checker after every correction or
  export change. Old v1 manifests must be regenerated; they are not upgraded in place.
