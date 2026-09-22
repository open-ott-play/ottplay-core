"use strict";
// Synthetic portal data only. Requests are queued to preserve asynchronous HTTP semantics.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");
const root = path.resolve(__dirname, ".."), client = path.resolve(root, "ottplay-foss2");
const context = vm.createContext({ window: { OTT2: { define(name, factory) { context.provider = factory(); } } } });
require(path.join(client, "tests/load-core.cjs"))(context);
vm.runInContext(fs.readFileSync(path.join(client, "src/providers.js"), "utf8"), context);
const samples = [];
for (const count of [10000, 50000]) {
    const pending = [];
    let calls = 0, result;
    const provider = context.provider.create({ portalTransport: true, request(url, callback) {
        pending.push({ url, callback }); calls++; return () => {};
    } });
    const start = performance.now();
    provider.load({ id: "fixture", type: "stalker", url: "https://synthetic.invalid/c/", mac: "00:1A:79:00:00:01" }, (error, value) => {
        assert.equal(error, null); result = value;
    });
    while (pending.length) {
        const request = pending.shift(), query = new URL(request.url).searchParams;
        let data;
        switch (query.get("action")) {
            case "handshake": data = { token: "synthetic-token" }; break;
            case "get_profile": data = { id: 1 }; break;
            case "get_genres": data = [{ id: 1, title: "Synthetic channels" }]; break;
            case "get_ordered_list": {
                const offset = (Number(query.get("p")) - 1) * 1000;
                assert(offset < count);
                data = { total_items: count, max_page_items: 1000, data: Array.from({ length: Math.min(1000, count - offset) }, (_, i) => ({
                    id: offset + i + 1, name: "Channel " + (offset + i), tv_genre_id: 1, cmd: "/opaque/" + (offset + i)
                })) }; break;
            }
            default: throw new Error("Unexpected synthetic request");
        }
        request.callback(null, { js: data });
    }
    const milliseconds = Math.round(performance.now() - start);
    assert.equal(result.channels.length, count + 1); // The portal's VOD root is retained.
    assert.equal(calls, 3 + count / 1000);
    assert(!JSON.stringify(result).includes("opaque"));
    samples.push({ count, milliseconds, returned: result.channels.length, requests: calls });
}
const manifest = JSON.parse(fs.readFileSync(path.join(client, "vendor/ottplay-core.manifest.json")));
const bundle = fs.readFileSync(path.join(client, "vendor/ottplay-core.js"));
console.log(JSON.stringify({ host: process.platform + " " + process.arch, engine: process.version, physical_device: false,
    source_sha256: manifest.source.sha256, js_bytes: bundle.length, gzip_bytes: zlib.gzipSync(bundle).length, samples }, null, 2));
