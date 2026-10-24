#!/usr/bin/env python3
"""Stage only verified compiler distributions, never the workspace or credentials."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ARTIFACTS = frozenset(
    {
        "ottplay-core.js",
        "ottplay-core.d.ts",
        "ottplay-core.jar",
        "ottplay-core.LICENSE.txt",
    }
)
MANIFEST = "ottplay-core.manifest.json"


def stage(root: Path, output: Path) -> None:
    dist = root / "shared-core" / "dist"
    if output.exists():
        raise ValueError("Refusing to replace an existing release directory")
    if dist.is_symlink() or not dist.is_dir():
        raise ValueError("Compiler distribution must be a regular directory")
    content = {}
    for name in ARTIFACTS | {MANIFEST}:
        path = dist / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Release artifact must be a regular file: " + name)
        content[name] = path.read_bytes()
    manifest = json.loads(content[MANIFEST])
    package = json.loads((root / "shared-core/package.json").read_text())
    if manifest.get("schema") != 1 or manifest.get("name") != "ottplay-shared-core":
        raise ValueError("Unexpected compiler manifest")
    if manifest.get("version") != package["version"]:
        raise ValueError("Compiler output differs from frozen package version")
    if set(manifest["artifacts"]) != ARTIFACTS:
        raise ValueError("Compiler artifact inventory differs from release policy")
    for name in ARTIFACTS:
        evidence = manifest["artifacts"][name]
        if evidence != {
            "sha256": hashlib.sha256(content[name]).hexdigest(),
            "bytes": len(content[name]),
        }:
            raise ValueError("Compiler output hash or size mismatch: " + name)
    # Validate all inputs before creating outputs. Compiler provenance is checked
    # by distribute.cjs check immediately before this stage in release-build.yml.
    output.mkdir(parents=True)
    for name, raw in content.items():
        (output / name).write_bytes(raw)
    checksums = "".join(
        f"{hashlib.sha256(content[name]).hexdigest()}  {name}\n"
        for name in sorted(content)
    )
    (output / "SHA256SUMS").write_text(checksums)


if __name__ == "__main__":
    project = Path(__file__).resolve().parents[1]
    stage(project, project / "release-dist")
