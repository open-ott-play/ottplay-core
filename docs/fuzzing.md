# Shared-core RC fuzzing

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
