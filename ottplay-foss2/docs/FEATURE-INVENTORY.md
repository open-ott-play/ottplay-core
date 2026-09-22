# Full product requirements and source evidence

Status: requirements inventory for the independent ES5 player, derived from local source inspected 2026-09-14. This is not an implementation-completion report. Source paths are relative to `/Users/vmedvedev/victron/ottplay-foss`. A file or function demonstrates intended/implemented old behavior, not current provider availability or physical-device success.

All new application, parser, provider, UI and control code must be written independently in ES5. Do not execute old scripts, depend on their globals, inherit their state coupling or retain bugs merely for apparent parity. Compatible file formats, user-visible behavior, numeric key facts and licensed font assets are reference inputs.

## 1. Acceptance model and product boundaries

The complete product is a TV-first IPTV/OTT player: configured channel sources, live playback, EPG/archive, VOD, favorites/history, remote-oriented settings and optional native/remote integrations. A new home page with working arrows is an initial increment, not completion of this inventory.

Each feature must have a status in the delivery checklist: specified, implemented, fixture-tested, browser-tested, native-tested or physical-device-tested. A capability-dependent feature may be unavailable with a clear explanation; it must not pretend success. Provider adapters must have their own readiness status rather than inheriting support from a provider-name list.

Required separation:

- Pure data/parsing and normalization.
- Persistent settings and migration.
- Provider transports/adapters and cancellation.
- Playback state and engine ownership.
- UI navigation/focus/rendering.
- Device input/native capability adapters.
- Explicitly optional EPG services, HTTP remote control and shell integrations.

No implicit global state synchronization, dynamic execution of provider responses, magic list indices for actions, or cross-feature mutation of shared window variables. Dependency errors must leave a functional settings/recovery screen. The application's own startup, controls and plain-HTML playback do not depend on ES2015 globals, a CDN or a build transpiler.

## 2. Core data and identity contracts

Source evidence: `src/channels/types.ts`; `src/channels/index.ts:setCurrent`, `onChanelsLoaded` and channel identity helpers; `tests/test_channel_id_migration.cjs`; `src/channels/favorites-lists.ts`.

- A channel has an opaque stable ID, provider/source ID, display name, stream locator or resolver, optional logo, group IDs, display number, EPG reference(s), archive capability and bounded provider metadata. IDs must not depend solely on display name. Duplicate names and multiple sources remain distinct.
- A group has a stable ID, name and ordered channel IDs. “All” and active favorites are explicit views, not magic category positions 0 and 1. Empty groups are valid. Missing references are cleaned or reported, never dereferenced blindly.
- A programme has channel ID, title, start/end as Unix seconds, description and optional artwork. End must exceed start. Store epochs unchanged; timezone/EPG shift belong to explicit conversion/display logic.
- A media item has stable source-specific ID, kind (folder/movie/series/episode/stream/quality choice), name, metadata, child/resolution method, playback locator and optional resume position. Do not overload channel records or make negative timestamps represent VOD.
- Playback state is an explicit object: session generation, source/channel/media ID, mode live/archive/VOD, engine, requested intent playing/paused/stopped, actual engine state, position, errors and pending work.
- History records retain identity and optional archive/VOD position, not just mutable array indices. Provider refresh, sort, rename, deletion and favorites changes cannot silently select a different channel.
- Import and migration must preserve old user intent using an explicit mapping report; ID collisions or missing channels cannot overwrite unrelated favorites/resume records.

## 3. Sources and M3U playlists

Source evidence: `prov/m3u/prov.js:getChanelsArray`, `getChannelUrl`, `getArchiveUrl`, `loadM3Uparams`, `setProviderParams`, `getMediaArrayEXTM3U`; `tests/test_m3u_epg_match.cjs`; `tests/test_m3u_vportal.cjs`.

### 3.1 Source management

Support several named playlist entries, selected active source, URL edit, add/remove/reorder, archive duration override, EPG/logo source configuration and user-agent/header options only where the transport can support them. Saving invalid input must not destroy a previously working source. Loading/failure/cancel states remain interactive. Reload is explicit and cancellable. A late reply from the prior source cannot replace the new source's channels.

Browser URL loading obeys CORS, TLS and mixed-content restrictions. A configurable companion/native transport may handle otherwise blocked fetches, with explicit capabilities. The UI must not promise that changing a playlist header gives browsers permission to send restricted headers. Text paste/local file import are useful new routes, but should be labeled additional behavior rather than falsely attributed to every old provider.

### 3.2 Parsing requirements

Accept UTF-8 BOM, CRLF/LF, empty lines, comments, quoted metadata containing commas and extended M3U. Parse attribute values with a tokenizer rather than splitting the first comma inside a quoted attribute. Treat metadata as text. One malformed record must not discard other valid records; return warnings with safe location/context.

Observed metadata to retain:

- Header `url-tvg`, `x-tvg-url`, `foss-tvg` source aliases.
- Entry `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-shift`, `tvg-source`, `url-tvg`.
- `#EXTGRP` category fallback.
- Header/entry `catchup`, `catchup-type`, `catchup-source`, `catchup-days`, `timeshift`, `tvg-rec`, plus configured `rechours` fallback.
- Duration and the name following the unquoted `#EXTINF` comma.

Define inheritance: valid entry metadata overrides header defaults, which override user source defaults. Empty values and missing values are distinct when clearing a setting. Archive days convert to hours once; preserve zero as explicit no-archive. Fractional hour EPG shifts require precise numeric parsing, bounds and a documented sign convention. URLs and title text must not be corrupted by blanket percent decoding.

Unsupported directives remain harmless data/warnings. Never eval playlist content because the server labels it JavaScript. Resolve relative media/logo URLs only against the configured playlist URL under an explicit URL policy; this is a deliberate new robustness requirement. Preserve stable order and deterministic duplicate handling. Avoid quadratic whole-list rescans on large playlists.

The old implementation hashes stream URLs and, in some providers, names. The new implementation must handle collision detection and signed/rotating URL changes deliberately rather than inheriting that identity loss.

### 3.3 Minimum parser acceptance fixtures

Quoted commas, duplicate channel names, same channel in several categories, Unicode, empty/missing titles, malformed metadata, blank URL, comment between EXTINF and URL, CRLF/BOM, header-versus-entry overrides, explicit zero archive, fractional shift, duplicate URL, long playlist, source switching during load and provider metadata containing HTML/script text.

## 4. Provider contract and all observed entries

Source evidence: `src/provider/index.ts:loadProv`, `loadChannels`, `selectProvaider`, `optionsList`; each `prov/<id>/prov.js`; `src/plugins/native-http.ts`; `src/plugins/stalker-portal.ts`.

Implement explicit provider instances with a common contract: validate configuration; open/close/dispose; list channels/groups; resolve live playback; query EPG; describe/resolve archive when supported; list/search/resolve media when supported; expose settings schema; classify errors; cancel pending work. Callbacks settle once. Provider-owned credentials, cached responses and request generations must not leak between instances.

Transport results need status, body, safe headers, timeout/abort and structured error categories. Distinguish unauthorized, unsupported endpoint, empty valid list, malformed response, network failure and user cancellation. Native JSONP compatibility parses only the configured callback wrapper and JSON payload; never executes remote text as application code.

The old tree has 48 `prov.js` entrypoints:

`1ott`, `all4you`, `antifriz`, `bestlist`, `bestlist/stalker`, `cbilling`, `d/maxtv`, `demo`, `diamondtv`, `dosug`, `dragon`, `drvao`, `edem`, `fabryka`, `fox`, `fxml`, `great`, `ipstream`, `iptv-ott.ru`, `itv`, `kb-team`, `korona`, `m3u`, `moidom`, `newlook`, `only4`, `ottclub`, `ottg`, `ottprime`, `polmedia`, `prost`, `raduga`, `rd`, `russkoetv`, `shara-tv`, `shara.club`, `sharavoz`, `shocktv`, `shura`, `stalker`, `tabox`, `top`, `topiptv`, `tvclub`, `tvteam`, `ultifl1x`, `vidok`, `xtream`.

Each named service needs a separately authored adapter and sanitized response fixtures before “supported” can be claimed. Names and existing file counts are inventory only; commercial endpoints/account availability were not verified. Do not copy old service credentials, operator configuration, local files or logs. Unsupported names must not be offered as working options.

### 4.1 Xtream

Observed source `prov/xtream/prov.js` accepts server/username/password, uses `player_api.php`, maps categories/live streams, builds `/live/<user>/<password>/<stream>.m3u8` and queries `action=get_short_epg`. The old implementation expects an aggregate initial response containing live streams; do not assume every real Xtream server returns that shape. A new adapter must explicitly support tested endpoint variants, authenticate, fetch documented category/live/VOD/series endpoints when implemented, normalize timestamp/text encodings and capability-gate archive.

The old Xtream adapter sets archive duration to zero and does not itself prove complete VOD/series/catchup support. Those are future implementation requirements for full provider parity where advertised, not an existing proven capability. Credentials must not appear in diagnostics or ordinary settings exports.

### 4.2 Stalker/Ministra and MAG distinction

Observed `prov/stalker/prov.js` uses a FOSS-specific JSON-RPC protocol under `/stalker_portal/api/` and stream resolution. `src/plugins/stalker-portal.ts` explicitly states that the project does **not** ship the classic MAG JsHttpRequest/get_profile handshake client. The native shim's allowlist of `/load.php` and `/c/portal` is not such a client.

A new implementation must label JSON-RPC portal compatibility accurately. Classic Ministra/MAG support requires independent handshake/token/profile/channel/pagination/link-resolution implementation and fixtures from an authorized portal. No fake successful handshake, made-up channel list or implicit MAC identity. Header/cookie transport is scoped to the configured origin; cancellation and unauthorized responses are observable.

### 4.3 XML/fXML and VPortal

Observed XML media parsing: `prov/m3u/prov.js:Text2Dom`, `fXMLCh2Json`, `fXML_to_JSON`, `getMediaArrayXML`. Require nested folder/media conversion, safe text, malformed XML handling and disabled external entity expansion where parser configuration permits it. No script interpretation from XML nodes.

Observed VPortal: `src/plugins/vportal.ts:parseVPortalLink`, `createVPortalClient`; M3U media source integration in `prov/m3u/prov.js:m3uUpdateMedia`. Parse `portal::[key:…]https://…` and bracket-encoded spelling without damaging opaque keys or URL escapes. Support category/stream/multistream entries, quality selection and cancellation when opening a new folder/provider/source. `app` and authentication key are controlled request fields, not overwritten by media metadata. Browser requests use a companion endpoint; native transport may call the configured portal. Error bodies can echo secrets and must not be rendered/logged.

## 5. Playback and engine lifecycle

Source evidence: `src/core/index.ts:stbPlay`, `stbStop`, `stbPause`, `stbContinue`, `setPlayerMode`, `normalizePlayerMode`, audio/subtitle/PiP helpers; `src/core/auto-playback.ts:watchAutoNativePlayback`; `src/index.ts:_playChannel`, `_playMedia`, `playArchive`; tests named `test_port_engine_lifecycle`, `test_port_dash_lifecycle`, `test_port_pause_intent`, `test_port_tauri_session` and `test_port_native_pip_lifecycle`.

Required user behavior: play selected channel/media, stop, pause/resume when supported, volume/mute, next/previous channel, numeric selection, last channel/history, restart live, live/archive transition, seek, remaining/duration display, loading/error indicator, audio track, subtitles including Off, aspect/zoom and appropriate fullscreen.

Rules preventing known old design failures:

- One session owns one primary playback engine. Concurrent callbacks cannot attach two engines or restore an old source.
- User intent survives late engine events; pause stays paused and stop stays stopped.
- Async teardown completes before a new engine reuses its target. Fatal errors have bounded retries; mode changes/stop dispose retry timers.
- Native-HLS startup is observed and cancellable; fallback does not treat an ordinary loading delay or intentional pause as fatal without policy.
- VOD seek waits for a usable timeline; live and native/MSE timeline origins are not interchangeable.
- No black-screen “success”: display error/capability state when load or decoding fails.
- Volume is application volume when supported; do not silently alter OS volume. Preserve the user's saved mute setting around any demo autoplay workaround.
- Track choices belong to source/channel identity and valid track descriptors; stale indices from another stream are not applied blindly.
- Separate in-page video rectangle, HTML browser fullscreen, native OS fullscreen and OS PiP. Each has separate state and success/failure.

Acceptance requires actual media events and teardown races, not only replacing functions with no-op spies. Physical codecs, DRM and simultaneous decoders remain separately tested capabilities.

## 6. EPG, programme details and scheduled reminders

Source evidence: `prov/m3u/prov.js:getEpgList`, `getEPGurl`, `getEPGchanel`, `provEpgLoader`; `src/channels/index.ts:getCurProgData`, `epgList`, `epgShow_miniproc`, `selectEpg`, `setEpgTimer`; `src/settings/index.ts:applyTimezoneSetting`; native EPG plugin and `tests/test-native-epg-parity.ts`.

- Load current/next programme and full guide by channel/source, with cache bounds/expiry and a bounded request queue.
- Match channels via explicit XMLTV ID, aliases/name normalization and configured sources; do not replace good identity with fuzzy name-only guesses. Expose unresolved/ambiguous matches.
- Support source-level and channel-level XMLTV source settings and EPG shifts. Query historical depth from actual archive duration, not a fixed ±48-hour window.
- Parse timestamps including declared offsets; preserve Unix seconds across timezone changes and DST. System timezone option restores system rules.
- Guide supports date/programme navigation, details, current marker, progress, upcoming programmes and archive availability. Future programmes open details/reminder actions rather than pretend playable archive.
- Empty EPG is a valid visible state; stale metadata must not show a different channel's programme.
- Reminders store identity/time, show configured lead-time notification, support removal and expire sensibly. Do not imply that a reminder wakes a powered-off TV without native support.
- Browser/companion/native XMLTV paths must be distinguished. A static HTTP server's health or successful player page load does not prove EPG availability.

## 7. Archive and timeshift

Source evidence: `prov/m3u/prov.js:getArchiveUrl`; `src/channels/index.ts:selectEpg`, archive helpers; `src/index.ts:playArchive`; `tests/test_port_playback.ts`, `tests/test_settings_parity.cjs`.

Archive capability is provider/channel-specific. Record available duration, method/template and permitted range. Support programme start/replay, timestamp selection, short/medium/long jumps, return to live, pause/resume where possible and resume offset policy.

Observed template variables: `${start}`, `${end}`, `${timestamp}`, `${offset}`, `${duration}` in integer seconds. Support replacement-template and `append` modes. Flussonic URL variants include MPEG-TS, `video.m3u8`, `mono.m3u8`, `index.m3u8` and `index.mpd`, with historical duration and near-live timeshift forms. Generic old fallback appends `utc`/`lutc`; it must only be offered when a provider contract identifies that format, not assumed valid for every URL.

Validate requested time against archive retention and current time, preserve existing query parameters and avoid double-appending tokens. Clarify duration/end semantics per adapter. The old Dune +7200 adjustment and negative sentinel modes are not general requirements. Acceptance fixtures must include existing query strings, zero/expired archive, programme boundary, near-live transition and source change during pending resolution.

## 8. VOD, series, folders and media history

Source evidence: `src/channels/index.ts:recordsList`, `requestMediaList`, `cancelMediaLoad`, `rememberMediaView`, `selectMedia`, `showMediaList`, `getMediaDescr`, `searchMedia`, `addToMedFavorites`; `src/index.ts:_playMedia`; `prov/edem/prov.js` media/search behavior; `tests/test_port_vod.cjs`, `tests/test_port_edem_search.cjs`.

Support nested folders, return stack, title/artwork/description, provider search, search-result navigation, films/series/episodes when supplied, source/quality selection, finite playback and resume prompt. Preserve folder path, selected row and scroll/page when entering/leaving details or playback. A provider callback may resolve asynchronously; cancellation makes late results harmless.

History/favorites identify an item and source separately from its expiring stream URL. Save resume at controlled intervals/end/stop; clamp invalid positions and avoid asking to resume after completion. “Continue watching” must resolve a fresh playable URL. Folder selection never accidentally resumes/plays the first child. A provider without a media API reports unavailable.

## 9. Favorites, groups, sorting and history

Source evidence: `src/channels/favorites-lists.ts` complete API; `src/channels/index.ts:bucketsList`, `saveChannelsCats`, `addToFavorites`, `removeFromFavorites`, channel/category editors; `src/channels/search.ts`.

Support multiple named favorites lists, active list selection, create/rename/delete, add/remove/reorder, persistence and fallback when deleting the active list. Migration from a single old favorites array preserves order. Channel/group editor supports appropriate create/rename/reorder/copy/delete and hide actions without losing original provider identity. Refresh reconciles removed channels and keeps unrelated groups intact.

Search is Unicode-safe, case-insensitive within documented normalization, deterministic and empty-query-safe. Channel/history filtering does not mutate the source list. Playing from a filtered/favorites view resolves its channel ID rather than applying a filtered row index to the unfiltered category. Last-channel/history can return to a previous live or archive position without using stale indices.

## 10. Parental control and protected actions

Source evidence: `src/channels/index.ts:hasParentalLock`, `ifParentalAccess`, `ifParentalAccessChId`, `enterPinAndSetAccess`, `parentControlSetup`; `src/provider/index.ts:optionsList`, `noSelProv`, `noProvParam`; `tests/test_parental_pin_input.cjs`, `tests/test_parental_startup.cjs`.

PIN protection applies to restricted channels/archive and configurable settings/provider-selection actions. All entry paths—remote, pointer, startup restore, history, favorites, archive and HTTP command—must pass the same guard. Locked labels may remain visible according to explicit preference; thumbnails/descriptions must respect configured privacy behavior.

PIN dialog owns focus, masks entry, supports numeric remote and physical keyboard, clear/back/cancel/confirm and restores prior focus. A denied or cancelled PIN cannot continue a stale selection. Changing source while a PIN request is pending invalidates its continuation. Config changes and reset/import cannot silently disable an active gate.

The old default PIN and `'*'` sentinel are observations, not a security requirement for the new design. Use explicit enabled/configured fields and versioned storage. `psChannels`, `psOptions`, `psProvs` are parental protection flags in implementation; misleading old interface comments describing provider switches must not be inherited.

## 11. Settings, persistence, import and reset

Source evidence: `src/settings/index.ts:PlayerSettings`, `defaultSettings`, `loadSettings`, `saveSettings`; `src/storage/index.ts`; `src/settings/cloud.ts`; `src/index.ts` settings menus and native export functions; `tests/test_provider_storage_reset.cjs`, `tests/test_native_settings_export.cjs`.

Setting groups required for parity:

- Appearance: selectable font family, independent font size adjustment, colors/highlight, background/OSD opacity, graphics/text icons, list side/layout, visible fields, scrollbar, row count, clocks and animation preference.
- Channel rows: number/logo/name/current programme/progress/archive marker/description/upcoming count, preview and list-position restoration.
- Playback: engine preference constrained by capabilities, buffering, stop/switch policy, resume offset, per-channel aspect/zoom/audio/subtitle and information display.
- Input: arrow/OK/Back/color/transport/channel shortcut assignments, disable numeric/color shortcuts, seek step sizes and volume increment.
- Time: system/override timezone, sleep timeout and EPG reminder lead time.
- Personal data: sources/providers, active source, channel/group order, favorites lists, history/resume and parental controls.
- Optional integration: local HTTP enablement/code/configured endpoint, remote settings transfer, device identity and shell preferences only when supported.

Use one validated schema with defaults, bounds and migration version; no duplicated `window.s*` and internal settings mirrors. Separate global/device settings, provider/source settings and transient UI state. Zero, false, empty, missing and malformed values have distinct documented handling. Values are saved atomically where the storage permits it; quota/unavailable-storage errors stay visible and do not crash playback.

Font-family alias is not named `fontSize` in the new schema; the old code used that misleading name. Hide unavailable controls instead of clearing user choices. Never overwrite a saved provider engine merely because the current device must use Auto. Editing one setting does not reset other settings.

Export is explicit and versioned, has a documented inclusion policy and masks/excludes local HTTP secrets/provider credentials by default. Import validates before mutation, shows a summary and applies a transactional migration; reject prototype keys and unreasonable sizes. Reset supports clearly scoped settings/source/personal-data choices. Never enumerate/delete all localStorage entries owned by other apps. Cloud/dealer transfer endpoints need explicit configuration and real acceptance; they are not presumed available because a helper exists.

## 12. Local/remote commands and native shell features

Source evidence: `src/commands/index.ts:handleCommand`; `src/plugins/local-http-remote.ts:createLocalHttpRemote`; `src/swop/index.ts`; `src/plugins/mobile-native-media.ts`; `src/index.ts` Tauri/Capacitor integration; `tests/test_local_http_remote.cjs`, `tests/test_http_remote_cloud.cjs`.

Observed command names: `popup_message`, `channel_by_number`, `channel_by_name`, `random_channel`, `change_provider`, `change_provider_settings`, `change_playlist`, `set_volume`, `exit_player`. Each command needs explicit input validation, capability checks, parental guard and an observable success/error result. Channel number is documented as 1-based in a defined active view. Name matching must search all intended categories correctly; the old function's inconsistent not-found sentinel is not a required behavior. Unknown commands have no effects.

HTTP control is off by default. Enabling creates or accepts a valid device-local secret using secure entropy; no fallback to Math.random, public UUID or a shared default. A configured URL alone does not enable polling. Revoke immediately on disable/rotation; abort requests and ignore stale generations. Deduplicate command IDs with bounded state. Polling has timeout, one in-flight request, controlled retry and disposal. Credentials are sent only to the configured service and never rendered in logs. Hosts without a secure generator can keep remote control unavailable while the player still works.

Optional native capabilities: OS fullscreen, native PiP, background audio/media session, keep-awake, app exit, native HTTP/cookies, device-local HTTP service, updates and file export. Use a versioned adapter and report unsupported in a plain browser. Do not treat web fallbacks returning success as native evidence. Native update/install/package workflows are separate deliverables; new ES5 frontend files do not create an APK/IPA/Tauri release automatically.

## 13. PiP, preview and screen geometry

Source evidence: `src/core/index.ts:stbPlayPip`, `stbStopPip`, `setPipPosition`; `src/channels/index.ts` PiP/channel helpers; `src/index.ts` native PiP integration; `src-tauri/pip/`.

Distinguish list preview, in-page second video and native OS PiP. Each owns its engine, stream generation, rectangle, volume policy and teardown. Controls include enable/disable, channel selection/swap where supported, position/size and primary playback restoration. The second decoder may be unavailable even when one stream works; report capability/failure without breaking the first stream. Closing a list does not restart cancelled preview or leak background playback. Native PiP close/return events synchronize frontend state.

Responsive geometry has a single source of truth. Preserve aspect ratio and bounded overscan-safe margins; handle resize/fullscreen transition during playback/list/PiP. New DOM does not depend on the old IDs or inline hardcoded 1280px arithmetic. Tests must cover tall/short list content, all row counts and fonts; the selected item remains visible.

## 14. Localization, typography and accessible navigation

Source evidence: `src/localization/index.ts:translate`, `loadLanguage`; the 20 `stbPlayer/_*.js` dictionaries; `src/index.ts:fontFamilyList`; `stbPlayer/1280.css`; [device/resource requirements](DEVICE-CONTRACTS.md).

Use data dictionaries for the 20 inventoried languages, stable message IDs/parameters and English/source fallback. Do not evaluate translation JavaScript. Switching language preserves settings/navigation and updates hints, dates and messages. Define plural/date/time and RTL behavior explicitly. Missing translations remain readable and cannot render `undefined`.

Retain six font labels and the local icon-font resource set as specified, including the documented Liberation/Roboto payload alias. Keyboard focus is always visible, layouts tolerate translated strings, and icon-only actions also have text/accessible labels. No mandatory animation, hover, color-only status or glyph-only fallback. Screen-reader support is a desirable new browser capability but is not proven by old source existence.

## 15. Diagnostics and reliability acceptance

Source evidence: `src/debug/playback-debug.ts`; `tests/test_debug_redaction.cjs`; `tests/test_port_bundle_smoke.cjs`; `tests/test_port_runtime.cjs`; `tests/browser/device-detection.spec.cjs`.

Diagnostics show build, profile, available engine/capabilities, safe request/error classes and current state transitions. Redact credentials, authorization/cookies, signed media URLs, provider tokens and hardware identifiers. Do not log raw playlists or provider response bodies. Bounded logs and task queues cannot grow indefinitely on TVs.

Required scenario matrix before a parity release:

1. Fresh boot, saved boot, unavailable storage, malformed settings and interrupted source load.
2. Every profile route and input collision; no modern language/API dependencies at boot.
3. Playlist/provider reload preserving favorite identity; old response arriving after switch.
4. Live→live, live→archive, archive→live, VOD resume and rapid stop/play/change races.
5. Missing/late EPG, timezone/DST transition, invalid programme times and archive bounds.
6. PIN through startup, keyboard, pointer, favorites, history and remote commands.
7. Font failure, longest translations, all family selections, 720p/1080p/4K and supported row counts.
8. Native-helper failures, Tizen registration failure, no second decoder and unavailable fullscreen.
9. Offline resources, blocked CORS/TLS, provider unauthorized/empty/malformed response and bounded recovery.
10. Reset/import/export scope, malformed/prototype-key payload and secret redaction.

The old test names are scenario evidence, not tests to copy verbatim or a substitute for new architecture-specific verification. Every supported claim needs a new executable test or an identified manual/device test record. Unimplemented providers/native features stay explicitly listed as remaining work.
