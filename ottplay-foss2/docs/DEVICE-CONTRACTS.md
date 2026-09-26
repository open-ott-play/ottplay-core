# Device, input and resource contracts

This specification defines device selection, numeric input, resource and native
capability requirements. Physical-device acceptance is separate from automated
browser tests.

## 1. Device support

The **24 device profiles** select remote key codes and detection behavior. A
profile does not establish manufacturer playback, decoder, DRM or PiP support.
The player uses HTML media with optional capability-checked media libraries.

Separate the following acceptance levels in every release report:

1. ES5 syntax and dependency/API checks.
2. Device selection and numeric input normalization against fixtures.
3. Real browser UI/navigation tests at television resolutions.
4. Simulator/native-shell integration, identifying the actual shell version.
5. Physical device, firmware, remote and selected clear/DRM streams.

Passing one level must not be reported as passing a later level. UA emulation cannot reproduce an embedded engine, hardware decoder or native service.

## 1.1. Complete retained target inventory

`src/devices.js` defines these 24 profile IDs:

- LG: `lg/webos`, `lg/netcast`.
- Samsung: `samsung/tizen`, `samsung/maple` (Orsay).
- Set-top boxes and native-shell targets: `mag`, `dune`, `android`, `e2` (Enigma2), `edem`, `inext`, `spark`.
- Other television/browser targets: `hbbtv`, `panasonic`, `philips`, `sony`, `sharp`, `toshiba`, `hisense`, `skyworth`, `tcl`, `vewd`.
- Desktop/browser profiles: `pc`, `pc2`, `nodejs`.

These IDs select detection and remote input behavior. The player has one shared HTML video/MSE implementation and does not load a different unverified media engine merely because an ID exists. Native HTML media is the baseline where supported; Hls.js, Shaka and mpegts.js become candidates only after capability checks. Proprietary AVPlay, OIPF, NetCast, MAG, Dune or Android decoder bridges require separately implemented and validated adapters.

## 1.2. Legacy runtime groups and support boundaries

LG webOS 1.x/2.x use WebKit for packaged web apps; their built-in browser versions differ, and MSE is absent. These devices retain the ES5 interface and native media path instead of being required to evaluate MSE libraries. webOS 3.x uses Chromium 38, 4.x uses Chromium 53, and 5.x uses Chromium 68; older language helpers can be supplied, but earlier MSE drafts and firmware-specific media behavior still require device playback checks. [LG web engines](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine), [LG MSE and streaming support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).

Samsung Tizen 2.3/2.4 use WebKit, while Tizen 3.0 uses Chromium 47 and 4.0 Chromium 56. Newer model years continue to change engine versions. A Tizen UA is therefore insufficient to select a modern runtime baseline. Install the shared ES5-compatible polyfills first, probe actual media support, and retain the profile's native key registration behavior. Samsung's separate video-element and AVPlay interfaces are different integration contracts. [Samsung web engine specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

Panasonic Viera, MAG, Dune, Orsay, NetCast and the other retained profiles must keep working input, catalog, local fonts and settings without modern JavaScript globals or MSE. Their exact firmware and shell APIs are not inferred from the brand. Android TV browsers and WebViews use the same feature checks; an Android UA alone does not establish a native player bridge. Desktop browsers also use capability checks, so a supported JavaScript engine is not mistaken for codec support.

The default UI language is English, with the existing Russian setting available. All application comments, developer documentation and new diagnostics are English. Translation data may contain its target language. Local font fallbacks and ES5/CSS compatibility are shared across every target profile.

## 2. Device selection

The application uses one device detector for startup and subsequent profile selection.

Required precedence:

1. An allowlisted explicit `/f/<profile>` route, including `lg/webos`, `lg/netcast`, `samsung/tizen` and `samsung/maple`. The suffix may be empty, `/`, `/index.html` or a nested document path.
2. An allowlisted `?device=<profile>` override when the route does not supply a valid profile.
3. Explicit webOS UA tokens (`web0s`, `webos`), then `netcast`, then the broad LG compatibility fallback.
4. MAG bridge shape or a bounded MAG model token/Infomir STB UA. Detection only reads method availability; it does not call hardware methods. A throwing bridge getter cannot prevent UA fallback.
5. Tizen before Maple; Dune; Android; HbbTV/OIPF; Viera; Philips; Hisense; Sony; TCL; Sharp; Toshiba; Skyworth; Vewd; Spark; NodeJS/Electron; otherwise PC.

The MAG model boundary must accept cases such as `MAG200`, `MAG254`, `MAG322w1` and `MAG420r2`, but not `ImageMAG254` or a word containing `mag`. A MAG signal takes precedence over a Maple compatibility token. Explicit selection takes precedence over every native or UA signal. Unknown paths/query values must not become script names, object prototype properties or resource paths.

Device detection must tolerate absent navigator/location, empty user agent, malformed URL encoding and inaccessible native globals. A manually selected profile configures remote behavior; playback capability remains separately detected.

## 3. Input contract

The input layer returns semantic actions, not UI mutations. It installs no event listener; the application controller owns keyboard events and the current focus context. All keyboard and remote input uses the selected profile's numeric map through one normalizer. Modern `KeyboardEvent.key` and `KeyboardEvent.code` fields are never read, including for desktop controls, navigation, media keys and repeat tracking.

Required actions are `up`, `down`, `left`, `right`, `ok`, `back`, `exit`, `quit`, `fullscreen`, `menu`, `info`, `guide`, `red`, `green`, `yellow`, `blue`, `playPause`, `play`, `pause`, `stop`, `forward`, `rewind`, `next`, `previous`, `previousChannel`, `audio`, `subtitle`, `aspect`, `zoom`, `pip`, `channelUp`, `channelDown`, `volumeUp`, `volumeDown`, `mute`, `tab`, `pageUp`, `pageDown`, `home`, `end` and `digit0` through `digit9`. An action is available only when the selected profile supplies its code. Dedicated Audio/Subtitle/Aspect/Zoom codes open playback options; PiP toggles the current session where supported. `PRECH` restores the previously confirmed broadcast through source and playback authorization, whereas `PREV` and `MEDIA_PREVIOUS` retain adjacent-item navigation. Unavailable features must not silently invoke a different command.

### Numeric event selection

- Accept a finite, positive integer `keyCode`. If it is missing, zero or invalid, try a finite, positive integer `which`. Strings, fractions, negative values and non-finite numbers are invalid. Inaccessible host properties are treated as absent.
- A valid `keyCode` takes precedence even when its value is unknown to the selected profile. Do not retry `which` or a PC map after an unknown numeric code. No usable numeric code means no command.
- A profile value of zero means that key is absent. Zero never dispatches an action.
- Named or physical browser key fields cannot create or override a command. A key-only `ArrowUp`, `Escape` or `MediaPlayPause` event is ignored. Changing keyboard language does not change a numeric command.
- An explicitly selected TV profile remains a TV input profile in a desktop browser. Test it with its actual numeric remote codes. For example, Android Up is 19, not desktop 38; Android 13 is digit 6, not Enter; Samsung Maple 73 is Stop even when a browser labels the event `i`.

### Shared actions and profile extensions

`RETURN` maps to `back`, dedicated `EXIT` maps to `exit`, and nonzero `POWER` maps to `quit`. `RETURN` has explicit priority when it shares a code with `EXIT`: Android code 4 remains `back`. Dedicated Exit codes include Samsung Tizen 10182, Samsung Maple 45, and LG/MAG 27. Return codes include Tizen 10009, webOS 461 and PC/MAG 8.

The `info` action comes from each profile's `INFO` fact: PC/MAG 73, Maple 99, LG/Tizen 457 and Android 165. There is no universal I, Q or L alias on TV profiles. PC, PC2, NodeJS and Edem retain `POWER=81` for quit and `INFO=73` for information.

Only `pc`, `pc2`, `nodejs` and `edem` add the following numeric desktop extensions:

- `FULLSCREEN=76` → `fullscreen`.
- `SPACE=32` → `playPause`; `CONTEXT_MENU=93` → `menu`.
- `TAB=9` → `tab`; Shift reverses focus traversal.
- `PAGE_UP=33` → `pageUp`; `PAGE_DOWN=34` → `pageDown`.
- `HOME=36` → `home`; `END=35` → `end`.
- `NUMPAD0` through `NUMPAD9`, codes 96–105, → `digit0` through `digit9`, alongside the existing top-row codes 48–57.
- `MEDIA_PLAY_PAUSE=179` → `playPause`; `MEDIA_STOP=178` → `stop`.
- `MEDIA_NEXT=176` → `next`; `MEDIA_PREVIOUS=177` → `previous`.
- `MEDIA_VOLUME_UP=175` → `volumeUp`; `MEDIA_VOLUME_DOWN=174` → `volumeDown`; `MEDIA_MUTE=173` → `mute`.

These extensions supplement the profile codes in Appendix A and are not global fallbacks. Maple 32/33 remain Yellow/Blue, Maple 99 remains Info, Android 9 remains digit 2, and Dune/MAG 33/34 remain channel keys. Multiple numeric codes may map to one semantic action: on the desktop profiles 80, 32 and 179 all mean `playPause`, and both 51 and 99 mean `digit3`. Desktop multimedia and keypad aliases are not inherited by TV profiles.

Explicit combined Play/Pause codes and shared nonzero PLAY/PAUSE codes normalize to `playPause`. Tizen 10252 remains combined Play/Pause, while 415 and 19 remain separate Play and Pause. A misleading `MediaPlayPause` label never overrides the numeric command. The player controller decides pause versus resume and suppresses unwanted repeats; the normalizer remains stateless. Fast-forward/rewind codes normalize to `forward`/`rewind`, with seek steps and repeat policy owned by the controller.

### Context and event ownership

- Dedicated `exit` first leaves native fullscreen. In windowed mode it cancels an open dialog; otherwise it opens the Yes/No exit confirmation with No selected.
- `quit`, supplied by desktop code 81 (Q) or a delivered nonzero profile `POWER` code, exits immediately without confirmation. It remains available from fullscreen and non-editing dialogs. Direct quit and confirmed Exit share idempotent cleanup: save an available VOD bookmark, retain the remembered channel, cancel outstanding work, release playback and attempt window closure. A stopped exit screen remains when the browser cannot close the tab. This action exits the application; it does not establish a system power-off bridge.
- `back` closes one interface layer and restores focus. It retains channel-list navigation instead of being merged with `exit`. One physical event cannot cancel a dialog and exit the player at the same time.
- `info` opens channel actions in the list. During playback it shows the information footer; a second activation expands the EPG description. Each activation restarts the six-second timeout used at playback startup. Bottom-video clicks use the same footer action.
- A focused expanded description consumes semantic `up`/`down`/`left`/`right` actions for scrolling. Profiles with `pageUp`/`pageDown`/`home`/`end` also use those actions there. This works with remote numeric codes that have no native browser scrolling behavior and cannot seek or change the channel. Mouse scrolling remains available.
- Text editing owns printable keys and native input cursor motion. Player commands must not consume typed text or change playback while text/PIN entry owns focus. Ctrl/Alt/Meta combinations remain available to the browser. Modifier handling belongs to the controller, not numeric normalization.
- Except for the explicit direct-quit action outside text editing, focus order is blocking dialog/PIN, editor, selection popup, active screen, then playback controls. Tab/Shift+Tab stay inside an open dialog when the profile supplies `tab`.
- Remote repeats can move lists and scroll descriptions. Transport, selection, provider changes, footer expansion and confirmation must not unintentionally double-fire. Held-key tracking and key release use the same validated numeric code.
- Release recovery is explicit profile metadata. `keyReleaseTimeout=0` on `pc`, `pc2`, `nodejs` and `edem` keeps held controls suppressed until keyup or focus loss. Transport, mute, previous-channel, track/picture options and PiP use this guard even when the browser omits `event.repeat`; directional navigation and volume retain repetition. Other profiles use a 350 ms inactivity timeout so a lost or absent keyup cannot suppress subsequent activations indefinitely. Each repeated keydown refreshes that bound; an event explicitly marked `repeat` remains suppressed. Keyup, focus loss and teardown clear held-control state. This is a compatibility policy, not a claim that every remote omits keyup or has the same repeat cadence; physical-device verification must record actual event behavior.
- Pointer/touch clicks resolve to the same commands as remote actions. Layout cannot rely on hover.

The numeric profile mappings appear in Appendix A. When two actions share a code, define precedence or a context rule explicitly rather than relying on object iteration order. PC `AUDIO` and `STOP` are both 83, so Stop retains priority. PC `ASPECT` shares 76 with the desktop fullscreen extension, so fullscreen wins. Tizen MTS 10195 opens audio options, PictureSize 10140 opens picture options, and PreviousChannel 10190 restores the previously watched broadcast.

## 4. Native integration requirements

### Android

Native Android features require a separately implemented and versioned bridge.
Detect a real native shell independently from the `android` UA; a normal Chrome
browser or test WebView does not establish ExoPlayer or shell-only operations.

### Dune

A `Dune` object alone does not establish proprietary playback or sleep APIs.
Native integration must be feature-detected and tested separately. Any
provider/device-specific archive time rule requires an explicit contract.

### Enigma2, Edem and Inext

These profiles contain key data and button labels. No manufacturer playback integration is implemented in their adapter files. Browser playback is the baseline; native functions are unavailable unless a new adapter implements and validates them.

### HbbTV and television-brand profiles

HbbTV, Hisense, Panasonic, Philips, Sharp, Skyworth, Sony, TCL, Toshiba and Vewd have key data, not a shipped OIPF media implementation. Detection of `hbbtv`/`oipf` UA tokens must not imply `application/oipfApplicationManager` or broadcast object readiness. A future broadcast/OIPF adapter requires an explicit lifecycle, keyset registration, resource ownership and physical test evidence.

### LG NetCast

The profile supplies key mappings and labels; it does not enable a NetCast native media plugin. Retain Back=8 and the distinct transport values. Do not load webOS-only helpers simply because the brand is LG.

### LG webOS

Optional webOS helpers include `webOS.system.hideSplashScreen()`,
`webOS.device.cursorVisible(false)`,
`webOS.platform.setWindowOrientation('landscape')` and
`webOS.app.requestWindowFocus()`. Guard each helper by method availability and
exception handling. `PalmSystem` is only a shell signal; each firmware requires
its own API checks.

Startup must succeed when helpers are absent or throw. Cursor navigation remains
available to Magic Remote users, orientation/focus changes respect host lifecycle,
and user preferences remain intact. Engine selection uses media capabilities,
stream type and a cancellable native-start probe. Back=461 is mandatory. LG's
default Left opens Menu during playback; an explicitly saved shortcut wins.

### MAG

Detection recognizes the presence of callable `gSTB.GetDeviceModel`, `gSTB.GetDeviceMacAddress` or `gSTB.GetMACAddress` without invoking them.

Use a generated device ID as the normal application identity. Retrieve a hardware MAC only when a configured provider's authorized protocol requires it; keep it out of routine logs/export. A MAC getter does not establish support for gSTB playback, DRM, authentication or Ministra handshake. The player must not report classic MAG portal support merely from this profile.

### NodeJS/Electron and PC/PC2

These are browser keyboard profiles. A NodeJS/Electron UA does not grant filesystem, IPC or native-window access. For plain browsers, implement supported HTML fullscreen APIs with feature detection. Tauri fullscreen and OS window state are separate from in-page video sizing. PC2 has the same numeric map as PC; keep both recognized profile IDs.

### Samsung Maple/Orsay

The presence of `Common.API` does not establish AVPlay or Samsung plugin playback. Arrow/OK/Back values are distinct from DOM defaults: Up=8, Down=5, Left=4, Right=6, OK=12, Back=88, Exit=45. Do not normalize raw code 8 to Back before consulting this profile.

### Samsung Tizen

Best-effort register non-navigation keys through `tizen.tvinputdevice.registerKey(name)` when callable. Missing privilege, missing API, throwing access or one unsupported key must not abort startup or later registrations. Arrows, Enter and Back are not explicitly registered. Registration must be idempotent per host/API instance; repeated application initialization must not register duplicate keys. `init()` returns a cleanup function and must not take ownership of keys registered by another component.

Registration names: digits `0`–`9`, `VolumeUp`, `VolumeDown`, `VolumeMute`, `ChannelUp`, `ChannelDown`, `ChannelList`, `PreviousChannel`, `MediaPlayPause`, `MediaRewind`, `MediaFastForward`, `MediaPlay`, `MediaPause`, `MediaStop`, `MediaRecord`, `MediaTrackPrevious`, `MediaTrackNext`, `ColorF0Red`, `ColorF1Green`, `ColorF2Yellow`, `ColorF3Blue`, `Menu`, `Tools`, `Info`, `Exit`, `PictureSize`, `MTS`, `Guide`. The containing native application needs its input privilege; a browser cannot acquire it with ES5 code.

The profile does not implement `webapis.avplay`. An AVPlay adapter requires prepare/play/pause/stop/seek/error/teardown contracts. Back=10009, Exit=10182 and combined Play/Pause=10252 must remain distinct facts.

### Spark

The presence of an `STB` object does not establish a callable media API. Retain the numeric input contract; native playback remains separately unverified.

## 5. Playback capability contract

Determine capabilities at runtime: HTML video element, `canPlayType`, native HLS response, MediaSource or prefixed equivalent, typed-array support, blob URL support, usable audio/text tracks, seekable range, browser fullscreen and native shell bridge. No optional dependency may be evaluated before its required APIs exist. Capture original native binary capabilities in `src/compat.js`, load the pinned local core-js bundle, finalize platform helpers, and only then load the application and optional media libraries. Repeat that order independently inside the HLS worker; page globals do not cross into worker globals. See [the engine bootstrap contract](ENGINE-COMPATIBILITY.md).

- The ES5 application must boot, show settings and explain unavailable playback when no media engine exists.
- A play request owns a generation/session ID. Stop, replacement, provider switch, Back from a loading view and teardown invalidate stale callbacks, watchdogs and native replies.
- Wait for asynchronous engine destruction before attaching a successor to the same video element. Limit retries, reset retry state on a new requested stream, and never retry a user-requested pause or stop.
- Distinguish live, timeshift/archive and finite VOD state; do not encode them in magic positive/negative timestamp sentinels.
- A native-HLS probe must measure actual startup progress, remain cancellable and fall back only once when the alternate engine is usable. Track/seek/PiP changes cannot revive a cancelled session.
- Audio/subtitle options require actual tracks; unsupported software volume or PiP is unavailable, not successful. Subtitle Off remains explicit.
- Codec, DRM, multi-decoder and background-playback claims require device-level tests. ES5 syntax does not solve codec support, CORS, TLS, certificates, mixed content or autoplay policy.

Optional vendor libraries require exact versions, licenses, hashes and ES5/API
requirements. Application startup must not depend on CDN availability.

## 6. Fonts, icons, layouts and language resources

Retain selectable font labels System, Roboto, Roboto Condensed, Caveat, Liberation, Gabriela and PT Sans Narrow. The system stack is `Helvetica, Arial, sans-serif`. Resource filenames and CSS family aliases are:

- `Roboto-Regular.ttf` → Roboto.
- `RobotoCondensed-Regular.ttf` → RobotoCondensed.
- `Caveat-Regular.ttf` → Caveat.
- `LiberationSans-Regular.ttf` → Liberation.
- `Gabriela-Regular.ttf` → Gabriela.
- `PTSansNarrow-Regular.ttf` → PTSansNarrow.
- `fontello.eot`, `fontello.woff2`, `fontello.woff`, `fontello.ttf`, `fontello.svg` → Fontello icon face.

**Font alias:** `LiberationSans-Regular.ttf` has the same bytes as `Roboto-Regular.ttf` and embeds family Roboto. There are six text filenames/menu aliases but five distinct text payloads. Preserve mapping if retaining appearance; do not describe the payload as a distinct Liberation font. A later replacement is a deliberate visual change, with separate license/metric testing.

Asset metadata is in `licenses/bundled-font-metadata.txt` and
`THIRD-PARTY-NOTICES.md`. Retain the notices and hashes. Fontello has mixed glyph
provenance; do not assume every icon shares one license.

Fonts are local and must work without Google Fonts or a CDN. Supply a system fallback while loading or on failure. Required visual fixtures: Cyrillic, Latin with diacritics, Greek, Hebrew, Armenian, Turkish, long text, numeric clocks and all UI icon fallbacks. Resource existence alone is not proof of glyph coverage. If a glyph is absent, fallback must keep the interface readable. Font selection cannot change application behavior or cursor indices.

Translations use data dictionaries with an explicit language fallback.

Layout must remain operable without CSS Grid, flexbox, custom properties, `inset`, `gap`, `object-fit`, `contain`, CSS animation or modern selector support. Use an explicit stable layout baseline, bounded rows and predictable text overflow. Optional enhancements must not hide focus or content. Validate 720p, 1080p, 4K and smaller embedded viewport dimensions; system font and each selectable face; unavailable-font conditions; RTL language behavior and long menu translations.

## 7. Acceptance tests

- Every one of the 24 profile IDs resolves from its explicit route; unknown profiles fail closed to detection/PC without dynamic resource loading.
- For every implemented nonzero profile action, normalize the exact profile code and test collisions through defined context rules. Test `keyCode`/`which` precedence, invalid numeric values, throwing getters, misleading `key`/`code` labels and key-only events. Zero and unknown profile codes never dispatch; no TV profile receives implicit PC aliases.
- Test missing APIs, throwing native getters, partial bridge shapes, repeated init/cleanup, and Tizen per-key registration failure.
- Test MAG precedence over Maple and wrong MAG word matches; webOS/NetCast distinction; Android versus native shell distinction.
- Test complete navigation, Return, dedicated Exit, Power and Info on actual numeric browser events, not only by calling action functions. Cover Android Return/Exit sharing, Maple transport/color/keypad collisions, desktop extensions, multiple codes for one action, editable inputs, direct Power/Q exit versus dedicated Exit confirmation, exactly-once teardown from fullscreen or dialogs, strict and bounded repeat suppression, lost keyup recovery and expanded-description scrolling with remote codes.
- Parse every delivered application, polyfill and vendor JS file, including the HLS worker payload, using an ES5 grammar. Remove Promise, fetch, Map, Set, Symbol, URL and modern array/typed-array helpers before boot; verify supplied helpers precede vendor evaluation in both page and worker realms. Require decoded synthetic HLS playback, worker failure fallback, and a usable interface when native MSE or binary storage is absent.
- Verify fonts by resource existence/hash and rendering. Report physical-device coverage separately by model and firmware.

## Appendix A. Profile key codes

`0` means absent. Profile labels identify numeric keys; the application resolves
them to the semantic actions described above.

### android

- Navigation: UP=19, DOWN=20, LEFT=21, RIGHT=22, ENTER=66, RETURN=4, EXIT=4, SETUP=82, TOOLS=82.
- Color: RED=183, GREEN=184, YELLOW=185, BLUE=186.
- Transport: PLAY=85, PAUSE=85, STOP=86, RW=89, FF=90, PREV=88, NEXT=87, REC=0.
- Channel and volume: CH_UP=167, CH_DOWN=168, CH_LIST=0, PRECH=0, VOL_UP=24, VOL_DOWN=25, MUTE=91.
- Additional: INFO=165, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=26.
- Digits N0–N9: 7, 8, 9, 10, 11, 12, 13, 14, 15, 16.

### dune

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=84, TOOLS=84.
- Color: RED=112, GREEN=113, YELLOW=114, BLUE=115.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=33, CH_DOWN=34, CH_LIST=0, PRECH=0, VOL_UP=107, VOL_DOWN=109, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### e2

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=84, TOOLS=84.
- Color: RED=112, GREEN=113, YELLOW=114, BLUE=115.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=33, CH_DOWN=34, CH_LIST=0, PRECH=0, VOL_UP=0, VOL_DOWN=0, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### edem

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=192, TOOLS=84.
- Color: RED=90, GREEN=88, YELLOW=67, BLUE=86.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=187, CH_DOWN=189, CH_LIST=0, PRECH=191, VOL_UP=0, VOL_DOWN=0, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=65, AUDIO=83, PIP=87, ZOOM=69, LANG=16, POWER=81.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### hbbtv

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### hisense

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### inext

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=84, TOOLS=84.
- Color: RED=112, GREEN=113, YELLOW=114, BLUE=115.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=33, CH_DOWN=34, CH_LIST=0, PRECH=0, VOL_UP=0, VOL_DOWN=0, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### lg/netcast

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=82, FF=70, PREV=188, NEXT=190, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### lg/webos

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=461, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### mag

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=122, TOOLS=122.
- Color: RED=112, GREEN=113, YELLOW=114, BLUE=115.
- Transport: PLAY=68, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=33, CH_DOWN=34, CH_LIST=0, PRECH=191, VOL_UP=107, VOL_DOWN=109, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=16, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### nodejs

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=192, TOOLS=84.
- Color: RED=90, GREEN=88, YELLOW=67, BLUE=86.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=187, CH_DOWN=189, CH_LIST=0, PRECH=191, VOL_UP=0, VOL_DOWN=0, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=65, AUDIO=83, PIP=87, ZOOM=69, LANG=16, POWER=81.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### panasonic

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### pc

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=192, TOOLS=84.
- Color: RED=90, GREEN=88, YELLOW=67, BLUE=86.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=187, CH_DOWN=189, CH_LIST=0, PRECH=191, VOL_UP=0, VOL_DOWN=0, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=65, AUDIO=83, PIP=87, ZOOM=69, LANG=16, POWER=81.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### pc2

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=192, TOOLS=84.
- Color: RED=90, GREEN=88, YELLOW=67, BLUE=86.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=187, CH_DOWN=189, CH_LIST=0, PRECH=191, VOL_UP=0, VOL_DOWN=0, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=65, AUDIO=83, PIP=87, ZOOM=69, LANG=16, POWER=81.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### philips

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### samsung/maple

- Navigation: UP=8, DOWN=5, LEFT=4, RIGHT=6, ENTER=12, RETURN=88, EXIT=45, SETUP=31, TOOLS=31.
- Color: RED=29, GREEN=30, YELLOW=32, BLUE=33.
- Transport: PLAY=71, PAUSE=75, STOP=73, RW=74, FF=72, PREV=68, NEXT=69, REC=0.
- Channel and volume: CH_UP=18, CH_DOWN=19, CH_LIST=107, PRECH=108, VOL_UP=16, VOL_DOWN=17, MUTE=82.
- Additional: INFO=99, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### samsung/tizen

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=10009, EXIT=10182, SETUP=18, TOOLS=10135.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PLAYPAUSE=10252, PAUSE=19, STOP=413, RW=412, FF=417, PREV=10232, NEXT=10233, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=10073, PRECH=10190, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=458, ASPECT=10140, AUDIO=10195, PIP=0, ZOOM=10122, LANG=0, POWER=10005.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### sharp

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### skyworth

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### sony

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### spark

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=84, TOOLS=84.
- Color: RED=112, GREEN=113, YELLOW=114, BLUE=115.
- Transport: PLAY=80, PAUSE=80, STOP=83, RW=82, FF=70, PREV=188, NEXT=190, REC=0.
- Channel and volume: CH_UP=33, CH_DOWN=34, CH_LIST=0, PRECH=0, VOL_UP=0, VOL_DOWN=0, MUTE=77.
- Additional: INFO=73, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### tcl

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### toshiba

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

### vewd

- Navigation: UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, RETURN=8, EXIT=27, SETUP=458, TOOLS=459.
- Color: RED=403, GREEN=404, YELLOW=405, BLUE=406.
- Transport: PLAY=415, PAUSE=19, STOP=413, RW=412, FF=417, PREV=424, NEXT=425, REC=416.
- Channel and volume: CH_UP=427, CH_DOWN=428, CH_LIST=0, PRECH=0, VOL_UP=447, VOL_DOWN=448, MUTE=449.
- Additional: INFO=457, EPG=0, ASPECT=0, AUDIO=0, PIP=0, ZOOM=0, LANG=0, POWER=0.
- Digits N0–N9: 48, 49, 50, 51, 52, 53, 54, 55, 56, 57.

## Beta 0.6 input and lifecycle corrections

Android user-agent detection preserves the Android media/device identity but uses numeric DOM keyboard codes for browser/WebView events. Explicit `/f/android` or `?device=android` selects the native Android KeyEvent transport. The two maps are never combined because Enter/Back overlap digit codes.

The HTTP server and detector share the device-route allowlist. Profile routes accept clean directory suffixes and `.html`/`.htm` documents, including `/f/lg/webos/index.html`; unknown profiles and traversal/document-type mismatches are rejected.

Tizen Guide (458) opens the programme guide while retaining the playing stream. It does not override a PIN dialog or active text editor. TV visibility changes suspend the decoder, keep user pause intent and VOD/DVR position, and recheck authorization before foreground resume. Deliberate pause, Stop and source changes cannot automatically restart playback. Desktop tab visibility retains its existing playback behavior. These are fixture/browser contracts, not physical-device certification.
