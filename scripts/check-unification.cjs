"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const inventory = JSON.parse(fs.readFileSync(path.join(root, "inventory.json")));
const core = path.join(root, "shared-core");
execFileSync("python3", [path.join(root, "scripts/generate-wire-contracts.py"), "--check"], { stdio: "inherit" });
function node(file, ...args) { execFileSync(process.execPath, [file, ...args], { cwd: root, stdio: "inherit" }); }
node(path.join(core, "scripts/check-boundary.cjs"));
node(path.join(core, "scripts/distribute.cjs"), "check-web", path.join(root, inventory.additional_client.path));
node(path.join(root, inventory.additional_client.path, "scripts/check-core.cjs"));
node(path.join(core, "scripts/distribute.cjs"), "check-jvm", path.join(root, "ottplay-android"));
const main = path.join(root, "ottplay-foss");
node(path.join(core, "scripts/distribute.cjs"), "check-native", main);
node(path.join(main, "scripts/shared-core.cjs"));
node(path.join(main, "tests/test_archive_core.cjs"));
node(path.join(main, "tests/test_playlist_core.cjs"));
node(path.join(main, "tests/test_xtream_core.cjs"));
node(path.join(main, "tests/test_stalker_core.cjs"));
node(path.join(main, "tests/test_guide_core.cjs"));
for (const [file, apis, displaced] of [
    ["core/src/main/kotlin/play/ott/nativeapp/core/LegacySourceImporter.kt", ["LegacySettingsImport.native"], /fun asObject|containsKey\("ottplay/],
    ["core/src/main/kotlin/play/ott/nativeapp/core/ProviderRepository.kt", ["OperatorSources.relationship", "OperatorSources.credentials"], /config\.username\.isBlank/],
    ["app/src/main/java/play/ott/nativeapp/data/SettingsBackupPolicy.kt", ["DurableSelections.validateBackup", "DurableSelections.mergeResume"], /while \(.*size|takeLast/],
    ["app/src/main/java/play/ott/nativeapp/playback/ChannelNavigator.kt", ["ChannelNavigation", "policy.acceptCatalog", "policy.canCommit"], /distinctBy|Math\.floorMod|private var targetId/],
    ["app/src/main/java/play/ott/nativeapp/playback/PlaybackProgressRecorder.kt", ["PlaybackRules.nativeResume"], /durationMs \/ 20/]
]) {
    const source = fs.readFileSync(path.join(root, "ottplay-android", file), "utf8");
    for (const api of apis) assert(source.includes(api + "("), "Android must delegate " + api);
    assert(!displaced.test(source), "Android domain policy reintroduced: " + file);
}
const guideAdapter = fs.readFileSync(path.join(root, "ottplay-android/core/src/main/kotlin/play/ott/nativeapp/core/XmltvParser.kt"), "utf8");
assert(guideAdapter.includes("GuideProgrammeRules.androidOrder(") && guideAdapter.includes("XmltvRecords(XmltvRecordFormat.ANDROID)"), "Android programme rules must use the common core");
assert(!/distinctBy|sortedWith|to > from/.test(guideAdapter), "Android programme normalization reintroduced");
const legacyGuide = fs.readFileSync(path.join(main, "src/channels/index.ts"), "utf8");
for (const api of ["legacyGuideSelection", "legacyGuideShift", "legacyGuideCacheCapacity", "legacyGuideCacheRead", "legacyGuideCacheOrder"]) assert(legacyGuide.includes("." + api + "("), "Base-player guide must use " + api);
assert(!/EPG_CACHE_TTL_MS|sorted\.findIndex|epgCacheChannelOrder\.(?:splice|unshift)|epgData!\.slice\(\)\.sort/.test(legacyGuide), "Base-player guide rules reintroduced");
const playlistAdapter = fs.readFileSync(path.join(root, "ottplay-android/core/src/main/kotlin/play/ott/nativeapp/core/M3uParser.kt"), "utf8");
assert(playlistAdapter.includes("Playlist.read("), "Android playlists must use the common core");
assert(!/commaOutsideQuotes|private fun attributes|#EXTINF:/.test(playlistAdapter), "Android playlist parsing reintroduced");
const browserProvider = fs.readFileSync(path.join(root, inventory.additional_client.path, "src/providers.js"), "utf8");
assert(browserProvider.includes("OttPlayCore.parseBrowserPlaylist("), "FOSS2 playlists must use the common core");
assert(!/function (?:titleComma|archiveDays|attributes)\(/.test(browserProvider), "Browser playlist decisions reintroduced");
assert(browserProvider.includes("new root.OttPlayCore.XtreamClient("), "FOSS2 Xtream must use the common core");
assert(!/function (?:normalizeXtream|normalizeSeries|streamUrl|numericId)\(/.test(browserProvider), "Browser Xtream decisions reintroduced");
const nativeXtream = fs.readFileSync(path.join(root, "ottplay-android/core/src/main/kotlin/play/ott/nativeapp/core/XtreamProvider.kt"), "utf8");
assert(nativeXtream.includes("XtreamLoad(") && nativeXtream.includes("XtreamCatalogs.episodes("), "Android Xtream must use the common core");
assert(!/get_live_streams|get_vod_streams|get_series_info|tv_archive_duration|container_extension/.test(nativeXtream), "Android Xtream wire decisions reintroduced");
const legacyXtream = fs.readFileSync(path.join(main, "prov/xtream/prov.js"), "utf8");
assert(legacyXtream.includes("OttPlayCore.legacyXtreamClient(") && legacyXtream.includes("client.guide("), "Base-player Xtream must use the common core");
assert(!/live_streams|epg_listings|player_api\.php|function addChan2cat/.test(legacyXtream), "Base-player Xtream rules reintroduced");
assert(browserProvider.includes("new root.OttPlayCore.StalkerClient(") && browserProvider.includes("OttPlayCore.stalkerConfig("), "FOSS2 Stalker must use the common core");
assert(!/function (?:portalItem|pagedPortal|portalRequest)|get_ordered_list|create_link/.test(browserProvider), "Browser Stalker rules reintroduced");
const nativeStalker = fs.readFileSync(path.join(root, "ottplay-android/core/src/main/kotlin/play/ott/nativeapp/core/StalkerProvider.kt"), "utf8");
assert(nativeStalker.includes("StalkerNativeLoad(") && nativeStalker.includes("StalkerRetry("), "Android Stalker must use the common core");
assert(!/get_ordered_list|create_link|total_items|tv_genre_id/.test(nativeStalker), "Android Stalker rules reintroduced");
const legacyStalker = fs.readFileSync(path.join(main, "prov/stalker/prov.js"), "utf8");
assert(legacyStalker.includes("new OttPlayCore.LegacyStalkerClient("), "Base-player Stalker must use the common core");
assert(!/stalkerApiCall\(\s*["']get_channels|get_epg_info|function addChan2cat|loadChannelsFromStalker/.test(legacyStalker), "Base-player Stalker rules reintroduced");
const bestlist = fs.readFileSync(path.join(main, "prov/bestlist/stalker/prov.js"), "utf8");
assert(bestlist.includes("OttPlayCore.legacyXtreamClient(") && bestlist.includes("fallbackPlaylist("), "BEST LiST must use the common Xtream core");
assert(!/live_streams|player_api\.php|function addChan2cat/.test(bestlist), "BEST LiST Xtream rules reintroduced");
function playlists(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) playlists(file);
        else if (entry.name === "prov.js") assert(!/#EXTINF:/.test(fs.readFileSync(file, "utf8")), "Provider M3U parser reintroduced: " + file);
    }
}
playlists(path.join(main, "prov"));
const archiveAdapter = fs.readFileSync(path.join(root, "ottplay-android/core/src/main/kotlin/play/ott/nativeapp/core/CatchupResolver.kt"), "utf8");
assert(archiveAdapter.includes("Archive.resolve("), "Android archive must use the common core");
assert(!/private fun flussonic|val replacements|substituted\.replace/.test(archiveAdapter), "Android archive decisions reintroduced");
for (const [file, forbidden] of [
    ["mobile-xmltv-epg/src/ios/MobileXmltvEpg.swift", /DateFormatter|NSRegularExpression|func (?:normalize|matchScore|regionalShift)/],
    ["mobile-xmltv-epg/src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt", /SimpleDateFormat|fun (?:normalize|matchScore|regionalShift)/],
    ["src-rs/core/src/xmltv.rs", /NaiveDateTime|RE_TS|best_score|by_norm/],
    ["src/plugins/m3u-proxy.ts", /normalizeNativeEpgName|nativeEpgMatchScore/]
]) assert(!forbidden.test(fs.readFileSync(path.join(main, file), "utf8")), "Migrated guide logic reintroduced: " + file);
for (const [file, required, forbidden] of [
    ["mobile-xmltv-epg/src/ios/MobileXmltvEpg.swift", "xmltvAccept", /currentProgTitle|currentProgChannel|enum TextTarget/],
    ["mobile-xmltv-epg/src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt", "XmltvRecords(", /currentProgTitle|currentProgChannel|channels\.putIfAbsent/],
    ["src-rs/core/src/xmltv.rs", "GuideRecords", /current_programme|current_channel|enum TextTarget|sort_by_key/]
]) {
    const source = fs.readFileSync(path.join(main, file), "utf8");
    assert(source.includes(required) && !forbidden.test(source), "Native XMLTV record rules must use the common core: " + file);
}
for (const [file, required] of [
    ["mobile-xmltv-epg/src/ios/MobileXmltvEpg.swift", ["nativeGuideSources", "nativeGuideUnowned", "nativeGuideLookup", "nativeGuideDisk", "nativeGuideLoadStart", "nativeGuideLoadNext", "NativeGuideSourceBatch"]],
    ["mobile-xmltv-epg/src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt", ["NativeGuideSources.urls", "NativeGuideSources.unowned", "NativeGuideSources.lookupAndroid", "NativeGuideSources.diskAndroid", "NativeSourceLoad.start", "NativeSourceLoad.next", "NativeSourceBatch("]],
    ["src-rs/core/src/native_xmltv.rs", ["shared_guide::unowned", "shared_guide::source_fresh", "shared_guide::source_refresh", "shared_guide::evict_source_set"]]
]) {
    const source = fs.readFileSync(path.join(main, file), "utf8");
    for (const api of required) assert(source.includes(api), "Native source/cache rules must use " + api);
    assert(!/TTL_SECONDS|const TTL:|private let ttl:|cdn\.epg\.one|channels\.contains_key\(&id\)/.test(source), "Native source/cache decisions reintroduced: " + file);
    if (file.startsWith("mobile-xmltv-epg/")) assert(!/firstError|fun fallback\(|if\s*\(?\s*!force\)?[,\s]+(?:let xml|\{\s*val cached)/.test(source), "Native offline fallback decisions reintroduced: " + file);
}
const repository = fs.readFileSync(path.join(root, "ottplay-android/app/src/main/java/play/ott/nativeapp/data/NativeRepository.kt"), "utf8");
assert(repository.includes("providers.epgSources(source, catalog)"), "Active Android EPG sources must use the core adapter");
assert(repository.includes("NativeGuideRefresh(") && repository.includes("NativeGuideRefreshAction.VALIDATE_SOURCE"), "Active Android refresh must use shared transitions");
assert(!/urls\.flatMap\s*\{\s*providers\.loadEpg/.test(repository), "Android refresh aggregation policy reintroduced");
const serverRefresh = fs.readFileSync(path.join(main, "src-rs/core/src/lib.rs"), "utf8");
assert(serverRefresh.includes("shared_guide::GuideRefresh::new(") && serverRefresh.includes("refresh.unowned(") && serverRefresh.includes("shared_guide::refresh_interval("), "Server guide refresh must use shared transitions, ownership and interval");
assert(!/all_channels\.entry|Duration::from_secs\(2 \* 3600\)/.test(serverRefresh), "Server refresh policy reintroduced");
for (const provider of inventory.provider_directories) assert(fs.statSync(path.join(main, "prov", provider)).isDirectory(), "Retained provider removed: " + provider);
for (const adapter of inventory.device_adapters) assert(fs.statSync(path.join(main, adapter)).isFile(), "Retained device removed: " + adapter);
execFileSync("python3", [path.join(main, "tests/test_native_epg_cache.py"), "--check-sources-only"], { stdio: "inherit" });
assert(inventory.product_decisions.retain_historical_tv_stb_platforms);
assert(inventory.product_decisions.retain_all_named_provider_integrations);
console.log("PASS unified guide/archive/playlist/Xtream/Stalker artifacts, operator/state/playback delegation, native source ownership and retained provider/device inventory");
