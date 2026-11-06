#!/usr/bin/env python3
"""Offline contract tests: no browser, build, token or network access required."""

import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
import urllib.request
import zipfile

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("hosted_release", Path(__file__).parents[1] / "scripts/hosted-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class FakeGitHub:
    def __init__(self, *, existing=False, draft=False, tag=None, corrupt_download=False):
        self.existing, self.tag, self.corrupt_download = existing, tag, corrupt_download
        self.draft = draft
        self.calls, self.assets = [], {}

    def call(self, method, path, value=None, **options):
        self.calls.append((method, path, value))
        if path.startswith("/releases/tags/"):
            return {"id": 8} if self.existing else None
        if path.startswith("/releases?"):
            return [{"tag_name": "foss2-v0.6.2-rc.1", "draft": True}] if self.draft else []
        if path.startswith("/git/ref/tags/"):
            return self.tag
        if path == "/git/refs":
            self.tag = {"object": {"type": "commit", "sha": value["sha"]}}
            return {"ref": value["ref"]}
        if path == "/releases":
            return {"id": 9, "tag_name": value["tag_name"], "draft": True, "assets": []}
        if path.startswith("/releases/9/assets?"):
            name = path.split("name=", 1)[1]
            asset_id = len(self.assets) + 1
            self.assets[asset_id] = value
            return json.dumps({"id": asset_id, "name": name, "size": len(value)}).encode()
        if path.startswith("/releases/assets/"):
            return b"wrong" if self.corrupt_download else self.assets[int(path.rsplit("/", 1)[1])]
        if method == "PATCH" and path == "/releases/9":
            return value
        raise AssertionError((method, path))


class ReleaseContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.root = self.repo / "ottplay-foss2"
        self.root.mkdir(parents=True)
        self.version = "0.6.2-rc.1"
        for name in release.TOP:
            (self.root / name).write_text(name, encoding="utf-8")
        (self.root / "vendor").mkdir()
        (self.root / ".gitignore").write_text("releases/\ntest-results/\n", encoding="utf-8")
        self.write("package.json", {"name": "ottplay-foss2", "version": self.version})
        self.write("package-lock.json", {"version": self.version, "packages": {"": {"version": self.version}}})
        self.write("vendor/runtime-manifest.json", {"lockfileSha256": release.digest((self.root / "package-lock.json").read_bytes())})
        (self.root / "index.html").write_text('<meta name="application-version" content="' + self.version + '">', encoding="utf-8")
        self.git("init", "-q")
        self.git("-c", "user.email=test@example.invalid", "-c", "user.name=Test", "add", ".")
        self.git("-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-qm", "fixture")
        self.sha = self.git("rev-parse", "HEAD").strip()
        self.git("update-ref", "refs/remotes/origin/main", self.sha)
        self.env = {"CANDIDATE_VERSION": self.version, "CANDIDATE_SHA": self.sha,
                    "GITHUB_WORKFLOW_SHA": self.sha, "GITHUB_REPOSITORY": "owner/repository",
                    "GITHUB_RUN_ID": "12", "GITHUB_RUN_ATTEMPT": "1",
                    "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main"}
        hashes = release.source_hashes(self.repo, self.sha)
        self.output = self.root / "releases" / self.version
        self.output.mkdir(parents=True)
        self.reportdir = self.root / "test-results" / ("release-" + self.version)
        self.reportdir.mkdir(parents=True)
        self.manifest = {"name": "ottplay-foss2", "version": self.version, "channel": "rc", "files": {
            name: {"bytes": len((self.root / name).read_bytes()), "sha256": sha} for name, sha in hashes.items()}}
        self.report = {"version": self.version, "platform": "linux", "passed": True, "inputsUnchanged": True,
                       "sourceHashes": hashes, "checks": [{"name": name, "exitCode": 0, "signal": None} for name in release.CHECKS]}
        (self.output / "release-manifest.json").write_bytes(release.json_bytes(self.manifest))
        (self.reportdir / "validation.json").write_bytes(release.json_bytes(self.report))
        with zipfile.ZipFile(self.output / release.asset_names(self.version)[0], "w") as archive:
            prefix = "ottplay-foss2-" + self.version + "/"
            for name in hashes:
                archive.writestr(prefix + name, (self.root / name).read_bytes())
            archive.writestr(prefix + "release-manifest.json", release.json_bytes(self.manifest))
        self.bundle = Path(self.temp.name) / "bundle"
        release.stage(self.bundle, self.repo, self.env)

    def write(self, name, value):
        (self.root / name).write_bytes(release.json_bytes(value))

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE).decode()

    def rebind(self):
        names = release.asset_names(self.version)
        binding = dict(release.identity(self.env), assets={name: release.digest((self.bundle / name).read_bytes()) for name in names[:3]})
        (self.bundle / "source-binding.json").write_bytes(release.json_bytes(binding))
        (self.bundle / "SHA256SUMS").write_bytes(release.sums(self.bundle, names))

    def verify(self):
        return release.verify(self.bundle, self.repo, self.env)

    def zip_metadata(self, original, target, system, attributes):
        """Change central-directory metadata only, preserving every member byte."""
        archive_path = self.bundle / release.asset_names(self.version)[0]
        archive_path.write_bytes(original)
        with zipfile.ZipFile(archive_path) as archive:
            position, rows = archive.start_dir, archive.infolist()
        data = bytearray(original)
        matched = False
        for row in rows:
            self.assertEqual(data[position:position + 4], b"PK\x01\x02")
            if row.filename == target:
                data[position + 5] = system
                struct.pack_into("<I", data, position + 38, attributes)
                matched = True
            lengths = struct.unpack_from("<HHH", data, position + 28)
            position += 46 + sum(lengths)
        self.assertTrue(matched)
        archive_path.write_bytes(data)
        self.rebind()

    def publication_guard(self):
        workflow = (Path(__file__).parents[2] / ".github/workflows/foss2-release.yml").read_text()
        publish = workflow.split("\n  publish:\n", 1)[1]
        marker = "      - name: Verify publication ancestry before repository code\n"
        self.assertIn(marker, publish)
        prefix, following = publish.split(marker, 1)
        block = following.split("\n      - ", 1)[0]
        self.assertIn("fetch-depth: 0", prefix)
        self.assertNotIn("run:", prefix, "The ancestry guard must be the first publisher script")
        self.assertIn("        working-directory: control\n", block)
        self.assertIn("        shell: bash\n", block)
        self.assertLess(publish.index(marker), publish.index("run: python3 control/"))
        body = block.split("        run: |\n", 1)[1]
        self.assertTrue(all(not line or line.startswith("          ") for line in body.splitlines()))
        return "\n".join(line[10:] for line in body.splitlines())

    def run_publication_guard(self, *, candidate=None, workflow=None, then=""):
        env = dict(os.environ, CANDIDATE_SHA=candidate or self.sha,
                   GITHUB_WORKFLOW_SHA=workflow or self.sha)
        return subprocess.run(["bash", "-c", self.publication_guard() + "\n" + then],
                              cwd=self.repo, env=env, capture_output=True, text=True, timeout=10)

    def test_immutable_request_and_branch_dispatch_cannot_publish(self):
        env = dict(self.env, INPUT_CANDIDATE=self.sha, INPUT_VERSION=self.version, INPUT_PUBLISH="true")
        self.assertEqual(release.request(env)["publish"], "true")
        self.assertEqual(release.request(dict(env, GITHUB_REF="refs/heads/feature"))["publish"], "false")
        for invalid in ["main", self.sha + "\nname=other", "$(echo unsafe)", "a" * 39]:
            with self.assertRaises(ValueError):
                release.request(dict(env, INPUT_CANDIDATE=invalid))
        for version in ["0.6.2", "0.6.2-rc.0", "0.6.2-rc.01", self.version + "\nother=x"]:
            with self.assertRaises(ValueError):
                release.request(dict(env, INPUT_VERSION=version))
        tagged = dict(env, GITHUB_EVENT_NAME="push", GITHUB_REF="refs/tags/foss2-v" + self.version, GITHUB_SHA=self.sha)
        self.assertEqual(release.request(tagged)["candidate"], self.sha)

    def test_clean_source_full_gates_and_bundle_pass(self):
        self.assertEqual(self.verify()["candidate"], self.sha)
        with self.assertRaises(FileExistsError):
            release.stage(self.bundle, self.repo, self.env)

    def test_changed_worktree_and_stale_lock_digest_rejected(self):
        self.write("package.json", {"name": "ottplay-foss2", "version": "0.6.3-rc.1"})
        with self.assertRaisesRegex(ValueError, "clean"):
            release.preflight(self.repo, self.env)
        data = {name: (self.root / name).read_bytes() for name in ["package.json", "package-lock.json", "index.html", "vendor/runtime-manifest.json"]}
        with self.assertRaisesRegex(ValueError, "versions"):
            release.check_versions(data, self.version)
        data["package.json"] = release.json_bytes({"name": "ottplay-foss2", "version": self.version})
        data["vendor/runtime-manifest.json"] = b'{"lockfileSha256":"bad"}'
        with self.assertRaisesRegex(ValueError, "digest"):
            release.check_versions(data, self.version)

    def test_other_run_or_candidate_cannot_reuse_artifact(self):
        for key, value in [("GITHUB_RUN_ID", "13"), ("GITHUB_RUN_ATTEMPT", "2"), ("CANDIDATE_SHA", "a" * 40), ("GITHUB_WORKFLOW_SHA", "b" * 40)]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "binding"):
                release.verify(self.bundle, self.repo, dict(self.env, **{key: value}))

    def test_incomplete_checks_rejected_even_with_new_checksums(self):
        for change in [lambda r: r["checks"].pop(), lambda r: r["checks"][0].update(exitCode=1),
                       lambda r: r.update(platform="darwin"), lambda r: r.update(passed=False),
                       lambda r: r.update(inputsUnchanged=False), lambda r: r["checks"][0].update(signal="SIGTERM"),
                       lambda r: r["checks"][0].pop("signal"), lambda r: r["checks"][0].update(exitCode=False)]:
            altered = json.loads(json.dumps(self.report))
            change(altered)
            (self.bundle / "validation.json").write_bytes(release.json_bytes(altered))
            self.rebind()
            with self.assertRaises(ValueError):
                self.verify()

    def test_tampered_and_extra_files_rejected(self):
        (self.bundle / "validation.json").write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.verify()
        (self.bundle / "unexpected").write_bytes(b"extra")
        with self.assertRaisesRegex(ValueError, "Unexpected bundle"):
            self.verify()

    def test_archive_path_injection_rejected_after_rebinding(self):
        with zipfile.ZipFile(self.bundle / release.asset_names(self.version)[0], "a") as archive:
            archive.writestr("../escape", "bad")
        self.rebind()
        with self.assertRaisesRegex(ValueError, "ZIP entries"):
            self.verify()

    def test_changed_archive_member_rejected_after_rebinding(self):
        archive_path = self.bundle / release.asset_names(self.version)[0]
        with zipfile.ZipFile(archive_path) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        entries["ottplay-foss2-" + self.version + "/index.html"] = b"altered"
        with zipfile.ZipFile(archive_path, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        self.rebind()
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            self.verify()

    def test_nonregular_zip_metadata_rejected_after_rebinding(self):
        original = (self.bundle / release.asset_names(self.version)[0]).read_bytes()
        for name in ["index.html", "release-manifest.json"]:
            for kind in [stat.S_IFLNK, stat.S_IFDIR, stat.S_IFIFO, stat.S_IFSOCK, stat.S_IFCHR, stat.S_IFBLK]:
                with self.subTest(name=name, kind=kind):
                    self.zip_metadata(original, "ottplay-foss2-" + self.version + "/" + name,
                                      3, (kind | 0o644) << 16)
                    with self.assertRaisesRegex(ValueError, "Non-regular ZIP entry"):
                        self.verify()
        self.zip_metadata(original, "ottplay-foss2-" + self.version + "/index.html", 0, 0x10)
        with self.assertRaisesRegex(ValueError, "Non-regular ZIP entry"):
            self.verify()

    def test_regular_dos_and_unix_zip_metadata_remain_compatible(self):
        original = (self.bundle / release.asset_names(self.version)[0]).read_bytes()
        for system, attributes in [(0, 0), (3, 0o600 << 16), (3, (stat.S_IFREG | 0o644) << 16)]:
            with self.subTest(system=system, attributes=attributes):
                self.zip_metadata(original, "ottplay-foss2-" + self.version + "/index.html", system, attributes)
                self.assertEqual(self.verify()["candidate"], self.sha)

    def test_report_cannot_claim_different_git_source(self):
        self.report["sourceHashes"]["index.html"] = "0" * 64
        (self.bundle / "validation.json").write_bytes(release.json_bytes(self.report))
        self.rebind()
        with self.assertRaisesRegex(ValueError, "Git candidate"):
            self.verify()

    def test_fresh_publication_uploads_then_downloads_all_assets_before_exposure(self):
        api = FakeGitHub()
        release.publish(self.bundle, self.repo, self.repo, self.env, api)
        self.assertEqual(len(api.assets), 5)
        self.assertEqual(api.calls[-1], ("PATCH", "/releases/9", {"draft": False, "prerelease": True}))
        self.assertEqual(sum(method == "GET" and path.startswith("/releases/assets/") for method, path, _ in api.calls), 5)

    def test_existing_release_or_wrong_tag_never_mutates(self):
        for api in [FakeGitHub(existing=True), FakeGitHub(draft=True),
                    FakeGitHub(tag={"object": {"type": "commit", "sha": "0" * 40}})]:
            with self.assertRaises(ValueError):
                release.publish(self.bundle, self.repo, self.repo, self.env, api)
            self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_matching_existing_tag_is_preserved(self):
        api = FakeGitHub(tag={"object": {"type": "commit", "sha": self.sha}})
        release.publish(self.bundle, self.repo, self.repo, self.env, api)
        self.assertFalse(any(path == "/git/refs" for _, path, _ in api.calls))

    def test_branch_dispatch_never_touches_network(self):
        api = FakeGitHub()
        with self.assertRaisesRegex(ValueError, "main dispatch"):
            release.publish(self.bundle, self.repo, self.repo, dict(self.env, GITHUB_REF="refs/heads/feature"), api)
        self.assertEqual(api.calls, [])

    def test_candidate_not_in_main_never_touches_network(self):
        self.git("-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "--allow-empty", "-qm", "unapproved")
        self.env["CANDIDATE_SHA"] = self.git("rev-parse", "HEAD").strip()
        self.rebind()
        api = FakeGitHub()
        with self.assertRaises(subprocess.CalledProcessError):
            release.publish(self.bundle, self.repo, self.repo, self.env, api)
        self.assertEqual(api.calls, [])

    def test_workflow_guard_accepts_main_candidate_and_control(self):
        result = self.run_publication_guard()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_workflow_guard_rejects_unmerged_helper_before_execution(self):
        helper = self.root / "scripts/hosted-release.py"
        helper.parent.mkdir()
        marker = self.repo / "untrusted-helper-ran"
        helper.write_text("from pathlib import Path\nPath('untrusted-helper-ran').touch()\n")
        self.git("add", "ottplay-foss2/scripts/hosted-release.py")
        self.git("-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-qm", "unmerged helper")
        unmerged = self.git("rev-parse", "HEAD").strip()
        for candidate, workflow in [(unmerged, self.sha), (self.sha, unmerged), (unmerged, unmerged)]:
            with self.subTest(candidate=candidate, workflow=workflow):
                result = self.run_publication_guard(candidate=candidate, workflow=workflow,
                                                    then="python3 ottplay-foss2/scripts/hosted-release.py")
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(marker.exists(), "No unapproved helper may execute after a failed guard")

    def test_workflow_guard_rejects_non_sha_and_missing_main(self):
        for value in ["main", "a" * 39, self.sha + "\n", "-h"]:
            for field in ["candidate", "workflow"]:
                with self.subTest(value=value, field=field):
                    self.assertNotEqual(self.run_publication_guard(**{field: value}).returncode, 0)
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        self.assertNotEqual(self.run_publication_guard().returncode, 0)

    def test_corrupt_download_leaves_draft_and_never_replaces_asset(self):
        api = FakeGitHub(corrupt_download=True)
        with self.assertRaisesRegex(ValueError, "download differs"):
            release.publish(self.bundle, self.repo, self.repo, self.env, api)
        self.assertFalse(any(method in ("PATCH", "DELETE") for method, _, _ in api.calls))

    def test_tag_moving_during_upload_cannot_expose_release(self):
        class MovingTag(FakeGitHub):
            def call(inner, method, path, value=None, **options):
                response = super().call(method, path, value, **options)
                if path == "/releases/assets/5":
                    inner.tag = {"object": {"type": "commit", "sha": "0" * 40}}
                return response
        api = MovingTag()
        with self.assertRaisesRegex(ValueError, "different source"):
            release.publish(self.bundle, self.repo, self.repo, self.env, api)
        self.assertFalse(any(method == "PATCH" for method, _, _ in api.calls))

    def test_draft_inventory_is_paginated_before_mutation(self):
        class Paginated(FakeGitHub):
            def call(inner, method, path, value=None, **options):
                if path == "/releases?per_page=100&page=1":
                    inner.calls.append((method, path, value))
                    return [{"tag_name": "unrelated-" + str(index)} for index in range(100)]
                return super().call(method, path, value, **options)
        api = Paginated(draft=True)
        with self.assertRaisesRegex(ValueError, "draft already exists"):
            release.publish(self.bundle, self.repo, self.repo, self.env, api)
        self.assertTrue(any(path.endswith("page=2") for _, path, _ in api.calls))
        self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_asset_redirect_drops_token(self):
        request = urllib.request.Request("https://api.github.com/example", headers={"Authorization": "Bearer fixture"})
        redirected = release.NoAuthRedirect().redirect_request(request, None, 302, "Found", {}, "https://release-assets.example.invalid/blob")
        self.assertFalse(redirected.has_header("Authorization"))
        with self.assertRaises(ValueError):
            release.NoAuthRedirect().redirect_request(request, None, 302, "Found", {}, "http://release-assets.example.invalid/blob")

    def test_publisher_gates_match_existing_release_builder(self):
        source = (Path(__file__).parents[1] / "scripts/release.cjs").read_text(encoding="utf-8")
        match = re.search(r"const requiredChecks=Object.freeze\(\[([^\]]+)\]\)", source)
        self.assertIsNotNone(match)
        self.assertEqual(re.findall(r"'([^']+)'", match[1]), release.CHECKS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
