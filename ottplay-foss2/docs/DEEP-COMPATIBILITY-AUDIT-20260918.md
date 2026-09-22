# OTT-play FOSS 2 — deep compatibility audit

> Historical findings from 0.5.0. All 13 tracked items have fixes and regression coverage in 0.6.0-beta.1; see [release notes](RELEASE-0.6.0-beta.1.md). Reproduction scripts linked below intentionally assert pre-fix behavior and are retained as historical evidence. Physical-device and live-provider acceptance remains separate.

Date: 2026-09-18. Audited version: 0.5.0. Scope: independent player compared with legacy behavior, with LG/TV usage prioritized. This audit does not modify the application runtime, original player, user storage or playback.

## Result

Nine concrete defects, three lifecycle/parity gaps and one optimization were identified. Four defects are P1 because they affect parental protection, channel/programme identity, primary remote navigation or playback recovery. The automated tests at audit time did not cover these combinations.

At audit time, the 0.5.0 suite passed 297 tests, ES5 parsing of 27 runtime scripts, 26 resource hashes and reproduction of 11 vendor/license assets. All files covered by the previous verification fingerprints matched before this audit. New isolated probes reproduce the findings against those same files; they assert the defective behavior and are evidence, not corrected acceptance tests.

## Findings

### F01 · P1 · Catalog changes detach favorites, overrides and parental protection

**Classification:** Confirmed defect. **Area:** Identity and PIN.

**Trigger:** Save News HD as a favorite, rename it and protect it with a PIN. Add News SD with the same tvg-id; the HD URL stays unchanged.

**Observed:** The HD ID changes from source:m3u:tvg:news to a URL-hashed variant. Favorite and rename disappear; catalog playback starts resolution without a PIN dialog.

**Cause:** IDs depend on the number of TVG variants and sometimes the stream URL. Only the individually restored last/previous channel gets protection migration.

**Remedy:** Introduce durable source-bound channel references for every identity-dependent store and reconcile the catalog before playback authorization. Ambiguous protected matches must require review/PIN.

**Acceptance:** Unique-to-variants, variants-to-unique, signed URL rotation, reordered mirrors, ambiguous identity and source isolation; verify favorites, hidden/name overrides and PIN together.

**Source:** [src/providers.js:213](/Users/vmedvedev/victron/ottplay-foss2/src/providers.js:213), [src/app.js:496](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:496), [src/app.js:517](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:517).

**Reproduction:** [data.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/data.cjs).

### F02 · P1 · Independent XMLTV feeds with reused IDs mix programmes and logos

**Classification:** Confirmed defect. **Area:** EPG.

**Trigger:** Feed A uses id=1 for NewsA; feed B uses id=1 for NewsB, with a later-starting programme.

**Observed:** NewsA displays B sports; NewsB receives NewsA's logo.

**Cause:** Per-channel feed URLs lose their affinity during playlist parsing. Merge uses the bare XMLTV ID as a global key.

**Remedy:** Retain channel-to-feed affinity and qualify EPG identity by feed. Define fallback at the matched channel level; changing feed order alone cannot repair collisions.

**Acceptance:** Reused numeric IDs, per-channel tvg-source, explicit priority, overlapping schedules, logos and fallback feeds.

**Source:** [src/providers.js:196](/Users/vmedvedev/victron/ottplay-foss2/src/providers.js:196), [src/epg.js:327](/Users/vmedvedev/victron/ottplay-foss2/src/epg.js:327) · Legacy: [prov/m3u/prov.js:689](/Users/vmedvedev/victron/ottplay-foss/prov/m3u/prov.js:689).

**Reproduction:** [data.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/data.cjs).

### F03 · P1 · Android browser events are interpreted as native Android KeyEvent codes

**Classification:** Confirmed defect. **Area:** Remote input.

**Trigger:** Use an Android browser UA and ordinary numeric DOM keydown events.

**Observed:** Up 38 is ignored; Enter 13 becomes digit6; Backspace 8 becomes digit1. Native codes 19/66 still mean Up/OK.

**Cause:** UA detection selects the native Android integer table without establishing that a native input bridge supplies those integers.

**Remedy:** Separate device/media identity from input transport. Use a DOM numeric profile in ordinary browsers and native integers only for an explicit native transport. Do not add colliding global aliases.

**Acceptance:** DOM arrows/Enter/Backspace/digits under Android UA plus explicit native 19/20/21/22/66/4. Wrong transport must never tune a channel.

**Source:** [src/devices.js:7](/Users/vmedvedev/victron/ottplay-foss2/src/devices.js:7), [src/devices.js:158](/Users/vmedvedev/victron/ottplay-foss2/src/devices.js:158) · Legacy: [android/app/src/main/java/play/ott/foss/MainActivity.java:23](/Users/vmedvedev/victron/ottplay-foss/android/app/src/main/java/play/ott/foss/MainActivity.java:23).

**Reproduction:** [lifecycle.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/lifecycle.cjs).

### F04 · P1 · Shaka recoverable errors destroy the active player

**Classification:** Confirmed defect. **Area:** Playback.

**Trigger:** A playing live Shaka session emits an error with severity=RECOVERABLE (1).

**Observed:** The adapter is destroyed and state becomes error, interrupting Shaka's own live network recovery.

**Cause:** Runtime error events are sent to the same terminal handler as attach/load failures, ignoring severity.

**Remedy:** Classify runtime severity separately. Preserve the adapter for recoverable errors while the existing progress watchdog bounds recovery; critical errors retain fallback.

**Acceptance:** Transient failure then recovery, persistent no-progress timeout, critical failure and explicit manual engine retention.

**Source:** [src/media.js:746](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:746), [src/media.js:769](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:769), [node_modules/shaka-player/lib/player.js:7786](/Users/vmedvedev/victron/ottplay-foss2/node_modules/shaka-player/lib/player.js:7786).

**Reproduction:** [media.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/media.cjs).

### F05 · P2 · Long-running sessions never refetch an expired programme guide

**Classification:** Confirmed defect. **Area:** EPG.

**Trigger:** Advance the application clock for 48 hours after one successful guide load.

**Observed:** 5,760 timer ticks produce only one network request; current programme becomes null after the loaded schedule expires.

**Cause:** The 30-second timer updates the view from the existing guide but never refreshes its data.

**Remedy:** Add bounded expiry/periodic refresh with retry backoff, foreground reconciliation, cancellation and retention of the last good guide.

**Acceptance:** 24–48 hour virtual-clock sessions, failed refresh/recovery, clock correction, source changes and stale callbacks.

**Source:** [src/app.js:866](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:866) · Legacy: [src/channels/index.ts:1574](/Users/vmedvedev/victron/ottplay-foss/src/channels/index.ts:1574).

**Reproduction:** [data.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/data.cjs).

### F06 · P2 · Play after a terminal VOD error restarts at zero

**Classification:** Confirmed defect. **Area:** Playback.

**Trigger:** A VOD session fails while playing at 51 seconds; the user presses Play.

**Observed:** Playback restarts at 0 seconds. The app directly invokes media.play(), so ordinary saved bookmarks do not restore this path.

**Cause:** Terminal cleanup resets the media element before capturing the resume position.

**Remedy:** Capture a valid position before error cleanup and retain it for explicit Play or engine changes. Intentional Stop, completed playback and a new channel need separate rules.

**Acceptance:** Native/HLS/Shaka failure during VOD/archive, retry and engine switch, paused intent, completion and intentional Stop.

**Source:** [src/media.js:186](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:186), [src/media.js:1065](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:1065), [src/app.js:745](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:745).

**Reproduction:** [media.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/media.cjs).

### F07 · P2 · An intermediate engine failure overwrites the pending live DVR offset

**Classification:** Confirmed defect. **Area:** Playback.

**Trigger:** Native playback is 12 seconds behind live; native fails, Hls construction fails, then Shaka starts with range 0–90.

**Observed:** Expected position is 78 seconds; actual position is 90, at the live edge.

**Cause:** Each fallback captures position again, even when the intermediate engine never acquired a valid timeline.

**Remedy:** Retain the original pending live offset until a replacement exposes a trustworthy range and completes restoration.

**Acceptance:** Three-engine fallback with constructor/vendor/pre-metadata failures, paused DVR and a moving final range.

**Source:** [src/media.js:892](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:892), [src/media.js:925](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:925).

**Reproduction:** [media.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/media.cjs).

### F08 · P2 · The registered Guide key has no application action

**Classification:** Confirmed defect. **Area:** Remote input.

**Trigger:** Press Tizen Guide code 458 from the channel list or playback.

**Observed:** The command is unconsumed; the guide does not open even though the guide screen exists.

**Cause:** The profile registers and normalizes guide, but neither the view nor playback controller dispatches it.

**Remedy:** Route guide to the existing screen with predictable channel/programme focus and unchanged playback; retain modal/editor ownership.

**Acceptance:** Numeric 458 from list, playback and dialogs; return focus and continuous media.

**Source:** [src/devices.js:40](/Users/vmedvedev/victron/ottplay-foss2/src/devices.js:40), [src/view.js:548](/Users/vmedvedev/victron/ottplay-foss2/src/view.js:548), [src/app.js:732](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:732).

**Reproduction:** [lifecycle.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/lifecycle.cjs).

### F09 · P2 · Documented profile index.html routes return HTTP 404

**Classification:** Confirmed defect. **Area:** Legacy entry routes.

**Trigger:** Open /f/lg/webos/index.html or /f/samsung/tizen/index.html on the supplied server.

**Observed:** Both return 404; the corresponding extensionless route returns 200.

**Cause:** The detector accepts document-style profile routes, but the server rewrite regex excludes the dot in index.html.

**Remedy:** Share an explicit allowlisted profile-route contract between detection and HTTP dispatch, including documented document suffixes.

**Acceptance:** HTTP checks for the advertised routes, query overrides and invalid/traversal paths; detector-only tests are insufficient.

**Source:** [scripts/serve.cjs:16](/Users/vmedvedev/victron/ottplay-foss2/scripts/serve.cjs:16), [docs/DEVICE-CONTRACTS.md:49](/Users/vmedvedev/victron/ottplay-foss2/docs/DEVICE-CONTRACTS.md:49).

**Reproduction:** [runtime.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/runtime.cjs).

### G01 · P2 · Host suspension pause is indistinguishable from a deliberate user pause

**Classification:** Lifecycle gap. **Area:** TV lifecycle.

**Trigger:** Playing → hidden → native pause → visible; the host may also emit playing on return.

**Observed:** The controller remains paused; a subsequent host playing event is immediately paused again. This event sequence is reproduced, not confirmed on a particular LG firmware.

**Cause:** Visibility handling only flushes bookmarks, while every native pause during playback becomes sticky user intent.

**Remedy:** Track user intent independently from host state. Add a TV lifecycle policy for suspend/relaunch that preserves genuine user pause, source/session cancellation, PIN and autoplay rules.

**Acceptance:** Foreground/background/standby sequences, user-paused before hiding, host auto-resume, stop/source changes while hidden, VOD/DVR position and expired authorization.

**Source:** [src/app.js:345](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:345), [src/media.js:633](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:633), [src/media.js:641](/Users/vmedvedev/victron/ottplay-foss2/src/media.js:641) · [LG lifecycle contract](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management).

**Reproduction:** [lifecycle.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/lifecycle.cjs).

### G02 · P2 · Flussonic and tvg-rec archive contracts are absent

**Classification:** Parity gap. **Area:** Archive.

**Trigger:** Parse catchup=flussonic with seven days, or a default archive template with tvg-rec=7.

**Observed:** Flussonic returns no archive URL. tvg-rec is ignored and parsed archive depth is zero. Both work through explicit contracts in the old player.

**Cause:** The independent parser and archive URL generator implement a smaller contract set.

**Remedy:** Implement bounded Flussonic URL generation and tvg-rec precedence/units independently; preserve access query parameters and reject unknown formats.

**Acceptance:** index/video/mono m3u8, MPEG-TS and DASH forms, signed queries, explicit zero, bounds and malformed input.

**Source:** [src/providers.js:197](/Users/vmedvedev/victron/ottplay-foss2/src/providers.js:197), [src/epg.js:435](/Users/vmedvedev/victron/ottplay-foss2/src/epg.js:435) · Legacy: [prov/m3u/prov.js:393](/Users/vmedvedev/victron/ottplay-foss/prov/m3u/prov.js:393), [prov/m3u/prov.js:629](/Users/vmedvedev/victron/ottplay-foss/prov/m3u/prov.js:629).

**Reproduction:** [data.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/data.cjs).

### G03 · P2 · Built-in EPG cannot expose the channel's full archive depth

**Classification:** Parity gap. **Area:** Archive.

**Trigger:** The feed contains a valid programme from three days ago and the channel allows a seven-day archive.

**Observed:** The service keeps the current programme but discards the historical one. An archiveDays request field is rejected with 400 EPG_REQUEST.

**Cause:** The service intentionally bounds all channels to ±24 hours and its request contract cannot express archive lookback.

**Remedy:** Retain memory limits while adding bounded per-channel archive depth or on-demand historical queries. This is an expansion of a documented limitation, not a newly introduced regression.

**Acceptance:** Three-/seven-day archive schedules, provider depth bounds, response/programme caps and current/next retention.

**Source:** [scripts/epg.cjs:28](/Users/vmedvedev/victron/ottplay-foss2/scripts/epg.cjs:28), [scripts/epg.cjs:114](/Users/vmedvedev/victron/ottplay-foss2/scripts/epg.cjs:114) · Legacy: [src-rs/core/src/lib.rs:74](/Users/vmedvedev/victron/ottplay-foss/src-rs/core/src/lib.rs:74).

**Reproduction:** [service.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/service.cjs).

### O01 · P3 · A full catalog scan defeats the EPG FIFO cache above 4,096 identities

**Classification:** Optimization. **Area:** Large playlists.

**Trigger:** Scan the same catalog twice with no programme boundary crossed, using per-channel EPG offsets.

**Observed:** At 4,096 identities the second pass reads zero original entries; at 4,097 it rereads all 4,097, and at 8,000 all 8,000. TV latency was not measured.

**Cause:** Every render scans all channels; sequential scanning beyond the FIFO capacity evicts entries before their next use.

**Remedy:** Keep a bounded working set for visible/playing channels and compute whole-catalog summaries separately, or use a cache policy that avoids full-scan thrashing.

**Acceptance:** 4,095/4,096/4,097/8,000 identities, shifted schedules, multiple programmes, bounded heap and long-session navigation latency.

**Source:** [src/app.js:9](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:9), [src/app.js:150](/Users/vmedvedev/victron/ottplay-foss2/src/app.js:150), [src/epg.js:367](/Users/vmedvedev/victron/ottplay-foss2/src/epg.js:367).

**Reproduction:** [runtime.cjs](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/runtime.cjs).

## Repair order

1. Stabilize channel identity and reconcile every dependent store before catalog authorization. Introduce source-qualified EPG identity at the same architectural layer.
2. Separate browser/native numeric input transport, wire Guide, and classify Shaka errors.
3. Preserve one playback intent and timeline through errors, chained fallback and TV lifecycle events.
4. Add guide-expiry refresh and archive coverage/contracts without expanding TV memory without bounds.
5. Close route dispatch gaps and measure large-catalog cache behavior on low-memory targets.

## Verification still needed

- Event-combination regressions matter more than another successful startup: remote + UA + real DOM events, metadata changes + PIN, multiple feeds + duplicate IDs, host suspend + pause, and three-hop fallback.
- Add long virtual-clock tests and measured multi-hour real playback for memory, timer/listener growth, Wi-Fi loss/recovery, expiring provider sessions and repeated source/channel switches.
- Test the delivered page on representative actual WebKit/old Chromium engines, then physical LG/Tizen/STBs by model/firmware. API removal in current Chromium cannot recreate old DOM/media implementations. LG documents different browser/app engines on webOS 1/2 in its [web engine specification](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine).
- Packaging, proprietary AVPlay/OIPF/gSTB/Dune bridges, DRM and operator-specific protocols remain the previously documented unimplemented scope; they are not counted as new defects here.

## Reproduction and boundaries

Run the five scripts in `test-results/deep-audit-20260918` with Node after installing the pinned development dependencies. Scripts use actual source modules plus isolated synthetic video/DOM/provider fixtures. `runtime.cjs` starts an ephemeral loopback HTTP server. None requests a private provider or uses the user's browser profile. Paths are pinned to this workspace for reproducibility.

See [evidence.json](/Users/vmedvedev/victron/ottplay-foss2/test-results/deep-audit-20260918/evidence.json) for commands, exit codes, logs, source hashes and evidence limits. No physical TV, live upstream service, browser-process restart or OS reboot was tested in this audit.
