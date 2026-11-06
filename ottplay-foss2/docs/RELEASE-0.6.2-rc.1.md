# OTT-play FOSS 2 — 0.6.2-rc.1

This candidate adds device-local files and folders plus authenticated Local
helper sources to FOSS2. The first readable file can start while discovery
continues. Later entries retain the active decoder, and natural completion can
wait for the next discovered file. Shuffle, exact-file resume, cancellation,
explicit refresh and bounded filesystem work are included. Local grants,
bookmarks and helper URLs remain separate from IPTV profile import/export.

The shared-core version, compiled core, media engines, fonts and license payloads
are unchanged. The runtime vendor manifest updates only the package-lock digest
for the candidate version. This release does not rebuild or republish shared-core.

## Hosted qualification and packaging

The scoped **FOSS2 release** workflow qualifies an immutable candidate on hosted
Linux. It installs locked dependencies and Chromium, creates synthetic media
with FFmpeg, then runs the existing `npm run verify:release` and
`npm run release:rc` commands. Qualification and packaging have read-only
repository permissions. All thirteen release checks must pass, the source
fingerprints must remain unchanged, and the archive must match those fingerprints.

For a branch candidate, manually run `.github/workflows/foss2-release.yml` with
the full 40-character commit SHA and exact version. Branch dispatches qualify
only. After review and merge, dispatch the workflow from `main` with `publish`
enabled, or push the matching `foss2-v0.6.2-rc.1` tag. Both the candidate and
the workflow revision must be in `main` before publication is eligible. A
deleted tag does not start qualification. This workflow accepts numbered beta
and RC versions; it does not rebuild stable releases.

The publishing job receives only the exact artifact produced by that run and
checks its source/version binding, manifest, archive and checksums before
publishing `foss2-v0.6.2-rc.1`. It must not replace existing releases, tags or
assets. Downloaded release assets must match the staged bytes. A failed attempt
may leave a draft for inspection; it must not overwrite that draft on retry.

The published archive, release manifest, checksums, validation report and
source/run binding are
the delivery evidence. Publishing assets does not install the player on an
existing host. Extract the accepted archive and preserve the host's origin and
browser storage when upgrading an installation.

## Evidence and limitations

Source-level Local and controller tests cover held originals, saturated
iterators, ready-file priority, cancellation, exact-file resume, source-scoped
helper progress, EOF ownership and independent playback admission. The hosted
workflow supplies the complete synthetic browser/package qualification for the
exact release commit; do not treat local source tests as that release receipt.
The required `browser-local-media` journey uses actual Chromium decoding to
check first-file playback before catalog completion, append without reloading,
natural EOF continuation, Stop ownership and the browser File path.
The same journey runs once in the existing ordinary PR and main browser-client
jobs, using a separate 60-second synthetic fixture and their already-installed
Chromium. It does not add another compatibility matrix. The scoped release
workflow also runs its offline publication contracts on relevant pull requests.

Physical televisions, mobile browsers, audible output, real remote filesystems,
live providers and DRM need separate acceptance. The broader required browser
matrix remains part of the repository's ordinary CI. Run any extended matrix
serially after ordinary qualification and retain the tested commit.

## Stable promotion

After RC acceptance, stable `foss2-v0.6.2` must reuse the accepted RC assets
without rebuilding or editing their internal `0.6.2-rc.1` version or filenames.
Stable promotion is a separate operation from candidate packaging. Keep the
previous installation and a private settings backup available for rollback.
