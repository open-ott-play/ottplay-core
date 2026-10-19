# CI runner selection

The current repository setting is `CI_RUNNER_MODE=github`. Public ARC standby
has not been accepted or activated. Prepared workflow selectors and registered
credentials do not demonstrate a working or isolated runner.

Two selector families coexist. The managed shared workflows use configurable
ARC labels; the existing Core compiler jobs retain their fixed legacy labels.
Changing the mode does not make these two pools interchangeable.

## Managed shared ARC standby

The CodeQL and dependency-review jobs, quality-gate helpers, and shared browser
workflow use the reviewed [toolkit runner policy](https://github.com/victron-venus/venus-os-ci-toolkit/blob/6b2d99519d513d2b871d2a845ddd6134dea4af2c/docs/RUNNERS.md).
With hosted execution enabled, `github`, an unset mode or an unrecognized mode
keeps GitHub-hosted execution. Either `self-hosted` or `k3s` opts the managed CI
selector into `CI_RUNNER_LABELS` for these events only:

- A `pull_request` whose head repository is this repository.
- `push`, `schedule` or `workflow_dispatch` on the repository's default branch.

Fork pull requests, `pull_request_target`, merge queues and manual runs on other
branches retain hosted routing. Only the browser matrix's `ubuntu-latest` rows
use this CI selector; explicit Windows, macOS and other platform rows keep their
specified platforms. Existing job conditions still decide whether a job runs.

This event policy differs from the legacy pool below. Before enabling managed
standby, separately qualify the public CI image, disposable worker lifecycle,
network and credential isolation, repository access and controller admission for
these exact workflows and same-repository PRs. Keep release and automation
credentials out of the CI pool. Workflow expressions alone cannot enforce this
boundary against a PR that edits YAML. Do not point `CI_RUNNER_LABELS` at the
legacy trusted-main pool or a private runner. Leave the mode `github` until these
requirements have been demonstrated; no such acceptance is claimed here.

Managed release jobs, including signed vendor delivery, use the separate
`CI_RUNNER_RELEASE_LABELS` selector for default-branch push, dispatch or schedule
events. They do not admit PRs to the release pool. Updating a reusable workflow
pin does not move delivery credentials into the CI pool. Standalone
`ottplay-foss` has its own workflows and configuration.

## Legacy Core pool and event admission

The scope, compiler, browser-client and wire-contract jobs in `core.yml` and its
qualification copy still opt in only with `CI_RUNNER_MODE=k3s`. Their fixed label
is `ottplay-k3s-linux-x64`; `self-hosted` does not activate these legacy selectors.
The scope workflow is pinned to toolkit commit
`6b2d99519d513d2b871d2a845ddd6134dea4af2c`, which accepts the explicit runner input.
Compiler artifact IDs/digests and the browser's exact artifact download remain
intact.

For these legacy jobs, the opt-in applies only to `push`, `workflow_dispatch` or
`schedule` on `refs/heads/main`. All pull requests, including same-repository PRs,
merge queues and manual runs on other branches stay hosted. Step provisioning
uses `runner.environment`, so a hosted PR still installs its OS dependencies.

Before admitting jobs to this legacy pool, runner-group or controller admission
must restrict it to the reviewed workflow files on `refs/heads/main`. If that
restriction cannot be enforced, leave the pool disabled. The legacy manual smoke
is main-only and needs the same infrastructure enforcement; it does not qualify
the managed ARC pool or its PR policy.

## Legacy admission and switching

1. Provision the legacy scale set with authorized-repository and trusted-main
   workflow restrictions. Use disposable runner pods.
2. Review the current `main` commit and record its full 40-character SHA. Dispatch
   **k3s runner admission** (`runner-smoke.yml`) on that current `main`.
   It ignores `CI_RUNNER_MODE`, so it can start a scale set with zero idle pods.
   Its stable job is `smoke-linux`, on `ottplay-k3s-linux-x64`.
3. Require a successful run on the reviewed SHA, no older than 24 hours, with the
   expected runner label. Pass `--expected-sha FULL40 --smoke-run RUN_ID` to the
   infrastructure operator. The reviewed SHA must still match both current `main`
   and the smoke run. If `main` advances, review and smoke the new commit. This
   explicit review does not assume paid branch-protection features. A registered
   or idle runner alone is not proof of readiness.
4. Before selecting `k3s`, also satisfy the managed standby requirements above:
   that mode affects both selector families. Do not use a legacy smoke result as
   evidence for the managed pool. To return both families to hosted execution,
   set `CI_RUNNER_MODE=github`. Queued or running jobs keep their original
   selection; cancel and rerun them deliberately when changing pools.

These workflows neither change the variable nor retry paid/failed jobs on another
pool. Billing-driven switching belongs to the external operator: it must retain
the same admission checks and must not convert a failed test into a runner retry.

## Legacy image contract

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
