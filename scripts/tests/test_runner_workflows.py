"""Lock runner routing and hosted-only provisioning without a YAML dependency.

GitHub syntax is independently checked by actionlint; these tests inspect the
small, deliberately explicit job/step blocks that control runner admission.
"""

import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERIC = "ottplay-k3s-linux-x64"
KVM = "ottplay-k3s-kvm-x64"
RELEASE = "ottplay-k3s-release-x64"


def jobs(name):
    source = (ROOT / ".github/workflows" / name).read_text()
    body = source.split("\njobs:\n", 1)[1]
    return {match[0]: match[1] for match in re.findall(r"^  ([\w-]+):\n(.*?)(?=^  [\w-]+:|\Z)", body, re.M | re.S)}


def steps(job):
    return re.findall(r"^      - (.*?)(?=^      - |\Z)", job, re.M | re.S)


def routed(label, hosted):
    return "${{ vars.CI_RUNNER_MODE == 'k3s' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch' || github.event_name == 'schedule') && '" + label + "' || '" + hosted + "' }}"


def named_step(job, name):
    return next(step for step in steps(job) if step.startswith("name: " + name + "\n"))


class WorkflowRoutingTests(unittest.TestCase):
    def test_public_prs_and_nonmain_runs_stay_hosted_even_in_k3s_mode(self):
        for name in ['core.yml']:
            for job, source in jobs(name).items():
                match = re.search(r"(?:runs-on|runner): (\$\{\{ .*? \}\})", source)
                if not match:
                    continue
                expression = match[1][3:-2].strip()
                hosted = "ubuntu-latest" if name == "core.yml" or job == "scope" else "ubuntu-24.04"
                label = RELEASE if name == "release.yml" else KVM if job == "emulator" else GENERIC
                for mode in ("", "github", "k3s", "unexpected"):
                    for ref in ("refs/heads/main", "refs/heads/feature", "refs/pull/1/merge"):
                        for event in ("push", "workflow_dispatch", "schedule", "pull_request", "pull_request_target", "merge_group"):
                            code = expression.replace("vars.CI_RUNNER_MODE", repr(mode)).replace("github.ref", repr(ref)).replace("github.event_name", repr(event))
                            code = code.replace("&&", "and").replace("||", "or")
                            tree = ast.parse(code, mode="eval")
                            allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Eq, ast.Constant)
                            self.assertTrue(all(isinstance(node, allowed) for node in ast.walk(tree)))
                            result = eval(compile(tree, "<runner-expression>", "eval"), {"__builtins__": {}})
                            trusted = mode == "k3s" and ref == "refs/heads/main" and event in ("push", "workflow_dispatch", "schedule")
                            with self.subTest(workflow=name, job=job, mode=mode, ref=ref, event=event):
                                self.assertEqual(result, label if trusted else hosted)

    def test_current_artifact_qualification_and_signed_delivery_are_preserved(self):
        workflow = jobs("core.yml")
        self.assertIn("artifact-id: ${{ steps.distribution.outputs.artifact-id }}", workflow["portable"])
        self.assertIn("artifact-digest: ${{ steps.distribution.outputs.artifact-digest }}", workflow["portable"])
        self.assertIn("- id: distribution", workflow["portable"])
        self.assertIn("needs: [scope, portable]", workflow["browser-client"])
        self.assertIn("artifact-ids: ${{ needs.portable.outputs.artifact-id }}", workflow["browser-client"])
        self.assertIn("distribute.cjs install-web", workflow["browser-client"])
        delivery = workflow["deliver"]
        self.assertIn("needs: [portable, browser-client, wire-contracts]", delivery)
        self.assertIn("vendor-update.yml@733de629b521477102822ccfcc855427de2f2b08", delivery)
        self.assertIn("artifact-digest: ${{ needs.portable.outputs.artifact-digest }}", delivery)
        self.assertNotIn("CI_RUNNER_MODE", delivery)
        self.assertNotIn("ottplay-k3s", delivery)

    def test_scope_and_all_linux_jobs_route_directly_without_hosted_bootstrap(self):
        workflow = jobs("core.yml")
        self.assertEqual(set(workflow), {"scope", "portable", "browser-client", "wire-contracts", "deliver"})
        self.assertIn("runner: " + routed(GENERIC, "ubuntu-latest"), workflow["scope"])
        self.assertRegex(workflow["scope"], r"change-scope.yml@[0-9a-f]{40}\n")
        for name in ("portable", "browser-client", "wire-contracts"):
            job = workflow[name]
            self.assertIn("runs-on: " + routed(GENERIC, "ubuntu-latest"), job)
            self.assertRegex(job, r"needs: (?:scope|\[scope, portable\])")
            self.assertIn("needs.scope.outputs.reason != 'documentation-only'", job)
            sequence = steps(job)
            self.assertTrue(sequence[0].startswith("uses: actions/checkout@"))
            self.assertIn("ci-runner-preflight.py", sequence[1])
            self.assertIn("if: runner.environment == 'self-hosted'", sequence[1])
            self.assertIn("working-directory: ${{ github.workspace }}", sequence[1])

    def test_selfhost_browser_never_installs_system_packages(self):
        browser = jobs("core.yml")["browser-client"]
        self.assertIn("ci-runner-preflight.py browser", browser)
        system_steps = [step for step in steps(browser) if "sudo " in step or "--with-deps" in step]
        self.assertEqual(len(system_steps), 2)
        for step in system_steps:
            self.assertIn("if: runner.environment == 'github-hosted'", step)
        prepared = named_step(browser, "Install Chromium on the prepared self-hosted image")
        self.assertIn("if: runner.environment == 'self-hosted'", prepared)
        self.assertIn("run: npx playwright install chromium\n", prepared)
        self.assertNotIn("--with-deps", prepared)
        fixture = named_step(browser, "Generate synthetic playback fixture")
        self.assertIn("ffmpeg -nostdin", fixture)
        self.assertNotIn("sudo", fixture)
        for suite in ("test:provider-browser", "test:epg-browser", "test:compat-browser"):
            self.assertIn(suite, browser)

    def test_manual_smoke_is_independent_of_mode_and_runs_real_chromium(self):
        source = (ROOT / ".github/workflows/runner-smoke.yml").read_text()
        workflow = jobs("runner-smoke.yml")
        self.assertEqual(set(workflow), {"smoke-linux"})
        self.assertIn("  workflow_dispatch:\n", source)
        self.assertNotRegex(source, r"(?m)^  (push|pull_request|schedule):")
        self.assertNotIn("CI_RUNNER_MODE", source)
        self.assertNotIn("secrets.", source)
        job = workflow["smoke-linux"]
        self.assertIn("runs-on: " + GENERIC + "\n", job)
        self.assertIn("if: github.ref == 'refs/heads/main'", job)
        self.assertIn("persist-credentials: false", job)
        self.assertIn("ci-runner-preflight.py browser", job)
        self.assertIn("chromium.launch", job)
        self.assertIn("run: /opt/ottplay/smoke.sh linux", job)
        self.assertLess(job.index("actions/setup-go@"), job.index("/opt/ottplay/smoke.sh"))
        self.assertNotIn("--with-deps", job)
        self.assertNotIn("sudo", job)


if __name__ == "__main__":
    unittest.main()
