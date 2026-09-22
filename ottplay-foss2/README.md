# OTT-play FOSS 2

**Beta 0.6.0-beta.1** — [release notes and upgrade instructions](docs/RELEASE-0.6.0-beta.1.md).

An independent IPTV player with an ES5 application runtime and a compact interface for LG televisions and remote controls, inspired by OTT-play FOSS. The original player is a requirements reference, not a runtime dependency. The application, state model, providers and controllers are newly written. Existing font resources are retained with their notices.

**English is the default.** Switch to Russian in **Settings → Size and language**. The selected language persists on the device, including after a reload. A missing or unsupported language setting falls back to English. The default font is the bundled **RobotoCondensed**; other fonts and sizes remain selectable.

## Run

```sh
cd ottplay-foss2-0.6.0-beta.1
npm ci
npm start
```

Open **http://127.0.0.1:8092/**. There is no application build step. The bundled fonts and media libraries are served locally. The server runs independently of the original project. Automatic programme-guide loading uses the public EPG.ONE feed described below.

To make the player available to devices on your own network, explicitly choose a network listener:

```sh
HOST=0.0.0.0 PORT=8092 npm start
```

Open the computer's LAN IP from the TV. The server defaults to loopback. Do not publish this development server as an authenticated public service.

## Installed desktop window

The local manifest installs **OTT-play 2** as a standalone browser app. In a desktop browser that supports **Window Controls Overlay**, the video can extend behind the title bar while the browser keeps its native window buttons. Ordinary tabs, televisions and browsers without this display mode retain their existing layout.

For an existing Chrome installation, open the app menu and accept **Review App Update → Update** when offered, then close and reopen the app. Use **Hide title bar** in the app menu to enable the overlay; **Show title bar** restores the standard bar. Keep the same origin and browser profile to retain sources, settings and the remembered channel. Reinstalling or clearing application data is unnecessary. The existing installation was upgraded and checked on macOS; browser update timing and menu availability can vary.

The transparent area between the native buttons can drag the window. Channel lists, dialogs and the on-screen keyboard remain below those buttons, while the video fills the window. Fullscreen removes the reserved title-bar space. This is an optional manifest and CSS feature; it adds no browser JavaScript, Service Worker or offline cache requirement.

## Use

- **Television:** add an M3U URL, paste a playlist, or choose an M3U file. The compact list shows channel number/name and current programme in aligned columns, with up to 26 rows per page at standard TV sizes. The adjacent panel shows the selected channel’s current programme, description and next programme. Increasing the font scale reduces the row count. Clicking a live channel or pressing OK starts playback immediately. Info opens favorites and channel settings. Narrow portrait screens use fewer columns.
- **Sources:** add/edit/delete M3U, Xtream Codes or standard Stalker/Ministra sources. Credentials are stored only in this browser's local settings. Stalker requires the configured local relay described below.
- **Video library:** browse movies, series, seasons and episodes supplied by the source. The Back to folders button restores the preceding level. VOD bookmarks can resume a previous position.
- **Favorites:** create, rename and delete collections. Move a favorite up or down from its channel card. Edit channel names, groups, ordering and visibility without modifying the original playlist.
- **Programme guide:** loads automatically from the playlist or the built-in source; up to ten custom XMLTV URLs can override it. Channel rows show EPG logos and current programmes; the adjacent details show the selected channel’s description and next programme. Filter channels/groups, browse pages, play supported catch-up archives, and set reminders for future programmes. Reminders run while the player is open.
- **Playback options:** choose available audio/subtitle tracks, picture size, zoom, volume and picture in picture. Options reflect the actual media backend. Audio, subtitles (including Off), aspect and zoom are remembered per channel. Live seeking requires a DVR window.
- **Settings:** choose the font and scale, accent color, startup restore, sleep timer, history, hidden channels, local relay and parental PIN.
- **Import/export:** review an OTT-play 2 backup or a supported original-player JSON/XML export before replacing settings. Source URLs and credentials are excluded from ordinary exports; including them requires the explicit checkbox.

The TV channel browser uses a compact single heading and dense rows, normally showing 26 channels at standard 720p/1080p text size and 25 when desktop window controls reserve space. Larger text and shorter windows reduce page capacity. Channels, filters and the optional EPG status share the heading; the redundant column heading is omitted. The page counter stays in that heading, and TV pages have no separate Previous/Next row. Use the remote page keys or mouse wheel to page through channels. Long programme details on the right start scrolling after 3 seconds, move at 14 pixels per second, pause for 4 seconds at the bottom and then return to the start. Moving to another channel starts its description at the top, while ordinary EPG refreshes preserve the reading position. Scrolling pauses for dialogs and inactive views; using a mouse temporarily pauses automatic movement. Remote focus stays on the selected channel.

In the channel list, Up/Down move the cursor, wrapping from the first channel to the last and back. Left/Right page backward/forward while preserving the row. CH+/CH− also page. The sidebar starts hidden. The visible Menu button or remote Menu toggles it; Back closes it and restores focus, and Right returns to the selected channel. Click or OK starts the selected live channel immediately. The Info button or remote Info opens channel actions and the full current programme description. Back closes the keyboard/dialog first. From playback, clicking the video, Back or Home returns to the playing channel and its page: the same video continues in the preview, and moving the cursor only changes the EPG details. Clicking the preview expands the current stream to the full application window without changing its playback or pause state; clicking the expanded video returns to the list. Back from the list or the Resume button restores full viewing without reconnecting or changing pause state. Loading a different source still stops the old stream. During playback, OK reveals the controls and focuses Play / Pause; Left/Right choose a control and OK activates it. Up/Down hide that control strip. The remote's yellow key opens the engine menu when the device profile supplies that key. The built-in keyboard supports Latin, Cyrillic and URL entry. On a desktop profile, numeric code 80 (P) toggles Play/Pause and 82/70 (R/F) seek. All keyboard and remote commands come from the selected device profile's numeric map; see [Device contracts](docs/DEVICE-CONTRACTS.md).

Mouse wheel and trackpad gestures page the channel, favorites and video lists without starting another channel. Horizontal gestures and Shift-wheel also page. A long page scrolls to its edge before moving to another page. Programme details, guide pages, dialogs, multiline fields, settings and the sidebar scroll inside their own available space. Ctrl/Meta-wheel remains available to the browser. The current EPG description and next programme remain fully accessible in the detail panel.

On reopening, the player loads the last successfully played live channel's source, opens the video view and starts that channel through the normal playback and PIN checks. It first uses the saved channel ID. If the playlist changes that ID, it looks for an unambiguous match using the original provider TVG ID, TVG name, channel name and group within the same source. This lets a channel survive rotating stream URLs without saving its stream URL. Older records can recover the saved name from the history entry with the same channel ID. A protected channel keeps its PIN requirement when its refreshed ID is matched.

An M3U playlist can publish several URLs for the same broadcast. When recognized M3U records share the saved TVG identity and channel name, and all their raw metadata except ID and URL agrees, startup chooses the first equivalent copy in the current playlist. Different quality, region, group or playback metadata remains significant; ambiguous names without a TVG ID cannot use this fallback. A missing or ambiguous broadcast leaves the list available.

An archive remembers its underlying channel and returns to live playback on startup. Browsing another source, clearing history, pressing Stop or attempting a stream that fails does not replace the remembered channel. User interaction cancels a pending startup restore, and a failed attempt does not restart later by itself.

Installations with only old viewing history retain exact-ID restoration, including VOD bookmarks. History alone cannot identify a live channel reliably after an ID or source disappears, so it does not select another channel by name.

Startup playback is enabled by default. Existing installations receive this default once during the upgrade; **Settings → Preferences → Restore the last channel on startup** can disable it afterward. The video view does not automatically request browser fullscreen. If the browser blocks autoplay, the footer and Play control remain visible until playback begins; press Play or use OK on the focused control. The player keeps the saved sound setting. Once playback starts, the normal six-second footer timeout resumes.

## Playback engine selection

**Auto** is the default. Open **Engine** during playback, **Options → Playback engine**, or **Settings → Playback → Player engine** to select **Auto**, **LG native / Native HTML5**, **Hls.js**, **Shaka**, or **MPEG-TS**. Engines without the required browser APIs are marked unavailable. The selection is saved for subsequent channels and reloads.

Auto considers the device and stream format. For HLS, LG starts with its native player; Chromium selects Hls.js when available. DASH uses Shaka; raw HTTP MPEG-TS and FLV use mpegts.js where supported. Direct files use native playback. URLs without a useful extension are checked through a bounded, cancellable request using the response Content-Type or the initial stream signature. Auto can try another compatible backend after a failed attempt; a manual selection keeps the chosen backend.

The same menu has **Stream format**: Auto, HLS, DASH, MPEG-TS, FLV, or MP4 / file. Leave it on Auto normally; select a format when a provider hides it behind an extensionless URL or the detection request is blocked. The format setting is also saved and applies to subsequent channels, so return it to Auto before switching to a different type of stream. The playback overlay shows the saved engine choice, active backend, detected format and position.

An engine change releases the previous session and preserves pause intent. VOD/archive uses a supported absolute position; live playback preserves its distance behind the live edge when both engines expose a DVR range. It does not add a missing codec or bypass provider access rules. A data relay does not proxy video. See [engine compatibility and LG boundaries](docs/ENGINE-COMPATIBILITY.md).

Keyboard and remote input uses numeric `keyCode`, or `which` when `keyCode` is absent or invalid. The selected device profile determines the action; modern `key` and `code` fields are never read. Unknown numeric codes and letter-only events do nothing. Selecting a TV profile in a desktop browser retains that TV's remote codes, including collisions such as Samsung Maple 73 for Stop and native Android 19 for Up. Android user-agent detection instead uses the browser DOM numeric map; `/f/android` or `?device=android` explicitly selects native KeyEvent input.

On the `pc`, `pc2`, `nodejs` and `edem` profiles, code 81 (Q) exits immediately without a confirmation, including from fullscreen or an open dialog when a text field is not being edited. Code 76 (L) toggles fullscreen, and 27 (Escape) leaves fullscreen. In windowed mode, the dedicated Exit action cancels an open dialog or opens the exit confirmation with No selected. Both direct Q exit and Yes in that confirmation save an available VOD bookmark, retain the last channel, stop playback, release resources and request window closure. Browsers that disallow closing a user-opened tab show a stopped exit screen with an Open player button. Ctrl/Alt/Meta combinations and ordinary text entry remain available to the browser/editor.

Remote Return and Exit are separate actions: webOS Return is 461, Tizen Return is 10009, and PC/MAG Return is 8. Dedicated Exit is 10182 on Tizen, 45 on Maple, and 27 on LG/MAG. The native Android profile shares Return and Exit at code 4, which retains Back navigation. A delivered nonzero Power code maps to the same immediate `quit` action; it does not open an exit confirmation. Numeric desktop extensions for Space, Context Menu, Tab, Page Up/Down and Home/End apply to `pc`, `pc2`, `nodejs`, `edem` and Android browser input. Those profiles also accept numeric keypad codes 96–105 alongside top-row digits, plus multimedia codes 179 for Play/Pause, 178 for Stop, 176/177 for Next/Previous, 175/174 for Volume Up/Down and 173 for Mute. Multiple codes can perform the same action. These additions never replace another profile's remote mapping: Maple 99 remains Info rather than keypad digit 3.

Held-control release follows the selected profile. Desktop profiles wait for keyup or focus loss. Remote profiles use a bounded 350 ms inactivity timeout to recover from missing keyup events; repeated keydown events refresh it, and events marked as repeats remain suppressed. This explicit profile policy does not assume identical event behavior on every physical remote.

During playback, the profile's Info code opens the channel/programme footer: PC/MAG 73 (I on a desktop keyboard), Maple 99, LG/Tizen 457 and native Android 165 (Android browser input uses 73). A second press expands the full EPG description; further presses retain the expanded view. Clicking the hidden footer area at the bottom of the video performs the same steps. Every activation starts a fresh six-second auto-hide interval, matching playback startup, including while paused. An autoplay-blocked session keeps the footer visible so Play remains available. Footer controls retain their own actions. A focused expanded description scrolls with that remote's directional actions, plus page/home/end actions where the profile supplies them, without changing the channel. Mouse scrolling also works.

The profile's Previous Channel key returns to the previously confirmed live broadcast, including its source and PIN checks; it is distinct from the adjacent Previous key. Dedicated Audio, Subtitle, Aspect and Zoom keys open playback options, and PiP toggles the current session where supported. Existing profile collisions retain their established priority. Held transport and toggle keys cannot repeatedly activate on legacy remotes that omit `event.repeat`. During VOD/archive playback with a known duration, digits 0–9 seek to 0–90%; live digits still select channel numbers. VOD bookmarks are also saved on page hiding and unload.

Track preferences use language and label when available, so reordered tracks do not silently select a different language. An ambiguous match leaves the backend default intact. Numeric track IDs are only reused without language/label metadata on the same engine. Preferences are bounded to the 200 most recently customized channels and excluded with sources from ordinary exports.

Auto monitors silent startup and stalled playback. A stream with positive evidence of a video track can fall back when that track never opens; radio and unknown manifests are not assumed to contain video. HLS recovery is limited, with one media-error recovery/downshift attempt per session and smaller buffers on TV profiles. Manual engine choice remains manual.

## Legacy browser bootstrap

The page loads native-capability capture, the pinned local core-js bundle and platform finalization before application modules or media libraries. Missing Promise, Symbol/iterators, collections, Object/Array/String/Number/Math helpers, URL and typed-array methods are supplied in ES5 syntax. The HLS Worker imports the same bootstrap in its separate realm before its matching Hls.js payload. Missing or failing Workers use main-thread transmuxing. The interface starts without downloading any optional media engine. Each engine loads on first demand after its native prerequisites pass; concurrent requests share one load. A dependency that fails or exceeds five seconds is excluded for the rest of the page session, even if its script executes later. Accepted references remain isolated from late global writes.

Native MediaSource (including the WebKit prefix), real binary buffers, stream transport and hardware codecs are checked separately. Polyfills cannot provide proprietary TV playback bridges or missing decoders. The 24 device input profiles and exact platform boundaries are documented in [Device contracts](docs/DEVICE-CONTRACTS.md).

## Programme guide and channel logos

EPG source priority is **custom URLs → playlist URLs → built-in EPG.ONE**. The built-in fallback is `https://cdn.epg.one/epg2.xml.gz`, the feed used by the original player's native editions. A playlist with only `tvg-id` and no XMLTV URL therefore still gets an automatic guide attempt. Clear the XMLTV field and save to restore automatic source selection; use **Programme guide → Refresh** to retry a failed download.

The local Node server downloads and decompresses the built-in guide, then returns channel metadata and a bounded programme window for the requested channels. The TV does not download or parse the full compressed feed. This built-in route works without enabling the optional provider relay. It requires the supplied server and internet access; hosting only the static files does not provide it. The browser sends channel IDs/names to this local service; stream URLs and provider credentials are excluded.

Matching prefers the exact XMLTV ID, then unique names, then a unique name with a leading/trailing HD, FHD, UHD or 4K label removed. It preserves region, language and time-shift labels. Ambiguous matches remain empty. The first safe EPG icon is preferred, with the playlist logo as a fallback; a failed image does not change the row height.

The EPG status line distinguishes loading, matched channels/current programmes, no matches, outdated guide dates and request errors. Current/next labels update every 30 seconds while the main interface is visible; this recalculation does not download the guide again. The guide downloads again every 30 minutes and when overdue on foreground. Failed requests retry after 1–30 minutes with exponential backoff, retaining each configured feed's last good data. A bounded scan-resistant lookup cache reuses channel matching and schedules until a programme boundary or guide change. Ordinary TV/favorites refresh updates changed text, logos and progress in place, preserving the focused row, preview and description scroll position. The built-in result has a 30-minute server cache and a default window of 24 hours before/after loading. Busy schedules retain current, next and nearby programmes within the response limits; the status line says **nearby programmes only** when that selection is limited. Archive-capable channels request up to seven past days from the built-in feed (384 programmes per channel, 50,000 total); larger windows require a custom feed. See [EPG contracts and limits](docs/EPG.md).

## Optional local source relay

Direct source requests require the provider's CORS permission. Stalker additionally needs Cookie headers that a browser cannot set itself. To enable the bounded server relay, allow exact upstream origins, then enable **Settings → Preferences → Use the configured local relay**:

```sh
OTT2_RELAY_ORIGINS='https://playlist.example,https://portal.example' npm start
```

Use your actual provider origins, including a non-default port when applicable. An origin is scheme + host + port, without a path, credentials or wildcard. LAN upstreams must be explicitly listed by literal IP, for example `http://192.168.1.20:8080`.

The relay accepts only same-origin JSON POST requests to `/api/relay`, performs upstream GET requests, validates every redirect and DNS destination, and limits request/response size and duration. It is disabled by default. It handles playlists, EPG and portal data, including bounded gzip/deflate responses and `.xml.gz` files; video remains direct. Decoded custom guides must fit the 16 MB response limit. The relay requires an Origin header. The separate built-in EPG endpoint also supports older TV engines that omit Origin by requiring `X-OTT2-EPG: 1` and validating Host against the bound server socket. An explicit mismatched Origin is rejected. Host/Origin checks expect a literal server IP or localhost, not a reverse-proxy deployment.

## Compatibility

The application scripts are ES5 and use callback-based XHR. The interface and native HTML5 path do not require Promise, fetch, Map, Set, URL, Object.assign or Array.from. Layout does not require CSS Grid, Flexbox or CSS custom properties. The Node server uses `saxes` for streaming XMLTV parsing; this server dependency is not sent to the TV and is outside the browser's ES5 runtime.

The 24 legacy device profiles and 192 URL routes are retained as **input/detection contracts**. They are not a claim that 24 firmware-specific media engines have been implemented or tested. Playback uses the device's HTML5 element, native HLS where available, and locally bundled Hls.js 1.7.3, Shaka Player 5.2.10 and mpegts.js 1.8.2 where runtime capabilities allow them. All three vendor bundles parse as ES5 but need additional APIs; unsupported environments keep the native path. LG webOS 1/2 lack MSE, while later firmware capabilities still need checking on the actual television.

The original font names and all eleven font resources are preserved. The original `LiberationSans-Regular.ttf` is a Roboto alias, not a distinct Liberation face; provenance records this rather than silently replacing it.

AVPlay/OIPF/gSTB and other native firmware playback bridges, proprietary operator protocols, vendor DRM, cloud/dealer services, native installers and eighteen additional translations are outside this delivered interface. See `IMPLEMENTATION-STATUS.md` for the boundary between working code, tested behavior and the broader technical specification.

## Verification

The development tree pins `vendor/ottplay-core.js`, compiled from the shared
OttPlay Kotlin Multiplatform core. Browser and Node guide rules use that same
file; browser archive retention, templates, URL formats and M3U parsing also
delegate to it. M3U accepts up to 100,000 unique entries, 32 Mi UTF-16 code units
per input and 1 Mi per line. Relative URL resolution stays with the browser adapter.
Xtream account/catalog request order, normalization, identities, stream routes
and series/season rules use the same core. The browser retains HTTP/cancellation,
URL codecs and a bounded series cache. The 58 captured Xtream migration cases
preserve its existing wire and catalog behavior.
Stalker/Ministra authentication, request order, pagination, catalogs, folder
hierarchies and create-link interpretation also delegate to this core. The
browser retains cancellable HTTP and URL/JSON codecs; session tokens and opaque
commands are private. Captured baselines cover 52 portal scenarios, with separate
cancellation and stale-generation tests.
XMLTV record normalization, feed merging/affinity, partial-window coverage and
bounded lookup caching also use the core. XML parsing and URL codecs stay here.
Forty-four captured cases preserve metadata ownership, duplicate precedence,
missing-stop inference, shifted schedules and source-scoped identities.
`npm run check:core` verifies its source receipt, artifact hashes and delegation.
Update it through the shared-core distribution script; do not edit the generated
bundle or restore an application-local copy of these rules. The existing ES5
bootstrap supplies its required standard APIs on older hosts.

Development tools were verified with Node.js 26.3.1. Install the pinned server and development dependencies when needed:

```sh
npm ci
npm test
npm run test:browser
npm run test:media-browser
npm run test:provider-browser
npm run test:engines-browser
npm run test:epg-browser
npm run test:browse-browser
npm run test:compat-browser
npm run test:scroll-browser
npm run test:controls-browser
OTT2_TEST_MEDIA=/absolute/path/to/test.mp4 npm run test:startup-browser
OTT2_TEST_MEDIA=/absolute/path/to/test.mp4 npm run test:window-controls-browser
```

Run browser suites sequentially to bound CPU and memory use. `npm test` checks lazy bootstrap order, polyfill behavior, application/provider/PIN/migration/state behavior, all device mappings, relay constraints, ES5 syntax, resource hashes and reproducible vendor assets. One relay test creates two temporary loopback HTTP servers.

The EPG suite exercises automatic loading, channel logos, current/next, explicit-source overrides, failure status and cancellation with synthetic fixtures. Its local artifact is [the EPG browser report](test-results/browser-epg-report.json). Server tests cover streamed gzip/XML parsing, request bounds, matching ambiguity, cancellation and cached results. A successful synthetic run does not certify public-feed availability or coverage of a private operator's channels.

The compatibility suite removes modern APIs independently in the page and Worker, verifies real HLS decoding and actual Worker init/transmux completion with workers enabled, and tests failed/missing Workers and unavailable native MSE/binary APIs. Its [compatibility report](test-results/browser-compat-report.json) records simulated legacy behavior, not physical firmware certification.

For the browse, scroll, controls and provider journeys, set `OTT2_TEST_MEDIA=/absolute/path/to/test.mp4` to a local synthetic H.264 MP4 before running the commands above. The browse, scroll and controls suites require it, and the provider suite needs valid media bytes to verify playback reliably; an empty HTTP response is not a playback fixture. The general UI suite also uses this option.

The startup suite also requires `OTT2_TEST_MEDIA`. It launches Chromium with autoplay permitted to verify returning directly to the saved channel, including repeated URL-query rotations and equivalent M3U broadcast copies, then uses a synthetic `NotAllowedError` to check that blocked autoplay retains Play and the saved mute setting. That rejection fixture verifies the recovery UI rather than a browser's changing autoplay eligibility policy. The [startup browser report](test-results/browser-startup-report.json) records the run and source hashes.

The window-controls suite also requires `OTT2_TEST_MEDIA`. It checks decoded playback, ordinary-layout fallback, macOS/Windows title-bar geometry, navigation, dialogs, the on-screen keyboard, small windows and real Fullscreen API transitions. Its WCO display mode and `titlebar-area-*` CSS inputs are explicitly simulated; native window buttons and dragging are outside that automated check. See the [automated report](test-results/browser-window-controls-report.json) and the separate [installed Chrome app observations](test-results/browser-live-window-controls-report.json).

The [scroll browser report](test-results/browser-scroll-report.json) covers real mouse wheel and trackpad input, legacy wheel events, channel cursor/EPG updates, nested scroll boundaries and uninterrupted decoding. Small-window settings and sidebar checks use 130% text size.

The playback controls suite exercises direct numeric Q exit, dedicated Exit confirmation and cancellation, actual fullscreen transitions, footer timing/expansion by keyboard and mouse, editable-field exceptions, full EPG scrolling and media teardown when tab closure is unavailable. Profile contract tests cover all 24 maps, numeric collisions and rejection of named-key fallbacks. Check the [playback controls report](test-results/browser-controls-report.json) timestamp and source hashes for the tested revision.

The browser tests use Playwright Chromium. `test:media-browser` and `test:engines-browser` also require FFmpeg; the media suite generates HLS/DASH fixtures and verifies actual decoding, audio switching and paused seeking. The engine suite generates HLS/TS/FLV media, checks extensionless URL detection by headers and body signatures, and verifies engine switching while paused. Set `FFMPEG=/absolute/path/to/ffmpeg` when it is not on PATH. The UI test accepts `OTT2_TEST_MEDIA=/absolute/path/to/test.mp4` to include actual MP4 playback. Automated browser tests use synthetic fixtures and temporary local servers. Their reports are local run artifacts: [UI report](test-results/browser-report.json), [provider report](test-results/browser-providers-report.json), [engine report](test-results/browser-engines-report.json), [media report](test-results/browser-media-report.json), and [verification record](test-results/verification.json). Check the recorded run time and source hashes before treating an older report as evidence for current edits.

## Reproduce bundled media dependencies

The page remains build-free. For maintainers, exact npm versions and the lockfile reproduce the local vendor files, licenses and HLS Worker:

```sh
npm ci --ignore-scripts
npm run check:vendors
npm run build:vendors
npm run check:vendors
```

`vendor/runtime-manifest.json` records the lockfile, builder, package versions and all generated asset hashes. `check:vendors` independently derives the expected bytes and rejects changed packages, assets, licenses or stale fingerprints. An intentional dependency upgrade requires rebuilding and repeating ES5, Worker and playback tests; a matching hash alone does not certify a TV firmware.

## Architecture and reference documents

- `TECHNICAL-SPEC.md`: source-derived requirements, acceptance rules and target extensions.
- `docs/FEATURE-INVENTORY.md`: old-player behavior and source evidence.
- `docs/DEVICE-CONTRACTS.md`: routes, key maps, font and platform boundaries.
- `docs/ARCHITECTURE-RISKS.md`: design decisions and old-system risks.
- `docs/PROVIDER-API.md`: independent provider and EPG contracts.
- `docs/EPG.md`: automatic sources, logos, matching, server filtering and limits.
- `MEDIA-API.md`: media lifecycle, capability APIs and actual playback tests.
- `docs/ENGINE-COMPATIBILITY.md`: native/MSE decisions, LG firmware boundaries and MPEG-TS/FLV dependency verification.
- `IMPLEMENTATION-STATUS.md`: delivered scope and verification status.
- `THIRD-PARTY-NOTICES.md`, `assets/provenance.json`: resources and licenses.

Runtime modules have explicit dependencies through the small `OTT2` registry. State, transport, provider parsing, EPG, security, migration, collection operations, view, keyboard and playback are separate modules. The application controller owns cancellations, session generations and teardown. Data from playlists is rendered as escaped text, not executable HTML.

The old project is not modified or required at startup. The MIT application license does not replace third-party resource licenses.
