#!/usr/bin/env python3
"""Emit and verify a privacy-safe manifest for a local graphic design artifact.

This script has no network, account, publication, or cleanup behavior. It reads only the
declared artifact directory and an optional critique metadata file, then writes the requested
manifest outside the artifact directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


SCHEMA = "graphic-design-artifact/v2"
EXPORT_STAGES = ("deterministic-svg-html", "verified-export")
STAGES = (
    "brief",
    "sources",
    "concept",
    "layout",
    "image2-imagery",
    "deterministic-svg-html",
    "independent-critique",
    "corrections",
    "verified-export",
)
TEXT_SUFFIXES = {".css", ".html", ".htm", ".json", ".svg", ".txt", ".xml"}
FONT_SUFFIXES = {".otf", ".ttf", ".woff", ".woff2"}
UNSAFE_MARKERS = re.compile(
    r"(?:\bnew\s+date\b|\bdate\s*\(|\bmath\.random\b|\bcrypto\.randomuuid\b|https?://(?!www\.w3\.org/))",
    re.IGNORECASE,
)
FONT_DECLARATION = re.compile(
    r"font-family\s*(?::|=)\s*[\"']?([^;\"'>}\n]+)", re.IGNORECASE
)


class ContractError(ValueError):
    """Raised when the declared artifact cannot satisfy the contract."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_inside(path: Path, root: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ContractError(f"{label} must be inside artifact directory") from exc
    return resolved


def safe_id(value: str | None, label: str) -> str:
    value = value.strip() if isinstance(value, str) else ""
    if not value or len(value) > 128 or any(ord(char) < 32 for char in value):
        raise ContractError(f"{label} must be a short non-empty safe ID")
    return value


def artifact_files(root: Path) -> list[Path]:
    return sorted(
        (path for path in root.rglob("*") if path.is_file() and not path.is_symlink()),
        key=lambda path: path.relative_to(root).as_posix(),
    )


def reject_symlinks(root: Path) -> None:
    if any(path.is_symlink() for path in root.rglob("*")):
        raise ContractError("artifact directory must not contain symlinks")


def read_text_files(files: list[Path], root: Path) -> dict[str, str]:
    texts: dict[str, str] = {}
    for path in files:
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            texts[path.relative_to(root).as_posix()] = path.read_text(
                encoding="utf-8"
            )
        except UnicodeDecodeError:
            # Binary-looking files with a text suffix cannot satisfy text checks.
            continue
    return texts


def critique_summary(path: Path | None, root: Path) -> dict[str, Any]:
    if path is None:
        return {"provided": False, "declared_independent": None, "independence": "unverified", "verdict": None, "issue_count": None}
    path = resolve_inside(path, root, "critique JSON")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError(f"critique JSON is unreadable: {path.name}") from exc
    if not isinstance(data, dict):
        raise ContractError("critique JSON must contain an object")
    independent = data.get("independent") is True
    verdict = data.get("verdict")
    if verdict not in {"pass", "revise", "fail"}:
        raise ContractError("critique verdict must be pass, revise, or fail")
    issues = data.get("issues", [])
    if not isinstance(issues, list):
        raise ContractError("critique issues must be a list")
    if not independent:
        raise ContractError("production critique must declare independent=true; the parent must verify the actual fresh reviewer")
    return {
        "provided": True,
        "declared_independent": True,
        "independence": "unverified",
        "verdict": verdict,
        "issue_count": len(issues),
    }


def build_manifest(args: argparse.Namespace) -> dict[str, Any]:
    root = Path(args.artifact_dir).expanduser().resolve()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not root.is_dir():
        raise ContractError(f"artifact directory does not exist: {root}")
    if manifest_path.parent == root or root in manifest_path.parents:
        raise ContractError("manifest must be outside artifact directory")
    reject_symlinks(root)

    stages = list(args.stage or [])
    export_only = args.evidence_scope == "export-determinism"
    expected_stages = EXPORT_STAGES if export_only else STAGES
    if stages != list(expected_stages):
        raise ContractError("stages must match the declared evidence scope in documented order")
    if export_only and (args.critique_json or args.source_id or args.brief_id or args.concept_id or args.layout_id or args.imagery_id or args.corrections):
        raise ContractError("export-determinism must not declare production references, critique, or corrections")
    if not export_only and not args.source_id:
        raise ContractError("at least one safe source-id is required")
    if args.corrections < 0 or args.corrections > 2:
        raise ContractError("corrections must be between 0 and 2")

    files = artifact_files(root)
    if not files:
        raise ContractError("artifact directory is empty")
    svg_html = [
        path for path in files if path.suffix.lower() in {".svg", ".html", ".htm"}
    ]
    if not svg_html:
        raise ContractError("artifact must contain at least one SVG or HTML export")

    texts = read_text_files(files, root)
    text_payload = "\n".join(texts.values())
    markers = sorted(set(UNSAFE_MARKERS.findall(text_payload)))
    if markers:
        raise ContractError("deterministic export contains time, randomness, or external URL markers")

    declarations: list[str] = []
    for text in texts.values():
        declarations.extend(match.strip() for match in FONT_DECLARATION.findall(text))
    declarations = list(dict.fromkeys(value for value in declarations if value))
    if not declarations:
        raise ContractError("deterministic export must declare font-family")
    if args.font_family and not any(
        args.font_family.casefold() in declaration.casefold() for declaration in declarations
    ):
        raise ContractError("requested font family is absent from export declarations")

    required_glyphs = list(dict.fromkeys(args.required_glyphs))
    missing = [glyph for glyph in required_glyphs if glyph not in text_payload]
    if missing:
        escaped = ", ".join(f"U+{ord(glyph):04X}" for glyph in missing)
        raise ContractError(f"required Mongolian glyphs are missing: {escaped}")

    packaged_fonts: list[dict[str, Any]] = []
    for font_arg in args.font_file or []:
        font_path = resolve_inside(Path(font_arg), root, "font file")
        if not font_path.is_file():
            raise ContractError(f"font file does not exist: {font_path.name}")
        if font_path.suffix.lower() not in FONT_SUFFIXES:
            raise ContractError(f"font file has unsupported suffix: {font_path.name}")
        packaged_fonts.append(
            {
                "path": font_path.relative_to(root).as_posix(),
                "size_bytes": font_path.stat().st_size,
                "sha256": sha256_file(font_path),
            }
        )

    critique = critique_summary(
        Path(args.critique_json).expanduser() if args.critique_json else None, root
    )
    if not export_only and not critique["provided"]:
        raise ContractError("production requires critique metadata; actual independent review remains parent-verified")

    manifest_files = [
        {
            "path": path.relative_to(root).as_posix(),
            "size_bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in files
    ]
    return {
        "schema": SCHEMA,
        "evidence": {
            "scope": args.evidence_scope,
            "behavioral_review": "unverified",
            "native_reviewer_verification": "not-performed",
        },
        "artifact": {
            "title": safe_id(args.title, "title"),
            "brief_id": safe_id(args.brief_id, "brief_id") if not export_only else None,
        },
        "workflow": {
            "stages": stages,
            "stage_evidence": "caller-declared",
            "corrections": args.corrections,
            "critique_verdict": critique["verdict"],
            "external_publication": "not-performed",
        },
        "references": {
            "source_ids": [safe_id(value, "source_id") for value in args.source_id or []],
            "concept_id": safe_id(args.concept_id, "concept_id") if not export_only else None,
            "layout_id": safe_id(args.layout_id, "layout_id") if not export_only else None,
            "imagery_id": safe_id(args.imagery_id, "imagery_id") if not export_only else None,
        },
        "checks": {
            "deterministic_svg_html": {
                "verified": True,
                "files": [path.relative_to(root).as_posix() for path in svg_html],
            },
            "mongolian_glyphs": {
                "required": required_glyphs,
                "missing": missing,
                "verified": not missing,
            },
            "font_declaration": {
                "verified": True,
                "families": declarations,
            },
            "packaged_fonts": {
                "requested": bool(args.font_file),
                "files": packaged_fonts,
            },
        },
        "critique": critique,
        "files": manifest_files,
    }


def write_manifest(manifest: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def verify_manifest(path: Path) -> tuple[bool, str]:
    path = path.expanduser().resolve()
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest.get("schema") != SCHEMA:
            return False, "schema mismatch; regenerate with v2 evidence scope"
        evidence = manifest["evidence"]
        if evidence != {
            "scope": evidence.get("scope"),
            "behavioral_review": "unverified",
            "native_reviewer_verification": "not-performed",
        } or evidence["scope"] not in {"production-metadata", "export-determinism"}:
            return False, "manifest cannot certify behavioral review or native reviewer independence"
        critique = manifest["critique"]
        if critique.get("independence") != "unverified" or "independent" in critique:
            return False, "critique declarations cannot certify independence"
        if manifest["workflow"].get("stage_evidence") != "caller-declared":
            return False, "workflow stages are declarations, not observed behavioral proof"
        export_only = evidence["scope"] == "export-determinism"
        if manifest["workflow"]["stages"] != list(EXPORT_STAGES if export_only else STAGES):
            return False, "stages do not match evidence scope"
        if export_only and (critique.get("provided") is not False or manifest["workflow"]["critique_verdict"] is not None):
            return False, "export-determinism cannot include production critique"
        root = path.parent / "artifact"
        # The normal layout is <workspace>/manifest.json and <workspace>/artifact/.
        # The emitted manifest keeps file paths relative to an artifact sibling.
        if not root.is_dir():
            return False, "expected artifact sibling directory is absent"
        if any(candidate.is_symlink() for candidate in root.rglob("*")):
            return False, "artifact directory contains a symlink"
        current_paths = {
            candidate.relative_to(root).as_posix() for candidate in artifact_files(root)
        }
        listed_paths = {entry["path"] for entry in manifest.get("files", [])}
        if current_paths != listed_paths:
            return False, "artifact file set changed"
        for entry in manifest.get("files", []):
            relative = Path(entry["path"])
            candidate = resolve_inside(root / relative, root, "manifest file")
            if not candidate.is_file():
                return False, f"missing artifact file: {entry['path']}"
            if candidate.stat().st_size != entry["size_bytes"]:
                return False, f"size changed: {entry['path']}"
            if sha256_file(candidate) != entry["sha256"]:
                return False, f"hash changed: {entry['path']}"
        if manifest["workflow"]["external_publication"] != "not-performed":
            return False, "publication boundary changed"
    except (OSError, KeyError, TypeError, AttributeError, ValueError, json.JSONDecodeError) as exc:
        return False, f"manifest unreadable or invalid: {type(exc).__name__}"
    return True, f"verified {len(manifest.get('files', []))} artifact file hashes; behavioral review unverified; native reviewer verification not performed"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--artifact-dir", required=True)
    result.add_argument("--manifest", required=True)
    result.add_argument("--title", required=True)
    result.add_argument("--evidence-scope", choices=("production-metadata", "export-determinism"), default="production-metadata", help="local metadata scope; neither mode verifies native reviewer provenance")
    result.add_argument("--brief-id")
    result.add_argument("--source-id", action="append", default=[])
    result.add_argument("--concept-id")
    result.add_argument("--layout-id")
    result.add_argument("--imagery-id")
    result.add_argument("--critique-json")
    result.add_argument("--corrections", type=int, default=0)
    result.add_argument("--font-family")
    result.add_argument("--font-file", action="append", default=[])
    result.add_argument("--required-glyphs", default="")
    result.add_argument("--stage", action="append", choices=STAGES, required=True)
    result.add_argument(
        "--verify-manifest",
        action="store_true",
        help="re-read the sibling artifact directory after emitting and verify every hash",
    )
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        manifest = build_manifest(args)
        manifest_path = Path(args.manifest).expanduser().resolve()
        write_manifest(manifest, manifest_path)
        manifest_hash = sha256_file(manifest_path)
        print(f"manifest={manifest_path}")
        print(f"artifact_files={len(manifest['files'])}")
        print(f"manifest_sha256={manifest_hash}")
        for entry in manifest["files"]:
            print(f"sha256 {entry['path']} {entry['sha256']}")
        if args.verify_manifest:
            valid, message = verify_manifest(manifest_path)
            print(f"verification={message}")
            return 0 if valid else 1
    except ContractError as exc:
        print(f"contract_error={exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
