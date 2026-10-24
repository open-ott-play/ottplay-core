# OTT-play FOSS 2 — 0.6.0-beta.5

This beta fixes request cleanup and includes the security changes merged since
beta 4. It packages the independent FOSS2 browser client, its Node server and
bundled browser dependencies. The shared-core library keeps its separate version.

## Changes

- Clear the request watchdog when an XMLHttpRequest fails synchronously during
  startup. A failed or cancelled request no longer leaves a 20-second timer
  behind, or a 125-second timer for the built-in guide. Error delivery remains
  asynchronous and cancellation still suppresses it.
- Use native Web Crypto PBKDF2 for parental PINs and preserve a locked state
  during legacy migration. Read the [parental-control migration and recovery
  guide](PARENTAL-CONTROLS.md) before upgrading an installation with a PIN.
- Enforce certificate key-size floors for HTTPS upstream connections in the
  local relay and guide server.
- Remove unused Fontello assets whose glyph provenance was unresolved.
- Include the reviewed shared-core 0.1.3 distribution and expanded browser
  compatibility checks.

## Upgrade

Verify `SHA256SUMS`, extract `ottplay-foss2-0.6.0-beta.5.zip`, and follow the
included [README](../README.md). Keep the same origin and browser profile to
retain settings, sources and the remembered channel. Back up private settings
before upgrading; do not publish the backup. Keep the previous package for
rollback, but note that an upgraded parental PIN remains locked in older versions.

PIN operations require Web Crypto in HTTPS or a trusted loopback context.
Plain HTTP at a LAN address and older TV browsers may not support it; protected
operations remain locked while unprotected playback remains available.
Development and server tools require Node 22.22.2+ within 22.x, 24.15.0+ within
24.x, or 26.0.0 and later.

## Qualification

The release verification command runs the unit, ES5, resource, vendor and
shared-core checks followed by eleven local browser suites against synthetic
media. Its report binds results to the exact packaged source hashes. These
checks do not establish physical-device, audible-output, provider or DRM
acceptance, and do not substitute for the separate cross-platform CI matrix.

## Building the release

From a clean checkout of the approved commit, with Node, FFmpeg and the matching
Playwright Chromium installed:

```sh
cd ottplay-foss2
npm ci --ignore-scripts
npx playwright install chromium
npm run verify:release
npm run release:beta
```

Publish only after `test-results/release-0.6.0-beta.5/validation.json` reports
`passed: true`, `inputsUnchanged: true`, and all twelve checks successful. The
package step writes the ZIP, per-file `release-manifest.json` and `SHA256SUMS`
under `releases/0.6.0-beta.5/`. Confirm the archive manifest's source-file hashes
match the verification report before publishing those three files under
`foss2-v0.6.0-beta.5`. The shared-core `v0.1.x` release workflow does not publish
this browser archive.
