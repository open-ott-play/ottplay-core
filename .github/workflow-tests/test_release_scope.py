"""Prevent an older generator from skipping main-branch release qualification."""

import json
import os
import subprocess
import sys
import unittest
from copy import deepcopy
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def require_full_release(workflow: dict):
    steps = workflow["jobs"]["scope"]["steps"]
    classifiers = [step for step in steps if step.get("id") == "scope"]
    if len(classifiers) != 1:
        message = "Expected one release change classifier"
        raise ValueError(message)
    classifier = classifiers[0]
    value = classifier.get("env", {}).get("FORCE_FULL")
    if value is not True and value != "true":
        message = "Main-branch release qualification must always run in full"
        raise ValueError(message)
    command = classifier.get("run", "")
    if (
        "args+=(--force)" not in command
        or 'scripts/change_scope.py "${args[@]}"' not in command
    ):
        message = "Release classifier must forward the force-full argument"
        raise ValueError(message)


def require_full_quality(workflow: dict):
    checks = workflow["jobs"]["checks"]
    if (
        checks.get("uses") != "./.github/workflows/quality-gate.yml"
        or checks.get("with", {}).get("force-full") is not True
    ):
        message = "Release quality gate must explicitly force full validation"
        raise ValueError(message)


class ReleaseScopeTests(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load(
            (ROOT / ".github/workflows/release-pipeline.yml").read_text()
        )

    def test_release_qualification_never_skips_documentation(self):
        require_full_release(self.workflow)

    def test_release_quality_gate_stays_full(self):
        require_full_quality(self.workflow)

    def test_release_quality_gate_rejects_missing_or_weak_force(self):
        workflow = deepcopy(self.workflow)
        for value in (False, None, 1, "true", "false", ""):
            with self.subTest(force_full=value):
                workflow["jobs"]["checks"]["with"]["force-full"] = value
                try:
                    require_full_quality(workflow)
                except ValueError as error:
                    if "explicitly force full validation" not in str(error):
                        raise
                else:
                    self.fail("Invalid quality force-full value was accepted")

    def test_old_generator_documentation_skip_is_rejected(self):
        workflow = deepcopy(self.workflow)
        (classifier,) = [
            step
            for step in workflow["jobs"]["scope"]["steps"]
            if step.get("id") == "scope"
        ]
        for value in ("false", False, None, 1, "TRUE", ""):
            with self.subTest(force_full=value):
                classifier["env"]["FORCE_FULL"] = value
                try:
                    require_full_release(workflow)
                except ValueError as error:
                    if "always run in full" not in str(error):
                        raise
                else:
                    self.fail("Invalid force-full value was accepted")


class CoreRequiredContextTests(unittest.TestCase):
    def setUp(self):
        self.quality = yaml.safe_load(
            (ROOT / ".github/workflows/quality-gate.yml").read_text()
        )
        self.wrapper = yaml.safe_load(
            (ROOT / ".github/workflows/core-release-validation.yml").read_text()
        )

    def test_required_leaf_contexts_are_always_created(self):
        call = self.quality["jobs"]["check-0"]
        self.assertNotIn("if", call)
        self.assertEqual(
            call["with"]["force-full"],
            "${{ inputs.force-full || needs.scope.outputs.run != 'false' }}",
        )
        events = self.wrapper.get("on", self.wrapper.get(True))
        self.assertIs(events["workflow_call"]["inputs"]["force-full"]["default"], True)
        self.assertEqual(
            self.wrapper["jobs"]["scope"]["with"]["force-full"],
            "${{ inputs.force-full }}",
        )
        self.assertEqual(
            self.wrapper["jobs"]["scope"]["with"]["required-paths"], '["CHANGELOG.md"]'
        )
        for name in (
            "portable",
            "browser-client",
            "browser-compatibility",
            "wire-contracts",
        ):
            self.assertEqual(
                self.wrapper["jobs"][name]["if"],
                "${{ needs.scope.outputs.run != 'false' || needs.scope.outputs.reason != 'documentation-only' }}",
            )

    def test_outer_and_inner_documentation_paths_agree(self):
        policy = json.loads((ROOT / ".release-policy.json").read_text())["change_scope"]
        outer = next(
            step
            for step in self.quality["jobs"]["scope"]["steps"]
            if step.get("id") == "scope"
        )
        inner = self.wrapper["jobs"]["scope"]["with"]
        self.assertEqual(
            json.loads(outer["env"]["DOCUMENTATION_PATHS"]),
            policy["documentation_paths"],
        )
        self.assertEqual(
            json.loads(inner["documentation-paths"]), policy["documentation_paths"]
        )
        self.assertTrue(
            {"GOVERNANCE.md", "ROADMAP.md"}.issubset(policy["documentation_paths"])
        )

    def test_browser_candidate_mandatory_inputs_exist(self):
        # Use the real side-effect-free archive inventory; never recreate its list here.
        subprocess.run(
            ["node", "-e", "require('./ottplay-foss2/scripts/release.cjs').files()"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_gate_requires_wrapper_success_for_documentation(self):
        gate = self.quality["jobs"]["gate"]
        source = next(
            step["run"] for step in gate["steps"] if "RESULTS" in step.get("env", {})
        )
        script = source.split("python3 - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
        for result in ("success", "failure", "cancelled", "skipped", None):
            with self.subTest(wrapper_result=result):
                results = {
                    "scope": {
                        "result": "success",
                        "outputs": {"run": "false", "reason": "documentation-only"},
                    },
                    "release-contracts": {"result": "skipped"},
                }
                if result is not None:
                    results["check-0"] = {"result": result}
                executed = subprocess.run(
                    [sys.executable, "-c", script],
                    env={**os.environ, "RESULTS": json.dumps(results)},
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(
                    executed.returncode == 0, result == "success", executed.stderr
                )


if __name__ == "__main__":
    unittest.main()
