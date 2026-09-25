# CI runner selection

The repository variable `CI_RUNNER_MODE` selects runners before any job starts.
Only `k3s` opts in; `github`, an empty value or any other value keeps the existing
GitHub-hosted runners. Public `ottplay-foss` is outside this configuration.

In `k3s` mode, **all** jobs in `core.yml`, including the reusable `scope` job,
route directly to `ottplay-k3s-linux-x64`. No hosted job is needed to choose a
runner. The reusable workflow is pinned to a revision with a `runner` input.
The existing scope, test suites, artifact rules and timeouts still apply.

## Admission and switching

1. Provision the ARC scale set and restrict it to authorized repositories.
   Use disposable runner pods and preserve the existing PR admission rules.
2. Review the current `main` commit and record its full 40-character SHA. Dispatch
   **k3s runner admission** (`runner-smoke.yml`) on that current `main`.
   It ignores `CI_RUNNER_MODE`, so it can start a scale set with zero idle pods.
   Its stable job is `smoke-linux`, on `ottplay-k3s-linux-x64`.
3. Require a successful run on the reviewed SHA, no older than 24 hours, with the
   expected runner label. Pass `--expected-sha FULL40 --smoke-run RUN_ID` to the
   infrastructure operator before setting this repository's `CI_RUNNER_MODE=k3s`.
   The reviewed SHA must still match both current `main` and the smoke run. If
   `main` advances, review and smoke the new commit. This explicit review does not
   assume paid branch-protection features. A registered or idle runner alone is
   not proof of readiness.
4. To return to hosted runners, explicitly set the repository variable to
   `github`. A queued or running job keeps its original selection; cancel and
   rerun it deliberately when changing pools.

These workflows neither change the variable nor retry paid/failed jobs on another
pool. Billing-driven switching belongs to the external operator: it must retain
the same admission checks and must not convert a failed test into a runner retry.

## Image contract

Use Ubuntu 24.04 x86_64 with `bash`, Python 3 plus pip, `git`, `curl`, `jq`, `gh`,
`unzip`, `tar`, `gzip`, `ffmpeg`, and Playwright Chromium OS dependencies installed
when building the image. `RUNNER_TEMP` and `RUNNER_TOOL_CACHE` must exist and be
writable by the runner user. Setup actions install the pinned Node, Java and Go
toolchains into that cache. Network access to their download sources, package
registries and GitHub is still needed.

`scripts/ci-runner-preflight.py` checks the OS, architecture, commands, actual
write access, pip and browser shared libraries before toolchain/download steps.
Self-hosted browser jobs run `npx playwright install chromium`; they never use
`--with-deps`, `apt` or `sudo`. Hosted jobs keep their existing package setup.
The smoke additionally installs the pinned toolchains/dependencies and launches
Chromium to render a page; it does not replace the normal application tests.

Each manual smoke must also pass the image-owned `/opt/ottplay/smoke.sh`
for its pool. This checks UID 1001, absence of host Docker/containerd sockets and
a Kubernetes API token, writable paths, Python venv support, and HTTPS access. A
missing script fails admission; the KVM variant additionally checks acceleration.

Local contracts: `python3 -m unittest discover -s scripts/tests -v` and
`actionlint .github/workflows/*.yml`. Local mocks cannot certify a provisioned
runner; the manual smoke is the required live acceptance check.
