# Architecture risks and acceptance rules

The original `ottplay-foss` is a source of observable requirements. Its application JavaScript, linker, provider scripts and test implementations are not part of the new player. The historical source pointers below identify classes of failure already guarded against in that project; they do not assert that those failures remain open there.

## 1. Coupling through mutable globals

In the reference project, `src/app/state.ts:40` holds shared selection and list data. `src/provider/index.ts:1123` clears channels, categories, EPG, favorites and VOD state together. `scripts/classic-bundle.cjs:1` fixes module order and creates import readers at line 92. Initialization order and object identity therefore become an implicit API.

Rules for the new implementation:

- `window.OTT2` is the application registry. Module state belongs to closures; `OTT2Compat` is a separate bootstrap capability report.
- Modules declare dependencies through `require`; missing and circular dependencies fail explicitly.
- A provider returns a new normalized value through a callback. It does not mutate the screen, DOM, settings or active playback.
- One controller owns application state. Rendering receives snapshots and returns actions through an explicit API.

Acceptance: loading a provider must not mutate unrelated globals or DOM; independent provider instances must remain isolated; reordered request completions must not change the accepted source.

## 2. Late responses, closed screens and channel changes

The reference `src/channels/index.ts:2862` stores the accepted VOD screen separately from provider globals. Line 2892 checks request context, source and URL; line 2904 explains that a late provider may already have overwritten shared data. Session numbers at `src/core/index.ts:155`, `:994` and `:1247` guard stale HLS/Shaka callbacks.

Rules:

- Each asynchronous operation belongs to one instance and session.
- `cancel()` is idempotent, cancels transport and suppresses callbacks and dependent requests even if transport completes later.
- Changing channels first releases the old engine's handlers, timers and resources.
- A failed catalog load must not discard an accepted catalog before the user chooses another action.
- A callback runs at most once; repeated XHR events cannot produce duplicate success or failure.

Acceptance: A → B → late success/failure from A; cancellation before a response and during a synchronous callback; Stop during engine preparation; duplicate transport callbacks; one failed request in a catalog sequence.

## 3. Synchronous cache hits and DOM lifecycle

The reference `src/channels/index.ts:1589` defers EPG handling because synchronous cache hits previously updated rows before DOM creation. `src/ui/index.ts:848` builds the screen and line 1125 manages selection.

Rules:

- Data changes must not require an existing DOM. Accept state before rendering the visible portion.
- Selection follows a stable record ID; its filtered-array position is derived.
- Filtering, deletion and group changes keep the selection visible. Empty lists have an explicit state without negative indexes.
- Handle empty/partial last pages, long titles and repeated rendering of the selected row.
- Up/Down/Left/Right/OK/Back work without a mouse; repeated initialization cannot add duplicate listeners.
- Sidebar visibility is independent of channel selection and playback. Closing it restores a visible focus target.
- Clicking video opens or retains the list without replacing the media element. Moving the cursor changes selected EPG details; choosing a channel starts playback.

Acceptance: 0/1/N/N+1 records for page size N; filtering the selected row; group change on the last page; cache hit before first render; one action per key event; sidebar toggle and preview clicks preserve focus, source and pause state.

## 4. Unavailable or damaged storage

The reference `src/storage/index.ts:55` handles storage failure after initial detection. Lines 80 and 92 cover read exceptions, quota and fallback storage.

Rules:

- Read `window.localStorage` itself inside `try`.
- Guard every read/write separately; object presence does not establish usability.
- Invalid JSON and unknown schema versions cannot prevent startup.
- Session memory retains updated settings after disk-write failure; the UI must not promise persistence across restarts.
- Favorite IDs include a source namespace. Identical `tvg-id` values from different subscriptions stay separate.
- Never use `localStorage.clear()` to remove other applications' keys on the same origin.

Acceptance: throwing getter; failed get/set/remove; quota exhaustion after startup; invalid JSON; unknown schema version; colliding IDs from two sources.

## 5. Device detection and language compatibility are separate from playback

The reference `src/plugins/native-bridge.ts:8` selects a registered bridge or web fallback. `src/core/index.ts:888` and `:916` separate a playback request from engine startup. A device adapter file alone is not proof of physical TV operation.

Rules:

- Model/UA detection chooses an input profile, not guaranteed codec, DRM, PiP or transport support.
- A native adapter exposes operations it can actually perform. Unsupported operations return an explicit result.
- Missing or throwing APIs result in an error or a compatible engine fallback; never report invented success.
- Report ES5 grammar, simulated API removal, desktop decoding, emulators and physical devices as distinct evidence.
- Capture native binary capabilities before core-js. Emulated typed arrays cannot establish MediaSource compatibility.
- Load the shared language bootstrap before any media library. A Worker has a separate realm and must import the bootstrap before its own HLS payload.
- Missing Worker support uses main-thread transmuxing. Worker startup failure must recover inline. Reported asynchronous worker errors disable that path for later playback attempts in the same player instance.
- Do not emulate native MSE, hardware decoders, vendor bridges or DRM with JavaScript feature stubs.

Acceptance: missing/throwing bridges and methods; completion after Stop; unsupported stream type; removed Promise/collections/typed-array helpers in both page and Worker; unavailable Worker; missing native MSE or binary storage; identical input buffers decoded with and without Worker.

## 6. External metadata and URLs

The reference `src/utils/helpers.ts:480`, `:493` and `:512` separates text, image URLs and HTML handling, used by metadata insertion such as `src/channels/index.ts:3325`.

Rules:

- Channel titles, categories, EPG and provider errors remain escaped text.
- Never execute provider scripts, use `eval` or `new Function`, accept M3U/XMLTV HTML, or construct event handlers from strings.
- Validate URL schemes before requests and playback. Reject executable URLs, control characters and unsafe relative references.
- Provider SVG/HTML icons must not be inserted as markup. Missing or unsafe logos use the default presentation.
- Do not expose credentials in diagnostics, errors, titles or exported screenshots. Human-readable IDs must not contain passwords.
- XMLTV must not resolve external entities or network DTDs.

Acceptance: executable-looking channel names; quoted commas in M3U attributes; `__proto__` EPG IDs; executable URL schemes; XML DTDs; control characters. Verify displayed text and absence of execution.

## 7. Network, provider contracts and archive

Application transport uses callbacks and cancellation; it does not require fetch or Promise. M3U, Xtream and Stalker are different protocols. Legacy support for a commercial provider does not establish its contract in the new implementation.

Rules:

- M3U parsing handles quoted attributes, BOM, CRLF, groups, EPG URLs and supported catchup placeholders. Malformed entries cannot become playable channels.
- Stable IDs do not depend on playlist order. Duplicates, stream variants and repeated `tvg-id` values require explicit handling.
- Xtream live/VOD categories remain separate; distinguish empty catalogs, authentication failures and invalid JSON.
- Only the documented Stalker profile is implemented. Other provider dialects remain unsupported until their contracts are established and tested.
- Archive URLs require a supported scheme and explicit provider template. Never invent an archive endpoint from a live URL.
- Reject future programmes, expired retention windows, missing templates and unknown placeholders.
- XMLTV timestamps normalize to UTC with explicit offsets. Match exact IDs before unambiguous names; ambiguous fallbacks must not associate another channel's programme.

Acceptance: reordered M3U retains IDs; duplicates; separate live/VOD category IDs; cancellation through request chains; +0530/-0330 offsets; programme boundaries/gaps; ambiguous names; unknown archive placeholders.

## Readiness boundaries

The architecture limits shared state and makes failures reproducible. A feature is verified by its external behavior; a device is verified by playback, input and lifecycle on that platform. Release evidence must distinguish implemented APIs from checks that have not been performed.

## External provider and EPG references

Contracts were studied from primary sources; modules and test fixtures were written independently:

- [XMLTV DTD](https://github.com/XMLTV/xmltv/blob/master/xmltv.dtd): channel/programme structure and UTC when no timezone is provided. Import supports minute/second precision and numeric offsets; incomplete dates do not create invented schedules.
- [Kodi IPTV Simple catchup specifiers](https://github.com/kodi-pvr/pvr.iptvsimple#catchup-format-specifiers): explicit default/append/vod templates. Supported substitutions include UTC timestamps, duration/offset with integer divisors, UTC date fields and catchup ID; automatic xc/fs/shift conversion is absent.
- [Published Xtream-compatible endpoint](https://github.com/gtaman92/XtreamCodesExtendAPI/blob/master/player_api.php): separate live/VOD categories/streams and record fields. Arbitrary modified portals require separate verification.

The current standard Stalker adapter is described in [Provider API](PROVIDER-API.md). This does not establish compatibility with the original player's FOSS JSON-RPC dialect or every portal. Archive generation requires completed programmes, retention and a supported template; a number of archive days alone is insufficient.
