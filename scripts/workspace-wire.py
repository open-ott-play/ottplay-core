"""Distribute canonical wire outputs to resolved consumer checkouts."""

import argparse
import hashlib
import importlib.util
import json
import subprocess

from checkouts import verify_checkout
from consumer_paths import SOURCE_ROOT, checkout_pins, consumer_path

TARGETS = {
    "main": "ottplay-foss",
    "swop": "ottplay-swop",
    "control": "ottplay-control-server",
}


def canonical_generator(source_root):
    script = source_root / "scripts/generate-wire-contracts.py"
    spec = importlib.util.spec_from_file_location("ottplay_wire_generator", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def distribute(*, check=False, selected=None, source_root=SOURCE_ROOT, environ=None):
    generator = canonical_generator(source_root)
    raw = generator.SCHEMA.read_bytes()
    schema = json.loads(raw)
    if schema["version"] != 1:
        raise ValueError("Unsupported wire schema version")
    digest = hashlib.sha256(raw).hexdigest()
    script = generator.SCRIPT.read_bytes()
    script_digest = hashlib.sha256(script).hexdigest()
    pins = checkout_pins(source_root)
    targets = [selected] if selected else list(TARGETS)
    bases = {}
    for target in targets:
        name = TARGETS[target]
        base = consumer_path(name, source_root, environ)
        # Distribution intentionally permits development branches/local changes,
        # but cannot create or write into an unrelated/missing repository.
        verify_checkout(base, pins[name], revision=False, clean=False)
        bases[target] = base
    pending = []
    for target in targets:
        files = {
            name: text.encode()
            for name, text in generator.outputs(target, schema, digest).items()
        }
        files["contracts/ottplay-wire-v1.json"] = raw
        files["scripts/generate-wire-contracts.py"] = script
        receipt = {
            "version": 1,
            "target": target,
            "schemaSha256": digest,
            "generatorSha256": script_digest,
        }
        files["contracts/wire-source.json"] = (
            json.dumps(receipt, indent=2) + "\n"
        ).encode()
        pending.extend((bases[target] / name, value) for name, value in files.items())
    # Refuse symlinked output paths before writing any generated files.
    for dest, _ in pending:
        if any(path.is_symlink() for path in (dest, *dest.parents)):
            raise ValueError(f"Wire output path contains a symlink: {dest}")
    bad = []
    for dest, value in pending:
        if check:
            if not dest.is_file() or dest.read_bytes() != value:
                bad.append(str(dest))
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(value)
    if bad:
        raise ValueError("Generated wire contracts differ:\n" + "\n".join(bad))
    print(
        ("Checked" if check else "Generated")
        + f" wire v1 {digest} ({', '.join(targets)})"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--target", choices=list(TARGETS))
    args = parser.parse_args()
    try:
        distribute(check=args.check, selected=args.target)
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
