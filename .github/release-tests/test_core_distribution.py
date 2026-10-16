"""Public compiler payload integrity and qualification/delivery separation."""

import copy
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

from scripts import version_plan

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "package_core_release", ROOT / "scripts/package_core_release.py"
)
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class CoreReleaseTests(unittest.TestCase):
    def fixture(self, root):
        dist = root / "shared-core/dist"
        dist.mkdir(parents=True)
        content = {
            "ottplay-core.js": b"compiled JS",
            "ottplay-core.d.ts": b"export type Core = string;",
            "ottplay-core.jar": b"compiled JVM",
            "ottplay-core.LICENSE.txt": b"Original license notices",
        }
        manifest = {
            "schema": 1,
            "name": "ottplay-shared-core",
            "version": "0.1.0-rc.1",
            "artifacts": {
                name: {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
                for name, raw in content.items()
            },
        }
        for name, raw in content.items():
            (dist / name).write_bytes(raw)
        (dist / PACKAGE.MANIFEST).write_text(json.dumps(manifest))
        (dist / ".env").write_text("private sentinel")
        (root / "shared-core/package.json").write_text(
            json.dumps({"version": "0.1.0-rc.1"})
        )
        return dist

    def test_only_compiler_inventory_is_published_and_existing_output_is_preserved(
        self,
    ):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dist = self.fixture(root)
            output = root / "release-dist"
            PACKAGE.stage(root, output)
            self.assertEqual(
                {p.name for p in output.iterdir()},
                PACKAGE.ARTIFACTS | {PACKAGE.MANIFEST, "SHA256SUMS"},
            )
            self.assertEqual(
                (output / "ottplay-core.LICENSE.txt").read_bytes(),
                (dist / "ottplay-core.LICENSE.txt").read_bytes(),
            )
            with self.assertRaisesRegex(ValueError, "Refusing to replace"):
                PACKAGE.stage(root, output)

    def test_stale_corrupt_or_linked_compiler_payload_never_creates_release(self):
        for mode in ("version", "bytes", "symlink", "inventory"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                dist = self.fixture(root)
                if mode == "version":
                    (root / "shared-core/package.json").write_text(
                        '{"version":"0.1.0-rc.2"}'
                    )
                elif mode == "bytes":
                    (dist / "ottplay-core.jar").write_bytes(b"corrupted")
                elif mode == "symlink":
                    (dist / "ottplay-core.js").unlink()
                    (dist / "ottplay-core.js").symlink_to(dist / ".env")
                else:
                    path = dist / PACKAGE.MANIFEST
                    data = json.loads(path.read_text())
                    data["artifacts"][".env"] = {}
                    path.write_text(json.dumps(data))
                output = root / "release-dist"
                with self.assertRaises(ValueError):
                    PACKAGE.stage(root, output)
                self.assertFalse(output.exists())

    def test_local_package_command_checks_plan_before_building_or_staging(self):
        for mode in ("valid", "valid-beta", "missing", "wrong-source", "wrong-channel", "wrong-version"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                dist = self.fixture(root)
                policy = json.loads((ROOT / ".release-policy.json").read_text())
                inputs = {item["path"] for item in policy["versioning"]["files"]}
                inputs.update(
                    {
                        ".release-policy.json",
                        "scripts/release.py",
                        "scripts/version_plan.py",
                        "scripts/release_version_adapter.py",
                        "scripts/release_control.py",
                        "scripts/package-release.sh",
                        "scripts/package_core_release.py",
                    }
                )
                for relative in inputs:
                    target = root / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes((ROOT / relative).read_bytes())
                manifest_path = dist / PACKAGE.MANIFEST
                manifest = json.loads(manifest_path.read_text())
                manifest["version"] = "0.1.0"
                manifest_path.write_text(json.dumps(manifest))
                subprocess.run(["git", "init", "-q", str(root)], check=True)
                subprocess.run(["git", "add", "."], cwd=root, check=True)
                subprocess.run(
                    [
                        "git",
                        "-c",
                        "user.name=Fixture",
                        "-c",
                        "user.email=fixture@example.invalid",
                        "-c",
                        "commit.gpgsign=false",
                        "commit",
                        "-qm",
                        "fixture",
                    ],
                    cwd=root,
                    check=True,
                )
                source = subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd=root, text=True
                ).strip()
                channel = "beta" if mode == "valid-beta" else "rc"
                plan = version_plan.create_plan("0.1.0", channel, 1, source, policy)
                # Fixture versions must follow their own plan, independently of
                # whichever release base is currently committed in the project.
                version_plan.sync_versions(root, policy, plan)
                manifest["version"] = version_plan.projections(plan)["package"]
                manifest_path.write_text(json.dumps(manifest))
                if mode == "wrong-source":
                    plan["source_sha"] = "a" * 40
                if mode == "wrong-channel":
                    plan = version_plan.create_plan("0.1.0", "beta", 1, source, policy)
                if mode == "wrong-version":
                    package_path = root / "shared-core/package.json"
                    package = json.loads(package_path.read_text())
                    package["version"] = "0.0.0"
                    package_path.write_text(json.dumps(package))
                if mode != "missing":
                    (root / ".release-plan.json").write_text(json.dumps(plan))
                tools = root / "fixture-tools"
                tools.mkdir()
                (tools / "python3").symlink_to(sys.executable)
                npm = tools / "npm"
                npm.write_text('#!/bin/sh\nprintf "%s\n" "$*" >> npm-invocations.txt\n')
                npm.chmod(0o755)
                environment = os.environ.copy()
                environment.pop("RELEASE_VERSION_PLAN", None)
                environment["PATH"] = str(tools) + os.pathsep + environment["PATH"]
                result = subprocess.run(
                    [
                        sys.executable,
                        "scripts/release.py",
                        "package",
                        "--version",
                        "0.1.0",
                        "--channel",
                        channel,
                    ],
                    cwd=root,
                    env=environment,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if mode in {"valid", "valid-beta"}:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(
                        len((root / "npm-invocations.txt").read_text().splitlines()), 4
                    )
                    self.assertEqual(
                        (root / "release-dist/ottplay-core.jar").read_bytes(),
                        b"compiled JVM",
                    )
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse((root / "npm-invocations.txt").exists())
                    self.assertFalse((root / "release-dist").exists())

    def test_rc_version_sync_preserves_locked_kotlin_dependencies(self):
        policy = json.loads((ROOT / ".release-policy.json").read_text())
        lock_path = Path("shared-core/kotlin-js-store/package-lock.json")
        original = json.loads((ROOT / lock_path).read_text())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = {item["path"] for item in policy["versioning"]["files"]}
            paths.add(str(lock_path))
            for relative in paths:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((ROOT / relative).read_bytes())
            plan = version_plan.create_plan("0.1.1", "rc", 1, "a" * 40, policy)
            version_plan.sync_versions(root, policy, plan)
            actual = json.loads((root / lock_path).read_text())
            self.assertEqual(actual["version"], "0.1.1")
            for workspace in ("", "packages/OttPlayCore", "packages/OttPlayCore-test"):
                self.assertEqual(actual["packages"][workspace]["version"], "0.1.1")
            expected = copy.deepcopy(original)
            expected["version"] = "0.1.1"
            for workspace in ("", "packages/OttPlayCore", "packages/OttPlayCore-test"):
                expected["packages"][workspace]["version"] = "0.1.1"
            self.assertEqual(actual, expected)
            version_plan.sync_versions(root, policy, plan, check=True)

    def test_final_packaged_javascript_receives_full_browser_qualification(self):
        jobs = yaml.safe_load((ROOT / ".github/workflows/release-build.yml").read_text())["jobs"]
        browser = jobs["browser-release"]
        self.assertEqual(browser["needs"], "package")
        self.assertEqual(jobs["package"]["outputs"]["browser-artifact-id"],
                         "${{ steps.assets.outputs.artifact-id }}")
        self.assertEqual(browser["with"]["browser-artifact-id"],
                         "${{ needs.package.outputs.browser-artifact-id }}")
        self.assertTrue(browser["with"]["browser-extended"])
        self.assertEqual(browser["with"]["browser-evidence-prefix"], "browser-release")
        self.assertIn("prepare-browser-candidate.cjs", browser["with"]["browser-prepare-command"])
        self.assertNotIn("pack:core", browser["with"]["browser-prepare-command"])

    def test_release_qualification_matches_existing_checks_and_has_no_delivery(self):
        original = yaml.safe_load((ROOT / ".github/workflows/core.yml").read_text())
        qualification = yaml.safe_load(
            (ROOT / ".github/workflows/core-release-validation.yml").read_text()
        )
        expected = {
            name: copy.deepcopy(original["jobs"][name])
            for name in ("scope", "portable", "browser-client", "browser-compatibility", "wire-contracts")
        }
        expected["scope"]["with"]["force-full"] = True
        self.assertEqual(qualification["jobs"], expected)
        self.assertEqual(qualification["permissions"], {"contents": "read"})
        self.assertEqual(
            set(qualification.get("on", qualification.get(True))), {"workflow_call"}
        )
        self.assertNotIn("deliver", qualification["jobs"])


if __name__ == "__main__":
    unittest.main()
