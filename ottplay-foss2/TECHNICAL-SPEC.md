# OTT-play 2: technical specification

Status: requirements for the new product, not a statement of completed acceptance.
The user requested a new interface and then clarified the approach: first document
the old player's complete requirements, then implement an independent replacement
from scratch without repeating its design mistakes. “HS5” means the previously
specified ECMAScript 5. Behavioral reference: the sibling consumer repository
`ottplay-foss` (resolved from the source checkout's parent), version 1.1.43,
commit `73a7ab59799aa5deb425df4fa4875f6939204e83`.

## 1. Purpose and boundaries

The application plays user-provided IPTV/OTT sources and provides programme
guides, catch-up, a video library and settings. The primary use is an LG television
with a remote; mouse, keyboard and touch must also have accessible control paths.
The interface retains the character of OTT-play: dark surfaces, high contrast
selection, labels readable from a distance, a dense list, visible focus and few
actions before playback starts.

The new project must not load `stbPlayer.js`, use the old player's DOM, or import
its modules, provider scripts or build system. Old source code may be consulted
as documentary evidence of behavior. Hardware key codes and external protocol
formats are contract data, not architecture to copy. Local fonts and explicitly
licensed third-party media libraries are allowed; each resource must have a
separate provenance record.

Native Tauri/Capacitor installers, server integrations, package signing, store
publication and installation on physical devices are separate deliverables.
An Android browser profile does not constitute a new Android APK. A Tizen key
map does not demonstrate AVPlay or DRM operation. Compatibility claims must stay
within the verified playback path.

## 2. Requirement sources

The detailed catalog and function references are in `docs/FEATURE-INVENTORY.md`.
The 24 device contracts and font contracts are in `docs/DEVICE-CONTRACTS.md`.
Architectural risks and their mitigation are in `docs/ARCHITECTURE-RISKS.md`.
Observed behavior takes priority over contradictory legacy comments. Bugs must
not be reproduced merely to achieve superficial similarity.

Each requirement needs four independent states: documented, implemented,
automatically verified, and verified on a device. A successful build or syntax
parse does not replace either form of behavioral verification. Actual readiness
is recorded in `IMPLEMENTATION-STATUS.md`.

## 3. Required compatibility

### COMP-01. Syntax and loading

All browser-executed JavaScript, including inline scripts and dependencies, must
parse as ECMAScript 5 classic scripts. `let`, `const`, arrow functions, classes,
template literals, destructuring, spread, `async/await`, ES modules and mandatory
dynamic imports are prohibited. Application development also uses ES5 so that
reviewed source corresponds to the code devices execute.

Resources load locally in an explicit order: compatibility bootstrap and language
polyfills first, then application module registration and interface startup.
Optional media libraries load on demand only after their prerequisites pass;
opening the catalog must not fetch them. Deduplicate in-flight loads and retain
accepted references independently of late rejected globals. A failed or timed-out
library is quarantined for the page session. The bootstrap must precede every
dependency that uses its APIs.
Worker execution is a separate JavaScript realm: HLS workers must load their own
compatibility bootstrap before Hls.js. Window-level polyfills do not satisfy the
worker contract. A failed or blocked worker must have a controlled main-thread
fallback when the library supports it.

No CDN, Node.js on the television, device-side transpiler or runtime compilation
is required. A source failure must not turn the interface into a blank page.
These limits apply to executable code and interface resources. A public EPG feed
may require the network. A separate Node server may stream large XMLTV files;
its dependencies must not be shipped to the television.

### COMP-02. Runtime environment

Baseline operation must not require native implementations of `Promise`, `fetch`,
`Map`, `Set`, `WeakMap`, `Object.assign`, `Array.from`, `URL`, `TextEncoder`,
WebCrypto, `MutationObserver`, Service Worker or `requestAnimationFrame`.
Install the required language and encoding polyfills before media libraries in
both the window and worker. An optional feature must check its prerequisites
before using an API. DOM/XHR, ES5 Array/Object/JSON behavior and timers are the
baseline contract. Unavailable storage falls back to memory with a visible notice.

Language polyfills cannot supply a missing native MediaSource, hardware decoder,
DRM implementation, native player bridge, network protocol or trusted certificate.
Native binary buffer support must remain distinguishable from emulated arrays
before selecting a backend that exchanges buffers with native media APIs.
Unsupported media prerequisites must preserve an accessible native-only interface
and explain why an optional engine is unavailable. Tested API removal is evidence
of fallback behavior, not proof that a historical firmware or codec works.

### COMP-03. CSS and dimensions

The main layout uses block, inline-block, absolute positioning and tables. Grid,
flex, gap, custom properties, calc, inset, object-fit and modern filters must not
be prerequisites for reaching controls. Decorative effects have simple fallbacks.
Focus remains visible without animations or shadows. Minimum layout checks are
640×480, 1280×720, 1920×1080, 3840×2160, 375×812 and 812×375. Enlarged fonts must
not remove controls. Long strings and translations must not overlap nearby buttons.

An optional desktop Window Controls Overlay enhancement may use scoped `env()`
and `calc()` declarations only inside its supported display-mode media query.
The ordinary page and legacy television layout must not depend on those rules.

### COMP-04. Fonts and languages

RobotoCondensed is the default, with system Helvetica/Arial/sans-serif fallbacks.
Local families are Roboto, RobotoCondensed, Caveat, Liberation, Gabriela and
PTSansNarrow; Fontello resources include EOT/WOFF2/WOFF/TTF/SVG. Preserve family
names. Commands must not rely on emoji or remote icon fonts for their meaning:
every icon has text. Failed font downloads must not prevent navigation. All menus
use the selected family and scale. The reference project has a resource defect:
LiberationSans-Regular.ttf is byte-identical to Roboto-Regular.ttf. The initial
delivery retains the compatible alias and documents its actual family; it must
not claim to include a distinct Liberation font.

Localization is a separate component concern. The old project's complete language
catalog remains a release requirement. Missing translations use understandable
fallback text rather than a resource key. Initial source languages are English,
which is the first-run default, and Russian. Other translations have separate
readiness states. Time formatting respects the time zone; channel names retain
Unicode and their original spelling. Comments, specifications and other project
documentation are written in English; translated user-facing strings are allowed.

### COMP-05. Device profiles

Android, Dune, Enigma2, Edem, HbbTV, Hisense, Inext, LG NetCast, LG webOS,
Infomir MAG, NodeJS, Panasonic, PC, PC2, Philips, Samsung Maple, Samsung Tizen,
Sharp, Skyworth, Sony, Spark, TCL, Toshiba and Vewd. Support automatic detection
and an explicit `/f/<profile>/` route. An arbitrary device string must not select
an unknown script URL. Priority is an explicit known profile, a verifiable
capability, a specific user agent, a generic user agent, then HTML5 fallback.
Probes must not change volume, playback, device settings or credentials.

The required product families include Samsung Tizen, LG webOS, Panasonic Viera,
Infomir MAG, Dune HD, Android TV and desktop browsers. Their browser profiles and
native playback bridges have independent acceptance criteria. Any extra device
families found in the reference documentation must be inventoried before a wider
support claim is made.

### COMP-06. Numeric input and semantic actions

One input normalizer resolves the selected profile's numeric codes to semantic
commands. Accept a finite positive integer `keyCode`, falling back to a finite
positive integer `which` only when `keyCode` is absent or invalid. A valid but
unmapped `keyCode` remains unhandled; it cannot fall back to `which` or a PC map.
Zero denotes an absent key. The runtime never reads modern `KeyboardEvent.key`
or `KeyboardEvent.code`, and named-key-only events do not dispatch commands.
Keyboard layout and misleading browser labels cannot override a remote code.

`RETURN` maps to `back`, dedicated `EXIT` to `exit`, and nonzero `POWER` to
`quit`. Return has priority when Return and Exit share a value: Android code 4
remains Back. Info uses each profile's value: PC/MAG 73, Samsung Maple 99,
LG/Tizen 457 and Android 165. Maple 73 remains Stop; Android 19 remains Up.
An explicitly selected TV profile must use its remote codes even when opened
in a desktop browser.

Only `pc`, `pc2`, `nodejs` and `edem` extend their observed maps with
`FULLSCREEN=76`, `SPACE=32`, `CONTEXT_MENU=93`, `TAB=9`, `PAGE_UP=33`,
`PAGE_DOWN=34`, `HOME=36` and `END=35`. These resolve to `fullscreen`,
`playPause`, `menu`, `tab`, `pageUp`, `pageDown`, `home` and `end` respectively.
Those profiles also add `NUMPAD0`–`NUMPAD9` at codes 96–105, alongside top-row
digits 48–57, and multimedia aliases `MEDIA_PLAY_PAUSE=179`, `MEDIA_STOP=178`,
`MEDIA_NEXT=176`, `MEDIA_PREVIOUS=177`, `MEDIA_VOLUME_UP=175`,
`MEDIA_VOLUME_DOWN=174` and `MEDIA_MUTE=173`. The actions are `playPause`,
`stop`, `next`, `previous`, `volumeUp`, `volumeDown` and `mute` respectively.
Multiple codes may select one semantic action without replacing existing codes.
These desktop profiles retain `POWER=81` and `INFO=73`; other profiles do not
inherit Q/L/I aliases, keypad/media aliases or standard browser navigation codes.
Maple 99 therefore remains Info rather than desktop keypad digit 3. Exact source facts
and additions are distinguished in `docs/DEVICE-CONTRACTS.md`.

`PRECH` maps to `previousChannel`, restoring the previously confirmed live
broadcast through source and playback PIN checks. `PREV` and multimedia Previous
remain adjacent-item navigation. Dedicated `AUDIO`, `SUBTITLE`, `ASPECT`, `ZOOM`
and `PIP` become semantic actions with explicit collision priority. Existing
Stop/fullscreen mappings win where a legacy profile shares a code.

Shared nonzero PLAY/PAUSE values and explicit combined transport values map to
`playPause`, preserving separate Play and Pause where supplied. The controller
owns context, editable-field exceptions, modifiers, repeat suppression and
held-key tracking using the validated numeric code. The normalizer has no UI
or playback side effects. Ctrl/Alt/Meta combinations stay with the browser.

Held-control recovery is selected by explicit profile metadata:
`keyReleaseTimeout=0` for the four desktop profiles requires keyup or focus loss;
other profiles use a 350 ms inactivity bound to recover from lost or absent
keyup. Repeated keydown refreshes that timer; an explicit `repeat` event does
not activate the control again. Keyup, focus loss and teardown clear held state.
The policy does not establish that every physical remote lacks keyup or uses the
same repeat cadence; hardware acceptance must verify those event patterns.

## 4. User journeys

### UX-01. First run

The empty state provides understandable actions: connect a playlist/provider,
open a local file and configure the interface. Synthetic demonstrations are
clearly labeled, do not replace real channels and do not persist invented EPG
or viewing counts. The user can finish local configuration without the internet.

### UX-02. Home screen and navigation

Sections are television, favorites, programme guide, video library, sources and
settings. Display actual data from the connected source. Every visible action
works or explains a specific unavailable capability. Hidden features must not be
presented as working. Large lists use bounded pages or virtualization; 10,000
channels must not produce 10,000 DOM cards.

The left section menu is collapsed by default. A visible Menu button and the
remote Menu command open and close it. Opening focuses the current section;
closing restores the previously selected channel or an available content control.
Back closes an open section menu before returning to playback. Selecting a
section collapses the menu and focuses that section's usable content. Hidden
section controls must not receive keyboard or remote focus.

Focus is separate state: screen, region and stable item ID. Restore it after EPG
updates, page changes and return from menus. When the focused item is removed,
choose the closest available item. Pointer and remote selection stay synchronized.
Tab/Shift+Tab remain inside an open dialog. One physical key produces one semantic
command.

### UX-03. Playback

Clicking a live channel or pressing OK on it starts playback immediately, subject
to the existing PIN gate. Back closes the current interface layer and retains
channel-list navigation; it is distinct from the dedicated Exit command.
Channel keys change channels; numeric entry has an explicit timeout and confirmation.
Play/Pause/Stop/Seek/Volume/Mute operate only when their capabilities are available.
The information panel shows the channel, programme, time and buffering state.
Text editing cannot change channels or volume. Changing screens must not reset
playback without a user command.

Clicking the full playback video opens the channel list with the same media
session continuing in the preview. Clicking the preview expands the currently
playing video to the full application window, just like Resume. It must not tune
the highlighted channel, reconnect the stream, unpause it or enter native OS
fullscreen. Clicking that expanded video returns to the channel list. An open modal continues to
own input; video clicks must not dismiss it or bypass its gate.

The dedicated Exit action leaves native fullscreen first. In windowed mode it
cancels an open dialog; otherwise it opens a Yes/No quit confirmation with No
selected. The profile `quit` action, including desktop code 81 (Q) and a
delivered nonzero Power code, exits immediately without confirmation, even from
fullscreen or an open dialog. Text editing and modified browser shortcuts retain
their existing input ownership. Desktop fullscreen code 76 toggles actual
fullscreen state. Direct quit and confirmed Exit share idempotent cleanup: save
an available VOD bookmark, retain the last channel, cancel outstanding work and
release media before attempting window closure. A browser that refuses closure
shows a stopped exit screen.

Info shows the playback footer and then expands its current EPG description on
the next activation. Bottom-video clicks use the same progression. Each
activation restarts the six-second deadline used when playback starts, including
while paused. An autoplay-blocked session keeps the footer and Play available
until playback starts, then resumes the same six-second deadline.
A focused expanded description consumes semantic directional
actions for scrolling on every remote profile. Page Up/Down and Home/End also
scroll when supplied by that profile. These events cannot seek, move focus into
the background or change channels; they do not depend on browser-native
scrolling for desktop arrow codes.

### UX-04. Compact LG interface

The main channel screen is an aligned row list rather than a grid of large cards.
In television layout, show channel number/name and the current programme. The
right panel contains the playing stream's preview and the description and next
programme of the highlighted channel. Missing EPG must not be replaced with
invented data. Target at least 20 visible rows at normal scale on 720p/1080p TV
viewports; calculate page capacity from available height and reduce it for enlarged
text or window controls. Combine channel count, filters and optional EPG status in
the main heading, and omit the redundant channel column heading. Put the compact
page counter in that heading as well; TV/favorites must not reserve a separate
Previous/Next row. Minimize the gap above the heading while respecting native
window controls. EPG status may
be hidden when horizontal space is limited; required controls remain reachable
with the remote. A narrow portrait layout may hide secondary columns and retain
larger touch targets. High contrast selection fills the entire row.

Up/Down select channel rows. Left/Right and CH+/CH− change pages, preserve the
row index and clamp it on a shorter last page. Menu toggles the section sidebar.
Up from the first channel wraps to the last channel in the current filtered
collection; Down from the last wraps to the first. This also applies to favorites
and collections that fit on one page. Page commands remain clamped at the ends.
Menu followed by Up from the first section closes the sidebar and focuses the
visible Menu button, keeping the header controls reachable with a remote.
Right from the sidebar closes it and returns to the selected row. Returning from
playback selects the playing channel on its corresponding page.

The video continues in a preview while moving the cursor to another channel
updates only its EPG. Back, when no menu is open, and Resume return to full playback
of the same media element without another resolve/load/play; paused state remains
unchanged. Info opens the complete description and channel actions.

Long selected-programme details scroll automatically inside the bounded right
panel after a reading pause, at a slow constant speed. Pause at the bottom before
returning to the beginning. Changing the selected programme starts from the top;
unchanged EPG refreshes retain the reading position. Hidden pages, modal dialogs
and inactive panels must not scroll. Manual scrolling temporarily pauses automatic
movement. Do not move focus, change channels, restart playback or scroll the outer
portrait page. Cancel timers and listeners when the view is destroyed.

The remote's yellow button opens the engine menu during playback. The same
function is available through Engine, playback options and Settings. OK displays
the media control bar focused on Play/Pause; Left/Right choose a control, OK
activates it and Up/Down hide the bar. No capability depends on the presence of
a particular colored button on the remote.

### UX-05. Installed desktop window controls

Ship a local web app manifest with a stable root identity, root launch URL and
scope, local icons, `standalone` fallback and a `window-controls-overlay` display
override. This browser installation is separate from a native installer. Preserve
same-origin browser storage and existing channel restoration; an existing app
update must not require uninstalling it or resetting settings.

When the browser enables the overlay, video occupies the full client viewport.
Only the browser-provided free title-bar rectangle is a draggable region. It
has no focus target, controls or painted background over the video. Home-screen
content, modal controls and the on-screen keyboard start below the native buttons;
the playback footer remains bounded and scrollable in short windows. Fullscreen
must remove both the drag region and title-bar insets, including during a delayed
display-mode update. Leaving fullscreen restores the appropriate window layout.

The browser owns overlay availability and its Show/Hide title bar preference.
The app does not replace native buttons or require WCO JavaScript APIs, a Service
Worker, offline caching or a changed bootstrap order. Ordinary tabs and devices
that ignore the manifest or display mode retain the existing ES5 application.

## 5. Sources and data model

### SRC-01. Sources

M3U/M3U8 from URLs and files: BOM, CRLF/LF, quoted attributes, commas in attributes
and names, relative URLs, `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, XMLTV URLs
and catch-up attributes. An invalid entry must not break the remaining channels;
the report shows accepted and skipped record counts.

Xtream Codes: server address and credentials, live channels, categories, VOD,
series/seasons/episodes, EPG and catch-up where the API supports them. Stalker:
MAC/portal, handshake, profile, categories, channel pages and obtaining a playable
link before playback. Session tokens are excluded from UI/logs/exports by default.

Named providers from the reference player remain in the inventory. They must not
load as arbitrary executable JavaScript plugins. Use a generic protocol only when
equivalence is established. Proprietary adapters require their own contract,
fixture responses and explicit readiness state.

### SRC-02. Identifiers and source switching

Channel IDs are stable for a source ID and external identifier/URL; they do not
depend on channel order or translated names. Handle duplicates explicitly.
Favorites, history and PIN lists must not mix sources. Switching sources cancels
previous requests, and their late callbacks cannot alter the new screen. Unknown
imported records are preserved or rejected with an understandable result. Silent
loss of settings is prohibited.

### SRC-03. Network layer

Use one XHR client with timeout, cancellation, size limits and clear HTTP/network/
format/CORS error categories. Retries are bounded and cancellable. Requests must
not directly mutate UI objects. Validate every URL scheme; `javascript:` and
executable HTML are prohibited. Treat logos, names and descriptions as untrusted
data.

A normal web origin cannot bypass CORS. If a local proxy is required, it is an
explicitly configured transport with restricted upstream hosts and methods.
Configuring remote control must not turn the web server into a public write API.

## 6. Playback

### PLAY-01. States and ownership

States: idle → loading → playing / paused / buffering → ended / error → idle.
One MediaSession owns the current engine, listeners, timers and retry budget.
A load command creates a generation ID; events from old sessions are ignored.
Destroy/stop are idempotent. User pause takes priority over reconnect. Autoplay
rejection from `play()` requires an explicit user action. Keep the footer visible
with Play focused until playback begins, and preserve the saved sound setting
rather than silently muting to bypass the browser's autoplay policy.

### PLAY-01a. Startup playback

Remember the last confirmed live channel immediately as `{ sourceId, id }`
plus available original provider `tvgId`, `tvgName`, `name` and `group` metadata.
Each metadata string is bounded to 512 characters; local presentation overrides
must not replace these identity fields. Do not persist a resolved stream URL,
provider token or programme snapshot in this reference.
Archive playback remembers the underlying channel for live playback on the next
launch. This record is independent of history and the source currently being
browsed. Stop, clearing history and a failed attempt to play another channel must
not discard or replace the last confirmed channel.

At startup, select the saved channel's source and load its current playlist. Use
an exact channel ID first. If it has changed, find an unambiguous match from the
saved provider TVG ID, TVG name, channel name and group within that same source.
Recover available TVG identity from a recognized legacy M3U ID and recover the
name for an older ID-only record only from its matching-ID history entry.
Preserve quality and regional suffixes; shared TVG IDs must not cause selection
of another quality variant when the saved variant is absent or ambiguous.

A recognized M3U TVG reference may match equivalent copies of the same broadcast.
After source, media kind and saved name/group matching, accept multiple copies
only when their recognized M3U identities contain the same nonempty,
case-sensitive TVG ID and their nonempty channel name matches the saved name.
Every raw metadata key and JSON value other than `id` and `url` must agree across
the copies, including group, TVG name, parental flags, catch-up settings and any
future playback attributes. Select the first equivalent copy in the current
source order and resolve its fresh URL normally. This exception does not apply
to missing TVG identity, an unnamed legacy variant, other provider types or
differing quality, regional or playback metadata. It preserves the broadcast;
it does not promise the same endpoint when several equivalent copies exist.

Transfer a protected old ID's PIN requirement to the matched refreshed ID before
resolving playback through the normal provider and authorization gate. Open the
video view and start playback; opening that view does not request DOM fullscreen.
Resolve fresh stream URLs instead of persisting expiring URLs or provider tokens.
If the channel is absent or ambiguous, leave the list available without
substituting another entry. Consume the initial restore attempt on completion
or failure. User actions cancel a pending attempt, and later source loads cannot
revive it.

When no saved live-channel reference exists, retain exact-ID legacy history
lookup and available VOD bookmark behavior. History does not record media kind
and may outlive a removed source, so it must not trigger metadata matching to
a live channel. This fallback does not require startup expansion of nested VOD
catalogs and does not override a saved live channel.

### PLAY-02. Engines and capabilities

Use HTML5 video for supported containers and native HLS; use Hls.js only when the
engine and that library version are compatible. DASH/DRM use compatible engines
with separate verification. The capability result describes pause, seek, tracks,
subtitles, PiP, fullscreen and DRM. A successful bridge call does not count as
successful playback without confirmation. Unsupported formats produce visible
errors.

Native bridges use the same MediaSession contract and do not mutate domain
objects. Device names alone cannot establish AVPlay/MAG/Capacitor/Tauri support.
Verify hardware decoders, DRM and certificates separately on the relevant platform.

### PLAY-02a. Automatic and manual engine selection

Auto is the default and considers the device profile and detected stream format.
LG HLS tries native playback first; Chromium uses a supported HLS MSE engine.
DASH, raw HTTP MPEG-TS/FLV and ordinary files route to suitable available backends.
An independent upstream transmuxer with ES5 syntax may handle MPEG-TS/FLV; this
does not promise an additional codec decoder.

Detect extensionless URLs through Content-Type or initial signatures using a
cancellable request with time and size limits. CORS or probe failures retain an
honest unknown result. Stop, channel changes and destroy cancel the probe. A late
result cannot start an old session. Check MIME, HLS/DASH signatures, TS and FLV,
not just the URL suffix.

The menu offers Auto, Native, Hls.js, Shaka and MPEG-TS, marks unavailable choices
and shows the active backend. Persist manual engine selection without silently
substituting it. A separate persisted Auto/HLS/DASH/MPEG-TS/FLV/MP4 format setting
helps when formats are hidden. Explain that preferences apply to subsequent
channels. The OSD shows the preference, backend, format and position.

Auto permits bounded fallback when the selected engine fails or never advances.
Engine changes release listeners, timers and adapters, preserve user pause and
VOD/archive seconds where seek is available, and preserve distance behind the live
edge across different live time origins. Retain a pending live offset until a seek
succeeds. Changes do not revive a stopped stream or bypass PIN checks.
Network, CORS, codec or access errors must not be concealed by a claim of universal
compatibility.

### PLAY-03. Recovery

Live streams have bounded recovery after network errors or stalls. Parsing,
authorization and unsupported-codec errors must not trigger endless retries.
Channel changes, pause, stop and destroy cancel retries. A single failure must
not reload the application or remove the source. Repeated progress events with an
unchanged media clock cannot extend the watchdog indefinitely. Missing video
triggers recovery only with positive video evidence, preserving genuine radio and
unknown manifests. A native HLS master inspection is bounded and cancellable, and
only successful HLS responses may supply codec evidence. HLS media-error recovery
and downshift occur at most once per session. Use conservative, bounded TV buffers.

### PLAY-04. Advanced features

Audio/subtitle selection, aspect/zoom, buffering, catch-up playback, VOD bookmarks,
continue watching, PiP and sleep timer use separate commands. An unsupported API
makes its control unavailable with an explanation. PiP must not create a hidden
second audio session. Update bookmarks only after confirmed playback/seek, and
never write them to a new channel through a late callback. Flush VOD bookmarks on
page hiding/unload. Digits 0–9 seek to 0–90% of a known VOD/archive duration.

Remember audio/subtitle choices and picture preferences per source and channel,
with at most 200 recent records. Match tracks by language and label, reject
ambiguity, and reuse numeric IDs only without metadata on the same backend.
Reapply after session changes and late track discovery, including explicit subtitle
Off. Live preference identity may follow the same unambiguous provider identity
as startup restore; never persist resolved stream URLs for this purpose.

## 7. EPG, catch-up and VOD

EPG-01: XMLTV supports time zones, multiple sources and cancellable refresh.
Match exact `tvg-id`, then unique `tvg-name`, then unique channel name after case
and whitespace normalization. If neither name matches, allow a unique alias with
standalone HD/FHD/UHD/4K removed from the beginning/end. Do not remove region,
language, time shift or additional words. Ambiguous names must not merge silently,
including after server filtering. Current/next are calculated from time intervals;
expired data is marked. The XML parser does not execute scripts.

EPG-01a: source priority is explicit user URLs, playlist URLs, then a built-in
public XMLTV feed as in the reference player. Clearing the user field restores
automatic selection. The UI distinguishes loading, unmatched channels, empty/stale
schedules and source errors. Refresh cancels its predecessor; a failed feed must
not hide successfully loaded feeds.

EPG-01b: store each XMLTV channel icon with its ID and all display-name aliases.
Use the same matcher for programmes and icons. Validate HTTP(S) URLs and resolve
relative references against the source document. The EPG icon takes priority over
the playlist logo; a failed image must not expand its channel row.

EPG-01c: a separate Node endpoint processes the large built-in gzip feed. The TV
receives bounded XMLTV for requested channels, including metadata required to
preserve ambiguity. The endpoint does not accept arbitrary upstream URLs or
credentials. `docs/EPG.md` defines limits for request bodies, decompression, XML
fields, duration, programme windows and responses. Caching and cancellation must
not mix channel sets. Server dependencies do not alter the UI's ES5 contract.

EPG-02: current/next programmes, details, a daily list/grid, title search and
reminders. Removing an event removes its reminder timer. Refresh retains position
and focus. Missing EPG must not produce fictional programmes. Current/next update
from the clock every 30 seconds on the visible main screen; this is not a request
to download XMLTV at that frequency. Cache channel matching and current/next
results within explicit bounds, invalidate at programme boundaries and guide
changes, and release old guide references when sources or imported state change.
For a structurally unchanged TV/favorites view, update only changed EPG fields;
retain row, focus, logo, preview and description scroll/timer identity.

ARC-01: catch-up availability depends on the channel contract, programme time and
provider limit. The source adapter constructs catch-up URLs; do not guess a
universal URL. Live, archive and VOD are explicit modes, not magic numbers.

VOD-01: categories, catalogs, seasons, episodes, search, descriptions, parental
access, history, favorites, resume position and confirmed seek. Opening a folder
must not treat it as a media URL. Canceling PIN entry restores list state.

## 8. User data and access

DATA-01: multiple named favorites lists, an active list, bounded viewing history,
and rename/delete without losing other lists. A channel removed from the current
playlist must not be reassigned to another channel by its index.

DATA-02: versioned schema, validation, migrations, one atomic snapshot write, and
protection against quota/security exceptions. Validate imports before replacing
state. Exports omit secrets unless explicitly selected. Importing the old format
requires a separate converter with a preview; never automatically modify legacy
localStorage. The new player uses an independent namespace.

DATA-03: validate `lastChannel` as a source/channel identifier pair with optional
`tvgId`, `tvgName`, `name` and `group` identity strings. Trim and bound each
metadata string to 512 characters; discard unsupported fields and non-string
metadata. The source must exist in the validated source list; opaque channel
IDs may contain up to 4096 characters. Delete the reference when its source is
removed, and clear it from ordinary exports together with source data. Full
exports retain the validated reference without resolved stream URLs, tokens or
programme metadata.

AUTH-01: separate gates protect restricted channels, settings and source changes.
Alternative playback controls must not bypass PIN checks. Storage must not contain
the plaintext PIN. Local settings protection must not be presented as protection
against a user who controls storage/devtools. A weak platform without appropriate
cryptography must not receive fictional secure remote-command authentication.
Passwords must not appear in logs or popup text.

## 9. Settings

Use separate fontFamily/fontScale/rowsPerPage values instead of ambiguous fontSize.
Settings include language, time/time zone, font, scale, contrast/colors, density,
icons, name/EPG/progress/archive display, OSD timeout, volume, channel up/down
behavior, startup/restore, buffering, history limits, parental gates, sleep timer,
EPG sources and catch-up parameters. Apply a setting through state to one owning
component. Do not keep two mirrors with different values. Reset has an explicit
scope and confirmation; it must not clear the entire origin.

Startup restore defaults to enabled. Settings without `startupVersion: 1` migrate
once to enabled restoration and record that version. Preferences must retain an
explicit opt-out made afterward. An import requiring parental-control review
sets restore to false and records the version so migration cannot re-enable it.

## 10. Remote control and diagnostics

REMOTE-01: command interface: validate → authenticate → authorize → dispatch.
Remote mutation is disabled by default. Device ID and bearer credentials are
separate values. HTTP/queue/swop/cloud integrations are connected separately.
Repeated delivery uses an idempotency key. Commands must not execute arbitrary
JavaScript/shell or open arbitrary URLs. Remote changes use the same controller
and PIN gates as the physical remote.

DIAG-01: bounded local ring log, opt-in debugging and secret redaction for URLs,
headers, PINs and provider payloads. Diagnostic export previews its contents before
saving. A network error must not display a URL password on the television.
Diagnostics do not depend on an external server's availability.

## 11. New architecture

One technical namespace, `OTT2`, contains the module registry, not mutable player
state. Modules are classic ES5 factories with explicit dependencies. Circular
dependencies and duplicate registration produce explicit load errors.

- Runtime: module registration and dependency resolution.
- State/repository: normalized user data and versioned persistence.
- Providers: source parsing/loading and normalized channels/media references.
- EPG: parsing, matching, indexes, time and catch-up contracts.
- MediaSession: sole owner of engine lifecycle and confirmed playback states.
- Devices: verified detection and physical-key normalization into commands.
- Controller: commands, gates, screen changes and cancellation of stale operations.
- View: DOM and focus; no storage reads, native APIs or stream URL construction.
- Transport: XHR/proxy/native HTTP with one cancellable contract.

Do not monkey-patch another module's functions, use global provider callbacks,
synchronize duplicate arrays, build HTML templates from unchecked provider
strings, or build by stripping import/export and concatenating shared bindings.
The UI talks to playback through the controller, not through card-level video
calls. Standards polyfills installed by the dedicated compatibility bootstrap are
separate from prohibited application-module monkey patches.

## 12. Acceptance checks

1. ES5 grammar for every delivered script, not only the entrypoint, including
   compatibility resources, media dependencies and worker entrypoints.
2. Startup without native Promise/fetch/Map/Set/Object.assign/Array.from; verify
   required polyfills before dependencies in both window and worker. Throwing
   storage, missing native media APIs and offline operation retain a usable UI.
   Verify worker decode or controlled worker fallback separately from UI startup.
3. All 24 profiles, conflicting user agents, explicit routes, null/throwing bridge
   probes, numeric codes to semantic commands, and input/dialog focus isolation
   from media controls. Verify `keyCode`/`which` validation and precedence, zero
   and unknown values, throwing event getters, misleading `key`/`code` labels,
   and rejection of named-key-only events. TV maps must not inherit PC aliases.
   Include Android Return/Exit and Maple navigation/transport/color/keypad
   collisions, desktop keypad/media aliases, and multiple codes for one action.
   Verify strict desktop release, bounded remote recovery after lost keyup, repeat
   timer renewal, explicit repeat suppression and cleanup on blur/teardown.
4. M3U quoted commas/BOM/Unicode/relative references/duplicates/10,000 channels;
   HTTP/timeout/cancel errors and source A→B with a late A callback.
5. Media A→B with stale playing/error events, pause during retry, stop during load,
   double destroy, bounded retries and autoplay rejection.
6. XMLTV offsets and DST timestamps, exact and ambiguous matches, and boundaries
   for current/next programmes and catch-up availability.
7. Corrupt/quota/unavailable storage, schema validation, migration, export/import,
   HTML/XSS in names/descriptions and absence of secrets from diagnostics.
8. Browser journeys: first run → source → channel → fullscreen → video click →
   channel list; preview click expands window playback and preserves pause; favorites → restart →
   persistence; EPG → catch-up; VOD → resume; every font setting → restart;
   mouse/Tab/remote/touch control paths. Menu toggles sections and restores cursor;
   Back closes sections before leaving the list. No extra media load occurs.
   Wheel and trackpad input page channel/favorite/video lists while retaining the
   cursor and selected EPG. Native overflow scrolls before pagination; nested
   fields, dialogs, the sidebar and complete EPG details own their scroll input.
   Check old WebKit/Gecko wheel events, page bounds, enlarged text and small
   windows. Scrolling and background guide refresh must preserve playback.
   Desktop code 81 and a delivered profile Power code exit immediately without
   opening a confirmation, including from fullscreen and non-editing dialogs.
   Code 76 toggles native DOM fullscreen. Dedicated profile Exit leaves
   fullscreen without requesting exit; in windowed mode it cancels a dialog or
   opens a Yes/No confirmation with No focused. Return retains navigation,
   including Android's shared Return/Exit code 4. Editable text and modified
   shortcuts retain ownership. Direct quit and confirmed Exit must release
   media exactly once even if the browser refuses window closure, while keeping
   the last channel and an available VOD bookmark.
   Reopening restores the last confirmed channel and its source directly into
   the video view through normal resolution and PIN checks. Cover browsing a
   different source, Stop, cleared history, failed later playback, missing
   channels, rotating URLs and IDs, legacy matching-ID history recovery,
   duplicate TVG quality/regional variants, equivalent copies of the same M3U
   broadcast across repeated query rotations and source reordering, rejection
   of differing group/playback metadata or missing TVG identity, protection on refreshed IDs,
   user cancellation during initial loading and the persisted opt-out.
   Autoplay rejection keeps Play visible without changing the saved mute setting;
   successful user-initiated playback restores the ordinary footer timeout.
   Profile Info codes and bottom video clicks show then expand the current EPG
   footer, resetting the same six-second deadline used at playback startup.
   Focused description scrolling must use semantic remote actions, preserve
   channel and position, and work without native desktop arrow-key behavior.

9. Layout screenshots at all required sizes, local font loading, no invisible or
   overlapping required controls, and no horizontal overflow.
10. Physical smoke profiles: exact model/firmware, launch path, real stream/codec,
    remote, audio, pause/seek, sleep/resume and sustained playback. User-agent
    emulation does not satisfy this check.
11. Compact LG layout: at least 20 TV rows at normal font size in 720p/1080p, a
    single combined heading, enlarged text adaptation, slow automatic EPG scrolling,
    visible row focus, current/next EPG and remote paging; English/Russian and
    RobotoCondensed/system fallbacks. Test both collapsed and expanded sections.
12. Extensionless HLS/TS/FLV in Chromium: header/body detection, actual decode,
    manual engine/format after reload, yellow and Engine/Settings paths, unavailable
    engine APIs, paused engine changes, and Stop during probing/teardown. Real LG
    native HLS is separately covered by item 10; desktop Chromium cannot replace it.
13. EPG: M3U without an XMLTV header chooses the built-in source; explicit URLs and
    headers take priority; clearing the setting restores automatic selection.
    Verify real `<icon src>` values and DOM images, current/next, relative URLs,
    gzip/corrupt gzip, exact/quality/ambiguous matches across feeds, metadata-only
    channels and preservation of ambiguity after server filtering. Cancellation
    releases the download; response/decompression limits are testable.
14. Installed desktop window controls: manifest identity, fallback mode, local
    icons and explicit HTTP routes; ordinary-layout fallback; left- and right-side
    button rectangles; full-window video; aligned browsing preview; modal and
    keyboard access; small-window footer overflow; and real fullscreen entry/exit.
    Record simulated WCO media/environment inputs separately from native desktop
    observations. Verify an existing browser app update, Show/Hide title bar,
    playback continuity and saved-state retention without clearing user data.
    Native dragging and physical TV/STB behavior need their own evidence.

Release threshold: required implemented features have no known blockers and
unverified platform scenarios are listed. “All features of the old player” may be
claimed only after the complete inventory is closed, including provider protocols,
native integrations and hardware checks. A working new foundation is not described
as a completed port.

## 13. Implementation sequence

First establish this specification and the contract inventory. Then implement an
independent executable vertical journey: source → catalog → command → playback →
error/recovery → storage. Follow with EPG/catch-up, favorites/VOD, settings,
parental access, protocol adapters and platform capabilities. Keep the application
runnable and verify behavior at each step. Do not defer its first execution until
a large final port has combined every module.

The final stage is an evidence-based compatibility matrix, hardware testing,
packaging and release. User credentials, local services, the installed application
and original `ottplay-foss` are not changed automatically.

## Delivery clarifications dated 2026-09-14

The entire interface defaults to English. An explicit Russian selection survives
restart; an unknown/missing language falls back to English. Loading text, startup
errors and persistent media controls are part of this contract. Languages in the
legacy catalog beyond English/Russian remain a separate extension.

`IMPLEMENTATION-STATUS.md` records currently implemented journeys and firmware,
provider and external-service boundaries. This broader specification does not
assert that every integration is already available.

The user identified LG TV as the priority platform and requested a denser
interface, automatic engine detection and manual engine switching. These are
captured in UX-04, PLAY-02a and acceptance checks 11–12. Successful playback of one
real channel in Chrome is separate from physical LG acceptance.

The latest navigation requirements add direct live-channel click/OK playback,
video-click access to the channel list, continuous preview playback and a hidden
section menu controlled by the visible Menu button or remote Menu key. The
compatibility update requires polyfills before media libraries and inside HLS
workers. English is required for comments and project documentation. These
requirements do not remove hardware/API limitations or the separate physical
device acceptance boundary.

Input handling uses only numeric event codes and the selected device profile.
Desktop labels such as Q, L and I describe the usual keyboard caps for codes
81, 76 and 73; they are not string comparisons or universal remote aliases.
Return, dedicated Exit, Power, Info and description scrolling use the same
semantic action path across old and modern devices.
