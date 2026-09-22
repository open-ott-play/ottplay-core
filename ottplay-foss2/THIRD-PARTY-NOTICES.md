# Resources and provenance

Application JavaScript in `src/` is independently written from documented behavior contracts. The old OTT-play executable bundles, provider scripts, builder and DOM are not the implementation. The adjacent `ottplay-foss` directory is not required to run, build or test this project.

The browser and local Node EPG filter share `vendor/ottplay-core.js`, compiled
from the maintained Kotlin Multiplatform `shared-core` source. XMLTV timestamps,
name normalization, guide selection and current/next rules are no longer
implemented separately in these consumers. The pinned source receipt and
artifact hashes are in `vendor/ottplay-core.manifest.json`; `npm run check:core`
verifies the installed bytes. The bundle includes Kotlin runtime code; its
MIT/Apache-2.0 notices are in `vendor/ottplay-core.LICENSE.txt`. It is loaded
locally after core-js and does not load the inherited player implementation.

## Server and development dependencies

The built-in XMLTV service uses `saxes` 6.0.0 (ISC) and its dependency `xmlchars` 2.2.0 (MIT), pinned in `package-lock.json`. Their licenses are included in their npm packages. They run only in the local Node server and never load in a television browser.

Development dependencies are used by development and verification tools. They are not included in the browser's ES5 runtime contract.

## Fonts

The `fonts/` assets are retained from the source snapshot identified in the technical specification to preserve font names and appearance. SHA-256 values are recorded in `assets/provenance.json`. Metadata for these exact files is retained in `licenses/bundled-font-metadata.txt`, alongside the available Apache-2.0 and SIL Open Font License texts.

`LiberationSans-Regular.ttf` and `Roboto-Regular.ttf` are identical and contain the Roboto family. This is an existing asset naming defect. The new application does not claim to provide a distinct Liberation typeface.

Fontello EOT, WOFF2, WOFF, TTF and SVG files are retained as compatibility resources. The new interface uses text commands and does not depend on their glyphs. The old project does not establish the complete provenance of every glyph; the application's MIT license does not relicense these assets. The retained upstream application license is `licenses/upstream-MIT.txt`. Glyph provenance remains a separate distribution review item.

## core-js 3.50.0

`vendor/core-js.min.js` is the unmodified `minified.js` file from the official `core-js-bundle@3.50.0` npm distribution. It is supplied under the [MIT license](vendor/core-js.LICENSE.txt). The exact package source, archive integrity and bundle SHA-256 are recorded in [its provenance](vendor/core-js.provenance.json). The project supplies this local bundle rather than downloading a polyfill service at startup. [Upstream project](https://github.com/zloirock/core-js/tree/v3.50.0).

It runs after native capability capture and before all application/media scripts. The same bundle runs inside the HLS worker before its payload. It supplies missing JavaScript standard-library features; it does not add a browser decoder, native MediaSource, a real binary buffer implementation, a proprietary device playback bridge or a working network stack. The independent ES5 helpers in `src/compat.js` preserve usable native object-URL functions and provide a clock fallback.

## Hls.js 1.7.3

`vendor/hls.min.js` and its matching `vendor/hls.worker.js` are unmodified files from the official `hls.js@1.7.3` npm distribution. Their [Apache-2.0 license](vendor/hls.LICENSE.txt), exact source, version and hashes are supplied in [the provenance record](vendor/hls.provenance.json). [Upstream source and compatibility requirements](https://github.com/video-dev/hls.js/tree/v1.7.3).

Both payloads are checked with an ES5 grammar. The full bundle also needs newer runtime APIs. The compatibility bootstrap runs before evaluation in each realm, and the application checks real native media capabilities before loading the library. The same-origin worker wrapper is independently written application code; the vendor worker remains unchanged. Missing or failing workers fall back to main-thread transmuxing.

## Shaka Player 5.2.10

`vendor/shaka.min.js` is the unmodified ES5-syntax `dist/shaka-player.compiled.js` from the official `shaka-player` npm package. It is independently obtained third-party code. The [Apache-2.0 license](vendor/shaka.LICENSE.txt), registry integrity and file SHA-256 are supplied in [its provenance](vendor/shaka.provenance.json). [Upstream project](https://github.com/shaka-project/shaka-player).

The common compatibility bootstrap precedes evaluation; Shaka's own platform polyfills are then installed before feature detection and playback. A library reporting basic support does not certify every DRM system, codec or device firmware.

## mpegts.js 1.8.2

`vendor/mpegts.min.js` is the unmodified minified `dist/mpegts.js` from the official `mpegts.js@1.8.2` npm distribution. The archive integrity and file SHA-256 are recorded in [its provenance](vendor/mpegts.provenance.json). The old OTT-play implementation and patches are not used. [Upstream source](https://github.com/xqq/mpegts.js/tree/v1.8.2).

The distribution includes:

- [Apache License 2.0](vendor/mpegts.LICENSE.txt) for mpegts.js.
- [The original extracted bundle notice](vendor/mpegts.js.LICENSE.txt), retaining the filename referenced by the upstream bundle comment.
- [Complete MIT dependency licenses](vendor/mpegts.dependencies.LICENSE.txt) for es6-promise 4.2.8 and events 3.3.0.

This engine repackages supported MPEG-TS/FLV streams into fragmented MP4 for MSE. It does not decode or transcode incompatible video/audio. Loading follows the shared compatibility and native-media checks; the selected network loader must support live streaming for live channels. Its workers remain disabled. CORS, hardware codecs and native network support remain device constraints. See [the engine compatibility contract](docs/ENGINE-COMPATIBILITY.md).
