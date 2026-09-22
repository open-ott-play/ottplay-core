"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const zlib = require("node:zlib"), { performance } = require("node:perf_hooks");
const root = path.resolve(__dirname, ".."), client = path.resolve(root, "ottplay-foss2");
const context = vm.createContext({ window: { OTT2: { define(name, factory) { context.provider = factory(); } } } });
require(path.join(client, "tests/load-core.cjs"))(context);
vm.runInContext(fs.readFileSync(path.join(client, "src/providers.js"), "utf8"), context);
const samples = [];
for (const count of [10000, 100000]) {
    const text = "#EXTM3U\n" + Array.from({ length: count }, (_, i) => '#EXTINF:-1 tvg-id="' + i + '" group-title="Group ' + i + '",Channel ' + i + '\nhttps://video.test/' + i).join("\n");
    const start = performance.now();
    const result = context.provider.parseM3U(text, { id: "fixture", url: "https://source.test/list" });
    samples.push({ count, bytes: Buffer.byteLength(text), milliseconds: Math.round(performance.now() - start), returned: result.channels.length });
}
const manifest = JSON.parse(fs.readFileSync(path.join(client, "vendor/ottplay-core.manifest.json")));
const bundle = fs.readFileSync(path.join(client, "vendor/ottplay-core.js"));
console.log(JSON.stringify({ host: process.platform + " " + process.arch, engine: process.version, physical_device: false,
    source_sha256: manifest.source.sha256, js_bytes: bundle.length, gzip_bytes: zlib.gzipSync(bundle).length, samples }, null, 2));
