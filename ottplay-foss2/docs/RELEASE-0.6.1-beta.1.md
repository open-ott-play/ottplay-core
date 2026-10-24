# OTT-play FOSS 2 — 0.6.1-beta.1

This beta improves catalog and programme-guide navigation in the independent
FOSS2 browser client. It retains the shared-core 0.1.3 package and the existing
settings and provider formats.

## Changes

- Reuse indexed catalog selections when moving between pages instead of
  filtering the complete catalog again. Channel lookup uses an ID index.
- Keep guide projections until programme boundaries and refresh only affected
  channel lookups. Catalog edits, favorite changes and guide replacement
  invalidate the relevant projections.
- Reuse the sorted guide while its source and filters are unchanged. Release
  that projection when leaving the guide, changing the source or closing the
  player.
- Add 10,000-channel regression coverage and a reproducible synthetic benchmark.
  These measurements describe projection work, not device startup or streaming
  throughput. See [catalog performance](https://github.com/open-ott-play/ottplay-core/blob/main/docs/foss2-catalog-performance.md)
  in the source repository for scope and limitations.

## Upgrade and rollback

Verify `SHA256SUMS`, extract `ottplay-foss2-0.6.1-beta.1.zip`, and follow the
included [README](../README.md). Preserve the serving origin and browser profile
to keep settings and the remembered channel. Keep the previous package and a
private settings backup. No settings migration is introduced by this beta.

The existing [parental-control requirements](PARENTAL-CONTROLS.md) still apply:
PIN operations require Web Crypto in HTTPS or a trusted loopback context. Older
clients cannot read upgraded parental metadata. Synthetic tests do not establish
physical-device, audible-output, live-provider or DRM acceptance.

## Qualification and packaging

From a clean checkout of the approved source, with supported Node, FFmpeg and
the locked Playwright Chromium installed:

```sh
cd ottplay-foss2
npm ci --ignore-scripts
npx playwright install chromium
npm run verify:release
npm run release:beta
```

Require `test-results/release-0.6.1-beta.1/validation.json` to report
`passed: true`, `inputsUnchanged: true` and all twelve checks successful.
Packaging verifies every source fingerprint before creating the ZIP,
`release-manifest.json` and `SHA256SUMS` under `releases/0.6.1-beta.1/`.
Publish those files and the validation report under `foss2-v0.6.1-beta.1`, then
verify downloaded bytes against the local checksums. Any source change after
verification requires a fresh verification run.

This release does not update classic FOSS, Tauri or Capacitor installations.
The shared-core release pipeline and vendor-delivery workflow do not publish
this independent browser archive.
