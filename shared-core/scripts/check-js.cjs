"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parse } = require("acorn");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "dist/ottplay-core.js");
const bundle = fs.readFileSync(file, "utf8");
parse(bundle, { ecmaVersion: 5, sourceType: "script" });

function verify(context, profile) {
    vm.runInContext(bundle, context, { timeout: 10000 });
    const core = context["play.ott:ottplay-shared-core"];
    assert(core, profile + ": classic-script export is available");
    const timelineRows = [{id:"old",start:0,end:10},{id:"new",start:10,end:20},{id:"overlap",start:12,end:18},{id:"tie",start:12,end:19},null,{start:"0",end:100}];
    const selected = core.guideScheduleSelection(timelineRows,12,3);
    assert.strictEqual(selected.current,timelineRows[2]);
    assert.strictEqual(core.guideScheduleSelection(timelineRows,10,0).current,timelineRows[1]);
    assert.strictEqual(core.guideScheduleSelection(timelineRows,18,0).current,timelineRows[3]);
    assert.equal(selected.retryAt,18);
    assert.deepEqual(Array.from(core.guideScheduleSelection(timelineRows,-1,2).following),timelineRows.slice(0,2));
    assert.equal(core.guideProgrammeId("s","c",null,0),"programme:1:s1:c7:start:0");
    assert.equal(core.guideProgrammeId("s","c",42,0),core.guideProgrammeId("s","c","42",20));
    assert.notEqual(core.guideProgrammeId("s","c",42,0),core.guideProgrammeId("s","other",42,0));

    const archivePayload = { label: "Opaque presentation", nested: { retained: true } };
    const archiveVisit = { sourceId: "source-a", channelId: "one", kind: "archive", archiveStart: 1000, payload: archivePayload };
    const liveVisit = { sourceId: "source-a", channelId: "one", kind: "live", payload: { category: 3 } };
    const otherSourceVisit = { sourceId: "source-b", channelId: "one", kind: "live", payload: {} };
    const sessionChange = core.playbackSessionTransition(archiveVisit, liveVisit, [archiveVisit, liveVisit, otherSourceVisit], 45, 10);
    assert.equal(sessionChange.history.length, 2);
    assert.equal(sessionChange.history[0].archiveStart, 1045);
    assert.equal(sessionChange.history[0].payload, archivePayload, profile + ": presentation payload identity survives the facade");
    assert.equal(sessionChange.history[1].sourceId, "source-b");
    assert.equal(archiveVisit.archiveStart, 1000, profile + ": history planning never mutates caller targets");
    const movieVisit = { sourceId: "source-a", channelId: "movie", kind: "vod", payload: archivePayload };
    const departure = core.playbackSessionTransition(movieVisit, null, [], 120.5, 5);
    assert.equal(departure.current, null);
    assert.equal(departure.effects[0].type, "save-position");
    assert.equal(departure.effects[0].position, 120.5);
    assert.equal(departure.effects[0].target.payload, archivePayload);
    const channelHistory = core.playbackSessionTransition(movieVisit, otherSourceVisit, [movieVisit, liveVisit], 120.5, 1, ["live", "archive"]);
    assert.equal(channelHistory.history.length, 1);
    assert.equal(channelHistory.history[0].channelId, "one");
    assert.equal(channelHistory.history[0].kind, "live");
    assert.equal(channelHistory.effects[0].type, "save-position");
    assert.equal(core.playbackSessionTransition(movieVisit, null, [liveVisit], 120.5, 1).history[0].kind, "vod");
    assert.throws(() => core.playbackSessionTransition(movieVisit, null, [], 120.5, 1, ["unknown"]), /Unknown recorded playback kind/);
    assert.throws(() => core.playbackSessionTransition(movieVisit, null, [], 120.5, 1, "live"), /Recorded playback kinds must be an array/);
    assert.equal(core.playbackSessionTransition(null, movieVisit, [], null, 5).effects[0].type, "restore-position");
    assert.equal(core.playbackSeekPlan(archiveVisit, { intent: "offset", value: 30, position: 100, now: 2000, archiveAvailable: true }).archiveStart, 1130);
    assert.equal(core.playbackSeekPlan(archiveVisit, { intent: "absolute", value: 2000, now: 2000 }).action, "go-live");
    assert.equal(core.playbackSeekPlan(movieVisit, { intent: "absolute", value: 100, duration: 100 }).position, 100);
    assert.equal(core.playbackSeekPlan(movieVisit, { intent: "absolute", value: 101, duration: 100 }).action, "noop");
    assert.equal(core.playbackSeekPlan(movieVisit, { intent: "begin" }).position, 0);
    assert.equal(core.playbackSeekPlan(liveVisit, { intent: "begin", now: 2000, archiveAvailable: true }).action, "noop");
    const playbackOwner = new core.PlaybackSessionOwnership();
    const otherPlaybackOwner = new core.PlaybackSessionOwnership();
    const previousPlaybackTicket = playbackOwner.begin();
    assert.equal(playbackOwner.accepts(previousPlaybackTicket), true);
    assert.equal(otherPlaybackOwner.accepts(previousPlaybackTicket), false);
    const currentPlaybackTicket = playbackOwner.begin();
    assert.equal(playbackOwner.accepts(previousPlaybackTicket), false);
    assert.equal(playbackOwner.accepts(currentPlaybackTicket), true);
    playbackOwner.cancel();
    assert.equal(playbackOwner.accepts(currentPlaybackTicket), false);
    assert.equal(playbackOwner.accepts(null), false);
    assert.equal(JSON.stringify(core.nativeGuideSources([" "], "https://explicit.test", value => value.trim())), '["https://cdn.epg.one/epg2.xml.gz"]');
    assert.equal(JSON.stringify(core.nativeGuideUnowned(["old"], ["old", "__proto__", "new", "new"])), '["__proto__","new"]');
    assert.equal(core.nativeGuideLookup(7200, 0, false, true), "JOIN");
    assert.equal(core.nativeGuideLookup(7199, 0, false, true), "CACHE");
    assert.equal(core.nativeGuideLookup(7199, 0, true, true), "JOIN");
    assert.equal(core.nativeGuideLookup(0, null, false, false), "LOAD");
    assert.equal(core.nativeGuideDisk("a", "a", 7200, 0, false), false);
    assert.equal(core.nativeGuideDisk("a", "b", 0, 0, true), false);
    assert.equal(core.nativeGuideDisk("a", "a", 0, NaN, true), true);
    assert.equal(core.nativeGuideFresh(7199), true);
    assert.equal(core.nativeGuideFresh(7200), false);
    assert.equal(core.nativeGuideRefresh(true, false, true), "STALE");
    assert.equal(core.nativeGuideRefresh(true, false, false), "REPLACE");
    assert.equal(core.nativeGuideRefresh(true, true, false), "FAIL");
    assert.equal(core.nativeGuideEvictSourceSet(8, false), true);
    assert.equal(core.nativeGuideEvictSourceSet(8, true), false);
    assert.equal(core.nativeGuideLoadStart(false), "READ_FRESH_DISK");
    assert.equal(core.nativeGuideLoadStart(true), "FETCH");
    for (const format of ["swift", "android"]) {
        assert.equal(core.nativeGuideLoadNext("FETCH", true, 0, format), "READ_MEMORY");
        assert.equal(core.nativeGuideLoadNext("READ_MEMORY", true, 0, format), "USE_MEMORY");
        assert.equal(core.nativeGuideLoadNext("READ_MEMORY", false, 0, format), "READ_STALE_DISK");
        assert.equal(core.nativeGuideLoadNext("READ_STALE_DISK", true, 1, format), "USE_STALE_DISK");
        assert.equal(core.nativeGuideLoadNext("WRITE_DISK", false, 1, format), format === "swift" ? "READ_MEMORY" : "USE_NETWORK");
    }
    assert.equal(core.nativeGuideLoadNext("REPARSE_NETWORK", false, 0, "swift"), "FAIL");
    const batch = new core.NativeGuideSourceBatch(3);
    assert.equal(batch.next(), 0); batch.advance(false, 0);
    assert.equal(batch.next(), 1); batch.advance(true, 0);
    assert.equal(batch.next(), 2); batch.advance(false, 0);
    assert.equal(batch.next(), -1); assert.equal(batch.failure(), 0);
    const partialBatch = new core.NativeGuideSourceBatch(2);
    partialBatch.advance(false, 0); partialBatch.advance(true, 1);
    assert.equal(partialBatch.failure(), -1);
    assert.equal(new core.NativeGuideSourceBatch(0).failure(), -1);
    const androidRefresh = new core.NativeGuideRefresh(2, "android");
    assert.equal(androidRefresh.action(), "FETCH");
    androidRefresh.advance(true); assert.equal(androidRefresh.index(), 1);
    androidRefresh.advance(true); assert.equal(androidRefresh.action(), "VALIDATE_SOURCE");
    androidRefresh.advance(false); assert.equal(androidRefresh.action(), "SKIP");
    const serverRefresh = new core.NativeGuideRefresh(2, "rust-server");
    assert.equal(JSON.stringify(serverRefresh.unowned(["a", "__proto__", "a"])), '["a","__proto__"]');
    serverRefresh.advance(true);
    assert.equal(JSON.stringify(serverRefresh.unowned(["a", "b", "__proto__"])), '["b"]');
    serverRefresh.advance(false); assert.equal(serverRefresh.action(), "OPEN_DATABASE");
    serverRefresh.advance(true, true); assert.equal(serverRefresh.action(), "WRITE_DATABASE");
    serverRefresh.advance(false); assert.equal(serverRefresh.action(), "REPLACE");
    assert.equal(core.nativeGuideRefreshInterval("rust-server"), 7200);
    assert.equal(new core.NativeGuideRefresh(0, "android").action(), "SKIP");
    const emptyRefresh = new core.NativeGuideRefresh(0, "rust-server");
    emptyRefresh.advance(false); assert.equal(emptyRefresh.action(), "FAIL");
    const browserRefresh = new core.BrowserGuideRefresh();
    assert.equal(JSON.stringify(browserRefresh.normalize([null, "http://epg.it999.ru/epg2.xml.gz", "https://cdn.epg.one/epg2.xml.gz", "b"])), '["https://cdn.epg.one/epg2.xml.gz","b"]');
    let refreshState = browserRefresh.begin(["a", "b"], false);
    const firstEpoch = refreshState.generation;
    refreshState = browserRefresh.complete(firstEpoch, 1, true, null, 100);
    assert.equal(JSON.stringify(refreshState.feeds), '["b"]');
    assert.equal(refreshState.info.phase, "loading");
    refreshState = browserRefresh.complete(firstEpoch, 0, true, null, 100);
    assert.equal(JSON.stringify(refreshState.feeds), '["a","b"]');
    assert.equal(refreshState.info.phase, "ready");
    assert.equal(browserRefresh.isDue(1800100), true);
    refreshState = browserRefresh.begin(["b"], true);
    assert.equal(browserRefresh.complete(firstEpoch, 0, true, null, 0), null);
    refreshState = browserRefresh.complete(refreshState.generation, 0, false, "TIMEOUT", 500);
    assert.equal(refreshState.notify, false); assert.equal(refreshState.due, 60500);
    assert.equal(JSON.stringify(refreshState.feeds), '["b"]');
    browserRefresh.reset(true); assert.equal(browserRefresh.snapshot().info.phase, "idle");
    browserRefresh.destroy(); assert.equal(browserRefresh.begin(["a"], false), null);
    for (const format of ["swift", "android", "rust", "rust-native"]) {
        const records = new core.XmltvRecords(format, value => value.trim(), value => value);
        const rows = [["start", "programme", "channel", "__proto__"], ["start", "title"], ["text", "First"], ["end", "title"],
            ["start", "title"], ["text", "Second"], ["end", "title"], ["end", "programme"]];
        assert.equal(records.accept(rows.slice(0, 5)).length, 0);
        const output = records.accept(rows.slice(5));
        assert.equal(output[0][1], "__proto__");
        assert.equal(output[0][2], "0");
        assert.equal(output[0][4], format.startsWith("rust") ? "Second" : "FirstSecond");
        assert.equal(records.accept([]).length, 0);
    }
    const decoding = new core.XmltvRecords("rust", value => value.trim());
    assert.equal(JSON.stringify(decoding.accept([["text-error", "ignored"], ["start", "programme"], ["start", "title"], ["text-error", "original"]])), '[["error","original"]]');
    assert.equal(JSON.stringify(core.nativeXmltvOrder([2, 1, 2], "rust-native")), "[1,0,2]");
    assert.equal(JSON.stringify(core.nativeXmltvOrder([2, 1, 2], "rust")), "[0,1,2]");
    for (const [input, expected] of [
        ["19700101000000 +0000", 0], ["197001010530 +0530", 0],
        ["19691231203000 -03:30", 0], ["19691231235959Z", -1000],
        ["00010101", -62135596800000], ["99991231235959", 253402300799000],
        ["20000229000000 UTC", 951782400000], ["\ufeff19700101\u00a0UTC\ufeff", 0],
        ["19000229", null], ["20260431", null], ["202601010000 +2400", null],
        ["20260101000000junk", null], ["", null]
    ]) assert.equal(core.parseXmltvTimestamp(input), expected, profile + ": " + input);
    assert.equal(core.parseXmltvTimestamp("00000229000000"), -62162121600000);
    assert.equal(core.parseBrowserXmltvTime("197001010530 +0530"), 0);
    assert.equal(core.parseBrowserXmltvTime("19700101"), null);
    assert.equal(core.parseBrowserXmltvTime("197001010530 +05:30"), null);
    assert.equal(core.canonicalChannelName("\ufeffHD\u00a0News\u202fWest\ufeff"), "news west");
    assert.equal(core.canonicalChannelName("HD News +2 UHD"), "news +2");
    assert.equal(core.canonicalChannelName("НОВОСТИ МОСКВА HD"), "новости москва");
    assert.equal(core.chooseGuideChannel([], [["a", "b"], ["display"]], [["alias"]]), "display");
    assert.equal(core.chooseGuideChannel([], [["tvg"], ["display"]], []), "tvg");
    assert.equal(core.chooseGuideChannel([], [["a", "b"]], [["a", "b"]]), null);
    const entries = [{ start: 20, end: 30 }, { start: 0, end: 10 }, { start: 5, end: 15 }, { start: 5, end: 18 }, null, { start: "1", end: 100 }, { start: 50, end: null }];
    let selection = core.selectGuideSchedule(entries, 7, false);
    assert.deepEqual([selection.current, selection.next, selection.from, selection.until], [2, 0, 5, 10]);
    selection = core.selectGuideSchedule(entries, 15, false);
    assert.deepEqual([selection.current, selection.next, selection.from, selection.until], [3, 0, 15, 18]);
    assert.equal(core.selectGuideSchedule(entries, 60, false).current, -1);
    assert.equal(core.selectGuideSchedule(entries, 60, true).current, 6);
    assert.equal(core.selectGuideSchedule(entries, NaN, true).current, -1);
    assert.equal(core.selectGuideSchedule(entries, Infinity, true).next, -1);
    // Exercise exported native ABI too, including hosts with emulated binary arrays.
    assert.equal(core.nativeGuideTime("20260101000000 +0💥", "rust"), 0);
    assert.equal(core.nativeGuideTime("２０２６０１０１００００００", "swift"), 1767225600);
    assert.equal(core.nativeGuideName("First +𝟜h HD", "rust"), "first");
    const native = new core.NativeGuide([["news", "News"], ["cinema", "Films"], ["blank", ""]],
        "web", value => value.length, value => value);
    assert.equal(native.resolve("blank", ["News"]), "blank");
    assert.equal(native.resolve("", ["News Extra", "Films"]), "cinema");
    assert.equal(native.match("News Extra").id, "news");
    assert.equal(native.match("unrelated"), null);
    assert.equal(JSON.stringify(core.nativeGuideSlice([[0, 3600], [172800, 180000]], 0, 48, 0)), "[[0,0,3600]]");
    const playlist = core.parseBrowserPlaylist('#EXTM3U\n#EXTINF:-1 tvg-id="__proto__" catchup-days="3",News\nhttps://video.test/live',
        "source", "source", value => value, value => value, value => value);
    assert.equal(playlist.channels[0].id, "source:m3u:tvg:__proto__");
    assert.equal(playlist.channels[0].catchup.days, 3);
    assert.equal(core.parseBrowserPlaylist("html", "s", "s", value => value, value => value, value => value).failure, "FORMAT");
    const provider = core.parseProviderPlaylist('#EXTM3U\n#EXTINF:-1 group-title="__proto__",News\nhttps://video.test/live', "generic", () => 42, 0);
    assert.equal(provider.channels[42].channel_name, "News");
    assert.equal(provider.groups.__proto__[0], 42);
    assert.equal(core.legacyPlaylistAttribute('tvg-id="one"', "tvg-id"), "one");
    const operator = core.parseOperatorPlaylist('#EXTM3U\n#EXTINF:-1 tvg-name="id" timeshift="2",First, title\nhttps://v.test/live/token/42.ts', "tvteam", () => 0, []);
    assert.equal(operator.channels.id.rec, 336);
    assert.equal(operator.channels.id.channel_name, "First");
    const antifriz = core.parseOperatorPlaylist('#EXTM3U\n#EXTINF:-1 tvg-logo="https://img.test/logo",News\nhttps://v.test/live/token/id.ts', "antifriz", () => 0, []);
    assert.equal(antifriz.channels.id.logo, "http://img.test/logo");
    assert.equal(core.parsePlaylistMedia('#EXTM3U\n#EXTINF:-1,Film, extra\n#comment\nhttps://v.test/movie')[0].name, "Film");
    const xcInput = { id: "source", username: "a/b", password: "x?&", output: "m3u8", base: "https://xc.test" };
    const render = (parts, query) => xcInput.base + "/" + parts.map(encodeURIComponent).join("/") +
        (query.length ? "?" + query.map(pair => pair.map(encodeURIComponent).join("=")).join("&") : "");
    const xc = new core.XtreamClient(xcInput, false, render, value => /^https?:\/\//.test(value) ? value : "", encodeURIComponent, parts => parts.join(":"));
    assert.equal(xc.request(), "https://xc.test/player_api.php?username=a%2Fb&password=x%3F%26");
    assert.equal(xc.accept({ user_info: { auth: 1, status: "Active" } }), null);
    const replies = [[{ category_id: "__proto__", category_name: "__proto__" }],
        [{ stream_id: 1, name: " News ", category_id: "__proto__", tv_archive: true, tv_archive_duration: "0x3" }], [], [], [], [{ series_id: 9 }]];
    for (const reply of replies) assert.equal(xc.accept(reply), null);
    assert.equal(xc.request(), null);
    assert.equal(xc.catalog().channels[0].group, "__proto__");
    assert.equal(xc.catalog().channels[0].archiveDays, 3);
    assert.equal(xc.catalog().channels[0].url, "https://xc.test/live/a%2Fb/x%3F%26/1.m3u8");
    const parent = xc.catalog().channels[1];
    assert.equal(xc.seriesRequest(parent).url, "https://xc.test/player_api.php?username=a%2Fb&password=x%3F%26&action=get_series_info&series_id=9");
    const series = xc.series({ episodes: { 2: [{ id: 3, container_extension: "mp4" }] } }, parent);
    assert.equal(series.folders[0].id, "source:xtream:series:9:season:2");
    assert.equal(series.episodes.$2[0].url, "https://xc.test/series/a%2Fb/x%3F%26/3.mp4");
    assert.equal(xc.seriesRequest({ seriesId: "../3", folderType: "series" }).failure, "FOLDER");
    const legacyXc = new core.XtreamClient(xcInput, true, render, value => value, encodeURIComponent, () => "");
    assert.equal(legacyXc.accept({ live_streams: [{ name: "One", stream_id: 1, category_id: 2 }], categories: [{ category_id: 2, category_name: "__proto__" }] }), null);
    assert.equal(legacyXc.legacyCatalog(() => 42).groups.__proto__[0], 42);
    assert.equal(legacyXc.guide({ epg_listings: [{ start: "1", end: "2" }] }, Number)[0].name, "No title");
    assert.equal(legacyXc.guide({ epg_listings: [{ start: {}, end: {} }] }, value => new Date(value).getTime()).length, 0);
    const jsonTitle = JSON.parse('{"__proto__":{"safe":true},"text":"Title"}');
    const decodedTitle = legacyXc.guide({ epg_listings: [{ start: 1, end: 2, title: jsonTitle }] }, Number)[0].name;
    assert.equal(JSON.stringify(decodedTitle), JSON.stringify(jsonTitle));
    assert.equal(Object.prototype.hasOwnProperty.call(decodedTitle, "__proto__"), true);
    assert.equal(decodedTitle.safe, undefined);
    const classic = core.legacyXtreamClient("https://xc.test/", "a/b", "x?&", encodeURIComponent);
    assert.equal(classic.request(), "https://xc.test//player_api.php?username=a%2Fb&password=x%3F%26");
    assert.equal(classic.fallbackPlaylist(false), "https://xc.test//get.php?username=a%2Fb&password=x%3F%26&type=m3u_plus&output=ts");
    assert.equal(classic.fallbackPlaylist(true), "https://xc.test/get.php?username=a%2Fb&password=x%3F%26&type=m3u_plus&output=ts");
    classic.accept({ live_streams: [{ stream_id: 1, name: "" }, { stream_id: 2, name: 2 }, { stream_id: 3 }] });
    const migrationChannels = classic.channelCatalog();
    assert.equal(migrationChannels[0].itemId, "xtream:stream:1");
    assert.equal(migrationChannels[0].name, "1");
    assert.equal(JSON.stringify(migrationChannels[0].legacyReference), '{"kind":"name-hash","value":""}');
    assert.equal(Object.prototype.hasOwnProperty.call(migrationChannels[1], "legacyReference"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(migrationChannels[2], "legacyReference"), false);
    migrationChannels[0].legacyReference.value = "mutated display";
    assert.equal(classic.channelCatalog()[0].legacyReference.value, "");
    const portal = { id: "portal", url: "https://p.test/c/", mac: "00:1A:79:01:02:03", language: "en", timezone: "UTC", profile: {} };
    Object.assign(portal, core.stalkerConfig(portal));
    const stalker = new core.StalkerClient(portal, 7, encodeURIComponent, value => value, value => /^https?:\/\//.test(value) ? value : "");
    const loading = stalker.load();
    assert.match(loading.request().url, /action=handshake/);
    for (const reply of [{ token: "opaque-token" }, { id: 1 }, [{ id: "1", title: "__proto__" }],
        { data: [{ id: 42, cmd: "/opaque-command", tv_genre_id: "1" }], total_items: 1 }]) assert.equal(loading.accept({ js: reply }), null);
    assert.equal(loading.request(), null);
    const channels = loading.result().channels;
    assert.equal(channels[0].group, "__proto__");
    assert.equal(JSON.stringify(channels).includes("opaque"), false);
    const playing = stalker.playback(channels[0]);
    assert.match(playing.request().url, /cmd=%2Fopaque-command/);
    assert.equal(playing.request().headers.Authorization, "Bearer opaque-token");
    assert.equal(playing.accept({ js: { cmd: "ffmpeg https://cdn.test/live" } }), null);
    assert.equal(playing.result().url, "https://cdn.test/live");
    assert.equal(stalker.browse({ ...channels[1], portalGeneration: "7" }).failure, "SESSION_FOLDER");
    assert.equal(stalker.verify("changed").failure, "SESSION_CATALOG");
    const rpc = new core.LegacyStalkerClient("https://p.test/", portal.mac);
    assert.equal(rpc.endpoint(), "https://p.test/stalker_portal/api/");
    assert.equal(rpc.accept({ result: 0 }), null);
    assert.equal(rpc.request().method, "handshake");
    assert.equal(rpc.accept({ result: {} }), null);
    assert.equal(rpc.request().method, "get_channels");
    assert.equal(rpc.accept({ result: [{ id: "42", name: "News", archive: "0x10" }] }), null);
    assert.equal(rpc.catalog(() => 42).channels[42].rec, 16);
    assert.equal(JSON.stringify(rpc.channelCatalog()[0].legacyReference), '{"kind":"numeric-id","value":42}');
    const migrationRpc = new core.LegacyStalkerClient("https://p.test/", portal.mac);
    migrationRpc.accept({ result: {} });
    migrationRpc.accept({ result: [{ ch_id: 43, name: "By ch_id" }, { ch_id: 44, name: "" }, { id: "invalid", name: "Invalid old ID" }] });
    assert.equal(migrationRpc.channelCatalog()[0].providerId, "43");
    assert.equal(JSON.stringify(migrationRpc.channelCatalog()[0].legacyReference), '{"kind":"name-hash","value":"By ch_id"}');
    assert.equal(Object.prototype.hasOwnProperty.call(migrationRpc.channelCatalog()[1], "legacyReference"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(migrationRpc.channelCatalog()[2], "legacyReference"), false);
    assert.equal(rpc.guide({ result: [{ start: "0x10", end: "32seconds" }] })[0].time, 16);
    const decodedStations = [{ id: "__proto__", names: ["News HD"], icons: ["https://img.test/news"] }];
    const decodedShows = [
        { channel: "__proto__", start: "202601010000", stop: "", title: "First" },
        { channel: "__proto__", start: "202601010100", stop: "202601010200", title: "Second" }
    ];
    const guide = core.parseBrowserGuide(decodedStations, decodedShows, { "data-truncated": "true" }, "https://guide.test/a", "a", value => value);
    assert.equal(guide.programmes[0].end - guide.programmes[0].start, 3600);
    assert.equal(guide.byId.__proto__.logo, "https://img.test/news");
    const joined = core.mergeBrowserGuides([guide, guide], value => value);
    const record = { tvgId: "__proto__", name: "News", epgUrls: [guide.sourceUrl] };
    const matched = core.matchedGuideChannel(record, joined);
    assert.equal(matched, JSON.stringify([guide.sourceUrl, "__proto__"]));
    assert.equal(joined.byChannel[matched], joined.byChannel.__proto__);
    assert.equal(joined.programmes[0], guide.programmes[0]);
    assert.equal(joined.coverage.limited, true);
    const shifted = core.shiftBrowserGuide(joined.byChannel[matched], 5.5);
    assert.equal(shifted[0].start, guide.programmes[0].start + 19800);
    const guideCache = new core.BrowserGuideLookup(2, 100);
    let builds = 0;
    function materialize() { builds++; return { metadata: joined.byId[matched], entries: shifted, unshifted: joined.byChannel[matched] }; }
    const selectedGuide = guideCache.lookup("id", joined, shifted[0].start + 1, materialize);
    assert.equal(selectedGuide.current, shifted[0]);
    assert.equal(guideCache.lookup("id", joined, shifted[0].end, materialize).current, shifted[1]);
    assert.equal(builds, 1);
    guideCache.clear(); guideCache.lookup("id", joined, shifted[0].start, materialize); assert.equal(builds, 2);
    const classicShows = [{ time: 0, time_to: 10 }, { time: 5, time_to: 15 }, { time: 10, time_to: 20 }];
    assert.equal(core.legacyGuideSelection(classicShows, 10, 0).current, classicShows[0]);
    assert.equal(core.legacyGuideCacheRead(classicShows, 0, 2, () => 20000), 1);
    assert.equal(core.legacyGuideCacheRead(classicShows, 0, 2, () => 20001), -1);
    const order = [1, 2, 3];
    assert.equal(JSON.stringify(core.legacyGuideCacheOrder(order, 2, 2, false)), "[3]");
    assert.equal(JSON.stringify(order), "[2,1]");
    const streamRows = core.streamingGuideIdentities([{ tvgId: " a ", name: " News HD ", archiveDays: 3 }, { tvgId: "a", name: "news hd", archiveDays: 7 }]);
    assert.equal(JSON.stringify(streamRows), '[["a","","news hd",7]]');
    const stream = new core.StreamingGuideFilter(streamRows, 1000, 4, 2);
    assert.equal(stream.channel("a", ["News HD"], "icon"), true);
    assert.equal(stream.accepts("a", 900, 1100), true);
    assert.equal(stream.accepts("unrequested", 900, 1100), false);
    const livePayload = { title: "Live" }, nextPayload = { title: "Next" };
    stream.programme("a", 900, 1100, livePayload);
    stream.programme("a", 800, 900, { title: "History" });
    stream.programme("a", 5000, null, nextPayload);
    const streamPayloads = [], streamOutput = [];
    const streamCoverage = stream.output(1024, (id, names, icon) => id + names[0] + icon,
        (id, payload) => { streamPayloads.push(payload); return id + payload.title; }, value => value.length, value => streamOutput.push(value));
    assert.equal(streamPayloads[0], livePayload);
    assert.equal(streamPayloads[1], nextPayload);
    assert.equal(JSON.stringify(streamOutput), '["aNews HDicon","aLive","aNext"]');
    assert.equal(streamCoverage.truncatedChannels, 1);
    assert.equal(streamCoverage.start, 1000 - 7 * 86400);
    const archive = { url: "https://video.test/live?token=a", mode: "append", source: "&s=${start}&d={duration:60}&id={catchup-id}", days: 2,
        start: 1767225600, end: 1767229200, now: 1767232800, correction: 0, programmeId: "Кино/🎬" };
    const calendar = () => [2026, 1, 1, 0, 0, 0];
    assert.equal(core.archiveUrl(archive, calendar, value => value), "https://video.test/live?token=a&s=1767225600&d=60&id=%D0%9A%D0%B8%D0%BD%D0%BE%2F%F0%9F%8E%AC");
    assert.equal(core.archiveUrl({ ...archive, now: archive.start + 1 }, calendar, value => value), null);
    assert.equal(core.providerArchiveUrl("m3u", "https://v.test/index.m3u8?token=a", "", "flussonic", 100, 160, 1000, true, 0), "https://v.test/archive-100-7260.m3u8?token=a");
    for (let code = 0; code <= 0xffff; code++) {
        const character = String.fromCharCode(code), value = character + "197001010000Z" + character;
        const expected = value.trim() === "197001010000Z" ? 0 : null;
        assert.equal(core.parseBrowserXmltvTime(value), expected, profile + ": whitespace U+" + code.toString(16));
    }

    assert.equal(core.playbackFormat("video.mpd;codec=avc"), "dash");
    assert.equal(core.playbackBodyFormat("<?xml x><!--a--><ns:MPD >"), "dash");
    assert.equal(core.playbackDeclaredFormat("", "", "", "ts", "x.mp4").reason, "url_hint");
    assert.equal(JSON.stringify(core.playbackEngines("hls", "auto", { nativeHls: true, hlsJs: true, chromium: true })), '["hls.js","native"]');
    assert.equal(core.playbackSeek(15, 5, 30, [{ start: 5, end: 10 }, { start: 20, end: 30 }]), 20);
    assert.equal(core.playbackChannelIndex(-1, 3, -1, "browser"), 2);
    assert.equal(core.playbackTrack([{ id: 1, language: "rus", label: " Original " }], { language: "ru", label: "Original" }, "native"), 0);
    const retries = new core.PlaybackRetries(1, 50);
    assert.equal(retries.admit(true), true); assert.equal(retries.delay(), 50); assert.equal(retries.admit(true), false);
    retries.reset(); assert.equal(retries.attempts(), 0);
    const recovery = new core.PlaybackRecovery(2);
    assert.equal(recovery.media(), true); assert.equal(recovery.media(), false);
    assert.equal(recovery.network("timeout"), true); assert.equal(recovery.network("timeout"), true); assert.equal(recovery.network("timeout"), false);
    recovery.reset(); assert.equal(recovery.network("levelParsingError"), false);
    const restart = new core.PlaybackRestart();
    assert.equal(restart.admit(true, false, true), "restart"); assert.equal(restart.pending(), true);
    restart.finish(); assert.equal(restart.admit(true, false, true), "stop"); restart.reset();
    assert.equal(restart.admit(true, true, true), "stop");
    const sequence = new core.PlaybackEngineSequence();
    sequence.set(["native", "hls.js"]); assert.equal(sequence.current(), "native"); assert.equal(sequence.canAdvance(true), true);
    sequence.advance(); assert.equal(sequence.fallbacks(), 1); assert.equal(sequence.current(), "hls.js"); assert.equal(sequence.canAdvance(true), false);

    assert.equal(core.operatorSourceAction({ server: "https://x", user: "u", pass: "p" }), "API");
    const operatorSession = new core.OperatorClient({ server: "https://x", user: "u", pass: "p" }, encodeURIComponent, () => 7);
    operatorSession.accept({ categories: [], live_streams: [{ name: "A", stream_id: 1 }] });
    assert.equal(operatorSession.catalog().ids[0], 7);
    const catalog = new core.OperatorCatalogClient("itv");
    catalog.accept({ channels: [{ ch_id: "1", name: "A", category: "News" }] }, []);
    assert.equal(core.operatorVodCatalog({ items: { title: "T", channel: { title: "M" } } }, "old").records.length, 1);
    assert.equal(core.operatorPortalNavigate("search=a%20b", "P", "", "k", decodeURIComponent).node.request.query, "a b");
    assert.equal(new core.OperatorPortalCatalogClient({ type: "category", items: [{ type: "next" }], count: 2 }, false).next().kind, "LAZY");
    const request = new core.OperatorRequestClient();
    assert.equal(request.begin(), 0); assert.equal(request.attach(0), "KEEP"); assert.equal(JSON.stringify(request.end()), "[0]"); assert.equal(request.accept(0), false);
    const providerLifetime = new core.OperatorLifetimeClient();
    providerLifetime.setSeries("api", "1", { x: 1 }); providerLifetime.setSeries("api", "2", { x: 2 }); assert.equal(providerLifetime.series("api", "1"), null);
    assert.equal(core.operatorSourceNamespace({ id: " a " }), "a");
    assert.equal(core.operatorBrowserConfig({ id: "a", type: "m3u" }, "https://a").type, "m3u");
    assert.equal(core.operatorSourceRelationship("browser-browse", "xtream", "a", "live", "b"), "SOURCE_MISMATCH");

    assert.equal(core.operatorLiveUrl("antifriz", "1", { server: "cdn", token: "t" }, { mode: 0, hls: 2 }), "http://cdn:80/1/video.m3u8?token=t");
    const operatorGuide = new core.OperatorGuideClient("shura", false);
    assert.equal(operatorGuide.phase(), "week"); operatorGuide.complete(); assert.equal(operatorGuide.phase(), "archive");
    assert.equal(core.operatorGuideUrl("shura", "1", { server: "2", rec: 0 }, "archive").endsWith("/pf.jsonp"), true);
    assert.equal(core.operatorVodRoot("kb-team", "", ""), "http://89.163.215.125");
    require("./check-state-abi.cjs")(core, assert);
    for (const format of ["browser", "node-streaming"]) {
        const records = new core.WebXmltvRecords(format);
        records.start("tv", {}); records.start("channel", { id: "news" });
        records.start("display-name", {}); records.text("News"); records.end("display-name");
        assert.equal(records.end("channel").value.names[0], "News"); records.end("tv");
    }

    // Differential oracle, independent of the core's Gregorian arithmetic.
    let count = 0;
    for (let year = 1; year <= 9999; year += 41) for (let month = 1; month <= 12; month++) {
        const date = new Date(0);
        date.setUTCFullYear(year, month - 1, 17);
        date.setUTCHours(12, 34, 56, 0);
        const input = String(year).padStart(4, "0") + String(month).padStart(2, "0") + "17123456 +0000";
        assert.equal(core.parseXmltvTimestamp(input), date.getTime(), profile + ": " + input);
        count++;
    }
    return { profile, oracleDates: count, passed: true };
}

const bootstrap = fs.readFileSync(process.argv[2] || require.resolve("core-js-bundle/minified.js"), "utf8");
function legacyContext(nativeBinary) {
    const context = vm.createContext({});
    vm.runInContext(`
    globalThis = undefined;
    Promise = Map = Set = WeakMap = WeakSet = Symbol = Reflect = undefined;
    Object.assign = Object.entries = Object.values = undefined;
    Array.from = Array.prototype.includes = undefined;
    String.prototype.includes = String.prototype.startsWith = String.prototype.endsWith = undefined;
    Number.isFinite = Math.imul = Math.trunc = undefined;
    (function () {
        var NativeRegExp = RegExp;
        RegExp = function (pattern, flags) {
            if (flags && /[^gim]/.test(flags)) throw new SyntaxError("Unsupported ES5 regular expression flag: " + flags);
            return new NativeRegExp(pattern, flags);
        };
        RegExp.prototype = NativeRegExp.prototype;
    }());
`, context);
    if (!nativeBinary) vm.runInContext(`
        ArrayBuffer = DataView = Int8Array = Uint8Array = Uint8ClampedArray = undefined;
        Int16Array = Uint16Array = Int32Array = Uint32Array = Float32Array = Float64Array = undefined;
    `, context);
    vm.runInContext(bootstrap, context, { timeout: 10000 });
    return context;
}
const reports = [
    verify(vm.createContext({}), "modern"),
    verify(legacyContext(true), "ES5 API simulation with core-js and native binary arrays"),
    verify(legacyContext(false), "ES5 API simulation with core-js and emulated binary arrays")
];
console.log(JSON.stringify({ es5Syntax: true, bundleBytes: Buffer.byteLength(bundle), reports }, null, 2));
