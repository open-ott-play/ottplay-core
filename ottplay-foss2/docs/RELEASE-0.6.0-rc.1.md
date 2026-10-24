# OTT-play FOSS 2 — 0.6.0-rc.1

This candidate retains the runtime and bundled dependencies of beta 5. It adds
an explicit RC packaging channel, keeps the existing deterministic archive and
records the candidate channel in the release manifest. The beta command rejects
an RC version, and stable versions cannot be rebuilt by the packager.

Read the [beta 5 changes and upgrade guidance](RELEASE-0.6.0-beta.5.md), including
parental PIN recovery and HTTPS requirements. The shared-core library keeps its
independent version and release workflow.

## Qualify and package

From a clean checkout of the approved commit, install the supported Node release,
FFmpeg and the locked Playwright Chromium, then run:

```sh
cd ottplay-foss2
npm ci --ignore-scripts
npx playwright install chromium
npm run verify:release
npm run release:rc
```

Require `test-results/release-0.6.0-rc.1/validation.json` to report `passed: true`,
`inputsUnchanged: true` and all twelve checks successful. Match every packaged
source hash against that report. Also require the exact commit's manual Shared
core workflow to pass its complete 35-target browser matrix and all required CI.
That workflow qualifies shared-core output; it does not package the FOSS2 ZIP.
Confirm the packaged shared-core JavaScript bytes match the qualified output.

Publish the ZIP, `release-manifest.json`, `SHA256SUMS` and validation report under
`foss2-v0.6.0-rc.1`. Download the published files and verify their size and SHA256
before accepting the candidate. Physical devices, audible output, live providers
and DRM remain outside the synthetic test claims.

## Promote without rebuilding

After candidate qualification, create stable tag `foss2-v0.6.0` at the same source
commit. Copy the accepted RC assets unchanged, verify their downloaded hashes
again and mark the GitHub release stable. Preserve their RC filenames and
internal `0.6.0-rc.1` version: these identify the exact accepted bytes. Explain
this in the stable release notes. Do not edit the archive or rebuild a nominally
stable package after qualification.

Keep the prior package and a private settings backup for rollback. Publication
does not deploy a player or migrate settings on an installed device.
