"""Resolve independently versioned consumers beside this source checkout."""

import json
import os
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]


def checkout_pins(source_root=SOURCE_ROOT):
    return json.loads((source_root / "checkouts.json").read_text())


def consumer_root(source_root=SOURCE_ROOT, environ=None):
    env = os.environ if environ is None else environ
    if "OTTPLAY_CONSUMER_ROOT" not in env:
        return source_root.resolve().parent
    value = env["OTTPLAY_CONSUMER_ROOT"]
    path = Path(value).expanduser()
    if not value or not path.is_absolute():
        raise ValueError("OTTPLAY_CONSUMER_ROOT must be a nonempty absolute path")
    return path.resolve()


def consumer_path(name, source_root=SOURCE_ROOT, environ=None):
    if name not in checkout_pins(source_root) or Path(name).name != name:
        raise ValueError(f"Unknown consumer: {name}")
    return consumer_root(source_root, environ) / name


def workspace_path(relative, source_root=SOURCE_ROOT, environ=None):
    """Resolve historical inventory/evidence paths without rewriting their keys."""
    path = Path(relative)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise ValueError(f"Expected a workspace-relative path: {relative}")
    if path.parts[0] in checkout_pins(source_root):
        return consumer_path(path.parts[0], source_root, environ).joinpath(
            *path.parts[1:]
        )
    return source_root / path


def layout(source_root=SOURCE_ROOT, environ=None):
    return {
        "sourceRoot": str(source_root.resolve()),
        "consumerRoot": str(consumer_root(source_root, environ)),
        "consumers": {
            name: str(consumer_path(name, source_root, environ))
            for name in checkout_pins(source_root)
        },
    }


if __name__ == "__main__":
    print(json.dumps(layout(), indent=2))
