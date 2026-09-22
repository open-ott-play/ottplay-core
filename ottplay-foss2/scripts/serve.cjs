#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
let deviceRoutes;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/devices.js"), "utf8"), {
    window: { OTT2: { define(name, factory) { deviceRoutes = factory(); } } }
});
const relay = require("./relay.cjs").createRelay({ allowOrigins: String(process.env.OTT2_RELAY_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean) });
const epg = require("./epg.cjs").createEPG();
const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png", ".ttf": "font/ttf", ".eot": "application/vnd.ms-fontobject", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
function handler(req, res) {
    if (req.url === "/api/relay") { relay.handle(req, res); return; }
    if (req.url === "/api/epg") { epg.handle(req, res); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    let url;
    try {
        const raw = decodeURIComponent(req.url.split("?")[0]);
        if (raw.split("/").some(part => part === "." || part === "..") || /[\\\x00]/.test(raw)) { res.writeHead(404); res.end(); return; }
        url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch { res.writeHead(400); res.end(); return; }
    if (url === "/" || deviceRoutes.routeDocument(url)) url = "/index.html";
    if (!/^(?:\/index\.html|\/manifest\.webmanifest|\/icons\/(?:icon-(?:192|512)\.png|icon\.svg)|\/src\/[a-z-]+\.js|\/ui\/[a-z-]+\.css|\/vendor\/(?:(?:hls|shaka|mpegts|core-js)\.min|hls\.worker|ottplay-core)\.js|\/fonts\/[a-zA-Z0-9_.-]+)$/.test(url)) { res.writeHead(404); res.end(); return; }
    const file = path.join(root, url);
    fs.realpath(file, (error, real) => {
        if (error || !real.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
        fs.stat(real, (error, stat) => {
            if (error || !stat.isFile()) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { "Content-Type": mime[path.extname(real)] || "application/octet-stream", "Content-Length": stat.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
            if (req.method === "HEAD") res.end();
            else { const stream = fs.createReadStream(real); stream.on("error", () => res.destroy()); stream.pipe(res); }
        });
    });
}
if (require.main === module) {
    const port = Number(process.env.PORT || 8092), host = process.env.HOST || "127.0.0.1";
    const server = http.createServer(handler);
    server.on("error", error => { console.error("Server could not start:", error.code); process.exitCode = 1; });
    server.listen(port, host, () => console.log(`OTT-play 2: http://${host}:${port}`));
}
module.exports = { handler };
