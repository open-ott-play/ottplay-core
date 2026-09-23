"""Exercise path selection and checkout safety using disposable local repositories."""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import checkouts
import consumer_paths

spec = importlib.util.spec_from_file_location(
    "workspace_wire", SCRIPTS / "workspace-wire.py"
)
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)


def git(directory, *args):
    return subprocess.check_output(
        ["git", "-C", str(directory), *args], text=True, stderr=subprocess.PIPE
    ).strip()


def initialize(directory, origin):
    directory.mkdir(parents=True)
    git(directory, "init", "-q")
    git(directory, "config", "user.name", "Layout fixture")
    git(directory, "config", "user.email", "layout@example.invalid")
    git(directory, "remote", "add", "origin", origin)
    (directory / "fixture.txt").write_text("original\n")
    git(directory, "add", "fixture.txt")
    git(
        directory,
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "fixture",
    )
    return git(directory, "rev-parse", "HEAD")


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "ottplay-core"
        self.source.mkdir()
        self.pins = consumer_paths.checkout_pins()
        self.save_pins()

    def save_pins(self):
        (self.source / "checkouts.json").write_text(json.dumps(self.pins))

    def checkout(self, name="ottplay-foss", base=None):
        target = (base or self.root) / name
        self.pins[name]["revision"] = initialize(target, self.pins[name]["url"])
        self.save_pins()
        return target


class LayoutTests(Fixture):
    def test_default_siblings_ignore_source_folder_name(self):
        for folder in ("ottplay-core", "renamed-source"):
            source = self.root / folder
            source.mkdir(exist_ok=True)
            (source / "checkouts.json").write_text(json.dumps(self.pins))
            self.assertEqual(
                consumer_paths.consumer_path("ottplay-foss", source, {}),
                self.root / "ottplay-foss",
            )
            self.assertEqual(
                consumer_paths.workspace_path("ottplay-foss2/src/app.js", source, {}),
                source / "ottplay-foss2/src/app.js",
            )

    def test_explicit_isolated_root_and_historical_paths(self):
        isolated = self.root / "ci consumers"
        env = {"OTTPLAY_CONSUMER_ROOT": str(isolated)}
        self.assertEqual(
            consumer_paths.consumer_path("ottplay-android", self.source, env),
            isolated / "ottplay-android",
        )
        self.assertEqual(
            consumer_paths.workspace_path(
                "ottplay-foss/tests/fixture.json", self.source, env
            ),
            isolated / "ottplay-foss/tests/fixture.json",
        )
        self.assertEqual(
            consumer_paths.workspace_path(
                "shared-core/dist/receipt.json", self.source, env
            ),
            self.source / "shared-core/dist/receipt.json",
        )
        self.assertEqual(
            consumer_paths.workspace_path("reports/result.json", self.source, env),
            self.source / "reports/result.json",
        )

    def test_bad_root_and_escaping_names_are_rejected(self):
        for value in ("", "relative/path"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                consumer_paths.consumer_root(
                    self.source, {"OTTPLAY_CONSUMER_ROOT": value}
                )
        for name in ("unknown", "../ottplay-foss", "ottplay-foss/../outside"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                consumer_paths.consumer_path(name, self.source, {})
        for name in ("/absolute", "../outside", "ottplay-foss/../outside"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                consumer_paths.workspace_path(name, self.source, {})

    def test_cli_uses_same_resolution_from_an_unrelated_cwd(self):
        env = dict(os.environ, OTTPLAY_CONSUMER_ROOT=str(self.root / "isolated"))
        result = subprocess.check_output(
            [sys.executable, str(SCRIPTS / "consumer_paths.py")],
            cwd=self.root,
            env=env,
            text=True,
        )
        self.assertEqual(json.loads(result), consumer_paths.layout(environ=env))


class CheckoutTests(Fixture):
    def test_matching_checkout_unchanged_with_equivalent_ssh_origin(self):
        target = self.checkout()
        git(
            target,
            "remote",
            "set-url",
            "origin",
            "git@github.com:open-ott-play/ottplay-foss.git",
        )
        before = (git(target, "rev-parse", "HEAD"), git(target, "symbolic-ref", "HEAD"))
        with (
            contextlib.redirect_stdout(io.StringIO()),
            patch.object(checkouts.subprocess, "run", wraps=subprocess.run) as commands,
        ):
            checkouts.materialize(["ottplay-foss"], self.source, {})
        for call in commands.call_args_list:
            self.assertNotIn("clone", call.args[0])
            self.assertNotIn("checkout", call.args[0])
        self.assertEqual(
            before,
            (git(target, "rev-parse", "HEAD"), git(target, "symbolic-ref", "HEAD")),
        )

    def test_wrong_revision_is_not_reset(self):
        target = self.checkout()
        expected = self.pins["ottplay-foss"]["revision"]
        (target / "fixture.txt").write_text("newer work\n")
        git(target, "add", "fixture.txt")
        git(
            target,
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "-qm",
            "newer",
        )
        before = git(target, "rev-parse", "HEAD")
        self.assertNotEqual(before, expected)
        with self.assertRaisesRegex(ValueError, "differs from pin"):
            checkouts.materialize(["ottplay-foss"], self.source, {})
        self.assertEqual(git(target, "rev-parse", "HEAD"), before)
        self.assertEqual((target / "fixture.txt").read_text(), "newer work\n")

    def test_wrong_origin_same_commit_rejected(self):
        target = self.checkout()
        git(
            target,
            "remote",
            "set-url",
            "origin",
            "https://github.com/unrelated/project.git",
        )
        with self.assertRaisesRegex(ValueError, "origin differs"):
            checkouts.materialize(["ottplay-foss"], self.source, {})
        self.assertEqual(
            git(target, "config", "remote.origin.url"),
            "https://github.com/unrelated/project.git",
        )

    def test_parent_repository_is_not_mistaken_for_consumer(self):
        parent = self.root / "parent-repo"
        self.pins["ottplay-foss"]["revision"] = initialize(
            parent, self.pins["ottplay-foss"]["url"]
        )
        self.save_pins()
        (parent / "ottplay-foss").mkdir()
        with self.assertRaisesRegex(ValueError, "not the root"):
            checkouts.materialize(
                ["ottplay-foss"], self.source, {"OTTPLAY_CONSUMER_ROOT": str(parent)}
            )

    def test_tracked_and_untracked_changes_are_preserved(self):
        target = self.checkout()
        for file in ("fixture.txt", "untracked.txt"):
            with self.subTest(file=file):
                path = target / file
                original = path.read_bytes() if path.exists() else None
                path.write_text("local work\n")
                with self.assertRaisesRegex(ValueError, "local changes"):
                    checkouts.materialize(["ottplay-foss"], self.source, {})
                self.assertEqual(path.read_text(), "local work\n")
                if original is None:
                    path.unlink()
                else:
                    path.write_bytes(original)

    def test_symlink_and_non_repository_are_rejected(self):
        other = self.root / "elsewhere"
        other.mkdir()
        target = self.root / "ottplay-foss"
        target.symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "not a symlink"):
            checkouts.materialize(["ottplay-foss"], self.source, {})
        target.unlink()
        target.mkdir()
        with self.assertRaisesRegex(ValueError, "cannot verify Git"):
            checkouts.materialize(["ottplay-foss"], self.source, {})

    def test_all_existing_targets_checked_before_any_clone(self):
        target = self.checkout("ottplay-swop")
        git(target, "remote", "set-url", "origin", "https://example.invalid/wrong.git")
        with (
            patch.object(checkouts.subprocess, "run", wraps=subprocess.run) as commands,
            self.assertRaisesRegex(ValueError, "origin differs"),
        ):
            checkouts.materialize(["ottplay-foss", "ottplay-swop"], self.source, {})
        for call in commands.call_args_list:
            self.assertNotIn("clone", call.args[0])
            self.assertNotIn("checkout", call.args[0])
        self.assertFalse((self.root / "ottplay-foss").exists())

    def test_missing_checkout_clones_only_into_explicit_root(self):
        seed = self.root / "seed"
        revision = initialize(seed, "https://example.invalid/fixture.git")
        self.pins["ottplay-foss"] = {"url": str(seed), "revision": revision}
        self.save_pins()
        isolated = self.root / "isolated"
        with contextlib.redirect_stdout(io.StringIO()):
            checkouts.materialize(
                ["ottplay-foss"], self.source, {"OTTPLAY_CONSUMER_ROOT": str(isolated)}
            )
        self.assertEqual(git(isolated / "ottplay-foss", "rev-parse", "HEAD"), revision)
        self.assertEqual(git(isolated / "ottplay-foss", "status", "--porcelain"), "")
        self.assertFalse((self.root / "ottplay-foss").exists())
        self.assertFalse((self.source / "ottplay-foss").exists())


class WireTests(Fixture):
    def setUp(self):
        super().setUp()
        for relative in (
            "scripts/generate-wire-contracts.py",
            "contracts/ottplay-wire-v1.json",
        ):
            dest = self.source / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SCRIPTS.parent / relative, dest)

    def distribute(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            wire.distribute(source_root=self.source, environ={}, **kwargs)

    def test_default_distribution_retains_generator_and_standalone_receipt(self):
        for name in wire.TARGETS.values():
            self.checkout(name)
        canonical = (self.source / "scripts/generate-wire-contracts.py").read_bytes()
        self.distribute()
        self.distribute(check=True)
        for target, name in wire.TARGETS.items():
            base = self.root / name
            self.assertEqual(
                (base / "scripts/generate-wire-contracts.py").read_bytes(), canonical
            )
            receipt = json.loads((base / "contracts/wire-source.json").read_text())
            self.assertEqual(receipt["target"], target)
            self.assertEqual(
                receipt["generatorSha256"], hashlib.sha256(canonical).hexdigest()
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(base / "scripts/generate-wire-contracts.py"),
                    "--check",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertFalse((self.source / name).exists())
        self.assertEqual(
            (self.source / "scripts/generate-wire-contracts.py").read_bytes(), canonical
        )

    def test_explicit_root_and_selected_target_do_not_touch_siblings(self):
        default = self.checkout()
        isolated = self.root / "isolated"
        target = self.checkout(base=isolated)
        with contextlib.redirect_stdout(io.StringIO()):
            wire.distribute(
                selected="main",
                source_root=self.source,
                environ={"OTTPLAY_CONSUMER_ROOT": str(isolated)},
            )
        self.assertTrue((target / "src/shared/wire-contracts.ts").is_file())
        self.assertFalse((default / "src").exists())

    def test_check_detects_drift_without_repair(self):
        target = self.checkout()
        self.distribute(selected="main")
        file = target / "src/shared/wire-contracts.ts"
        file.write_text("changed\n")
        with self.assertRaisesRegex(ValueError, "Generated wire contracts differ"):
            self.distribute(check=True, selected="main")
        self.assertEqual(file.read_text(), "changed\n")

    def test_missing_wrong_repo_and_symlink_output_fail_before_write(self):
        with self.assertRaisesRegex(ValueError, "existing repository"):
            self.distribute(selected="main")
        target = self.checkout()
        git(target, "remote", "set-url", "origin", "https://example.invalid/wrong.git")
        with self.assertRaisesRegex(ValueError, "origin differs"):
            self.distribute(selected="main")
        self.assertFalse((target / "src").exists())
        git(target, "remote", "set-url", "origin", self.pins["ottplay-foss"]["url"])
        outside = self.root / "outside"
        outside.mkdir()
        (target / "src").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.distribute(selected="main")
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse((target / "contracts").exists())


if __name__ == "__main__":
    unittest.main()
