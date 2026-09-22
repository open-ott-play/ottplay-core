# OttPlay unification workspace

Status: common guide rules run in FOSS2, main web/iOS/Rust and Android consumers;
archive URL rules run in FOSS2, Android and all 13 main-player archive adapters.
M3U parsing runs in the same core for both clients, all 43 main-player playlist
adapters and three M3U media catalogs.
Xtream account/catalog/series rules now run in the same core for FOSS2 and
Android; the base player's embedded live catalog and short EPG also delegate.
Stalker/Ministra MAG sessions, pagination and media references now use the core
in FOSS2 and Android; Android and the base player also delegate JSON-RPC.
Browser XMLTV normalization, feed merging/affinity/coverage, protected lookup
caching, classic-player schedule/cache rules and Android programme ordering
now also delegate to the common core. Native source selection, first-source
ownership, memory/disk cache decisions and Rust atomic refresh decisions also
run in this core, with explicit platform compatibility profiles.
The Node guide filter also delegates identity/depth merging, streaming retention,
channel selection and round-robin output budgets to this core.
**The product migration is not complete.**
The five repository directories are isolated checkouts of the revisions recorded
in [inventory.json](inventory.json); existing installations are not modified.
The independent `ottplay-foss2` client is also in scope.

The requested outcome is one maintained implementation of player business logic
across the entire OttPlay family, with no copied legacy implementation in the new
core. Renaming inherited functions, copying them into a shared directory, or
maintaining matching JavaScript/Kotlin/Swift/Rust algorithms does not meet that
outcome. Generated compiler outputs are distributions of one source, not new
authoritative implementations.

## Reproduce this source tree

This private repository owns `shared-core` and `ottplay-foss2`. The other five
repositories remain independently versioned consumers/services. Their exact
integration commits are pinned in `checkouts.json`; `inventory.json` retains
the original revisions used to capture migration contracts.

With GitHub access to the organization (including the private Android repo):

```sh
python3 scripts/checkouts.py
cd shared-core
npm ci
./gradlew --no-daemon jvmTest jsNodeTest
npm run pack:core
npm run check:js
cd ../ottplay-foss2
npm ci
npm test
cd ../ottplay-foss
npm ci --ignore-scripts
cd ..
node scripts/check-unification.cjs
```

The checkout helper refuses to move an existing checkout to a different
revision. Consumer artifacts can be verified and built without this source
repository. To update the shared implementation, compile it once and use the
three install commands documented in `shared-core/README.md`, then update
consumer branches and their pins together.

GitHub Actions rebuilds the common JVM/ES5 outputs and checks the browser pin,
then runs FOSS2 contracts and Chromium EPG/compatibility journeys. Consumer PRs
run their own native/platform CI. `validation.json` records earlier local
qualification; its `reports/` references are local evidence, excluded from Git.
Source publication is separate from a product release or deployment.

## Observed starting point

- `ottplay-foss/src` still implements the classic global player contracts. Its
  linker and provider/device scripts depend on them. Removing the aliases alone
  would break integration, not remove the architecture.
- Playlist/provider, guide matching, time conversion and catch-up logic exist in
  several languages. Their behavior differs; unifying filenames would not make
  their results equivalent.
- Two native XMLTV implementations each had a second identical tracked copy:
  437 lines of Swift and 390 lines of Kotlin. Exact paths and hashes are recorded
  in the inventory. This is not an exhaustive semantic clone count.
- `ottplay-android/core` is a small independently developed JVM core, but depends
  directly on OkHttp, Java date/time, crypto, SAX and streams. Moving this module
  unchanged would not make it portable.
- FOSS2 has independently developed ES5 provider/state/UI modules, but its status
  document explicitly excludes historical operator-specific integrations and
  native playback bridges. It cannot replace every client unchanged.
- The current main checkout contains 47 provider directories. FOSS2's historical
  specification refers to 48 provider names. Directory count is not a verified
  count of supported commercial integrations.
- `ottplay-web-vitrine` already consumes the main player's release artifact. It
  should continue to publish a qualified build instead of acquiring player code.
- The control server and SWOP have separate service responsibilities. They need
  shared versioned wire contracts, not a copy of the playback runtime.

## Proposed dependency boundary

`shared-core/commonMain` owns source/catalog models, channel identity, provider
request/response state machines, EPG matching and schedule rules, catch-up,
favorites/history, settings migrations, parental authorization and playback
decisions. It receives time, randomness, storage and transport explicitly.

Platform code owns UI/focus, networking and TLS enforcement, secure storage,
streaming XML decoding, codecs, media sessions, DRM, operating-system lifecycle
and device APIs. An adapter may translate types and perform an effect; it must
not reimplement provider, identity, authorization or schedule decisions.

Kotlin Multiplatform is used for the migrated rules:

- JVM artifact for the native Android application; retain Compose and Media3.
- ES5 JavaScript artifact for old televisions, browsers, FOSS2, the desktop UI
  and the Node companion. No required WebAssembly, remote execution or Android
  JavaScript interpreter.
- The identical ES5 distribution runs in system JavaScriptCore on iOS and
  pinned rquickjs/QuickJS-NG in Rust. XML/media/networking remain native.
- Rust retains Alpine/musl packaging. A Kotlin/Native C library was not adopted
  because its Linux ABI would exclude that existing server target.
- Apple framework compilation remains a portability check, not an application
  dependency; consumers do not need Gradle or a sibling source checkout.

Kotlin documents [ES5 output](https://kotlinlang.org/docs/js-overview.html) and
[Apple frameworks](https://kotlinlang.org/docs/apple-framework.html). These
capabilities do not prove the final runtime works on a particular TV. Bundle
size, polyfill requirements, initialization cost and full provider behavior must
be measured before adopting this candidate for all clients.

## Confirmed product requirements

Preserve every existing TV/STB target and every historical provider integration.
The user confirmed both requirements. Platform/provider retirement is outside
this migration's scope. Retained proprietary protocols still need contract
fixtures and account/device acceptance; loading an old provider script is not a
replacement for a migrated implementation.

## Implemented integration

- `shared-core/src/commonMain` owns deterministic XMLTV date arithmetic, explicit
  browser/Android input formats, channel-name normalization, ordered guide ID
  selection, and current/next selection with safe cache intervals.
- FOSS2 browser and Node EPG filter load **the same generated JavaScript file**.
  Their displaced implementations were deleted. The browser's overlapping
  schedule cache also delegates to core, so it cannot acquire separate rules.
- The active Android application's SAX decoder delegates timestamp conversion
  to the generated JVM JAR. SAX, decompression limits and entity rejection stay
  in its platform adapter. Existing date-only input and offset limits survive.
- Compiler outputs carry one deterministic source receipt and SHA-256 hashes.
  Browser checks and Android's compile task verify the pinned artifact; the
  workspace guard also verifies both consumers against the same source build.
- Main-player iOS compiles the canonical Swift adapter directly from
  `mobile-xmltv-epg`. The archived Android tests compile their canonical Kotlin
  adapter directly. Two identical source copies (827 lines) were removed;
  native regression tests now reject their reintroduction.
- Native timestamp conversion, normalization, fuzzy/alias selection, regional
  shifts and guide windows now delegate to the same common implementation.
  Rust supplies UTF-8 lengths and float precision; Swift supplies Unicode
  canonical composition and grapheme counts. The archived Android fixture and
  main browser bridge also use the core, with their explicit input profiles.
- Rust runtime failures propagate as errors, distinct from an unmatched channel.
  Browser startup stops with a recoverable message when its core cannot load.
  Cargo, browser staging and iOS resource loading verify artifact receipts.
- A bounded common timestamp cache handles repeated XMLTV dates. Its eviction
  ring avoids scans of deleted hash slots on feeds with unique timestamps.
- `Archive.kt` owns archive retention, template expansion, component escaping,
  minute rounding, Flussonic resources and the retained provider URL formats.
  FOSS2 and Android delegate their archive decisions; all 13 main-player archive
  adapters delegate to the identical ES5 distribution. Displaced algorithms were
  deleted. Other provider sessions and the old timeshift playback controller remain.
- Compatibility is explicit: FOSS2 requires completed programmes, Android clips
  an ongoing programme to the supplied clock, and historical provider profiles
  retain Dune padding, recent absolute timeshift and their exact wire spellings.
  A fixed suite of 272 input/output examples records the original provider
  contracts. No inherited provider function is shipped inside the common core.
- URL parsing, the IANA zone database and transport header scoping remain host
  boundaries. Common tests run on JVM, JS and macOS; Android integration checks
  include daylight-saving folds and encoded resource names with signed queries.
- Docker's web build now receives the pinned core and its notices, so frontend
  staging can verify and package the same revision as the Rust server.

- `Playlist.kt` owns browser/Android line state, metadata inheritance, archive
  availability, group selection, duplicate handling and channel identity inputs.
  URL resolution, hashes, header decoding and DRM remain host primitives.
- `ProviderPlaylist.kt` and `OperatorPlaylist.kt` implement explicit retained
  provider formats. All 34 generic parsers, the base M3U parser, eight special
  operator parsers and three media parsers now delegate. Their displaced source
  and unused attribute helpers were deleted. The common core does not execute
  legacy scripts. Other provider sessions and EPG request adapters remain to migrate.
- 743 captured main-player cases and 26 FOSS2 cases preserve existing channel
  IDs, metadata, categories and wire payloads. Android tests cover directive
  scoping, duplicate validation, localized generated names and HLS detection.
  Browser M3U inputs now share Android's 32 Mi-code-unit input, 1 Mi-code-unit
  line and 100,000-channel bounds. Prototype-named groups use safe dictionaries.
- `XtreamSession`, `XtreamCatalogs` and `LegacyXtream` own Xtream authentication,
  request ordering, optional-section policy, channel/episode identity, categories,
  metadata, archive eligibility, stream routes, season grouping and short EPG
  record selection. FOSS2, Android and the base player contain transport and model
  adapters. Their displaced normalization and route-selection code was removed.
- Compatibility profiles preserve the base player's name-hash IDs and raw stream
  references, FOSS2's strict authentication/numeric IDs and Android's embedded
  live response, optional HTTP 404/405/501 sections and localized fallback names.
  Native limits count rows before deduplication and stop before the next section.
  JSON/URL codecs, HTTP/cancellation, date decoding and UI remain host effects.
- Fixed pre-migration fixtures cover 58 FOSS2, 68 Android and 13 base-player
  Xtream contracts. Additional common tests exercise early limits, malformed
  data, identity and request order; browser cancellation tests interrupt every
  catalog stage. The JS ABI is also exercised under the ES5 API simulations.

- `StalkerProtocol`, `StalkerPages`, `StalkerBrowserSession`, `StalkerNativeLoad`
  and `LegacyStalker` own MAG/JSON-RPC requests, authentication policy, bounded
  retries/pagination, catalog identities and media-link interpretation. Hosts
  retain HTTP, cancellation, mutexes, JSON/URL codecs and public model conversion.
- Captured contracts cover 52 FOSS2, 63 Android and 19 base-player scenarios.
  Browser raw-row and native unique-row pagination retain their existing order
  of completion and failure checks. Tokens and opaque media commands stay in
  the browser session; stale generations cannot resolve media.
- BEST LiST uses the same classic Xtream adapter and retains both historical
  M3U fallback URL forms; 12 captured cases cover that removed parser copy.
- ES5 API simulations exercise Stalker loading/playback, JSON-RPC and Xtream
  fallbacks. Literal replacement avoids Kotlin/JS Unicode-RegExp construction,
  including the existing antifriz logo rewrite. A source guard prevents regression.

- `GuideFeeds` owns browser XMLTV record validation, missing-stop inference,
  duplicate/metadata precedence, name indexes, feed-scoped identity and source
  preference. `GuideCoverage` validates and combines partial-window metadata.
  The browser decodes XML and resolves URLs; merging preserves programme object
  references and aliases to unambiguous schedules.
- `GuideLookupCache` retains the browser stable/rotating cache and shifted-entry
  budget; `GuideScheduleMemo` caches selections only inside a safe interval.
  Classic-player full-schedule TTL/LRU and now/next selection now use explicit
  common policies. The classic inclusive endpoint and first overlap remain
  distinct from the browser half-open/latest-start policy.
- Android XMLTV validation, first-duplicate retention and channel/start ordering
  use the same core. Captured migration cases cover 44 browser, 44 classic-player
  and 33 Android scenarios; independent common tests run on JVM, JS and macOS.

Run `node scripts/check-unification.cjs` after building/distributing the core.
It verifies migrated artifacts and the retained provider/device file inventory.
This is a structural guard, not proof of device or provider acceptance.

- `StreamingGuide` owns the Node companion's request identity/depth merging,
  candidate matching, metadata precedence, archive windows, bounded programme
  retention and round-robin output budgets. Payloads remain opaque to the core;
  XML/gzip/HTTP, URL validation, UTF-8 byte counts and response serialization
  stay in the adapter. The displaced Node algorithms were deleted.
- 110 captured HTTP responses preserve exact XML order, coverage attributes,
  ambiguous metadata, late candidate discovery, fractional limits and UTF-8
  output limits. Ten common scenarios exercise the rules on JVM, JS and macOS;
  the public bridge also runs in both ES5 API simulations.

- `NativeSourceLoad` selects fresh disk, network, memory and stale-disk outcomes
  for Swift and archived Android. `NativeSourceBatch` owns ordered partial
  success and first-error selection. The adapters retain only effects and native
  payload/error storage for these decisions. The platform write-failure and
  second-parse contracts are explicit compatibility profiles.
- 77 additional contracts were verified on unchanged revision `d24f07be` before
  migration, then on the shared implementation. These include real write
  failures and delayed callbacks, plus the existing 118 source/cache cases.
- `XmltvRecords` interprets native decoded XMLTV events in one implementation.
  Swift, archived Kotlin, active Android and Rust retain explicit compatibility
  profiles for metadata, repeated fields, empty IDs and programme admission.
  Native parsers retain XML security/decoding and apply the shared collection
  operations. Swift/Rust transport uses bounded event batches.
- 100 captured results from `c021259` / Android `1ade13f` cover all five native
  profiles; additional fixtures exercise batch boundaries and error precedence.
  Native validation limits and errors remain covered by the shipping adapters.

## Remaining work

EPG source aggregation/refresh, remaining streaming field extraction, other
operator sessions and catalog/identity rules, state migrations, playback
controllers and service wire contracts still need migration. No whole client is yet
fully free of inherited player logic. No release has been published or deployed.
Archive URLs, M3U and Xtream availability metadata are migrated; other provider
metadata and playback/timeshift state remain.

## Migration order

1. Inventory active entry points, exact client versions, provider/device
   contracts and storage schemas. Capture executable behavioral fixtures and
   explicitly decide conflicting semantics.
2. Prove one common implementation can run on JVM, ES5 and Apple targets. Guide rules now run from `shared-core` in the browser, Node filter and Android
   decoder. The same generated ES5 code also runs in native Swift/Rust adapters
   and the main browser bridge. Retained device/account acceptance remains open.
3. Finish migrating one whole subsystem at a time behind a stable API: EPG, channel identity,
   playlist parsing, provider sessions/catch-up, then durable state and playback
   decisions. Test adapters against the same fixtures and replace consumers.
   Delete each displaced implementation as its consumers migrate.
4. Replace the inherited main-player controllers and global state contracts.
   Keep old settings import at the data boundary. Do not load legacy player,
   provider or device implementation as a hidden fallback.
5. Package one core revision for every retained client. Vitrine consumes the
   qualified browser artifact; service contracts are generated from one schema.
6. Verify application builds, migration/rollback, full browser/native workflows
   and physical-device acceptance. Only then remove obsolete packages and make
   the unified line the release default.

## Completion gates

- Every retained client consumes the same versioned core source revision.
- No maintained duplicate of migrated domain logic remains in any platform.
- New runtime bundles have no dependency on inherited player implementation.
- Native adapters contain platform effects and type conversion only.
- One fixture suite exercises all compiled core targets, including malformed
  data, Unicode, time zones, identity ambiguity and cancellation races.
- Settings migration preserves sources, credentials, favorites, parental
  protection, history and resume positions, and has a tested rollback path.
- All retained device/provider contracts have an explicit acceptance result.
- CI rejects legacy dependency reintroduction and unreviewed duplication;
  generated bundles are checked against their source revision and hashes.

Passing the migrated guide tests does not satisfy the remaining product
completion gates or certify physical devices. See `validation.json` for the
verified scope and outstanding checks.
