"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

// Reuse the real media adapter fixture; observe pure policy return values only.
const filename = path.join(__dirname, "test-media.cjs");
const harness = fs.readFileSync(filename, "utf8").split("const live = ")[0]
    .replace('const source = fs.readFileSync(path.join(__dirname, "../src/media.js"), "utf8");',
        'const source = fs.readFileSync(path.join(__dirname, "../src/media.js"), "utf8").replace("load: function (next, selection)", "__policy: { plan: planEngines, format: formatOf }, load: function (next, selection)");');
const fixtureModule = new Module(filename, module);
fixtureModule.filename = filename;
fixtureModule.paths = module.paths;
fixtureModule._compile(harness + "\nmodule.exports = fixture;", filename);
const fixture = fixtureModule.exports;
const clone = value => JSON.parse(JSON.stringify(value));
function capture() {
    const plans = [], formats = [], seeks = [];
    for (const device of ["generic", "lg/webos", "chromium"]) {
        for (let mask = 0; mask < 64; mask++) {
            function Hls() {}
            Hls.isSupported = () => !!(mask & 1);
            function Shaka() {}
            Shaka.isBrowserSupported = () => !!(mask & 2);
            const f = fixture({
                video: { canPlayType(mime) { return ((/mpegurl/i.test(mime) && mask & 8) || (/dash/.test(mime) && mask & 16) || (/mp2t|flv/.test(mime) && mask & 32)) ? "probably" : ""; } },
                environment: { Promise, Hls, shaka: { Player: Shaka },
                    mpegts: { isSupported: () => !!(mask & 4), getFeatureList: () => ({ msePlayback: true, mseLivePlayback: true }) },
                    navigator: { userAgent: device === "chromium" ? "Chrome/120" : "" } },
                options: { device }
            });
            for (const format of ["", "hls", "dash", "mpegts", "flv", "file"]) {
                plans.push({ device, mask, format, result: clone(f.player.__policy.plan(format)) });
            }
            f.player.destroy();
        }
    }
    for (const engine of ["native", "hls.js", "shaka", "mpegts"]) {
        const f = fixture({ options: { engine } });
        for (const format of ["", "hls", "dash", "mpegts", "flv", "file"]) plans.push({ engine, format, result: clone(f.player.__policy.plan(format)) });
        f.player.destroy();
    }
    const f = fixture();
    for (const value of [null, false, 0, "", "HLS", " m3u8 ", "mpegurl", "DASH", "mpd", "video.mpd;codec=avc", "foo/mpd?x", "foo.mpd#x", "mpd-extra", "flv", "x-flv-x", "TS", "mp2t", "mpeg-ts", "mpegts", "file", "video/mp4", "video/mp4extra", "video/webm", "video/ogg", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "hls-flv", "mpegurl-flv", "dash+xml-flv", "flv-mp2t", "application/octet-stream"]) {
        formats.push({ value, result: f.player.__policy.format(value) });
    }
    f.player.destroy();
    for (const ranges of [[[0,100]], [[5,10],[20,30]], [[5,10],[10,20],[25,40]]]) {
        for (const requested of [-1,0,5,10,12,15,18,20,22,25,30,100]) {
            const x = fixture({ video: { seekable: { length: ranges.length, start(i) { return ranges[i][0]; }, end(i) { return ranges[i][1]; } } } });
            x.player.load({id:"vod",kind:"vod",url:"https://media.example/video.mp4"});
            const accepted=x.player.seek(requested);
            seeks.push({ ranges, requested, accepted, position: x.video.currentTime });
            x.player.destroy();
        }
    }
    return { plans, formats, seeks };
}
const target = path.join(__dirname,"fixtures/playback-policy/before-core.json");
if (process.argv.includes("--capture")) {
    assert(!fs.existsSync(target), "Do not overwrite the pre-migration baseline");
    fs.writeFileSync(target, JSON.stringify({baseline:"f429f537497ec95c2bf92781e1ecee86c18bbfe8", observed:capture()},null,2)+"\n");
} else test("browser engine, format and seek policy retains captured pre-migration outcomes", () => {
    const expected=JSON.parse(fs.readFileSync(target,"utf8"));
    assert.deepEqual(capture(),expected.observed);
});
