"use strict";
// Optional playlist / EPG / portal relay. It never streams video or exposes remote control.
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const net = require("node:net");
const zlib = require("node:zlib");

const nonPublic = new net.BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) nonPublic.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 96], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]]) nonPublic.addSubnet(address, prefix, "ipv6");
const headerNames = new Set(["accept", "authorization", "cookie", "user-agent", "x-user-agent", "referer"]);

function hostName(value) { return value.replace(/^\[|\]$/g, "").toLowerCase(); }
function address(value) {
    value = hostName(value || "");
    if (value.startsWith("::ffff:") && net.isIP(value.slice(7)) === 4) return value.slice(7);
    return value;
}
function isPrivate(value) {
    value = address(value);
    const family = net.isIP(value);
    if (family === 6 && /^::ffff:/i.test(value)) {
        const tail = value.slice(7).split(":");
        if (tail.length === 2 && tail.every(part => /^[0-9a-f]{1,4}$/i.test(part))) {
            const a = parseInt(tail[0], 16), b = parseInt(tail[1], 16);
            return isPrivate([a >>> 8, a & 255, b >>> 8, b & 255].join("."));
        }
        return true;
    }
    return !family || nonPublic.check(value, family === 6 ? "ipv6" : "ipv4");
}
function targetURL(value) {
    if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error("URL");
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.hostname.includes("*")) throw new Error("URL");
    return url;
}
function validLocalOrigin(req) {
    const host = req.headers.host, origin = req.headers.origin;
    if (typeof host !== "string" || typeof origin !== "string") return false;
    const scheme = req.socket.encrypted ? "https:" : "http:";
    let local, supplied;
    try { local = targetURL(scheme + "//" + host); supplied = targetURL(origin); } catch { return false; }
    if (local.pathname !== "/" || supplied.pathname !== "/" || local.search || supplied.search || local.origin !== supplied.origin || supplied.protocol !== scheme) return false;
    const port = Number(local.port || (scheme === "https:" ? 443 : 80));
    if (port !== req.socket.localPort) return false;
    const actual = address(req.socket.localAddress), expected = address(local.hostname);
    if (expected === "localhost") return actual === "127.0.0.1" || actual === "::1";
    return !!net.isIP(expected) && expected === actual;
}

function createRelay(configuration = {}) {
    const allowed = new Set();
    for (const value of configuration.allowOrigins || []) {
        const url = targetURL(value);
        if (url.pathname !== "/" || url.search) throw new Error("Relay allowlist entries must be exact HTTP(S) origins");
        allowed.add(url.origin);
    }
    const lookup = configuration.lookup || dns.lookup;
    const request = configuration.request || ((url, options, callback) => (url.protocol === "https:" ? https : http).request(url, options, callback));
    const responseLimit = Math.min(configuration.responseLimit || 16 * 1024 * 1024, 16 * 1024 * 1024);
    const bodyLimit = Math.min(configuration.bodyLimit || 64 * 1024, 64 * 1024);
    const timeout = Math.min(configuration.timeout || 20000, 20000);
    let active = 0;
    function handle(req, res) {
        function reject(status, code) {
            res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
            res.end(code);
        }
        if (!allowed.size) { reject(503, "RELAY_DISABLED"); return; }
        if (req.method !== "POST") { reject(405, "POST_REQUIRED"); return; }
        if (!validLocalOrigin(req)) { reject(403, "SAME_ORIGIN_REQUIRED"); return; }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers["content-type"] || "")) { reject(415, "JSON_REQUIRED"); return; }
        if (active >= 8) { reject(429, "RELAY_BUSY"); return; }
        active++;
        let done = false, outgoing = null, incoming = null, decoder = null, chunks = [], size = 0;
        const timer = setTimeout(() => finish(504, "UPSTREAM_TIMEOUT"), timeout);
        function cleanup() {
            clearTimeout(timer);
            if (outgoing) outgoing.destroy();
            if (incoming) incoming.destroy();
            if (decoder) decoder.destroy();
            active--;
        }
        function finish(status, body) {
            if (done) return;
            done = true; cleanup(); reject(status, body);
        }
        res.on("close", () => { if (!done) { done = true; cleanup(); } });
        req.on("aborted", () => { if (!done) { done = true; cleanup(); } });
        req.on("error", () => finish(400, "INVALID_REQUEST"));
        req.on("data", chunk => {
            if (done) return;
            size += chunk.length;
            if (size > bodyLimit) { chunks = []; finish(413, "REQUEST_TOO_LARGE"); return; }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (done) return;
            let dto, url, headers = {};
            try {
                dto = JSON.parse(Buffer.concat(chunks).toString("utf8")); chunks = [];
                if (!dto || typeof dto !== "object" || Array.isArray(dto) || Object.keys(dto).some(key => !["url", "headers"].includes(key))) throw new Error("DTO");
                url = targetURL(dto.url);
                if (dto.headers !== undefined && (!dto.headers || typeof dto.headers !== "object" || Array.isArray(dto.headers))) throw new Error("HEADERS");
                for (const [name, value] of Object.entries(dto.headers || {})) {
                    const normalized = name.toLowerCase();
                    if (!headerNames.has(normalized) || Object.hasOwn(headers, normalized) || typeof value !== "string" || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("HEADER");
                    if (normalized === "referer" && value) targetURL(value);
                    headers[normalized] = value;
                }
                if (JSON.stringify(headers).length > 16384) throw new Error("HEADERS");
            } catch { finish(400, "INVALID_RELAY_REQUEST"); return; }
            follow(url, headers, 0);
        });
        function follow(url, suppliedHeaders, redirects) {
            if (done) return;
            if (!allowed.has(url.origin)) { finish(403, "UPSTREAM_ORIGIN_NOT_ALLOWED"); return; }
            const hostname = hostName(url.hostname), literal = net.isIP(hostname), localName = hostname === "localhost";
            function resolved(error, records) {
                if (done) return;
                if (error || !Array.isArray(records) || !records.length || records.some(record => !record || !net.isIP(record.address))) { finish(502, "DNS_FAILED"); return; }
                // A DNS hostname may not be rebound into a private or reserved network.
                // LAN access requires an explicitly configured literal IP origin.
                if (!literal && records.some(record => localName ? !["127.0.0.1", "::1"].includes(address(record.address)) : isPrivate(record.address))) { finish(403, "UPSTREAM_ADDRESS_NOT_ALLOWED"); return; }
                const chosen = records[0], family = net.isIP(chosen.address);
                const options = { method: "GET", agent: false, rejectUnauthorized: true,
                    headers: { ...suppliedHeaders, "accept-encoding": "identity" },
                    lookup(name, settings, callback) {
                        if (typeof settings === "function") { callback = settings; settings = {}; }
                        if (settings && settings.all) callback(null, [{ address: chosen.address, family }]);
                        else callback(null, chosen.address, family);
                    } };
                try {
                    const attempt = request(url, options, response => {
                        if (done) { response.destroy(); return; }
                        incoming = response;
                        const status = response.statusCode;
                        if ([301, 302, 303, 307, 308].includes(status)) {
                            if (redirects >= 3 || typeof response.headers.location !== "string") { finish(502, "REDIRECT_LIMIT"); return; }
                            let next;
                            try { next = targetURL(new URL(response.headers.location, url).href); } catch { finish(502, "INVALID_REDIRECT"); return; }
                            if (url.protocol === "https:" && next.protocol !== "https:") { finish(403, "REDIRECT_DOWNGRADE"); return; }
                            const nextHeaders = { ...suppliedHeaders };
                            if (next.origin !== url.origin) { delete nextHeaders.authorization; delete nextHeaders.cookie; delete nextHeaders.referer; }
                            response.destroy(); incoming = null;
                            outgoing.destroy(); outgoing = null;
                            follow(next, nextHeaders, redirects + 1); return;
                        }
                        if (status < 200 || status >= 600) { finish(502, "UPSTREAM_STATUS"); return; }
                        const encoding = String(response.headers["content-encoding"] || "identity").trim().toLowerCase();
                        if (!["identity", "gzip", "x-gzip", "deflate"].includes(encoding)) { finish(502, "COMPRESSED_RESPONSE_UNSUPPORTED"); return; }
                        if (Number(response.headers["content-length"]) > responseLimit) { finish(502, "RESPONSE_TOO_LARGE"); return; }
                        let received = 0;
                        const data = [];
                        response.on("data", chunk => {
                            if (done) return;
                            received += chunk.length;
                            if (received > responseLimit) { finish(502, "RESPONSE_TOO_LARGE"); return; }
                            data.push(chunk);
                        });
                        response.on("end", () => {
                            if (done) return;
                            const body = Buffer.concat(data);
                            data.length = 0;
                            if (encoding === "gzip" || encoding === "x-gzip" || encoding === "deflate") decode(body, encoding, true);
                            else normalize(body);
                        });
                        response.on("error", () => finish(502, "UPSTREAM_FAILED"));
                        response.on("aborted", () => finish(502, "UPSTREAM_ABORTED"));
                        function normalize(body) {
                            // XMLTV .gz downloads are often attachments with no HTTP encoding.
                            // Decode by magic rather than the URL, which may be extensionless.
                            if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) decode(body, "gzip", false);
                            else finish(status, body);
                        }
                        function decode(body, encoding, mayBeAttachment) {
                            if (done) return;
                            let decodedSize = 0;
                            const decoded = [];
                            decoder = encoding === "deflate" ? zlib.createInflate() : zlib.createGunzip();
                            decoder.on("data", chunk => {
                                if (done) return;
                                decodedSize += chunk.length;
                                if (decodedSize > responseLimit) { finish(502, "RESPONSE_TOO_LARGE"); return; }
                                decoded.push(chunk);
                            });
                            decoder.on("error", () => finish(502, "INVALID_COMPRESSED_RESPONSE"));
                            decoder.on("end", () => {
                                if (done) return;
                                const output = Buffer.concat(decoded);
                                decoder = null;
                                if (mayBeAttachment) normalize(output);
                                else finish(status, output);
                            });
                            decoder.end(body);
                        }
                    });
                    outgoing = attempt;
                    attempt.on("error", () => { if (outgoing === attempt) finish(502, "UPSTREAM_FAILED"); });
                    attempt.end();
                } catch { finish(502, "UPSTREAM_FAILED"); }
            }
            if (literal) resolved(null, [{ address: hostname, family: literal }]);
            else {
                try { lookup(hostname, { all: true, verbatim: true }, resolved); }
                catch { finish(502, "DNS_FAILED"); }
            }
        }
    }
    return { handle };
}
module.exports = { createRelay, validLocalOrigin };
