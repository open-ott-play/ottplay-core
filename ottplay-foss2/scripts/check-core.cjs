"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "vendor/ottplay-core.manifest.json")));
assert.equal(manifest.name, "ottplay-shared-core");
assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
for (const file of ["ottplay-core.js", "ottplay-core.LICENSE.txt"]) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "vendor", file))).digest("hex");
    assert.equal(hash, manifest.artifacts[file].sha256, "Modified shared core distribution: " + file);
}
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const polyfills = html.indexOf('src="/vendor/core-js.min.js"');
const core = html.indexOf('src="/vendor/ottplay-core.js"');
assert(polyfills >= 0 && polyfills < core && core < html.indexOf('src="/src/epg.js"'), "Core must load after polyfills and before EPG");
for (const file of ["src/epg.js", "scripts/epg.cjs"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const api of ["WebXmltvRecords", "canonicalChannelName", ...(file === "src/epg.js" ? ["parseBrowserXmltvTime", "selectGuideSchedule", "parseBrowserGuide", "mergeBrowserGuides", "matchedGuideChannel"] : ["streamingGuideIdentities", "StreamingGuideFilter"])]) assert(source.includes("core." + api + "("), file + " must use core." + api);
    assert(!source.includes("setUTCFullYear"), "XMLTV date arithmetic belongs to shared core: " + file);
}
const streaming = fs.readFileSync(path.join(root, "scripts/epg.cjs"), "utf8");
for (const api of ["channel", "accepts", "programme", "output"]) assert(streaming.includes("guide." + api + "("), "Streaming guide must use core " + api);
assert(!/candidateDepths|programmeCap|nextCandidates|function priority|86400|for \(let round/.test(streaming), "Streaming guide selection or retention reintroduced");
const epg = fs.readFileSync(path.join(root, "src/epg.js"), "utf8");
assert(epg.includes("new core.BrowserGuideLookup("), "Guide lookup cache must use the common core");
assert(!/function (?:addName|mergeCoverage|coverageNumber|plainMatchedId)|retainedEntries|nextStart|list\.sort/.test(epg), "Displaced guide normalization/cache implementation reintroduced");
assert(epg.includes("core.archiveUrl("), "Archive resolution must delegate to the common core");
assert(!/duration: duration|identifiesProgramme|timeshift_abs-|function pad\(/.test(epg), "Displaced archive implementation reintroduced");
const providers = fs.readFileSync(path.join(root, "src/providers.js"), "utf8");
assert(core < html.indexOf('src="/src/providers.js"'), "Core must load before providers");
assert(providers.includes("OttPlayCore.parseBrowserPlaylist("), "M3U parsing must delegate to the common core");
assert(!/function (?:attributes|titleComma|archiveDays)\(/.test(providers), "Displaced playlist parser reintroduced");
assert(providers.includes("new root.OttPlayCore.XtreamClient("), "Xtream must delegate to the common core");
assert(!/function (?:normalizeXtream|normalizeSeries|streamUrl|numericId)\(/.test(providers), "Displaced Xtream rules reintroduced");
assert(providers.includes("new root.OttPlayCore.StalkerClient(") && providers.includes("OttPlayCore.stalkerConfig("), "Stalker must delegate to the common core");
assert(!/function (?:portalItem|pagedPortal|portalRequest)|get_ordered_list|create_link/.test(providers), "Displaced Stalker rules reintroduced");
const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
assert(app.includes("new environment.OttPlayCore.BrowserGuideRefresh("), "Browser refresh must use the common core");
for (const api of ["normalize", "begin", "accepts", "complete", "reset", "destroy", "isDue"]) assert(app.includes("guideRefresh." + api + "("), "Browser refresh must use shared " + api);
assert(!/guideEpoch|guideDue|guideFailures|lastEpgUrls|results\.some|Math\.pow/.test(app), "Browser refresh retention/backoff/generation policy reintroduced");
const media = fs.readFileSync(path.join(root, "src/media.js"), "utf8");
for (const api of ["PlaybackRetries", "PlaybackRecovery", "PlaybackEngineSequence", "playbackEngines", "playbackFormat", "playbackSeek", "playbackDeclaredFormat", "playbackBodyFormat"]) assert(media.includes("core." + api + "("), "Playback rules must use " + api);
assert(!/var retryCount|var engineIndex|var mediaRecoveryUsed|function language\(/.test(media), "Playback policy reintroduced");
for (const [file, apis, displaced] of [
    ["src/state.js", ["validateBrowserState", "pruneBrowserSources", "exportBrowserState"], /function reference\(|function track\(/],
    ["src/library.js", ["restoreChannelIndex", "libraryDecorate", "favoriteListChange", "libraryToggleReminder"], /function legacyTvgId|candidates\.filter/],
    ["src/channel-identity.js", ["rememberChannelIdentity", "reconcileChannelIdentity", "channelIdentityPermission"], /function candidates\(|function move\(/],
    ["src/security.js", ["BrowserParentalSession", "parentalValidate", "parentalProtected", "parentalFailedBlock"], /playbackActions|maxBlock|grantUntil = 0/],
    ["src/migration.js", ["previewLegacySettings"], /function (?:embedded|xtream|oldIds)\(/],
    ["src/playback-preferences.js", ["playbackTrack", "libraryPreferenceIndex", "librarySavePreference"], /function language\(|candidates\.filter/],
    ["src/providers.js", ["OperatorRequestClient", "OperatorLifetimeClient", "operatorBrowserConfig", "operatorSourceRelationship"], /var sessions =|var seriesCache =/]
]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const api of apis) assert(source.includes("." + api + "("), file + " must use " + api);
    assert(!displaced.test(source), "Displaced domain implementation reintroduced: " + file);
}
console.log("PASS shared core receipt, bootstrap order and guide/archive/playlist/Xtream/Stalker delegation");
