const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");

const code = fs.readFileSync(path.join(__dirname, "../src/providers.js"), "utf8");
acorn.parse(code, { ecmaVersion: 5, sourceType: "script" });
let providers;
const sandbox = vm.createContext({ window: { OTT2: { define(name, factory) {
    assert.equal(name, "providers");
    providers = factory();
} } } });
vm.runInContext("Promise = undefined; fetch = undefined; URL = undefined; Map = undefined; Set = undefined; Object.assign = undefined; Number.isFinite = undefined; String.prototype.includes = undefined;", sandbox);
require("./load-core.cjs")(sandbox);
vm.runInContext(code, sandbox);
const plain = (value) => JSON.parse(JSON.stringify(value));

const source = { id: "source-A", type: "m3u", url: "https://playlist.test/list.m3u" };
const first = '#EXTINF:-1 tvg-id="news" tvg-name="News, international" group-title="News, world" tvg-logo="https://image.test/logo.png" catchup="default" catchup-days="3" catchup-source="https://video.test/archive?start={utc}&duration={duration}",<img src=x onerror=alert(1)>\nhttps://video.test/live/news.m3u8';
const second = '#EXTINF:-1 tvg-id="movie" media="true",Movie\nhttps://video.test/movie.mp4';
const playlist = '\ufeff#EXTM3U x-tvg-url="https://epg.test/a.xml, https://epg.test/b.xml,https://epg.test/a.xml"\r\n' + first + '\r\n' + second + '\r\n#EXTINF:-1 tvg-id="bad",Unsafe\r\njavascript:alert(1)\r\n#EXTINF:-1,Missing\n#EXTINF:-1 tvg-id="__proto__",Prototype name\nhttps://video.test/proto.ts';
const parsed = providers.parseM3U(playlist, source);
assert.equal(parsed.channels.length, 3);
assert.equal(parsed.channels[0].name, "<img src=x onerror=alert(1)>", "External metadata remains literal data");
assert.equal(parsed.channels[0].group, "News, world");
assert.equal(parsed.channels[0].tvgName, "News, international");
assert.equal(parsed.channels[0].catchup.days, 3);
assert.equal(parsed.channels[1].kind, "vod");
assert.equal(parsed.channels[2].tvgId, "__proto__");
assert.deepEqual(plain(parsed.epgUrls), ["https://epg.test/a.xml", "https://epg.test/b.xml"]);
assert(parsed.warnings.length > 0);
const reversed = providers.parseM3U("#EXTM3U\n" + second + "\n" + first, source);
assert.equal(reversed.channels[0].id, parsed.channels[1].id, "A reorder preserves favorites identity");
assert.equal(reversed.channels[1].id, parsed.channels[0].id);
assert.notEqual(providers.parseM3U("#EXTM3U\n" + first, { id: "source-B" }).channels[0].id, parsed.channels[0].id, "Sources cannot share a channel ID");
const duplicate = providers.parseM3U("#EXTM3U\n" + first + "\n" + first + '\n#EXTINF:-1 tvg-id="news",HD\nhttps://video.test/live/news-hd.m3u8', source);
assert.equal(duplicate.channels.length, 2, "Exact duplicate streams are coalesced");
assert.notEqual(duplicate.channels[0].id, duplicate.channels[1].id, "Variant streams sharing tvg-id retain separate identities");
assert.throws(() => providers.parseM3U("<html>not a playlist</html>", source), (error) => error.code === "M3U_FORMAT");
assert.throws(() => providers.parseM3U("#EXTM3U", {}), (error) => error.code === "SOURCE_ID");
for (const url of ["javascript:alert(1)", "data:text/plain,a", "https://u:p@video.test/a", "https://video.test\\@evil.test/a", "https://video.test/\nheader", "https://video.test:65536/a", "//video.test/a", "https://video.test/a|User-Agent=x"]) {
    assert.equal(providers.httpUrl(url), "", "Reject unsupported URL: " + url);
}
assert.equal(providers.httpUrl("http://[::1]:8080/a"), "http://[::1]:8080/a");

function transport() {
    const pending = [];
    return {
        pending,
        request(url, callback) {
            const entry = { url, callback, cancels: 0 };
            pending.push(entry);
            return () => { entry.cancels++; };
        }
    };
}
const network = transport();
const service = providers.create({ request: network.request });
const delivered = [];
const cancelA = service.load(source, (error, result) => delivered.push([error, result]));
cancelA();
cancelA();
assert.equal(network.pending[0].cancels, 1);
network.pending[0].callback(null, playlist);
network.pending[0].callback(new Error("late failure"));
assert.equal(delivered.length, 0, "An aborted response cannot return a departed catalog");
const cancelB = service.load(source, (error, result) => delivered.push([error, result]));
network.pending[1].callback(null, playlist);
network.pending[1].callback(null, playlist);
cancelB();
assert.equal(delivered.length, 1, "Duplicate transport events cannot finish twice");
assert.equal(delivered[0][0], null);
assert.equal(delivered[0][1].channels.length, 3);

const xc = transport();
const xtream = providers.create({ request: xc.request });
let xcResult;
const xcSource = { id: "premium", type: "xtream", url: "https://xc.test/player_api.php", username: "user @", password: "p/a?&" };
xtream.load(xcSource, (error, result) => { assert.equal(error, null); xcResult = result; });
assert.equal(xc.pending.length, 1);
assert(xc.pending[0].url.endsWith("username=user%20%40&password=p%2Fa%3F%26"));
xc.pending[0].callback(null, '{"user_info":{"auth":1}}');
const expected = ["get_live_categories", "get_live_streams", "get_vod_categories", "get_vod_streams", "get_series_categories", "get_series"];
const responses = [
    [{ category_id: "7", category_name: "Live group" }],
    [{ stream_id: 42, name: "Live", category_id: "7", epg_channel_id: "news", tv_archive: 1, tv_archive_duration: 5 }],
    [{ category_id: "7", category_name: "Movie group" }],
    [{ stream_id: 42, name: "Film", category_id: "7", container_extension: "mp4" }, { stream_id: 43, name: "Direct film", direct_source: "https://cdn.test/film.mkv" }], [], []
];
for (let i = 0; i < expected.length; i++) {
    assert(xc.pending[i + 1].url.endsWith("&action=" + expected[i]));
    xc.pending[i + 1].callback(null, JSON.stringify(responses[i]));
}
assert.equal(xcResult.channels.length, 3);
assert.equal(xcResult.channels[0].group, "Live group");
assert.equal(xcResult.channels[1].group, "Movie group", "Live/VOD category IDs have distinct scopes");
assert.notEqual(xcResult.channels[0].id, xcResult.channels[1].id);
assert.equal(xcResult.channels[0].url, "https://xc.test/live/user%20%40/p%2Fa%3F%26/42.m3u8");
assert.equal(xcResult.channels[1].url, "https://xc.test/movie/user%20%40/p%2Fa%3F%26/42.mp4");
assert.equal(xcResult.channels[2].url, "https://cdn.test/film.mkv");
assert.equal(xcResult.channels[0].catchup.type, "xtream", "Authenticated Xtream supplies its explicit archive URL contract");
assert(xcResult.epgUrls[0].startsWith("https://xc.test/xmltv.php?"));

const cancelled = transport();
let cancelledCalls = 0;
const stop = providers.create({ request: cancelled.request }).load(xcSource, () => { cancelledCalls++; });
cancelled.pending[0].callback(null, { user_info: { auth: 1 } });
stop();
cancelled.pending[1].callback(null, []);
assert.equal(cancelled.pending.length, 2, "Cancel prevents dependent requests");
assert.equal(cancelled.pending[1].cancels, 1);
assert.equal(cancelledCalls, 0);

let authCallback;
let reentrantStop;
let reentrantAborts = 0;
let reentrantCompletions = 0;
reentrantStop = providers.create({ request(url, callback) {
    if (url.indexOf("&action=") < 0) authCallback = callback;
    else reentrantStop();
    return () => { reentrantAborts++; };
} }).load(xcSource, () => { reentrantCompletions++; });
authCallback(null, { user_info: { auth: 1 } });
assert.equal(reentrantAborts, 1, "Cancellation during request setup also cancels the late-returned transport handle");
assert.equal(reentrantCompletions, 0);

for (const failure of ["auth", "json", "network", "throw"]) {
    let calls = 0;
    providers.create({ request(url, callback) {
        if (failure === "throw") throw new Error("secret=private-password");
        if (failure === "network") callback(new Error("secret=private-password"));
        else callback(null, failure === "auth" ? { user_info: { auth: 0 } } : "<broken>");
        return () => {};
    } }).load(xcSource, (error) => {
        calls++;
        assert(error);
        assert(!error.message.includes("private-password"), "Errors must not expose transport URLs");
    });
    assert.equal(calls, 1, failure);
}
let unsupportedCalls = 0;
providers.create({ request() { throw new Error("Unsupported provider must not request network"); } }).load({ id: "s", type: "stalker", url: "https://portal.test/c/", mac: "00:1A:79:00:00:00" }, (error) => {
    unsupportedCalls++;
    assert.equal(error.code, "PORTAL_TRANSPORT");
});
assert.equal(unsupportedCalls, 1);
let resolved;
service.resolve(parsed.channels[0], (error, value) => { assert.equal(error, null); resolved = value; });
assert.equal(resolved.url, parsed.channels[0].url);
console.log("PASS: independent ES5 M3U/Xtream parsing, source identities, URL validation, cancellation and provider error contracts");

const affinity = providers.parseM3U('#EXTM3U x-tvg-url="default.xml" catchup-days="5"\n#EXTINF:-1 tvg-id="1" url-tvg="a.xml" tvg-source="b.xml" tvg-rec="7" catchup="flussonic",A\nhttps://stream.test/a/index.m3u8\n#EXTINF:-1 tvg-id="2" catchup-days="0" timeshift="3" tvg-rec="7" catchup="default" catchup-source="https://stream.test/archive?start={utc}",B\nhttps://stream.test/b/index.m3u8', source);
assert.deepEqual(plain(affinity.channels[0].epgUrls), ['https://playlist.test/a.xml', 'https://playlist.test/b.xml', 'https://playlist.test/default.xml']);
assert.deepEqual(plain(affinity.channels[1].epgUrls), ['https://playlist.test/default.xml']);
assert.equal(affinity.channels[0].catchup.days, 7, 'A local tvg-rec overrides every header depth alias');
assert.equal(affinity.channels[1].catchup.days, 0, 'An explicit zero prevents fallback to another depth alias');
for (const [attributes, expected] of [['tvg-rec="7"', 7], ['timeshift="2" tvg-rec="7"', 2], ['catchup-days="1.5" timeshift="2"', 1.5], ['tvg-rec="999"', 30], ['tvg-rec="-1"', 0], ['tvg-rec="Infinity"', 0], ['tvg-rec="1e3"', 0], ['tvg-rec="broken"', 0]]) {
    const item = providers.parseM3U('#EXTM3U\n#EXTINF:-1 catchup="default" catchup-source="https://stream.test/?start={utc}" ' + attributes + ',A\nhttps://stream.test/live', source).channels[0];
    assert.equal(item.catchup.days, expected, attributes);
}
assert.deepEqual(plain(xcResult.channels[0].epgUrls), plain(xcResult.epgUrls), 'Xtream live channels retain their authenticated guide affinity');

for (const fixture of require("./fixtures/playlist-before-core.json")) {
    if (fixture.error) assert.throws(() => providers.parseM3U(fixture.text, fixture.source), error =>
        error.code === fixture.error.code && error.message === fixture.error.message);
    else assert.deepEqual(plain(providers.parseM3U(fixture.text, fixture.source)), fixture.expected);
}
