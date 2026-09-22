"use strict";
// Synthetic provider data only; no account, network or device access.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");
const root = path.resolve(__dirname, ".."), client = path.resolve(root, "ottplay-foss2");
const context = vm.createContext({ window: { OTT2: { define(name, factory) { context.provider = factory(); } } } });
require(path.join(client, "tests/load-core.cjs"))(context);
vm.runInContext(fs.readFileSync(path.join(client, "src/providers.js"), "utf8"), context);
const samples = [];
for (const count of [10000, 100000]) {
    const rows = Array.from({ length: count }, (_, i) => ({ stream_id: i + 1, name: "Channel " + i, category_id: i % 10,
        epg_channel_id: "epg-" + i, tv_archive: 1, tv_archive_duration: 7 }));
    const data = { get_live_streams: rows, get_live_categories: Array.from({ length: 10 }, (_, i) => ({ category_id: i, category_name: "Group " + i })) };
    let calls = 0, result;
    const provider = context.provider.create({ request(url, callback) {
        calls++;
        const action = new URL(url).searchParams.get("action");
        callback(null, action ? data[action] || [] : { user_info: { auth: 1, status: "Active" } });
    } });
    const start = performance.now();
    provider.load({ id: "fixture", type: "xtream", url: "https://synthetic.invalid", username: "fixture", password: "fixture" }, (error, value) => {
        assert.equal(error, null); result = value;
    });
    const milliseconds = Math.round(performance.now() - start);
    assert.equal(result.channels.length, count);
    assert.equal(calls, 7);
    samples.push({ count, milliseconds, returned: result.channels.length, requests: calls });
}
const manifest = JSON.parse(fs.readFileSync(path.join(client, "vendor/ottplay-core.manifest.json")));
const bundle = fs.readFileSync(path.join(client, "vendor/ottplay-core.js"));
console.log(JSON.stringify({ host: process.platform + " " + process.arch, engine: process.version, physical_device: false,
    source_sha256: manifest.source.sha256, js_bytes: bundle.length, gzip_bytes: zlib.gzipSync(bundle).length, samples }, null, 2));
