# OttPlay shared core

One maintained implementation of guide, archive, provider/catalog, durable-state
and playback decisions for the OttPlay family. The browser and Node filter in FOSS2 consume the same generated
ES5 bundle. Main-player iOS uses JavaScriptCore, Rust uses QuickJS-NG, and the
main browser bridge uses that identical file. The active native Android
application and archived Android adapter consume the JVM artifact.
Compatibility profiles retain the existing client contracts. Physical device and
commercial provider acceptance remains separate from the automated checks.

`src/commonMain` owns XMLTV date arithmetic, channel-name normalization, ordered
ID/name/quality-alias selection, native fuzzy matching, regional time shifts,
archive windows, current/next selection, cache intervals, archive URL decisions,
M3U catalog rules, Xtream sessions/catalogs/series and Stalker MAG/JSON-RPC.
`src/jsMain` converts ABI types only. XML decoding, decompression, transport,
native feed I/O and callback coordination, storage, UI and media playback remain
with consumers. Native matching indexes themselves belong to this core.

Compatibility is explicit. The browser format requires minutes, accepts UTC/GMT/Z
and offsets up to 23:59 without a colon. Android retains date-only/hour-only
inputs, Z and colon offsets, with the existing 18:00 offset limit. Both preserve
year 0000 and reject impossible dates. One calendar implementation serves both.
Names retain regional and time-shift labels. Exact IDs precede ordered exact
names, then unique quality aliases; ambiguity does not pick an arbitrary ID.
Schedules use half-open intervals, the latest starting overlap and stable ties.

## Build and distribute

Requires JDK 17+, Node.js and the included Gradle wrapper:

```sh
npm ci
node scripts/check-boundary.cjs
./gradlew --no-daemon jvmTest jsNodeTest
npm run pack:core
npm run check:js
npm run check:core
node scripts/distribute.cjs install-web /absolute/path/to/ottplay-foss2
node scripts/distribute.cjs install-jvm /absolute/path/to/ottplay-android
node scripts/distribute.cjs install-native /absolute/path/to/ottplay-foss
```

`pack:core` invokes the compiler, then writes `dist/ottplay-core.manifest.json`
with deterministic source and artifact hashes. It refuses inputs changed during
compilation. Kotlin 2.4.20 emits empty collection marker interfaces in varying
orders; the packer canonicalizes only those verified method-free markers.
Other arrays and interfaces retain compiler order. Shape assertions and a
regression test reject added marker behavior. Clean macOS, incremental macOS
and GitHub Linux builds produce the same normalized JS bytes. `check:js`
exercises the distributed file, including this packaging step. Consumers pin generated artifacts rather than maintaining source
copies. They run without a sibling checkout or compiler installation. To check
an update against this source build, use `check-web`, `check-native` or `check-jvm` with the same
explicit consumer paths. Do not hand-edit generated JS/JAR files or receipts.

Apple portability validation is opt-in:

```sh
./gradlew --no-daemon -Papple=true macosArm64Test linkDebugFrameworkIosSimulatorArm64
```

The common scenarios run on JVM, JavaScript and native macOS. JVM also compares
the calendar with the JDK across four centuries and checks the retained Android
parser contract, including every BMP character around the timestamp. The JS ABI
harness parses ES5 syntax and tests modern and two older-API simulations, with
2,928 calendar oracle dates and 65,536 whitespace inputs per environment.

The older-API simulations remove modern globals and reject non-ES5 RegExp flags.
They use pinned core-js 3.50.0, once with native binary arrays and once with
emulated arrays. Kotlin's runtime needs this bootstrap; `check-boundary.cjs`
rejects Kotlin `Regex`, which would introduce the unsupported `u` flag.
These simulations do not certify physical televisions.

The Apple framework is not an application dependency. Swift uses the same
compiled ES5 rules through JavaScriptCore; Rust uses rquickjs 0.14.0, including
Alpine/musl. Engine contexts have no application I/O callbacks. Only trusted
compiler output is evaluated; channel data crosses typed function arguments.

Native compatibility profiles keep ID/alias ordering, quality/shift stripping,
UTF-8 vs grapheme vs UTF-16 length and Rust's float precision explicit. Rust
keeps its fourteen-digit date and permissive suffix contract, including the
zero-second malformed-input sentinel. Swift accepts Unicode decimal date digits.
Native dates now share the proleptic Gregorian calendar: the archived Java
parser's invalid-date rollover and Swift's historical Julian cutover are not
part of this contract. Those affect invalid/pre-broadcast dates; contemporary
XMLTV fixtures retain their results. Existing cache/storage/wire shapes remain.

`NativeGuideClock` caches at most 4,096 inputs of at most 64 UTF-16 code units per
parser/VM. Eviction uses a ring, so unique-date feeds do not require a scan per
eviction. Date arithmetic uses exact integers in double precision for XMLTV's
four-digit year range, avoiding boxed ES5 64-bit arithmetic. JVM callers still
receive `Long` milliseconds/seconds.

`Archive` owns retention checks, programme identity validation, template tokens,
component escaping, Xtream minute rounding and Flussonic resource selection.
Calendar fields are supplied by the host's UTC/IANA time-zone library; URL
parsing and credential header scoping stay with transport adapters. FOSS2 and
Android select explicit contracts for completed vs current programmes and
supported tokens. Main-player provider adapters pass one of the recorded wire
profiles; Dune end padding, absolute timeshift thresholds and the historical
kb-team `.mdp` spelling remain deliberate compatibility data. These adapters
no longer expand placeholders or calculate archive durations themselves.

The 272 provider input/output fixtures in the main repository record baseline
`7d47b0ca391e4b1d1fe282cb4bf11a2bfe17e80a`. They run against the actual provider
adapters and compiled ES5 core. The independent common suite exercises retained
client differences on all three targets, including malformed tokens, signed
queries, Unicode component bytes and exact retention/absolute-shift boundaries.

`Playlist` owns browser/Android metadata parsing and directive order. The host
supplies URL resolution, a stable hash primitive and header/DRM decoders. It
retains each client's identity inputs, archive defaults, grouping, HLS handling
and duplicate policy. Existing Android limits also bound browser M3U inputs:
32 Mi UTF-16 code units, 1 Mi per line and 100,000 unique entries.

`ProviderPlaylist` and `OperatorPlaylist` retain historical wire profiles for
43 main-player playlist adapters and three media catalogs. They preserve even
awkward compatibility details such as first-comma titles, blank URI handling,
week-based TVTeam archives and operator-specific ID path segments. Null-prototype
JS maps safely represent groups named `__proto__`. Fixed baseline fixtures test
743 adapter cases; no old parser body is bundled as a fallback.

`XtreamSession` selects account/catalog requests and validates replies without
performing HTTP. `XtreamLoad` processes native sections as they arrive, preserving
the 100,000-row limit before deduplication and before subsequent requests.
`XtreamCatalogs` owns catalog/episode metadata, IDs, duplicate policy, seasons,
archive eligibility and route choices. `LegacyXtream` preserves the base player's
embedded live response, name-hash identities and short-EPG records. The shared
wire-value model keeps missing/null and native/browser coercions explicit.

Profiles retain existing behavior: strict browser auth, native missing-user-info
acceptance, optional native 404/405/501 sections, extension and direct-URL rules,
and the base player's raw stream references. Hosts supply JSON and URL codecs,
HTTP/cancellation, hashing, localization and Date/IANA decoding. The JS ABI
converts public models without normalizing provider catalogs independently.
Pre-migration fixtures cover 58 FOSS2, 68 Android and 13 base-player contracts.

`StalkerProtocol` owns MAG/JSON-RPC envelopes, request/header policy, MAC/profile
validation, token and media-link interpretation. `StalkerPages` preserves browser
raw-row vs native unique-row completion, duplicate policies and finite page caps.
`StalkerBrowserSession` keeps tokens and opaque commands private and rejects
stale catalog generations. `StalkerNativeLoad` and `LegacyStalker` retain native
and base-player request order, RPC catalogs, identities and short EPG records.
`StalkerTokens` and `StalkerRetry` own bounded cache/retry policy; the Android host
serializes access and performs cancellable HTTP.

Captured baselines cover 52 browser, 63 Android and 19 base-player scenarios.
Twelve additional BEST LiST cases cover its removed duplicate Xtream parser and
M3U fallback spellings. The shared classic Xtream factory supplies both providers.
ES5 runtime simulations cover these APIs and the antifriz logo rewrite; source
checks forbid Kotlin `replaceFirst`, whose JS implementation needs a Unicode
RegExp even for a literal search. URL/JSON decoding stays in platform adapters.

`GuideFeeds` normalizes browser XMLTV records, infers missing stops, preserves
metadata/duplicate precedence and constructs feed-scoped name/ID indexes.
`GuideCoverage` validates declared bounds and combines partial-feed metadata.
The browser adapter only decodes XML, resolves URLs and converts public models.
Merged programme objects and unambiguous schedule aliases preserve identity.

`GuideLookupCache` owns bounded stable/rotating retention and shifted-copy weight;
`GuideScheduleMemo` reuses a selection until an actual schedule boundary.
`GuideResponseCache` owns classic full-schedule TTL, expiry and LRU policy.
`LegacyGuideSchedule` retains inclusive programme ends and the first overlapping
start, while `GuideSchedule` retains half-open/latest-start browser semantics.
Android uses `GuideProgrammeRules` for interval validation, duplicate retention
and deterministic ordering. Captured contracts cover 44 browser, 44 classic
and 33 Android cases; XML parser protections stay in the host.

`NativeGuideSources` owns native URL selection/deduplication, channel ownership,
cache hit/coalescing precedence, disk identity/TTL, Rust source-set capacity and
partial-refresh decisions. Android's disk TTL remains inclusive at two hours;
Swift's remains exclusive. Swift supplies Foundation trimming and canonical
Unicode equality as host primitives. Active Android retains untrimmed URLs and
explicit-source-first ordering; archived Play still has no bundled default.
Hosts retain locks, HTTP/XML/gzip/file operations, clock and metadata decoding,
and callback execution.

`NativeSourceLoad` owns fresh-disk/network admission, memory-before-stale-disk
fallback and write-error policy. Swift requires a successful disk write and
retains its second network parse; that parse's failure terminates without
fallback. Android keeps the parsed network response when writing fails. Any
present memory result, including an empty guide, precedes stale disk. Native
adapters retain payloads and original errors while executing the selected effect.
`NativeSourceBatch` continues sequential loads after errors and selects the first
failure only when no source produced channels. Channel ownership remains shared.

Another 77 contracts (39 Swift, 38 Kotlin) were qualified on unchanged adapter
revision `d24f07be` before migration. They exercise distinct memory/disk/network
payloads, real write failures, delayed/coalesced callbacks, timestamps, ordered
source batches and Swift's second-parse failure. Eight new common tests exercise
the state transitions on JVM, JavaScript and macOS.

The actual Swift/Kotlin adapters each pass 59 source/cache cases qualified
against main revision `ab69d2f`, including forced/coalesced loads, exact TTL,
malformed metadata, Unicode URL/channel equality and integer overflow.
`tests/test_native_epg_cache.py` executes these through the real JVM and
JavaScriptCore distributions; Rust tests partial HTTP failure and source-set
isolation through QuickJS. These run in the existing native CI suites.

`StreamingGuide` owns the Node companion's identity/archive-depth merging,
candidate indexes, first-icon/merged-name metadata, streaming window admission,
current/next priority and bounded programme retention. The output pass preserves
ambiguous metadata and shares the byte/programme budget across channels in rounds.
The host supplies XML encoders, UTF-8 lengths and an output sink. Programme
payloads keep their original identity and discarded payloads are released.

Compatibility includes programme-only exact IDs, first equal-priority entries,
late candidate discovery without retroactive pruning, open stops and fractional
archive depth. The Node adapter's existing transport, XML and request bounds
remain in place. A fixed baseline of 110 actual HTTP responses from source
revision `b34ae28` verifies exact output and failures. Ten common tests and all
three JS ABI environments exercise this implementation.

Transport, other operator session logic and durable
state still need migration. See [workspace status](../README.md) and
[validation](validation.json); physical targets are not certified by VM tests.

`XmltvRecords` now interprets decoded native XMLTV events for Swift, archived
Kotlin, active Android and both Rust profiles. It owns channel metadata/alias
precedence, repeated title/description selection, programme admission, timestamp
conversion and field scope. `NativeRecordRules` supplies stable programme order;
active Android retains the existing common interval deduplication policy.
Hosts retain XML decoding/security limits, Unicode primitives, native payload
storage and error objects. Swift/QuickJS bridge traffic is batched by token count
and byte budget; emitted collection operations are drained after each batch.

The compatibility profiles preserve concatenated, first and last field rules,
Foundation canonical ID equality, empty/missing attributes and QuickXML empty
element events. Conditional Rust decoding failures retain their original error
and precedence; malformed Swift input still clears only channels/programmes.
Fixtures captured before migration cover 100 parser results across five profiles,
with additional native batch/error boundaries. The actual shipping adapters run
these fixtures in their existing CI suites. Native XMLTV field limits, root/DTD
guards, decompress limits and programme caps remain platform protections.

`BrowserGuideRefresh` owns source normalization/order, per-URL stale-feed
retention, progressive merge selection, callback generations, status, retry
backoff and automatic-refresh notification decisions. Browser code keeps parsed
payloads and performs requests, cancellation, guide merging and UI updates.
Eighteen pre-migration scenarios preserve 67 complete state snapshots, including
removed/reordered sources, empty success, cancellation and foreground refresh.

`NativeGuideRefresh` owns sequential fetch/error/commit transitions for active
Android and the Rust server. Android stops at the first failed feed, preserves
data when there are no URLs, and validates the full current source under the
host's refresh lock before committing. Rust continues after feed errors and
returns a fresh empty result even when all feeds fail; a database-open error
propagates, while a persistence error still returns fresh memory. Rust metadata
uses shared first-feed ownership and its timer consumes the shared interval.
Hosts retain original errors, payloads, clocks, mutexes and atomic SQLite writes.
Captured public-API tests preserve eighteen Android and twenty-eight Rust
outcomes. Additional Android tests retain cancellation, completion-order commits
and full rollback on a later insert failure. SQL conflict behavior is unchanged.

The source uses the OttPlay MIT license. Generated JavaScript includes Kotlin's
Apache-2.0 runtime notices in `ottplay-core.LICENSE.txt`. The standard Gradle
wrapper retains its Apache-2.0 notices and pinned distribution checksum.

## Operator, durable-state and playback ownership

`OperatorSession` and the shared catalog builders own the classic operator API,
playlist fallback and partial-response behavior. Provider profiles supply endpoint
and credential rules. The base player's single operator transport adapter performs
XHR, interception and proxy effects; its provider files retain configuration/UI
wiring. `OperatorPortal` owns VPortal search, pagination, inherited metadata and
variant choices. `OperatorLifetime` owns request admission and bounded series
retention; cancellation handles stay in the host.

Durable selections, browser state, source-bound identity, legacy settings import,
backup portability and parental authorization live in common code. Profiles retain
classic list aliasing, native merge/eviction, browser redaction, rate limits and
source/session invalidation. JSON/URL codecs, cryptographic primitives, storage,
file permissions, consent prompts and payload identity stay in adapters.

Playback rules choose decoder order, format signatures, retry/recovery budgets,
seek gaps, saved tracks and native resume positions. Channel navigation owns the
catalog and switch generations that reject stale asynchronous callbacks. Media3,
HTML media/decoder calls, OS lifecycle events, timers and device APIs stay native.
The same ES5 artifact supplies the browser and classic decisions; Android calls
the JVM API directly.

The independent services consume generated wire contracts from the workspace's
`contracts/ottplay-wire-v1.json`. They do not embed a player runtime. Self-contained
generators and digest receipts reject edits to a generated policy, including when
building a consumer without this workspace.
