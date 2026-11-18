# Core documentation

Reference material for the shared OttPlay business logic, its compiled JVM/ES5
distributions, the service wire contracts and the FOSS2 browser client.

## Shared core behaviour

- [Classic client contracts and migration](CLASSIC_CORE_CONTRACTS.md) — the additive v1 classic profiles and why the bulk implementation stays the oracle.
- [Classic contract performance qualification](CLASSIC_CORE_PERFORMANCE.md) — the paired scenarios measured on 2026-11-12 and the decision to defer migration.
- [FOSS2 catalog and guide projection caches](foss2-catalog-performance.md) — the catalog index, the bounded filter cache and what invalidates each projection.
- [Security design and verification](security-design.md) — trust boundaries between the shared core and the platform adapters, and how they are verified.

## Build, test and release

- [CI runner selection](CI-RUNNERS.md) — the two selector families and why the shared ARC standby is not activated.
- [Shared-core RC fuzzing](fuzzing.md) — the Jazzer.js targets run against the compiled ES5 output.
- [Compiled shared-core releases](CORE-RELEASING.md) — the `v0.1.0-*` line, the base version files and consumer delivery.
- [Qualified GitHub CLI for release operations](release-github-cli.md) — the pinned CLI and Go build installed by generated release jobs.

## Images

- [Documentation images](images/README.md) — the FOSS2 first-run capture used by the hero and its source package.
