"use strict";
// Run in a child process: NODE_EXTRA_CA_CERTS is read at Node startup.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { once } = require("node:events");
const { createRelay } = require("../scripts/relay.cjs");
const { createEPG, DEFAULT_EPG_URL } = require("../scripts/epg.cjs");
const { clock, document, dto } = require("./epg-fixture.cjs");
async function listen(server) {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    return server.address().port;
}
function prime(url) {
    return new Promise((resolve, reject) => {
        // Only cache priming uses this weak fixture policy; product options stay intact.
        const req = https.get(url, { ciphers: "DEFAULT:@SECLEVEL=0", headers: { connection: "close" } }, res => {
            const reused = res.socket.isSessionReused();
            res.resume(); res.on("end", () => resolve(reused));
        });
        req.on("error", reject);
    });
}
function post(origin, route, value) {
    const body = JSON.stringify(value);
    return new Promise((resolve, reject) => {
        const req = http.request(origin + route, { method: "POST", headers: {
            origin, "content-type": "application/json", "content-length": Buffer.byteLength(body)
        } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
        req.on("error", reject); req.end(body);
    });
}
async function main() {
    const [directory, version, cipherPolicy] = process.argv.slice(2), requests = [];
    // Weak keys exist only in this fixture, so its server policy must allow them.
    const remote = https.createServer({ key: fs.readFileSync(path.join(directory, "leaf.key")),
        cert: fs.readFileSync(path.join(directory, "chain.pem")), ciphers: "DEFAULT:@SECLEVEL=0",
        minVersion: version, maxVersion: version }, (req, res) => {
        requests.push({ path: req.url, reused: req.socket.isSessionReused(), auth: req.headers.authorization || null });
        res.writeHead(200, { "Content-Length": Buffer.byteLength(document) }); res.end(document);
    });
    let local;
    try {
        const target = "https://127.0.0.1:" + await listen(remote);
        const first = await prime(target + "/prime");
        const second = await prime(target + "/prime");
        assert.equal(first, false);
        assert.equal(second, true, "fixture must really prime and resume the default-agent cache");
        if (cipherPolicy) tls.DEFAULT_CIPHERS = cipherPolicy;
        const relay = createRelay({ allowOrigins: [target], timeout: 2000 });
        let current = clock;
        const epg = createEPG({ now: () => current, timeout: 2000,
            // Keep actual request options/TLS; replace only the fixed public endpoint.
            request(url, options, callback) {
                assert.equal(url.href, DEFAULT_EPG_URL);
                return https.request(target + "/epg", options, callback);
            }
        });
        local = http.createServer((req, res) => req.url === "/relay" ? relay.handle(req, res) : epg.handle(req, res));
        const origin = "http://127.0.0.1:" + await listen(local), statuses = [];
        for (let index = 0; index < 2; index++) {
            statuses.push(await post(origin, "/relay", { url: target + "/relay", headers: { authorization: "Bearer synthetic-fixture-only" } }));
            statuses.push(await post(origin, "/epg", dto));
            current += 31 * 60000; // Expire the application response cache.
        }
        console.log(JSON.stringify({ statuses, requests: requests.filter(row => row.path !== "/prime"), primed: second }));
    } finally {
        https.globalAgent.destroy();
        if (local) { local.closeAllConnections(); await new Promise(resolve => local.close(resolve)); }
        remote.closeAllConnections(); await new Promise(resolve => remote.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
