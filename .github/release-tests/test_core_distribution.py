"""Public compiler payload integrity and qualification/delivery separation."""

import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import yaml

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

    def test_release_qualification_matches_existing_checks_and_has_no_delivery(self):
        original = yaml.safe_load((ROOT / ".github/workflows/core.yml").read_text())
        qualification = yaml.safe_load(
            (ROOT / ".github/workflows/core-release-validation.yml").read_text()
        )
        expected = {
            name: copy.deepcopy(original["jobs"][name])
            for name in ("scope", "portable", "browser-client", "wire-contracts")
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
