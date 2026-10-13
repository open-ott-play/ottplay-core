# OTT-play FOSS 2 — 0.6.0-beta.4

This beta updates the browser playback dependency and qualifies the build-tool security patch together.

## Changes

- Update Shaka Player to 5.2.13 with the exact upstream compiled asset, license and provenance. Upstream fixes include live DASH period transitions, HLS audio transitions and subtitle handling; compatibility still depends on the device and stream.
- Update Playwright to 1.64.0 and Acorn to 8.19.0 for current Chromium regression coverage and parser correctness checks.
- Update the shared-core Gradle wrapper to 9.8.1, including its published distribution checksum. The patch also fixes Debian/Ubuntu toolchain discovery and dependency-resolution regressions.

## Upgrade

Verify `SHA256SUMS`, extract `ottplay-foss2-0.6.0-beta.4.zip`, and follow the included README. Keep the previous beta and local settings for rollback. Browser playback assets remain bundled. Development tools require Node 22.22.2+ within 22.x, 24.15.0+ within 24.x, or 26.0.0 and later.

This release packages the browser client and separate shared-core artifacts. Automated browser and synthetic-media checks do not establish physical-device, firmware, provider or DRM acceptance.

## Security

Gradle 9.8.1 fixes daemon deserialization vulnerabilities and repository handling that could expose builds to malicious artifacts. See the [upstream release notes](https://docs.gradle.org/9.8.1/release-notes.html). Credentials and private playback data are not part of the package; retain the existing opt-in relay controls.
