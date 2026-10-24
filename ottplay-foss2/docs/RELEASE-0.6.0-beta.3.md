# OTT-play FOSS 2 — 0.6.0-beta.3

This beta packages the current shared-core integration and browser client for explicit testing.

## Changes

- Include the reviewed canonical shared-core distribution and its source receipt.
- Update Shaka Player to 5.2.12 together with its unmodified upstream assets, licenses and provenance.
- Qualify the updated browser development dependencies and Gradle 9.8 build; keep dependency groups and delivery revisions coordinated.
- Declare the Node versions supported by the test dependencies and verify the active pinned delivery workflow and input together.

## Upgrade

Verify `SHA256SUMS`, extract `ottplay-foss2-0.6.0-beta.3.zip`, and follow the included README. Keep a copy of the previous beta and local settings before testing. Browser runtime assets are bundled; development tools require Node 22.22.2+ within 22.x, 24.15.0+ within 24.x, or 26.0.0 and later.

This is a browser-client beta, not an Android or iOS application release. Automated Chromium and synthetic media checks do not certify playback on a particular television, firmware or provider.

## Security

Provider credentials and local playlist data are not included in the release. Preserve the existing opt-in relay controls and do not publish private playback URLs or authentication data in diagnostics. Vendor bytes, licenses, source receipts and release checksums remain verified.
