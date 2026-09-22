"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
let server, port;

test.before(async () => {
    server = http.createServer(require("../scripts/serve.cjs").handler);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    port = server.address().port;
});
test.after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
function request(url, method = "GET") {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port, path: url, method, agent: false }, res => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("error", reject);
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject); req.end();
    });
}

test("installed app keeps the root identity and standalone fallback when overlay is unsupported", () => {
    const existingURL = "http://127.0.0.1:8092/";
    assert.equal(new URL(manifest.id, existingURL).href, existingURL);
    assert.equal(new URL(manifest.start_url, existingURL).href, existingURL);
    assert.equal(new URL(manifest.scope, existingURL).href, existingURL);
    assert.equal(manifest.display, "standalone");
    assert.deepEqual(manifest.display_override, ["window-controls-overlay"]);
    assert.equal(manifest.name, "OTT-play 2");
    assert.equal(manifest.short_name, "OTT2");
    assert.equal(manifest.lang, "en");
    assert.equal(manifest.theme_color, "#111519");
    assert.equal(manifest.background_color, manifest.theme_color);
    assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
    for (const icon of manifest.icons) {
        assert.equal(icon.type, "image/png");
        assert.equal(icon.purpose, "any");
        assert.equal(new URL(icon.src, existingURL).origin, new URL(existingURL).origin);
    }
});

test("HTTP serves the manifest and decodable local icons with the expected MIME and security headers", async () => {
    const assets = [["/manifest.webmanifest", "application/manifest+json; charset=utf-8"], ["/icons/icon.svg", "image/svg+xml"], ...manifest.icons.map(icon => [icon.src, icon.type])];
    for (const [url, type] of assets) {
        const result = await request(url);
        const expected = fs.readFileSync(path.join(root, url));
        assert.equal(result.status, 200, url);
        assert.equal(result.headers["content-type"], type, url);
        assert.equal(result.headers["content-length"], String(expected.length));
        assert.equal(result.headers["x-content-type-options"], "nosniff");
        assert.equal(result.headers["cache-control"], "no-store");
        assert.equal(result.headers["referrer-policy"], "no-referrer");
        assert.deepEqual(result.body, expected);
        const head = await request(url, "HEAD");
        assert.equal(head.status, 200);
        assert.equal(head.headers["content-type"], type);
        assert.equal(head.headers["content-length"], String(expected.length));
        assert.equal(head.body.length, 0);
    }
    for (const icon of manifest.icons) {
        const result = await request(icon.src), bytes = result.body, size = Number(icon.sizes.split("x")[0]);
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.equal(bytes.readUInt32BE(16), size);
        assert.equal(bytes.readUInt32BE(20), size);
        assert.equal(bytes[24], 8); assert.equal(bytes[25], 6);
        const data = [];
        for (let offset = 8; offset < bytes.length;) {
            const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
            if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
            offset += length + 12;
        }
        assert.equal(zlib.inflateSync(Buffer.concat(data)).length, size * (size * 4 + 1));
    }
});

test("PWA assets retain the static allowlist, method checks and existing application routes", async () => {
    for (const url of ["/package.json", "/scripts/serve.cjs", "/icons/generate.cjs", "/icons/other.png", "/icons/icon-128.png", "/icons/", "/manifest.json", "/icons/%2e%2e/package.json", "/icons/icon-192.png/extra"]) {
        assert.equal((await request(url)).status, 404, url);
    }
    assert.equal((await request("/icons/%zz.png")).status, 400);
    for (const url of ["/manifest.webmanifest", "/icons/icon-192.png"]) assert.equal((await request(url, "POST")).status, 405, url);
    for (const url of ["/", "/f/lg/", "/src/compat.js", "/ui/base.css"]) assert.equal((await request(url)).status, 200, url);
    assert.equal((await request("/api/epg")).status, 405);
    const relay = await request("/api/relay");
    assert.equal(relay.status, String(process.env.OTT2_RELAY_ORIGINS || "").split(",").some(value => value.trim()) ? 405 : 503);
});
