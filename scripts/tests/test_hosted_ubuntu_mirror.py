"""Exercise the shipped toolkit mirror preparation against temporary files."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class HostedUbuntuMirrorTests(unittest.TestCase):
    WORKFLOW_NAME = "core.yml"
    STEP_NAME = "Prefer the provisioned Ubuntu archive fallback"
    AZURE = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
    FALLBACK = "https://archive.ubuntu.com/ubuntu/\tpriority:2\n"

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.mirrors = self.root / "apt-mirrors.txt"
        workflow = yaml.safe_load((ROOT / ".github/workflows" / self.WORKFLOW_NAME).read_text())
        self.steps = workflow["jobs"]["browser-client"]["steps"]
        self.step = next(step for step in self.steps if step.get("name") == self.STEP_NAME)
        # Execute the shipped Node body against a fixture; never write host APT files.
        body = self.step["run"].split("<<'NODE'\n", 1)[1].removesuffix("NODE\n")
        self.assertEqual(body.count("'/etc/apt/apt-mirrors.txt'"), 1)
        self.body = body.replace("'/etc/apt/apt-mirrors.txt'", json.dumps(str(self.mirrors)))

    def execute(self, **env):
        return subprocess.run(
            ["node", "-e", self.body], cwd=self.root,
            env=os.environ | {"RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "Linux"} | env,
            capture_output=True, text=True, check=False,
        )

    def test_only_exact_azure_line_removed_and_other_bytes_and_mode_preserved(self):
        others = ("# Mirrors provisioned by the runner image\n\n" + self.FALLBACK +
                  "https://security.ubuntu.com/ubuntu/\tpriority:3\n" +
                  "https://example.invalid/ubuntu/ priority:8 arch:amd64 type:deb # keep options\n")
        original = "# Keep this header\n" + self.AZURE + others
        expected = "# Keep this header\n" + others
        self.mirrors.write_bytes(original.encode())
        self.mirrors.chmod(0o640)
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mirrors.read_bytes(), expected.encode())
        self.assertEqual(self.mirrors.stat().st_mode & 0o777, 0o640)
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mirrors.read_bytes(), expected.encode())
        self.assertIn("leaving APT unchanged", result.stdout)

    def test_whitespace_and_crlf_preserved(self):
        azure = " \t" + self.AZURE.rstrip("\n") + "  \r\n"
        fallback = "  " + self.FALLBACK.rstrip("\n") + " \r\n"
        expected = "# untouched\r\n" + fallback + "# final comment without newline"
        self.mirrors.write_bytes((azure + expected).encode())
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mirrors.read_bytes(), expected.encode())

    def test_no_azure_and_lookalike_uris_are_untouched(self):
        original = ("# " + self.AZURE + "http://azure.archive.ubuntu.com/ubuntu-other/ priority:1\n" +
                    "http://azure.archive.ubuntu.com.example.invalid/ubuntu/ priority:1\n" +
                    "https://azure.archive.ubuntu.com/ubuntu/ priority:1\n" + self.FALLBACK)
        self.mirrors.write_bytes(original.encode())
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mirrors.read_bytes(), original.encode())

    def test_unrecognized_source_shapes_warn_without_any_write(self):
        for original in (
            self.AZURE, self.AZURE + self.FALLBACK.replace("https:", "http:"),
            self.AZURE + self.FALLBACK.replace("priority:2", "priority:1"),
            self.AZURE.replace("priority:1", "priority:2") + self.FALLBACK,
            self.AZURE + self.FALLBACK.replace("priority:2", "priority:2 arch:amd64"),
            self.AZURE.replace("priority:1", "priority:1 arch:amd64") + self.FALLBACK,
            self.AZURE * 2 + self.FALLBACK, self.AZURE + self.FALLBACK * 2,
            self.AZURE.replace("priority:1", "priority:2") + self.FALLBACK.replace("priority:2", "priority:1"),
            self.AZURE + self.FALLBACK.rstrip("\n") + " # official fallback\n",
        ):
            with self.subTest(original=original):
                self.mirrors.write_bytes(original.encode())
                result = self.execute()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("::warning::Unrecognized Ubuntu mirror configuration; leaving APT unchanged",
                              result.stdout)
                self.assertEqual(self.mirrors.read_bytes(), original.encode())

    def test_invalid_encoding_and_non_regular_files_fail_unchanged(self):
        original = (self.AZURE + self.FALLBACK).encode() + b"\xff"
        self.mirrors.write_bytes(original)
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertEqual(self.mirrors.read_bytes(), original)
        self.mirrors.unlink()
        target = self.root / "target"
        target.write_text(self.AZURE + self.FALLBACK)
        self.mirrors.symlink_to(target)
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertTrue(self.mirrors.is_symlink())
        self.assertEqual(target.read_text(), self.AZURE + self.FALLBACK)
        self.mirrors.unlink()
        self.mirrors.mkdir()
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertTrue(self.mirrors.is_dir())

    def test_missing_image_mirror_list_is_an_explicit_noop(self):
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No image-provisioned Ubuntu mirror list", result.stdout)
        self.assertFalse(self.mirrors.exists())

    def test_self_hosted_and_non_linux_do_not_access_mirror_list(self):
        # A directory would fail if the guarded body attempted to inspect it.
        self.mirrors.mkdir()
        for environment, operating_system in (
            ("self-hosted", "Linux"), ("github-hosted", "Windows"),
            ("github-hosted", "macOS"), ("", "Linux"), ("github-hosted", ""),
        ):
            with self.subTest(environment=environment, operating_system=operating_system):
                result = self.execute(RUNNER_ENVIRONMENT=environment, RUNNER_OS=operating_system)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("does not apply", result.stdout)
                self.assertTrue(self.mirrors.is_dir())

    def test_preparation_precedes_installs_and_preserves_the_timeout(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows" / self.WORKFLOW_NAME).read_text())
        job = workflow["jobs"]["browser-client"]
        self.assertEqual(job["timeout-minutes"], 15)
        self.assertEqual(self.step["if"], "runner.environment == 'github-hosted' && runner.os == 'Linux'")
        names = [step.get("name") for step in self.steps]
        self.assertLess(names.index(self.STEP_NAME), names.index("Install Chromium on GitHub-hosted runners"))
        self.assertLess(names.index(self.STEP_NAME), names.index("Install ffmpeg on GitHub-hosted runners"))
        other = "core-release-validation.yml" if self.WORKFLOW_NAME == "core.yml" else "core.yml"
        peer = yaml.safe_load((ROOT / ".github/workflows" / other).read_text())
        peer_step = next(step for step in peer["jobs"]["browser-client"]["steps"] if step.get("name") == self.STEP_NAME)
        self.assertEqual(self.step, peer_step)


class ReleaseHostedUbuntuMirrorTests(HostedUbuntuMirrorTests):
    WORKFLOW_NAME = "core-release-validation.yml"


if __name__ == "__main__":
    unittest.main()
