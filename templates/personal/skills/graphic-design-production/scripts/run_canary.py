#!/usr/bin/env python3
"""Exercise deterministic local exports only; no production or independent review claim."""

from __future__ import annotations

import argparse
from pathlib import Path

import emit_artifact_manifest


SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f7f3ee"/>
  <text x="96" y="250" fill="#1e1b18" font-family="Noto Sans, Noto Sans Mongolian, sans-serif" font-size="72">Өө Үү</text>
  <text x="96" y="350" fill="#6b625a" font-family="Noto Sans, Noto Sans Mongolian, sans-serif" font-size="28">Deterministic graphic design canary</text>
</svg>
"""

HTML = """<!doctype html>
<html lang="mn"><head><meta charset="utf-8"><style>
body { margin: 0; background: #f7f3ee; color: #1e1b18; font-family: Noto Sans, Noto Sans Mongolian, sans-serif; }
main { width: 1200px; height: 630px; padding: 96px; box-sizing: border-box; }
</style></head><body><main><h1>Өө Үү</h1><p>Deterministic graphic design canary</p></main></body></html>
"""


def main() -> int:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--workspace", required=True, help="existing or new temporary workspace")
    args = cli.parse_args()
    workspace = Path(args.workspace).expanduser().resolve()
    artifact = workspace / "artifact"
    if artifact.exists() and any(artifact.iterdir()):
        raise SystemExit("canary artifact directory must be empty; use a fresh temporary workspace")
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / "design.svg").write_text(SVG, encoding="utf-8")
    (artifact / "index.html").write_text(HTML, encoding="utf-8")
    argv = [
        "--artifact-dir",
        str(artifact),
        "--manifest",
        str(workspace / "manifest.json"),
        "--title",
        "deterministic canary",
        "--evidence-scope",
        "export-determinism",
        "--font-family",
        "Noto Sans",
        "--required-glyphs",
        "ӨөҮү",
        "--stage",
        "deterministic-svg-html",
        "--stage",
        "verified-export",
        "--verify-manifest",
    ]
    print(f"canary_workspace={workspace}")
    return emit_artifact_manifest.main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
