"""Materialize exact pins into the consumer root; never repair existing checkouts."""

import argparse
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from consumer_paths import SOURCE_ROOT, checkout_pins, consumer_path


def repository_identity(url):
    """Allow equivalent GitHub HTTPS/SSH transport spellings, not other repos."""
    match = re.fullmatch(r"git@github\.com:([^/]+/[^/]+?)(?:\.git)?", url)
    if match:
        return "github.com/" + match[1].lower()
    parsed = urlsplit(url)
    if (
        parsed.scheme in ("https", "ssh")
        and parsed.hostname == "github.com"
        and not parsed.query
        and not parsed.fragment
        and parsed.port is None
        and parsed.password is None
        and parsed.username in (None, "git")
        and re.fullmatch(r"/[^/]+/[^/]+", parsed.path)
    ):
        return "github.com/" + parsed.path[1:].removesuffix(".git").lower()
    return url


def git(target, *args):
    return subprocess.check_output(
        ["git", "-C", str(target), *args], text=True, stderr=subprocess.PIPE
    ).strip()


def verify_checkout(target, pin, *, revision=True, clean=True):
    """Read-only verification; also used before explicit wire distribution."""
    if target.is_symlink() or not target.is_dir():
        raise ValueError(
            f"{target}: expected an existing repository directory, not a symlink"
        )
    try:
        top = Path(git(target, "rev-parse", "--show-toplevel"))
        if top.resolve() != target.resolve():
            raise ValueError(f"{target}: not the root of its own Git checkout")
        urls = git(target, "config", "--get-all", "remote.origin.url").splitlines()
        if len(urls) != 1 or repository_identity(urls[0]) != repository_identity(
            pin["url"]
        ):
            raise ValueError(f"{target}: origin differs from configured repository")
        head = git(target, "rev-parse", "HEAD")
        if revision and head != pin["revision"]:
            raise ValueError(
                f"{target}: existing checkout differs from pin; reconcile it explicitly"
            )
        if clean and git(target, "status", "--porcelain", "--untracked-files=all"):
            raise ValueError(
                f"{target}: existing checkout has local changes; leave it intact and use a separate consumer root"
            )
    except subprocess.CalledProcessError as error:
        raise ValueError(
            f"{target}: cannot verify Git checkout (exit {error.returncode})"
        ) from error
    return head


def materialize(names, source_root=SOURCE_ROOT, environ=None):
    pins = checkout_pins(source_root)
    targets = []
    # Validate all existing targets before creating any missing checkout.
    for name in dict.fromkeys(names):
        target = consumer_path(name, source_root, environ)
        pin = pins[name]
        if not re.fullmatch(r"[0-9a-f]{40}", pin["revision"]):
            raise ValueError(f"{name}: expected an exact 40-character revision")
        exists = target.exists() or target.is_symlink()
        if exists:
            verify_checkout(target, pin)
        targets.append((name, target, pin, exists))
    for name, target, pin, exists in targets:
        if not exists:
            if target.exists() or target.is_symlink():
                raise ValueError(
                    f"{target}: appeared during checkout preparation; left untouched"
                )
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                ["git", "clone", "--no-checkout", pin["url"], str(target)], check=True
            )
            subprocess.run(
                ["git", "-C", str(target), "checkout", "--detach", pin["revision"]],
                check=True,
            )
            verify_checkout(target, pin)
        print(f"{name}: {pin['revision']} ({target})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=list(checkout_pins()), action="append")
    args = parser.parse_args()
    try:
        materialize(args.only or checkout_pins())
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
