# Playback engines and legacy-device compatibility

Implementation and local regression evidence updated on 2026-09-16. This document separates stream transport, browser APIs and hardware codecs. A matching URL extension alone is not playback proof.

## Bootstrap and runtime requirements

The application uses ES5 classic scripts. `index.html` loads `src/compat.js` first to capture native binary/worker capabilities and object-URL functions, then the local `vendor/core-js.min.js`, then `src/compat-ready.js`. Application modules and `src/boot.js` follow. The bootstrap checks the installed helpers before evaluating any optional media library. The interface starts immediately after module registration with no optional media requests. `OTT2VendorLoader` loads an engine on demand, deduplicates in-flight requests and applies a five-second bound. Script completion supports both standard load events and legacy `readyState` events. Failed/timed-out engines are quarantined for the page session, and `OTT2Vendors` stores accepted references independently of late globals. Canceling a session removes its callback without interrupting another subscriber.

The pinned full Hls.js 1.7.3 UMD bundle has ES5 syntax but requires newer globals and helpers. Its upstream documents an ES2016 baseline and ES2017 helpers for the full build, with no bundled core-js. The local 3.50.0 polyfill bundle supplies Promise, Symbol/iterators, strong/weak collections, Object/Array/String/Number/Math helpers, typed-array helpers and URL/URLSearchParams. The compatibility helper verifies the APIs actually used by the vendored engines and retains `webkitURL` blob functions when URL construction is replaced. This changes the old behavior where missing language helpers excluded an otherwise usable MSE backend. [Hls.js 1.7.3 requirements](https://github.com/video-dev/hls.js/blob/v1.7.3/README.md).

Do not equate polyfilled typed arrays with native browser binary storage. The loader records working native ArrayBuffer, DataView and typed arrays **before** polyfills run, and requires that original capability for MSE engines. MediaSource, codecs, DRM CDMs, native decoder surfaces, device bridges, transferable buffers, TLS and server CORS policy cannot be supplied by these JavaScript helpers. Missing optional playback support leaves the catalog, settings and available native playback usable.

The full vendor distributions already include appropriate encoding fallbacks when TextEncoder/TextDecoder are absent. The application does not substitute an incomplete encoding shim. It also does not fake `fetch` or streaming response bodies; HLS uses its available native network loader, while mpegts.js must pass its live-loader capability probe.

## Worker bootstrap

Workers do not inherit the page's globals. HLS therefore uses the same-origin `/src/hls-worker.js` wrapper, which synchronously imports `src/compat.js`, `vendor/core-js.min.js`, `src/compat-ready.js`, and the matching unmodified `vendor/hls.worker.js`, in that order. The worker verifies its own readiness and native binary capability before importing the HLS payload. The main and worker payloads are pinned to the same 1.7.3 distribution and independently hash checked.

The HLS adapter enables the worker only when the native capability checks permit it. A missing worker uses main-thread transmuxing. A reported asynchronous worker error disables worker creation during subsequent playback attempts in the same media instance; HLS falls back to the main thread. Synchronous Worker constructor failures are handled inline by Hls.js and may be attempted again on a later channel. mpegts.js retains both worker flags disabled, so it cannot bypass this compatibility bootstrap through a separate unprepared realm.

`tests/browser-compat.cjs` removes modern APIs independently in the page and the served worker wrapper, then requires decoded HLS video and advancing playback. The healthy path also requires `enableWorker: true`, Worker `init` and `transmuxComplete` messages, with no hidden main-thread fallback. A separate deliberate HTTP 503 Worker failure must produce a nonfatal fallback and decoded main-thread playback. It also checks bootstrap request order, worker-load failure fallback, no-worker playback, and interface startup without MSE or real native binary APIs. These are controlled Chromium regression scenarios, not an emulator for every old JavaScript engine. The latest execution result belongs in `test-results/browser-compat-report.json` and the release verification record.

## Why Chrome needs more than a video element

Native HTML5, Hls.js, Shaka and mpegts.js are distinct playback paths. Hls.js consumes HLS playlists; Shaka consumes supported manifests. A continuous HTTP MPEG-TS channel is neither an HLS playlist nor a DASH manifest. Feeding that TS URL into the native Chromium video element can produce `MEDIA_ERR_SRC_NOT_SUPPORTED` even when the elementary video and audio codecs are supported.

The additional mpegts.js dependency repackages supported TS/FLV streams into fragmented MP4 for MSE. It does not transcode video or audio. Unsupported MPEG-2 video, unavailable HEVC decoding, unsupported audio codecs, authorization failures and CORS remain separate problems. Cross-origin MSE requests require permission from the stream server. [Upstream overview and limits](https://github.com/xqq/mpegts.js/blob/v1.8.2/README.md).

## LG is the primary target

Native playback is the first candidate for LG HLS and supported direct media. LG documents HLS and HTTP(S) support; its native HLS tag support differs by firmware. MSE is absent on webOS 1.x and 2.x. Versions 3.x and 4.x implement older MSE drafts, while 5.0 and later list the 2016 recommendation. Availability of an MSE object is therefore insufficient evidence that a current library works. [LG streaming specifications](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).

Detecting LG must recognize `Web0S`, `WebOS` and the documented SmartTV user-agent markers. The platform's web engine spans old WebKit through Chromium; webOS 1.x/2.x even use different engines for web apps and the built-in browser. A desktop Chromium test does not certify the corresponding TV firmware. [LG web engine specifications](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine).

LG's format lists include TS and multiple video/audio codecs, with model-specific exceptions. They must not be interpreted as universal support for every live transport, codec profile or MSE path. [LG webOS 25 audio/video format](https://webostv.developer.lge.com/develop/specifications/video-audio-250).

Use automatic selection for normal operation. Keep manual engine selection available when a provider or TV firmware needs a particular path. An unavailable engine should be described as unavailable rather than silently changing a saved manual preference. A supported backend can still reject a particular stream.

## Independent mpegts.js dependency

`vendor/mpegts.min.js` is the unchanged, minified `dist/mpegts.js` from official npm `mpegts.js@1.8.2`; its archive integrity and SHA-256 are recorded in `vendor/mpegts.provenance.json`. It passes Acorn with `ecmaVersion: 5`. Source references to TypeScript describe upstream authoring and do not mean TypeScript is executed by this application.

The Apache license, extracted bundle notice and full MIT dependency license texts are included alongside it. The old OttPlay source was inspected only to understand behavior. None of its playback implementation was reused.

The bundle has its own limited polyfills. Loading it nevertheless remains optional: ES5 grammar does not supply MediaSource, typed arrays or streaming network APIs. The shared application gate checks the installed language helpers, native MSE, original binary APIs and object URLs. After evaluation, the upstream loader probes decide whether streaming is usable; absent `fetch` alone does not exclude a browser with a supported native streaming XHR loader. Devices without usable MSE continue through the native path.

After loading, query `mpegts.getFeatureList()` inside a `try/catch`. Require `mseLivePlayback` for live TS/FLV; `msePlayback` alone does not guarantee a streaming loader. Missing or throwing capability probes mean this backend is unavailable. The exact bundled library exposes both probes.

The adapter sequence is `createPlayer`, register events, `attachMediaElement`, `load`, then `play`. Specify source `type` as `mpegts` or `flv`; disable both worker options for the conservative TV integration. `ERROR` supplies `(type, detail, info)`, without Hls.js's `fatal` property. A recovered early EOF is a separate event. Detach listeners and destroy the instance on stop, engine change or channel change. TS seeking is not a guaranteed feature. [Upstream API](https://github.com/xqq/mpegts.js/blob/v1.8.2/docs/api.md).

## Recovery, memory and position

Auto advances through compatible engines when startup is silent or playback stops progressing. The 15-second default watchdog also samples the media clock, so missing progress events do not create a false stall and repeated unchanged events do not hide one. A manual engine selection does not silently switch.

Missing-video recovery requires positive video evidence from declared stream metadata or a supported engine's track data. Native HLS may inspect at most 64 KiB of a master response for four seconds when another backend is available and exposed tracks show audio without video. Only a successful `#EXTM3U` response with explicit video CODECS supplies that evidence. Radio, blocked requests and unknown/media-only playlists remain protected from speculative missing-video fallback. The probe is canceled on session changes and may renew the native source once because some single-session relays replace the native request when inspected.

Fresh decoded-frame counters are preferred for video validation. On firmware without counters, dimensions or a nonempty video TrackList are fallback hints; neither is universal physical decoding proof. Pause and session changes cancel pending watchdog work.

Hls.js gets one media-error recovery/downshift attempt per session. TV profiles default to 30 MB maximum buffered bytes, 15 seconds forward, 10 seconds back and a 30-second maximum forward target. Desktop defaults are 60 MB, 30 seconds forward/back and a 60-second maximum forward target. These bound HLS buffering, not total process memory; `options.lowMemory` can explicitly select the policy. Device and stream testing may justify different budgets.

VOD/archive engine changes retain seconds. Live changes retain distance behind the live edge instead of copying one engine's absolute media clock into another. The pending offset survives a temporarily rejected seek and is applied against the new moving range. Ordinary `pause()`/`play()` preserves session identity; a restarted adapter gets a new generation so track preferences can be applied again.

## Reproducible local vendors

`npm run build:vendors` derives all 11 pinned JavaScript/license assets from the installed exact npm distributions. `npm run check:vendors` verifies the derived bytes and `vendor/runtime-manifest.json`, including the lockfile and builder fingerprints. Hls.js and its Worker remain paired at 1.7.3, Shaka at 5.2.10, mpegts.js at 1.8.2 and core-js at 3.50.0. This maintainer pipeline adds no runtime build step. Dependency changes still require ES5 parsing and page/Worker playback checks.

## Earlier dependency verification

The unchanged bundle was tested in headless Chromium against locally generated, eight-second H.264/AAC media at 320×180, 25 fps:

- Native direct HTTP MPEG-TS: rejected with media error 4.
- mpegts.js, the same TS bytes: video decoded, playback time advanced beyond 0.3 seconds, both audio and video tracks identified.
- Native direct HTTP FLV: rejected with media error 4.
- mpegts.js, the same FLV bytes: decoded and advanced with both tracks identified.
- Both mpegts.js runs: zero engine errors and zero page errors; instances destroyed after use.
- With modern globals removed, upstream evaluation survived but reported `mseLivePlayback: false` and a range-only XHR loader. This confirms why a basic MSE check is insufficient.

These are dependency-level tests using synthetic streams. Application integration tests cover engine choice and lifecycle separately. Actual LG firmware, provider access, decoder support and the user's channel URLs require their own playback evidence.

Recoverable Shaka errors retain the adapter under the bounded no-progress watchdog; critical errors use the normal fallback policy. Pending VOD/archive position and live DVR offset survive an intermediate engine failure without usable metadata. TV host suspension releases resources; foreground restores position and explicit pause intent through the controller-authorized `suspend()`/`resume()` API.
