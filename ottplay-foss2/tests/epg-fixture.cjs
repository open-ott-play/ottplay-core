"use strict";
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const zlib = require("node:zlib");
const { createEPG, DEFAULT_EPG_URL } = require("../scripts/epg.cjs");

const clock = Date.UTC(2026, 8, 14, 12);
const document = '<tv><channel id="news"><display-name>Новости</display-name><display-name>News</display-name><icon src="/logos/news.png"/></channel>' +
    '<channel id="exact"><display-name>Authoritative</display-name></channel>' +
    '<channel id="empty"><display-name>Empty</display-name><icon src="https://icons.test/empty.png"/></channel>' +
    '<channel id="other"><display-name>Other</display-name></channel>' +
    '<programme channel="news" start="20260914110000 +0000" stop="20260914130000 +0000"><title>Current &amp; live</title><desc><![CDATA[<description>]]></desc></programme>' +
    '<programme channel="news" start="20260914130000 +0000" stop="20260914140000 +0000"><title>Next</title></programme>' +
    '<programme channel="news" start="20260914090000 +0000" stop="20260914100000 +0000"><title>Archive</title></programme>' +
    '<programme channel="news" start="20260916110000 +0000" stop="20260916130000 +0000"><title>Too far</title></programme>' +
    '<programme channel="news" start="20260912110000 +0000" stop="20260912130000 +0000"><title>Too old</title></programme>' +
    '<programme channel="other" start="20260914110000 +0000" stop="20260914130000 +0000"><title>Unrequested</title></programme></tv>';
const dto = { channels: [{ id: "local-only", tvgId: "proxy-news", name: "Новости HD" }, { name: "Empty" }] };

function fixture(options = {}, route = {}) {
    const calls = [];
    function request(url, configuration, callback) {
        const req = new EventEmitter(); req.destroyed = false; req.destroy = () => { req.destroyed = true; };
        calls.push({ url: String(url), configuration, req });
        req.end = () => setImmediate(() => {
            if (req.destroyed || route.hang) return;
            if (route.error) { req.emit("error", new Error("private error")); return; }
            const body = route.body === undefined ? zlib.gzipSync(Buffer.from(document)) : route.body;
            const response = Readable.from(route.chunks || [body]);
            response.statusCode = route.status || 200; response.headers = route.headers || {};
            callback(response);
        });
        return req;
    }
    return { calls, epg: createEPG({ now: () => clock, request, ...options }) };
}
function invoke(epg, value = dto, changes = {}) {
    const req = new EventEmitter(), res = new EventEmitter();
    req.method = changes.method || "POST";
    req.headers = { host: "127.0.0.1:8092", origin: "http://127.0.0.1:8092", "content-type": "application/json", ...changes.headers };
    req.socket = { localAddress: "127.0.0.1", localPort: 8092 };
    const result = new Promise(resolve => {
        res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
        res.end = body => { res.body = String(body); resolve(res); res.emit("close"); };
        epg.handle(req, res);
        if (!res.status) { req.emit("data", Buffer.from(typeof value === "string" ? value : JSON.stringify(value))); req.emit("end"); }
    });
    return { result, cancel() { res.emit("close"); }, req, res };
}

module.exports = { fixture, invoke, clock, document, dto };
