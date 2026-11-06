#!/usr/bin/env python3
"""Bind the existing FOSS2 release commands to immutable GitHub candidates.

The publisher consumes data only; it never executes scripts from the archive.
All network mutations are create-only, except finalizing the draft it just made.
"""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

VERSION = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-(beta|rc)\.[1-9]\d*")
SHA = re.compile(r"[0-9a-f]{40}")
CHECKS = ["unit-es5-resources-vendors", "browser", "browser-providers", "browser-engines",
          "browser-media", "browser-epg", "browser-browse", "browser-compat", "browser-scroll",
          "browser-controls", "browser-startup", "browser-window-controls", "browser-local-media"]
TOP = {"index.html", "manifest.webmanifest", "package.json", "package-lock.json", "LICENSE",
       "README.md", "TECHNICAL-SPEC.md", "MEDIA-API.md", "THIRD-PARTY-NOTICES.md"}
ROOTS = {"src", "ui", "vendor", "fonts", "icons", "licenses", "assets", "docs", "scripts", "tests"}
MAX_BYTES = 512 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], timeout=120)


def request(env):
    event, ref = env["GITHUB_EVENT_NAME"], env["GITHUB_REF"]
    if event == "push":
        require(ref.startswith("refs/tags/foss2-v"), "Only FOSS2 tags are supported")
        version, candidate, publish = ref.removeprefix("refs/tags/foss2-v"), env["GITHUB_SHA"], True
    else:
        require(event == "workflow_dispatch", "Unsupported event")
        version, candidate = env["INPUT_VERSION"], env["INPUT_CANDIDATE"]
        publish = env.get("INPUT_PUBLISH") == "true" and ref == "refs/heads/main"
    require(SHA.fullmatch(candidate), "Candidate must be a full lowercase commit SHA")
    match = VERSION.fullmatch(version)
    require(match, "A numbered beta or RC version is required; stable promotion is separate")
    return {"candidate": candidate, "version": version, "channel": match[1],
            "publish": str(publish).lower()}


def identity(env):
    version, sha = env["CANDIDATE_VERSION"], env["CANDIDATE_SHA"]
    require(VERSION.fullmatch(version) and SHA.fullmatch(sha), "Invalid candidate identity")
    require(SHA.fullmatch(env["GITHUB_WORKFLOW_SHA"]), "Invalid workflow identity")
    require(re.fullmatch(r"[\w.-]+/[\w.-]+", env["GITHUB_REPOSITORY"]), "Invalid repository")
    require(all(re.fullmatch(r"[1-9]\d*", env[key]) for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")),
            "Invalid run identity")
    return {"schema": 1, "candidate": sha, "version": version, "tag": "foss2-v" + version,
            "repository": env["GITHUB_REPOSITORY"], "workflow_sha": env["GITHUB_WORKFLOW_SHA"],
            "run_id": env["GITHUB_RUN_ID"], "run_attempt": env["GITHUB_RUN_ATTEMPT"]}


def check_versions(data, version):
    package, lock = json.loads(data["package.json"]), json.loads(data["package-lock.json"])
    require(package["name"] == "ottplay-foss2", "Wrong product")
    require(package["version"] == lock["version"] == lock["packages"][""]["version"] == version,
            "Package and lock versions differ from candidate")
    require(re.findall(rb'<meta name="application-version" content="([^"]+)">', data["index.html"])
            == [version.encode()], "Page version differs from candidate")
    vendor = json.loads(data["vendor/runtime-manifest.json"])
    require(vendor["lockfileSha256"] == digest(data["package-lock.json"]), "Stale vendor lock digest")


def preflight(repo, env):
    expected = identity(env)
    require(git(repo, "rev-parse", "HEAD").decode().strip() == expected["candidate"], "Wrong checkout")
    require(not git(repo, "status", "--porcelain", "--untracked-files=all", "--", "ottplay-foss2"),
            "Candidate inputs must be clean")
    root = Path(repo) / "ottplay-foss2"
    check_versions({name: (root / name).read_bytes() for name in
                    ["package.json", "package-lock.json", "index.html", "vendor/runtime-manifest.json"]},
                   expected["version"])
    if env["GITHUB_EVENT_NAME"] == "push":
        require(env["GITHUB_REF"] == "refs/tags/" + expected["tag"], "Tag differs from version")
    return expected


def source_hashes(repo, candidate):
    archive = git(repo, "archive", "--format=tar", candidate, "ottplay-foss2")
    require(len(archive) <= MAX_BYTES, "Source archive too large")
    result = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for entry in source:
            parts = PurePosixPath(entry.name).parts
            name = "/".join(parts[1:])
            if not name or not (name in TOP or parts[1] in ROOTS) or entry.isdir():
                continue
            require(entry.isfile() and not entry.issym() and not entry.islnk(), "Non-file source input")
            result[name] = digest(source.extractfile(entry).read())
    require(TOP <= result.keys(), "Missing release inputs")
    return result


def asset_names(version):
    return ["ottplay-foss2-" + version + ".zip", "release-manifest.json", "validation.json", "source-binding.json"]


def sums(bundle, names):
    return "".join(digest((bundle / name).read_bytes()) + "  " + name + "\n" for name in names).encode()


def verify(bundle, repo, env):
    bundle, expected = Path(bundle), identity(env)
    names = asset_names(expected["version"])
    require({p.name for p in bundle.iterdir()} == set(names + ["SHA256SUMS"]), "Unexpected bundle files")
    require(all(p.is_file() and not p.is_symlink() and p.stat().st_size <= MAX_BYTES for p in bundle.iterdir()),
            "Invalid bundle file")
    require((bundle / "SHA256SUMS").read_bytes() == sums(bundle, names), "Asset checksum mismatch")
    manifest_bytes = (bundle / "release-manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    report = json.loads((bundle / "validation.json").read_bytes())
    binding = json.loads((bundle / "source-binding.json").read_bytes())
    require(binding == dict(expected, assets={name: digest((bundle / name).read_bytes()) for name in names[:3]}),
            "Source/run/artifact binding mismatch")
    require(manifest["name"] == "ottplay-foss2" and manifest["version"] == expected["version"]
            and manifest["channel"] == VERSION.fullmatch(expected["version"])[1], "Wrong manifest identity")
    hashes = source_hashes(repo, expected["candidate"])
    require(report.get("passed") is True and report.get("inputsUnchanged") is True
            and report.get("version") == expected["version"], "Release qualification did not pass")
    require(report.get("platform") == "linux", "Release qualification must run on Linux")
    checks = report.get("checks", [])
    require(len(checks) == len(CHECKS) and all(row.get("name") == name and type(row.get("exitCode")) is int
            and row["exitCode"] == 0 and "signal" in row and row["signal"] is None
            for row, name in zip(checks, CHECKS)), "Missing release gates")
    require(report.get("sourceHashes") == hashes, "Validation source differs from Git candidate")
    require(set(manifest["files"]) == set(hashes), "Archive inventory differs from Git candidate")
    prefix = "ottplay-foss2-" + expected["version"] + "/"
    with zipfile.ZipFile(bundle / names[0]) as archive:
        rows = archive.infolist()
        wanted = {prefix + name for name in hashes} | {prefix + "release-manifest.json"}
        require(len(rows) == len(wanted) and {row.filename for row in rows} == wanted,
                "Unexpected or duplicate ZIP entries")
        require(sum(row.file_size for row in rows) <= MAX_BYTES, "Expanded archive too large")
        require(archive.read(prefix + "release-manifest.json") == manifest_bytes, "Embedded manifest mismatch")
        versions = {}
        for name, sha in hashes.items():
            require(not PurePosixPath(name).is_absolute() and ".." not in PurePosixPath(name).parts,
                    "Unsafe archive name")
            data = archive.read(prefix + name)
            require(manifest["files"][name] == {"bytes": len(data), "sha256": sha} and digest(data) == sha,
                    "Archive bytes differ from Git candidate: " + name)
            if name in {"package.json", "package-lock.json", "index.html", "vendor/runtime-manifest.json"}:
                versions[name] = data
        check_versions(versions, expected["version"])
    return expected


def stage(bundle, repo, env):
    expected = preflight(repo, env)
    bundle = Path(bundle)
    bundle.mkdir()  # Never overlay an earlier run's bundle.
    root = Path(repo) / "ottplay-foss2"
    names = asset_names(expected["version"])
    for name in names[:2]:
        shutil.copyfile(root / "releases" / expected["version"] / name, bundle / name)
    shutil.copyfile(root / "test-results" / ("release-" + expected["version"]) / "validation.json", bundle / names[2])
    (bundle / names[3]).write_bytes(json_bytes(dict(expected, assets={name: digest((bundle / name).read_bytes())
                                                                    for name in names[:3]})))
    (bundle / "SHA256SUMS").write_bytes(sums(bundle, names))
    return verify(bundle, repo, env)


class GitHub:
    def __init__(self, repository, token):
        self.repository, self.token = repository, token

    def call(self, method, path, value=None, *, raw=False, optional=False, upload=False):
        host = "https://uploads.github.com" if upload else "https://api.github.com"
        data = value if raw else (json_bytes(value) if value is not None else None)
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/octet-stream" if raw and method == "GET"
                   else "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                   "Content-Type": "application/octet-stream" if raw else "application/json"}
        req = urllib.request.Request(host + "/repos/" + self.repository + path, data=data, headers=headers, method=method)
        try:
            # urllib strips Authorization before the signed asset redirect below.
            opener = urllib.request.build_opener(NoAuthRedirect())
            with opener.open(req, timeout=90) as response:
                payload = response.read(MAX_BYTES + 1)
                require(len(payload) <= MAX_BYTES, "GitHub response too large")
                return payload if raw else json.loads(payload)
        except urllib.error.HTTPError as error:
            if optional and error.code == 404:
                return None
            raise RuntimeError("GitHub " + method + " failed: " + str(error.code)) from None


class NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        require(urllib.parse.urlparse(newurl).scheme == "https", "Insecure asset redirect")
        if redirected is not None:
            redirected.remove_header("Authorization")
        return redirected


def require_tag(api, tag, candidate, *, optional=False):
    existing = api.call("GET", "/git/ref/tags/" + tag, optional=optional)
    if existing is None:
        return False
    obj = existing["object"]
    for _ in range(8):
        if obj["type"] != "tag":
            break
        obj = api.call("GET", "/git/tags/" + obj["sha"])["object"]
    require(obj["type"] == "commit" and obj["sha"] == candidate, "Tag points to different source")
    return True


def require_no_release(api, tag):
    require(api.call("GET", "/releases/tags/" + urllib.parse.quote(tag, safe=""), optional=True) is None,
            "Release already exists; refusing to replace it")
    # The tag endpoint may omit drafts; authenticated listing includes them.
    for page in range(1, 101):
        releases = api.call("GET", "/releases?per_page=100&page=" + str(page))
        require(not any(row.get("tag_name") == tag for row in releases),
                "Release or draft already exists; refusing to replace it")
        if len(releases) < 100:
            return
    raise ValueError("Release inventory limit reached; absence is not proven")


def publish(bundle, repo, control, env, client=None):
    expected = verify(bundle, repo, env)
    require((env["GITHUB_EVENT_NAME"] == "workflow_dispatch" and env["GITHUB_REF"] == "refs/heads/main")
            or (env["GITHUB_EVENT_NAME"] == "push" and env["GITHUB_REF"] == "refs/tags/" + expected["tag"]),
            "Only main dispatch or exact candidate tag can publish")
    for sha in (expected["candidate"], expected["workflow_sha"]):
        subprocess.run(["git", "-C", str(control), "merge-base", "--is-ancestor", sha, "origin/main"],
                       check=True, timeout=30)
    api = client or GitHub(expected["repository"], env["GH_TOKEN"])
    tag = urllib.parse.quote(expected["tag"], safe="")
    require_no_release(api, expected["tag"])
    if not require_tag(api, tag, expected["candidate"], optional=True):
        api.call("POST", "/git/refs", {"ref": "refs/tags/" + expected["tag"], "sha": expected["candidate"]})
    body = ("FOSS2 " + expected["version"] + "\n\nCandidate: `" + expected["candidate"] + "`\n"
            "Hosted Linux qualification and source hashes are included in validation.json and source-binding.json.\n"
            "Download the ZIP and verify SHA256SUMS before extracting. This does not update an existing installation.\n"
            "Physical device, live-provider and DRM acceptance are separate from synthetic browser qualification.")
    release = api.call("POST", "/releases", {"tag_name": expected["tag"], "target_commitish": expected["candidate"],
                       "name": "FOSS2 " + expected["version"], "body": body, "draft": True, "prerelease": True})
    require(release.get("draft") is True and release.get("tag_name") == expected["tag"]
            and not release.get("assets"), "New draft must match the tag and have no assets")
    release_id = str(int(release["id"]))
    for name in asset_names(expected["version"]) + ["SHA256SUMS"]:
        data = (Path(bundle) / name).read_bytes()
        uploaded = api.call("POST", "/releases/" + release_id + "/assets?name=" + urllib.parse.quote(name, safe=""),
                            data, raw=True, upload=True)
        # Upload responses are JSON even though their request body is binary.
        uploaded = json.loads(uploaded)
        require(uploaded["name"] == name and uploaded["size"] == len(data), "Uploaded asset identity mismatch")
        downloaded = api.call("GET", "/releases/assets/" + str(int(uploaded["id"])), raw=True)
        require(downloaded == data, "Uploaded asset download differs from staged bytes")
    require_tag(api, tag, expected["candidate"])
    result = api.call("PATCH", "/releases/" + release_id, {"draft": False, "prerelease": True})
    require(result.get("draft") is False and result.get("prerelease") is True, "Release did not become a prerelease")
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["request", "preflight", "stage", "verify", "publish"])
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--control", type=Path)
    parser.add_argument("--bundle", type=Path)
    args = parser.parse_args()
    if args.command == "request":
        result = request(os.environ)
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write("".join(key + "=" + value + "\n" for key, value in result.items()))
    elif args.command == "preflight":
        result = preflight(args.repo, os.environ)
    elif args.command == "publish":
        result = publish(args.bundle, args.repo, args.control, os.environ)
    else:
        result = {"stage": stage, "verify": verify}[args.command](args.bundle, args.repo, os.environ)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
