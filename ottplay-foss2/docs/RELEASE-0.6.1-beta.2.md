# OTT-play FOSS 2 — 0.6.1-beta.2

This beta refreshes the browser libraries in the independent FOSS2 client.
The application settings and provider formats remain unchanged.

## Changes since beta 1

- Update HLS.js from 1.7.3 to 1.7.4, including the matching bundled worker.
- Update Shaka Player from 5.2.13 to 5.3.3 and core-js from 3.50.0 to 3.51.0.
  Keep the upstream library bytes, license notices and locked-package provenance.
- Refresh the shared-core source manifest to the already qualified 0.1.5 release.
  The bundled shared-core JavaScript bytes are unchanged from beta 1.
- Update the locked test dependencies to jsdom 30.1.3 and Playwright 1.64.1.

## Upgrade and rollback

Verify `SHA256SUMS`, extract `ottplay-foss2-0.6.1-beta.2.zip`, and follow the
included [README](../README.md). Preserve the serving origin and browser profile
to retain settings and the remembered channel. Keep the previous package and a
private settings backup. This beta introduces no settings migration.

The existing [parental-control requirements](PARENTAL-CONTROLS.md) still apply:
PIN operations require Web Crypto in HTTPS or a trusted loopback context. Older
clients cannot read upgraded parental metadata. Synthetic tests do not establish
physical-device, audible-output, live-provider or DRM acceptance.

## Qualification and packaging

From the approved source, with supported Node, FFmpeg and the locked Playwright
Chromium installed:

```sh
cd ottplay-foss2
npm ci --ignore-scripts
npx playwright install chromium
npm run verify:release
npm run release:beta
```

Require `test-results/release-0.6.1-beta.2/validation.json` to report
`passed: true`, `inputsUnchanged: true` and all twelve checks successful.
Packaging verifies every source fingerprint before creating the ZIP,
`release-manifest.json` and `SHA256SUMS` under `releases/0.6.1-beta.2/`.
Publish those files and the validation report under `foss2-v0.6.1-beta.2`, then
verify downloaded sizes and hashes. Any changed packaged input requires fresh
verification before publication.

The next RC must also pass the exact-source, complete 35-target Shared core
browser matrix and match its qualified shared-core JavaScript bytes. Stable
promotion retains the accepted RC assets, filenames and internal RC version
without rebuilding; see the established [promotion procedure](RELEASE-0.6.0-rc.1.md).

This release does not update classic FOSS, Tauri or Capacitor installations.
The shared-core release pipeline and vendor-delivery workflow do not publish
this independent browser archive.
