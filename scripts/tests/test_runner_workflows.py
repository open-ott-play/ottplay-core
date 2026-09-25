"""Lock runner routing and hosted-only provisioning without a YAML dependency.

GitHub syntax is independently checked by actionlint; these tests inspect the
small, deliberately explicit job/step blocks that control runner admission.
"""

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
    return "${{ vars.CI_RUNNER_MODE == 'k3s' && '" + label + "' || '" + hosted + "' }}"


def named_step(job, name):
    return next(step for step in steps(job) if step.startswith("name: " + name + "\n"))


class WorkflowRoutingTests(unittest.TestCase):
    def test_scope_and_all_linux_jobs_route_directly_without_hosted_bootstrap(self):
        workflow = jobs("core.yml")
        self.assertEqual(set(workflow), {"scope", "portable", "browser-client", "wire-contracts"})
        self.assertIn("runner: " + routed(GENERIC, "ubuntu-latest"), workflow["scope"])
        self.assertRegex(workflow["scope"], r"change-scope.yml@[0-9a-f]{40}\n")
        for name in ("portable", "browser-client", "wire-contracts"):
            job = workflow[name]
            self.assertIn("runs-on: " + routed(GENERIC, "ubuntu-latest"), job)
            self.assertIn("needs: scope", job)
            self.assertIn("needs.scope.outputs.reason != 'documentation-only'", job)
            sequence = steps(job)
            self.assertTrue(sequence[0].startswith("uses: actions/checkout@"))
            self.assertIn("ci-runner-preflight.py", sequence[1])
            self.assertIn("if: vars.CI_RUNNER_MODE == 'k3s'", sequence[1])
            self.assertIn("working-directory: ${{ github.workspace }}", sequence[1])

    def test_selfhost_browser_never_installs_system_packages(self):
        browser = jobs("core.yml")["browser-client"]
        self.assertIn("ci-runner-preflight.py browser", browser)
        system_steps = [step for step in steps(browser) if "sudo " in step or "--with-deps" in step]
        self.assertEqual(len(system_steps), 2)
        for step in system_steps:
            self.assertIn("if: vars.CI_RUNNER_MODE != 'k3s'", step)
        prepared = named_step(browser, "Install Chromium on the prepared self-hosted image")
        self.assertIn("if: vars.CI_RUNNER_MODE == 'k3s'", prepared)
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
