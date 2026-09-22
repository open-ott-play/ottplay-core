"use strict";
// The public default guide is streamed on the server; TV browsers receive only
// requested channel metadata, one future day and up to seven archive days.
const https = require("node:https");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { SaxesParser } = require("saxes");
const { validLocalOrigin } = require("./relay.cjs");
const core = require("../vendor/ottplay-core.js");

const DEFAULT_EPG_URL = "https://cdn.epg.one/epg2.xml.gz";
const MB = 1024 * 1024;
const canonicalName = value => core.canonicalChannelName(String(value || ""));
const escape = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
function time(value) { return core.parseBrowserXmltvTime(String(value || "")); }
function identities(dto) {
    if (!dto || typeof dto !== "object" || Array.isArray(dto) || Object.keys(dto).some(key => key !== "channels") || !Array.isArray(dto.channels) || !dto.channels.length || dto.channels.length > 16384) throw new Error("EPG_REQUEST");
    for (const row of dto.channels) {
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !["id", "tvgId", "tvgName", "name", "archiveDays"].includes(key))) throw new Error("EPG_REQUEST");
        for (const key of Object.keys(row)) if (key !== "archiveDays" && (typeof row[key] !== "string" || row[key].length > 512 || /[\u0000-\u001f\u007f]/.test(row[key]))) throw new Error("EPG_REQUEST");
        if (row.archiveDays !== undefined && (typeof row.archiveDays !== "number" || !Number.isFinite(row.archiveDays) || row.archiveDays < 0 || row.archiveDays > 7)) throw new Error("EPG_REQUEST");
    }
    return core.streamingGuideIdentities(dto.channels).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
function createEPG(configuration = {}) {
    const request = configuration.request || ((url, options, callback) => https.request(url, options, callback));
    const now = configuration.now || Date.now;
    const limits = {
        wire: Math.min(configuration.wireLimit || 80 * MB, 80 * MB),
        decoded: Math.min(configuration.decodedLimit || 512 * MB, 512 * MB),
        output: Math.min(configuration.outputLimit || 16 * MB, 16 * MB),
        programmes: Math.min(configuration.programmeLimit || 50000, 50000),
        perChannel: Math.min(configuration.channelProgrammeLimit || 384, 512),
        timeout: Math.min(configuration.timeout || 120000, 120000)
    };
    let active = null, cache = null, clients = 0;
    function handle(req, res) {
        let closed = false, release = null, readingTimer, counted = false;
        function cleanup() {
            clearTimeout(readingTimer);
            if (counted) { clients--; counted = false; }
            if (release) { const cancel = release; release = null; cancel(); }
        }
        function respond(status, body) {
            if (closed) return;
            closed = true; cleanup();
            res.writeHead(status, { "Content-Type": status === 200 ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
            res.end(body);
        }
        if (req.method !== "POST") { respond(405, "POST_REQUIRED"); return; }
        // Some older TV engines omit Origin on same-origin XHR. A required
        // custom header still makes cross-origin requests need an unavailable
        // CORS preflight; validate Host against the actual bound socket as well.
        const originRequest = req.headers.origin === undefined && req.headers["x-ott2-epg"] === "1" ? {
            headers: { ...req.headers, origin: (req.socket.encrypted ? "https://" : "http://") + req.headers.host }, socket: req.socket
        } : req;
        if (!validLocalOrigin(originRequest)) { respond(403, "SAME_ORIGIN_REQUIRED"); return; }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers["content-type"] || "")) { respond(415, "JSON_REQUIRED"); return; }
        if (clients >= 8) { respond(429, "EPG_BUSY"); return; }
        clients++; counted = true;
        const abort = () => { if (!closed) { closed = true; cleanup(); } };
        res.on("close", abort); req.on("aborted", abort);
        req.on("error", () => respond(400, "EPG_REQUEST"));
        readingTimer = setTimeout(() => respond(408, "EPG_REQUEST_TIMEOUT"), 10000);
        const chunks = []; let length = 0;
        req.on("data", chunk => {
            if (closed) return;
            length += chunk.length;
            if (length > 4 * MB) { chunks.length = 0; respond(413, "EPG_REQUEST_TOO_LARGE"); return; }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (closed) return;
            clearTimeout(readingTimer);
            let rows, key;
            try {
                rows = identities(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                key = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
            } catch { respond(400, "EPG_REQUEST"); return; }
            chunks.length = 0;
            if (cache && cache.key === key && now() - cache.created < 30 * 60000) { respond(200, cache.xml); return; }
            if (active && active.key !== key) { respond(429, "EPG_BUSY"); return; }
            if (!active) active = createJob(key, rows);
            const job = active;
            job.listeners.add(respond);
            release = () => {
                job.listeners.delete(respond);
                if (!job.listeners.size && active === job) job.cancel();
            };
            if (!job.started) job.start();
        });
    }
    function createJob(key, requested) {
        const job = { key, listeners: new Set(), started: false, start, cancel: () => finish(499, "EPG_CANCELLED") };
        const guide = new core.StreamingGuideFilter(requested, now() / 1000, limits.programmes, limits.perChannel);
        const parser = new SaxesParser(), utf8 = new StringDecoder("utf8");
        let done = false, outgoing = null, incoming = null, decoder = null, timer;
        let wire = 0, decoded = 0, depth = 0, sawRoot = false, item = null, field = null, gap = 0;
        function invalid(code) { const error = new Error(code); error.code = code; throw error; }
        function finish(status, body) {
            if (done) return;
            done = true; clearTimeout(timer);
            if (outgoing) outgoing.destroy(); if (incoming) incoming.destroy(); if (decoder) decoder.destroy();
            if (active === job) active = null;
            if (status === 200) cache = { key, created: now(), xml: body };
            const listeners = Array.from(job.listeners); job.listeners.clear();
            for (const callback of listeners) callback(status, body);
        }
        parser.on("error", () => invalid("EPG_XML"));
        parser.on("doctype", value => { if (!/^\s*tv(?:\s+SYSTEM\s+(?:"[^"<>]*"|'[^'<>]*'))?\s*$/.test(value)) invalid("EPG_XML"); });
        parser.on("opentag", tag => {
            depth++;
            if (depth > 16) invalid("EPG_XML");
            if (depth === 1) { if (tag.name !== "tv" || sawRoot) invalid("EPG_XML"); sawRoot = true; return; }
            if (depth === 2 && tag.name === "channel") item = { kind: "channel", id: String(tag.attributes.id || "").trim(), names: [], icon: "" };
            else if (depth === 2 && tag.name === "programme") {
                const id = String(tag.attributes.channel || "").trim(), begin = time(tag.attributes.start), end = time(tag.attributes.stop);
                item = guide.accepts(id, begin, end) ? { kind: "programme", id, start: String(tag.attributes.start), stop: String(tag.attributes.stop || ""), begin, end, title: "", desc: "", catchupId: String(tag.attributes["catchup-id"] || "") } : null;
            }
            if (!item) return;
            if (item.id.length > 512) invalid("EPG_FIELD_TOO_LARGE");
            if (depth === 3 && tag.name === "icon" && item.kind === "channel") {
                if (String(tag.attributes.src || "").length > 8192) invalid("EPG_FIELD_TOO_LARGE");
                if (!item.icon) {
                    try { const url = new URL(String(tag.attributes.src || ""), DEFAULT_EPG_URL); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) item.icon = url.href; } catch {}
                }
            }
            if (depth === 3 && ((item.kind === "channel" && tag.name === "display-name") || (item.kind === "programme" && ["title", "desc", "catchup-id"].includes(tag.name)))) field = { name: tag.name, text: "" };
        });
        function addText(value) { if (field) { field.text += value; if (field.text.length > 16384) invalid("EPG_FIELD_TOO_LARGE"); } }
        parser.on("text", addText); parser.on("cdata", addText);
        parser.on("closetag", () => {
            if (depth === 3 && field && item) {
                const value = field.text.trim();
                if (field.name === "display-name") { if (item.names.length >= 64) invalid("EPG_FIELD_TOO_LARGE"); item.names.push(value); }
                else if (field.name === "catchup-id") { if (!item.catchupId) item.catchupId = value; }
                else if (!item[field.name]) item[field.name] = value;
                field = null;
            }
            if (depth === 2 && item) {
                if (item.kind === "channel") {
                    if (!guide.channel(item.id, item.names, item.icon)) invalid("EPG_TOO_LARGE");
                } else guide.programme(item.id, item.begin, item.end, item);
                item = null;
            }
            depth--;
        });
        function feed(chunk) {
            if (done) return;
            decoded += chunk.length;
            if (decoded > limits.decoded) { finish(502, "EPG_DECODED_TOO_LARGE"); return; }
            const text = utf8.write(chunk);
            const lastBoundary = Math.max(text.lastIndexOf("<"), text.lastIndexOf(">"));
            gap = lastBoundary < 0 ? gap + text.length : text.length - lastBoundary;
            if (gap > MB) { finish(502, "EPG_FIELD_TOO_LARGE"); return; }
            try { parser.write(text); } catch (error) { finish(502, /^EPG_/.test(error.code || "") ? error.code : "EPG_XML"); }
        }
        function complete() {
            if (done) return;
            try {
                parser.write(utf8.end()).close();
                if (!sawRoot) invalid("EPG_XML");
                let xml = "";
                const coverage = guide.output(limits.output,
                    (id, names, icon) => '<channel id="' + escape(id) + '">' + names.map(name => '<display-name>' + escape(name) + '</display-name>').join("") + (icon ? '<icon src="' + escape(icon) + '"/>' : "") + '</channel>',
                    (id, entry) => '<programme channel="' + escape(id) + '" start="' + escape(entry.start) + '"' + (entry.stop ? ' stop="' + escape(entry.stop) + '"' : "") + (entry.catchupId ? ' catchup-id="' + escape(entry.catchupId) + '"' : "") + '><title>' + escape(entry.title) + '</title>' + (entry.desc ? '<desc>' + escape(entry.desc) + '</desc>' : "") + '</programme>',
                    value => Buffer.byteLength(value), value => { xml += value; });
                if (!coverage) invalid("EPG_TOO_LARGE");
                const header = '<?xml version="1.0" encoding="UTF-8"?><tv generator-info-name="OTT-play 2 filtered guide" data-window-start="' + coverage.start + '" data-window-end="' + coverage.end + '" data-programme-limit="' + coverage.programmeLimit + '" data-truncated-channels="' + coverage.truncatedChannels + '" data-truncated="' + (coverage.truncatedChannels ? 'true' : 'false') + '">';
                finish(200, header + xml + '</tv>');
            } catch (error) { finish(502, /^EPG_/.test(error.code || "") ? error.code : "EPG_XML"); }
        }
        function start() {
            job.started = true;
            timer = setTimeout(() => finish(504, "EPG_TIMEOUT"), limits.timeout);
            follow(new URL(DEFAULT_EPG_URL), 0);
        }
        function follow(url, redirects) {
            try {
                const attempt = request(url, { method: "GET", agent: false, rejectUnauthorized: true, headers: { Accept: "application/xml, application/gzip, */*", "Accept-Encoding": "identity", "User-Agent": "OTT-play-FOSS2/0.3" } }, response => {
                    if (done) { response.destroy(); return; }
                    incoming = response;
                    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                        let next; try { next = new URL(response.headers.location, url); } catch { finish(502, "EPG_UPSTREAM"); return; }
                        if (redirects >= 2 || next.origin !== new URL(DEFAULT_EPG_URL).origin || next.username || next.password) { finish(502, "EPG_UPSTREAM"); return; }
                        response.destroy(); incoming = null; outgoing.destroy(); outgoing = null; follow(next, redirects + 1); return;
                    }
                    if (response.statusCode !== 200) { finish(502, "EPG_UPSTREAM"); return; }
                    if (Number(response.headers["content-length"]) > limits.wire) { finish(502, "EPG_WIRE_TOO_LARGE"); return; }
                    let started = false, prefix = Buffer.alloc(0);
                    function consume(chunk) {
                        if (decoder) { if (!decoder.write(chunk)) { response.pause(); decoder.once("drain", () => { if (!done) response.resume(); }); } }
                        else feed(chunk);
                    }
                    response.on("data", chunk => {
                        if (done) return;
                        wire += chunk.length;
                        if (wire > limits.wire) { finish(502, "EPG_WIRE_TOO_LARGE"); return; }
                        if (!started) {
                            prefix = Buffer.concat([prefix, chunk]);
                            if (prefix.length < 2) return;
                            started = true;
                            if (prefix[0] === 0x1f && prefix[1] === 0x8b) {
                                decoder = zlib.createGunzip();
                                decoder.on("data", feed); decoder.on("end", complete); decoder.on("error", () => finish(502, "EPG_GZIP"));
                            }
                            consume(prefix); prefix = null;
                        } else consume(chunk);
                    });
                    response.on("end", () => { if (done) return; if (decoder) decoder.end(); else { if (prefix && prefix.length) feed(prefix); complete(); } });
                    response.on("error", () => finish(502, "EPG_UPSTREAM")); response.on("aborted", () => finish(502, "EPG_UPSTREAM"));
                });
                outgoing = attempt;
                attempt.on("error", () => { if (outgoing === attempt) finish(502, "EPG_UPSTREAM"); }); attempt.end();
            } catch { finish(502, "EPG_UPSTREAM"); }
        }
        return job;
    }
    return { handle };
}
module.exports = { createEPG, DEFAULT_EPG_URL, canonicalName };
