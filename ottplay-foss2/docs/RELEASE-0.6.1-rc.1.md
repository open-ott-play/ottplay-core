# OTT-play FOSS 2 — 0.6.1-rc.1

This candidate keeps the runtime and dependency bytes qualified in
[0.6.1-beta.2](RELEASE-0.6.1-beta.2.md). It changes only the candidate version,
release documentation and the generated package-lock digest. It also refreshes
the shared-core source receipt from the successful current-source compiler run;
all compiled payloads and license bytes remain identical. The shared-core library
retains its independent version and release workflow.

## Qualify and package

From the approved source, use the supported Node release, FFmpeg and the locked
Playwright Chromium, then run:

```sh
cd ottplay-foss2
npm ci --ignore-scripts
npx playwright install chromium
npm run verify:release
npm run release:rc
```

Require `test-results/release-0.6.1-rc.1/validation.json` to report `passed: true`,
`inputsUnchanged: true` and all twelve checks successful. Match every packaged
source hash against that report. Require all normal CI at the merged source and
its manual Shared core workflow to pass the complete 35-target browser matrix.
Run that manual workflow only after the ordinary main run finishes; retain the
exact source while qualification is in progress. This workflow qualifies the
shared-core output and does not package the FOSS2 ZIP. Confirm that the packaged
shared-core JavaScript matches that qualified output.

Publish the ZIP, `release-manifest.json`, `SHA256SUMS` and validation report under
`foss2-v0.6.1-rc.1`. Download the published files and verify their size and SHA256
before accepting the candidate. Physical devices, audible output, live providers
and DRM remain outside the synthetic test claims.

## Promote without rebuilding

After RC qualification, create stable tag `foss2-v0.6.1` at the same source commit.
Copy the accepted RC assets unchanged, verify their downloaded hashes again and
mark the GitHub release stable. Preserve their RC filenames and internal
`0.6.1-rc.1` version: these identify the accepted bytes. Explain this in the stable
release notes. Do not edit the archive or rebuild a nominally stable package.

Keep the prior package and a private settings backup for rollback. Publication
does not deploy a player or migrate settings on an installed device.
