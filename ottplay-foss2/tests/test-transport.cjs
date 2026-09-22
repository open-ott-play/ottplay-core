"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function fixture(configuration) {
    const modules = {}, requests = [], timers = new Map(), results = [];
    let nextTimer = 0;
    class XHR {
        constructor() { this.readyState = 0; this.status = 0; this.responseText = ""; this.headers = {}; requests.push(this); }
        open(method, url) { this.method = method; this.url = url; }
        setRequestHeader(name, value) { this.headers[name] = value; }
        send(value) { this.sent = value; }
        abort() { this.aborted = true; }
        complete(status, text) { this.readyState = 4; this.status = status; this.responseText = text; if (this.onreadystatechange) this.onreadystatechange(); }
    }
    const environment = {
        XMLHttpRequest: XHR,
        setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    const context = vm.createContext({ OTT2: { define(name, factory) { modules[name] = factory(); } } });
    vm.runInContext("Promise = undefined; fetch = undefined; Map = undefined; Set = undefined; URL = undefined;", context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/transport.js"), "utf8"), context);
    const request = modules.transport.create(environment, configuration);
    return { requests, timers, results, start(url = "https://epg.test/guide", options) { return request(url, (error, text) => results.push({ error, text }), options); } };
}

test("transport keeps normal XMLTV text and decodes no provider messages into diagnostics", () => {
    const f = fixture(); f.start();
    f.requests[0].complete(200, '<tv><channel id="news"/></tv>');
    assert.equal(f.results[0].error, null);
    assert.equal(f.results[0].text, '<tv><channel id="news"/></tv>');
    assert.equal(f.timers.size, 0);
    const error = fixture({ relay: true }); error.start();
    error.requests[0].complete(502, "https://private.example/?token=secret");
    assert.equal(error.results[0].error.code, "HTTP");
    assert(!error.results[0].error.message.includes("secret"));
});

test("transport reports fixed relay failure codes and consistently classifies browser failures", () => {
    for (const code of ["UPSTREAM_ORIGIN_NOT_ALLOWED", "RELAY_DISABLED", "RESPONSE_TOO_LARGE", "INVALID_COMPRESSED_RESPONSE"]) {
        const f = fixture({ relay: true }); f.start();
        assert.equal(f.requests[0].method, "POST");
        f.requests[0].complete(502, code);
        assert.equal(f.results[0].error.code, code);
    }
    const direct = fixture(); direct.start(); direct.requests[0].complete(502, "RELAY_DISABLED");
    assert.equal(direct.results[0].error.code, "HTTP");
    const network = fixture(); network.start(); network.requests[0].onerror();
    assert.equal(network.results[0].error.code, "NETWORK");
});

test("transport aborts oversized XMLTV during progress before retaining a complete response", () => {
    const f = fixture(); f.start();
    const xhr = f.requests[0]; xhr.readyState = 3;
    xhr.responseText = "x".repeat(16 * 1024 * 1024 + 1);
    const late = xhr.onreadystatechange;
    xhr.onprogress();
    assert.equal(xhr.aborted, true);
    assert.equal(f.results[0].error.code, "RESPONSE_SIZE");
    assert.equal(f.timers.size, 0);
    xhr.readyState = 4; xhr.status = 200; late();
    assert.equal(f.results.length, 1);
});

test("cancellation and timeout detach every XHR callback and complete at most once", () => {
    const cancelled = fixture(); const cancel = cancelled.start();
    const xhr = cancelled.requests[0], late = xhr.onreadystatechange;
    cancel(); xhr.readyState = 4; xhr.status = 200; xhr.responseText = "<tv/>"; late();
    assert.equal(cancelled.results.length, 0);
    assert.equal(cancelled.timers.size, 0);
    assert.equal(xhr.onprogress, null);
    assert.equal(xhr.aborted, true);
    const timed = fixture(); timed.start();
    Array.from(timed.timers.values())[0]();
    assert.equal(timed.results[0].error.code, "TIMEOUT");
    assert.equal(timed.requests[0].onprogress, null);
    assert.equal(timed.requests[0].aborted, true);
});
test("built-in guide posts only channel identities, independent of relay and provider credentials", () => {
    const f = fixture({ relay: true });
    f.start("https://cdn.epg.one/epg2.xml.gz", { builtinEPG: true, channels: [{ id: "local", name: "News", tvgId: "news", url: "https://secret.test/token", sourceId: "private" }], headers: { Cookie: "secret" } });
    const xhr = f.requests[0];
    assert.equal(xhr.method, "POST"); assert.equal(xhr.url, "/api/epg");
    assert.deepEqual(JSON.parse(xhr.sent), { channels: [{ tvgId: "news", tvgName: "", name: "News", archiveDays: 0 }] });
    assert.equal(xhr.headers.Cookie, undefined);
    assert.equal(xhr.headers["X-OTT2-EPG"], "1");
    xhr.complete(502, "EPG_GZIP"); assert.equal(f.results[0].error.code, "EPG_GZIP");
});
