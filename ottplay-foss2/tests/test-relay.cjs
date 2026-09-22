const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const zlib = require("node:zlib");
const { createRelay } = require("../scripts/relay.cjs");

function upstream(routes = {}) {
    const calls = [];
    function request(url, options, callback) {
        const req = new EventEmitter();
        req.destroyed = false;
        req.destroy = () => { req.destroyed = true; };
        calls.push({ url: url.href, options, req });
        req.end = () => setImmediate(() => {
            if (req.destroyed) return;
            const route = routes[url.href] || { status: 200, body: "#EXTM3U\n" };
            if (route.hang) return;
            if (route.error) { req.emit("error", new Error("secret upstream error")); return; }
            const response = new EventEmitter();
            response.statusCode = route.status || 200; response.headers = route.headers || {};
            response.destroyed = false; response.destroy = () => { response.destroyed = true; };
            callback(response);
            if (response.destroyed) return;
            if (route.abort) { response.emit("aborted"); return; }
            for (const body of route.chunks || [route.body || ""]) if (!response.destroyed) response.emit("data", Buffer.from(body));
            if (!response.destroyed) response.emit("end");
        });
        return req;
    }
    return { request, calls };
}
function localRequest(relay, value = { url: "https://provider.test/list" }, changes = {}) {
    return new Promise(resolve => {
        const req = new EventEmitter();
        req.method = changes.method || "POST";
        req.headers = { host: "127.0.0.1:8092", origin: "http://127.0.0.1:8092", "content-type": "application/json", ...changes.headers };
        req.socket = { localAddress: "127.0.0.1", localPort: 8092, ...changes.socket };
        const res = new EventEmitter();
        res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
        res.end = body => { res.body = String(body || ""); resolve(res); res.emit("close"); };
        relay.handle(req, res);
        if (res.status) return;
        if (changes.abort) { req.emit("aborted"); resolve(res); return; }
        const body = typeof value === "string" ? value : JSON.stringify(value);
        for (const chunk of changes.chunks || [body]) req.emit("data", Buffer.from(chunk));
        req.emit("end");
    });
}
const publicDNS = (name, options, callback) => callback(null, [{ address: "8.8.8.8", family: 4 }]);
function setup(options = {}, routes = {}) {
    const fake = upstream(routes);
    return { ...fake, relay: createRelay({ allowOrigins: ["https://provider.test"], lookup: publicDNS, request: fake.request, ...options }) };
}
test("relay is disabled without exact origin allowlist and rejects malformed entries", async () => {
    const disabled = createRelay();
    assert.equal((await localRequest(disabled)).status, 503);
    for (const origin of ["*", "https://*.provider.test", "https://provider.test/path", "https://provider.test?token=secret", "ftp://provider.test", "https://user:secret@provider.test", "https://provider.test/#fragment"]) assert.throws(() => createRelay({ allowOrigins: [origin] }));
});
test("relay enforces local bound Host, matching Origin, JSON content type and POST", async () => {
    const f = setup();
    for (const changes of [
        { headers: { origin: "https://attacker.test" } }, { headers: { origin: undefined } },
        { headers: { host: "attacker.test:8092", origin: "http://attacker.test:8092" } },
        { headers: { host: "127.0.0.1:80", origin: "http://127.0.0.1:80" } },
        { headers: { host: "127.0.0.2:8092", origin: "http://127.0.0.2:8092" } },
        { headers: { host: "localhost.evil:8092", origin: "http://localhost.evil:8092" } },
        { headers: { origin: "http://127.0.0.1:8092/extra" } }
    ]) assert.equal((await localRequest(f.relay, undefined, changes)).status, 403);
    assert.equal((await localRequest(f.relay, undefined, { method: "GET" })).status, 405);
    assert.equal((await localRequest(f.relay, undefined, { headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal(f.calls.length, 0);
    assert.equal((await localRequest(f.relay, undefined, { headers: { host: "localhost:8092", origin: "http://localhost:8092" } })).status, 200);
    assert.equal((await localRequest(f.relay, undefined, { socket: { localAddress: "::ffff:127.0.0.1" } })).status, 200);
});
test("approved GET is pinned to validated DNS and forwards only explicitly allowed source headers", async () => {
    const f = setup({}, { "https://provider.test/list": { body: "#EXTM3U\nChannel", headers: { "set-cookie": "secret=value", "access-control-allow-origin": "*", "content-type": "text/html" } } });
    const result = await localRequest(f.relay, { url: "https://provider.test/list", headers: { Cookie: "mac=00%3A11", Authorization: "Bearer secret", "X-User-Agent": "Model: MAG250", Referer: "https://provider.test/c/" } });
    assert.equal(result.status, 200); assert.equal(result.body, "#EXTM3U\nChannel");
    assert.equal(result.headers["Content-Type"], "text/plain; charset=utf-8");
    assert(!Object.keys(result.headers).some(name => /access-control|set-cookie/i.test(name)));
    const options = f.calls[0].options;
    assert.equal(options.method, "GET"); assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.headers.cookie, "mac=00%3A11"); assert.equal(options.headers["accept-encoding"], "identity");
    options.lookup("provider.test", {}, (error, ip, family) => { assert.equal(error, null); assert.equal(ip, "8.8.8.8"); assert.equal(family, 4); });
    options.lookup("provider.test", { all: true }, (error, rows) => assert.deepEqual(rows, [{ address: "8.8.8.8", family: 4 }]));
});
test("relay rejects nonallowlisted URLs, credentials, methods, forged and multiline headers", async () => {
    const f = setup();
    assert.equal((await localRequest(f.relay, { url: "https://other.test/list" })).status, 403);
    for (const value of ["{", "null", "[]", { url: "file:///etc/passwd" }, { url: "https://user:secret@provider.test" },
        { url: "https://provider.test/\r\nInjected" }, { url: "https://provider.test/list", method: "POST" },
        { url: "https://provider.test/list", headers: { Host: "other.test" } }, { url: "https://provider.test/list", headers: { Connection: "keep-alive" } },
        { url: "https://provider.test/list", headers: { Cookie: "a\r\nHost: other.test" } },
        { url: "https://provider.test/list", headers: { Cookie: "one", cookie: "two" } },
        '{"url":"https://provider.test/list","headers":{"__proto__":"unsafe"}}']) assert.equal((await localRequest(f.relay, value)).status, 400);
    assert.equal(f.calls.length, 0);
});
test("public DNS names cannot resolve to private, reserved or mapped loopback addresses", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "100.64.1.2", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0.0.0.0", "203.0.113.1"]) {
        const f = setup({ lookup: (name, options, callback) => callback(null, [{ address: ip }]) });
        assert.equal((await localRequest(f.relay)).status, 403, ip); assert.equal(f.calls.length, 0);
    }
    const mixed = setup({ lookup: (name, options, callback) => callback(null, [{ address: "8.8.8.8" }, { address: "127.0.0.1" }]) });
    assert.equal((await localRequest(mixed.relay)).status, 403);
});
test("an explicit literal IP allowlist is required for intentional LAN sources", async () => {
    const f = setup({ allowOrigins: ["http://192.168.1.20:8080"] });
    const result = await localRequest(f.relay, { url: "http://192.168.1.20:8080/portal.php" });
    assert.equal(result.status, 200); assert.equal(f.calls.length, 1);
    assert.equal((await localRequest(f.relay, { url: "http://192.168.1.20:80/portal.php" })).status, 403);
});
test("every redirect revalidates origin and DNS; credentials never cross origins", async () => {
    const f = setup({ allowOrigins: ["https://provider.test", "https://cdn.test"] }, {
        "https://provider.test/list": { status: 302, headers: { location: "https://cdn.test/list" } },
        "https://cdn.test/list": { body: "XMLTV" }
    });
    const result = await localRequest(f.relay, { url: "https://provider.test/list", headers: { Authorization: "Bearer secret", Cookie: "private=yes", Referer: "https://provider.test/c/" } });
    assert.equal(result.status, 200); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.headers.authorization, undefined); assert.equal(f.calls[1].options.headers.cookie, undefined); assert.equal(f.calls[1].options.headers.referer, undefined);
    const escape = setup({}, { "https://provider.test/list": { status: 302, headers: { location: "http://127.0.0.1/admin" } } });
    assert.equal((await localRequest(escape.relay)).status, 403); assert.equal(escape.calls.length, 1);
    const rebound = setup({ lookup: (name, options, callback) => callback(null, [{ address: name === "cdn.test" ? "127.0.0.1" : "8.8.8.8" }]), allowOrigins: ["https://provider.test", "https://cdn.test"] }, {
        "https://provider.test/list": { status: 302, headers: { location: "https://cdn.test/list" } }
    });
    assert.equal((await localRequest(rebound.relay)).status, 403); assert.equal(rebound.calls.length, 1);
});
test("same-origin redirects keep provider credentials but loops and HTTPS downgrade stop", async () => {
    const f = setup({}, { "https://provider.test/list": { status: 302, headers: { location: "/next" } }, "https://provider.test/next": { body: "ok" } });
    assert.equal((await localRequest(f.relay, { url: "https://provider.test/list", headers: { Authorization: "Bearer secret" } })).status, 200);
    assert.equal(f.calls[1].options.headers.authorization, "Bearer secret");
    const loop = setup({}, { "https://provider.test/list": { status: 302, headers: { location: "/list" } } });
    assert.equal((await localRequest(loop.relay)).body, "REDIRECT_LIMIT"); assert.equal(loop.calls.length, 4);
    const downgrade = setup({ allowOrigins: ["https://provider.test", "http://provider.test"] }, { "https://provider.test/list": { status: 302, headers: { location: "http://provider.test/list" } } });
    assert.equal((await localRequest(downgrade.relay)).body, "REDIRECT_DOWNGRADE");
});
test("body, streamed response and timeout limits abort bounded work without leaking internals", async () => {
    const body = setup({ bodyLimit: 16 });
    assert.equal((await localRequest(body.relay, undefined, { chunks: ["12345678", "123456789"] })).status, 413); assert.equal(body.calls.length, 0);
    const response = setup({ responseLimit: 5 }, { "https://provider.test/list": { chunks: ["123", "456"] } });
    assert.equal((await localRequest(response.relay)).body, "RESPONSE_TOO_LARGE"); assert.equal(response.calls[0].req.destroyed, true);
    const timeout = setup({ timeout: 10 }, { "https://provider.test/list": { hang: true } });
    assert.equal((await localRequest(timeout.relay)).status, 504); assert.equal(timeout.calls[0].req.destroyed, true);
    const fail = setup({}, { "https://provider.test/list": { error: true } });
    assert.equal((await localRequest(fail.relay)).body, "UPSTREAM_FAILED");
    const aborted = setup({}, { "https://provider.test/list": { abort: true } });
    assert.equal((await localRequest(aborted.relay)).body, "UPSTREAM_ABORTED");
});
test("relay decodes gzip XMLTV attachments and compressed HTTP responses within the same output limit", async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><tv><channel id="news"><display-name>Новости</display-name></channel></tv>';
    const gzip = zlib.gzipSync(Buffer.from(xml));
    for (const route of [
        { body: gzip, headers: { "content-type": "application/gzip" } },
        { chunks: [gzip.subarray(0, 1), gzip.subarray(1, 15), gzip.subarray(15)], headers: {} },
        { body: gzip, headers: { "content-encoding": "gzip" } },
        { body: zlib.deflateSync(Buffer.from(xml)), headers: { "content-encoding": "deflate" } },
        { body: zlib.gzipSync(gzip), headers: { "content-encoding": "gzip", "content-type": "application/gzip" } }
    ]) {
        const f = setup({}, { "https://provider.test/list": route });
        const result = await localRequest(f.relay);
        assert.equal(result.status, 200);
        assert.equal(result.body, xml);
        assert.equal(result.headers["Content-Type"], "text/plain; charset=utf-8");
        assert.equal(result.headers["Content-Encoding"], undefined);
    }
});
test("compressed responses enforce decoded size, reject invalid data and retain cancellation bounds", async () => {
    const bomb = setup({ responseLimit: 1024 }, { "https://provider.test/list": { body: zlib.gzipSync(Buffer.from("x".repeat(8192))) } });
    assert.equal((await localRequest(bomb.relay)).body, "RESPONSE_TOO_LARGE");
    assert.equal(bomb.calls[0].req.destroyed, true);
    for (const route of [
        { body: "private provider error", headers: { "content-encoding": "gzip" } },
        { body: Buffer.from([0x1f, 0x8b, 0x08, 0x00]) },
        { body: zlib.gzipSync(Buffer.from("xml")).subarray(0, 12) }
    ]) {
        const f = setup({}, { "https://provider.test/list": route });
        assert.equal((await localRequest(f.relay)).body, "INVALID_COMPRESSED_RESPONSE");
    }
    const unsupported = setup({}, { "https://provider.test/list": { body: "compressed", headers: { "content-encoding": "br" } } });
    assert.equal((await localRequest(unsupported.relay)).body, "COMPRESSED_RESPONSE_UNSUPPORTED");
});
test("actual loopback HTTP relay follows approved redirect and keeps source cookies off the browser", async () => {
    const received = [];
    const upstreamServer = http.createServer((req, res) => {
        received.push({ method: req.method, url: req.url, cookie: req.headers.cookie });
        if (req.url === "/start") { res.writeHead(302, { Location: "/playlist" }); res.end(); }
        else { res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Set-Cookie": "upstream-session=secret" }); res.end("#EXTM3U\n#EXTINF:-1,Test\nhttps://media.test/video"); }
    });
    const listen = server => new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await listen(upstreamServer);
    const upstreamOrigin = "http://127.0.0.1:" + upstreamServer.address().port;
    const relay = createRelay({ allowOrigins: [upstreamOrigin] });
    const relayServer = http.createServer(relay.handle);
    try {
        await listen(relayServer);
        const origin = "http://127.0.0.1:" + relayServer.address().port;
        const payload = JSON.stringify({ url: upstreamOrigin + "/start", headers: { Cookie: "mac=00%3A11" } });
        const response = await new Promise((resolve, reject) => {
            const req = http.request(origin + "/api/relay", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" } }, res => {
                const chunks = []; res.on("data", chunk => chunks.push(chunk));
                res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
            });
            req.on("error", reject); req.end(payload);
        });
        assert.equal(response.status, 200);
        assert(response.text.startsWith("#EXTM3U"));
        assert.equal(response.headers["set-cookie"], undefined);
        assert.deepEqual(received, [{ method: "GET", url: "/start", cookie: "mac=00%3A11" }, { method: "GET", url: "/playlist", cookie: "mac=00%3A11" }]);
    } finally {
        await close(relayServer); await close(upstreamServer);
    }
});
