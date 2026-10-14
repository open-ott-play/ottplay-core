# Compiled shared-core releases

The `v0.1.0-*` line versions the existing `shared-core` compiler distribution.
It does not change FOSS2's independent `foss2-*` releases, deploy a player or
update consumer repositories. The existing protected `core.yml` checks and
opt-in vendor delivery keep their original triggers and job names.

`shared-core/package.json` is the base version; the npm lock and Gradle JAR
version follow it. Before packaging, the shared pipeline applies one frozen
version plan. `release-build.yml` compiles the real JVM17 and ES5 outputs,
checks the distribution's source and artifact hashes, exercises the compiled
JavaScript, and stages only these files plus checksums:

- `ottplay-core.jar`
- `ottplay-core.js`
- `ottplay-core.d.ts`
- `ottplay-core.manifest.json`
- `ottplay-core.LICENSE.txt` (original project/Kotlin notices)

No workspace archive, fuzz dependencies, browser application, credentials,
firmware, or native Apple framework is included. `package_core_release.py`
rejects stale versions, corrupted bytes, symlinked artifacts and unexpected
manifest entries; it refuses to overwrite an existing output directory.

The qualification adapter `core-release-validation.yml` has the same portable,
browser-consumer and wire validation steps as `core.yml`, with forced full
scope. A drift test compares the jobs structurally. It deliberately has no
vendor-delivery job or delivery credentials. The shared release tool retains
checksums, source identity, the frozen plan and version receipts. Promotion
validates and reuses candidate bytes rather than silently rebuilding them.

Merging a code change creates a beta under the shared policy. After reviewing
beta checks and artifacts, dispatch a candidate from a clean default branch:

```sh
python3 scripts/release.py rc --version 0.1.0
```

An RC additionally requires the two offline campaigns documented in
[FUZZING.md](FUZZING.md). Review its exact-source mutation report and publication
receipts before considering a stable release. This onboarding publishes beta
and RC candidates only; real device acceptance is a separate release decision.

For local packaging, run `npm ci --prefix shared-core`, then
`npm --prefix shared-core run pack:core`, `npm --prefix shared-core run check:core`,
`npm --prefix shared-core run check:js`, and `python3 scripts/package_core_release.py`.
Use a fresh output directory; never hand-edit compiler artifacts or their
manifest. Further workflow details are in [release-workflow.md](release-workflow.md).
