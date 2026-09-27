#!/usr/bin/env python3
"""Verify exact released consumers against their committed core source receipts.

This checks provenance, not runtime tests or acceptance. See compatibility/README.md.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def verify(matrix, checkouts):
    verified = []
    sources = {}
    for consumer in matrix["consumers"]:
        name = consumer["id"]
        checkout = checkouts[name]
        actual = git(checkout, "rev-parse", "HEAD").decode().strip()
        if actual != consumer["commit"]:
            raise ValueError(f"{name}: checkout {actual} differs from tested release")
        tag = git(checkout, "rev-parse", consumer["release"] + "^{commit}").decode().strip()
        if tag != actual:
            raise ValueError(f"{name}: release tag does not resolve to expected commit")
        if git(checkout, "status", "--porcelain", "--untracked-files=no").strip():
            raise ValueError(f"{name}: tracked files have local modifications")
        manifest_path = checkout / consumer["manifest"]
        manifest = json.loads(manifest_path.read_text())
        source = manifest["source"]
        expected = consumer["core_source_sha256"]
        canonical = json.dumps(source["files"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        if sha256(canonical) != expected or source["sha256"] != expected:
            raise ValueError(f"{name}: manifest source receipt differs from tested pair")
        revision = consumer["core_source_commit"]
        if revision not in sources:
            archive = git(ROOT, "archive", revision, "shared-core")
            with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
                sources[revision] = {
                    member.name.removeprefix("shared-core/"): sha256(bundle.extractfile(member).read())
                    for member in bundle.getmembers() if member.isfile()
                }
        for file, digest in source["files"].items():
            if sources[revision].get(file) != digest:
                raise ValueError(f"{name}: core source differs: {file}")
        for file, expected_digest in consumer["artifacts"].items():
            data = (manifest_path.parent / file).read_bytes()
            receipt = manifest["artifacts"][file]
            if sha256(data) != expected_digest or receipt["sha256"] != expected_digest or receipt["bytes"] != len(data):
                raise ValueError(f"{name}: artifact differs: {file}")
        verified.append({"consumer": name, "release": consumer["release"], "core_source_commit": revision,
                         "artifact_count": len(consumer["artifacts"]), "status": "provenance_verified"})
    return verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", type=Path, default=ROOT / "compatibility/releases-2026-09-27.json")
    parser.add_argument("--checkout", action="append", default=[], metavar="ID=PATH")
    args = parser.parse_args()
    checkouts = {}
    for item in args.checkout:
        name, path = item.split("=", 1)
        checkouts[name] = Path(path).expanduser().resolve()
    matrix = json.loads(args.matrix.read_text())
    missing = {row["id"] for row in matrix["consumers"]} - checkouts.keys()
    if missing:
        parser.error("Missing --checkout for " + ", ".join(sorted(missing)))
    print(json.dumps({"checks": verify(matrix, checkouts), "runtime_tests_rerun": False,
                      "publication_gate": "not_qualified"}, indent=2))


if __name__ == "__main__":
    main()
