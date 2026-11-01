# Shared-core RC fuzzing

See the [illustrated RC fuzzing process and verified rollout results](https://github.com/victron-venus/venus-os-ci-toolkit/blob/main/docs/rc-fuzzing-results.md)
for the shared release flow, evidence requirements and a dated cross-project
snapshot. The project-specific scope and reproduction guidance below still apply.

The public repository runs Jazzer.js 4.0.0 against the actual ES5 JavaScript
compiled from `shared-core/src/commonMain` and its exported Kotlin/JS adapter.
This is a GitHub-hosted bounded campaign, not registration with Google's hosted
OSS-Fuzz service. The README badge describes this policy; it is not an assertion
that every current candidate passed.

## When it runs and what it costs

`.github/fuzz.json` declares two 60-second targets. The shared pinned
`venus-os-ci-toolkit` workflow admits only an explicit `rc` dispatch from the
public repository's default branch. Mutation does not run on pull requests,
beta pushes, nightlies, or private repositories. Dependency installation and
compilation happen before the offline campaign. Ordinary unit and compatibility
tests continue under the existing CI policy.

The shared runner executes targets without network access, with bounded input
size, time, memory and process limits. Neither target opens a provider URL,
contacts a device, starts a player, or reads credentials. Fuzz tooling has a
separate lockfile and is not in the distributed JAR or JavaScript artifact.

## Targets and oracles

- `playlist` invokes `parseBrowserPlaylist` with raw UTF-8 input and a prefixed
  M3U variant. In-memory identity URL resolution and a deterministic hash stand
  in for host callbacks. It checks expected parse rejections, unique persisted
  channel identifiers/guide URLs, bounded catch-up days, stable source identity,
  and deterministic parsing. Invalid attributes, duplicate IDs, malformed
  quotes and reserved names are in the initial corpus.
- `guide-timeline` passes binary-derived IEEE754 values through
  `guideScheduleSelection`. Its independent interval oracle verifies half-open
  selection, the latest-start overlap rule, stable tie order, bounded future
  results and retry time. NaN, infinities, signed zero, empty schedules and huge
  finite epochs are covered. Inputs are frozen to catch mutation.

The first local campaign found inconsistent ordering of `-0.0` and `+0.0`
programme starts. The common Kotlin comparator now preserves input order for
numeric ties. The original failing seed and a JVM/JS regression test are kept;
the oracle was not weakened to accept the old result.

## Reproduce and add coverage

Use Node24, JDK17 and the committed dependency locks:

```sh
bash scripts/prepare_core_fuzz.sh
node fuzz/node_modules/@jazzer.js/core/dist/cli.js fuzz/playlist.mjs --sync -- /tmp/playlist-corpus -max_total_time=60 -max_len=65536
node fuzz/node_modules/@jazzer.js/core/dist/cli.js fuzz/guide-timeline.mjs --sync -- /tmp/guide-corpus -max_total_time=60 -max_len=4096
```

First create each temporary corpus directory and copy the corresponding
`fuzz/corpus/<target>/` seeds into it. Local commands above do not create a
network namespace; the release runner supplies that isolation. Replay a saved
failure by passing its file instead of the corpus directory and `-runs=1`.
Reduce a failure to a reproducible seed, fix production behavior, add a common
JVM/JS regression where applicable, and rerun the unchanged oracle. Only
reviewed minimal seeds belong in the committed corpus.

## Release evidence and limitations

An RC cannot publish unless every declared target reports successful mutation
with a positive execution count. The shared workflow retains diagnostics and
failure inputs for 30 days, and binds `fuzz-report.json` to the source SHA,
manifest hash, run ID and attempt. The release includes that report and its
validation receipt in the complete checksummed artifact inventory.

Passing these two targets does not establish exhaustive parser coverage,
Android or Apple device acceptance, codec compatibility, or hosted OSS-Fuzz
coverage. Existing common JVM/JS, ES5, synthetic browser playback, and wire
contract checks remain required. See [core releases](CORE-RELEASING.md).

## Deterministic target-contract checks

Ordinary CI now replays the real fuzz target exports using the checked-in
synthetic corpus, fixed malformed inputs and a bounded deterministic byte matrix.
It awaits asynchronous targets and propagates assertion failures. This catches
harness/production API drift without starting Jazzer or a mutation campaign.
The RC preflight repeats this check after its locked setup.

Run locally from the repository root:

```sh
bash scripts/prepare_core_fuzz.sh
node fuzz/replay.mjs
```

Ordinary CI reuses its already compiled and verified `shared-core/dist` output,
so this check adds no second Gradle build.

The replay preserves the same offline boundaries as the targets above; it does
not qualify a release or substitute for the RC's isolated campaign.

The existing portable build also runs `scripts/workflow_contracts.py --actions-only`
with hash-locked PyYAML. This validates action pins and the fuzz policy/runtime
agreement while preserving this repository's custom core qualification graph.

## Public release artifacts and retries

Release artifacts use `-run-<run_id>-attempt-<run_attempt>` names, and the collector selects only the current run and attempt.

Before publication starts, use **Re-run all jobs** only if the allocator and
release policy permit reuse of that run's reservation. Recreate every required
input in the same attempt; failed-only or individual retries can leave inputs
missing, and older artifacts must not fill those gaps.

For a fresh candidate or final build, once publication has started
(`begin_publication`), or its external publication result is partial or uncertain,
inspect the existing release, tags and assets before retrying. A consumed build
number requires a new workflow run and reservation authorized by the release
policy; an existing immutable tag may also require a new base version. Never
reset the release ledger, overwrite assets or retag to force a retry. Historical
byte promotion of an accepted RC keeps its reserved number and follows the
existing promotion policy.

Mutation remains limited to an explicit RC dispatch on the public default
branch. Its report describes one source revision and run; it does not establish
complete platform coverage or device acceptance. See the shared
[evidence contract](rc-fuzzing.md).

Browser validation still downloads the package through its exact artifact ID;
the separate `browser-release` evidence names and workflow pin are unchanged.

### Package receipt identity

Fresh publication verifies each staged package receipt against the independently
supplied repository, source commit, workflow run and attempt. Receipts created
before this migration, or offline without an Actions identity, cannot qualify a
fresh publication. Run all required producers in one complete workflow attempt
after migration; an earlier attempt cannot fill missing inputs.

Historical promotion and retained-evidence validation keep their existing checks.
Receipt coverage validates the staged files; the expected packages and platforms
still require a separate completeness check. Existing release approval and device
acceptance policies continue to apply.

See the shared [receipt migration guide](https://github.com/victron-venus/venus-os-ci-toolkit/blob/main/docs/release-workflow.md#migrate-package-receipt-identity-without-replacing-the-release-engine).

### Complete package producer inventory

`versioning.required_build_receipts` declares the exact package and signature
receipt filenames required by this project's final publisher. Each authenticated
receipt must match the repository, source commit, workflow run and attempt. A
missing producer or an unexpected receipt stops fresh publication, even when the
remaining packages are valid. RC fuzz evidence is checked separately; pre-signing
checks do not require a signature receipt that has not been created yet.

Before publication begins, rerun all required producers only when the allocator
and release policy permit reusing that reservation. After publication begins or
its outcome is uncertain, inspect existing tags, releases and assets before a
policy-authorized new run; never reset the ledger or mix earlier-attempt packages.
Historical RC promotion keeps its accepted source policy. Keep this explicit
inventory aligned with producer changes; it does not replace package-format,
signature or device acceptance checks.
