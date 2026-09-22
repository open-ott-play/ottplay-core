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
const normalize = value => core.normalizedChannelName(String(value || ""));
const canonicalName = value => core.canonicalChannelName(String(value || ""));
const escape = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
function time(value) { return core.parseBrowserXmltvTime(String(value || "")); }
function identities(dto) {
    if (!dto || typeof dto !== "object" || Array.isArray(dto) || Object.keys(dto).some(key => key !== "channels") || !Array.isArray(dto.channels) || !dto.channels.length || dto.channels.length > 16384) throw new Error("EPG_REQUEST");
    const unique = new Map();
    for (const row of dto.channels) {
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !["id", "tvgId", "tvgName", "name", "archiveDays"].includes(key))) throw new Error("EPG_REQUEST");
        for (const key of Object.keys(row)) if (key !== "archiveDays" && (typeof row[key] !== "string" || row[key].length > 512 || /[\u0000-\u001f\u007f]/.test(row[key]))) throw new Error("EPG_REQUEST");
        if (row.archiveDays !== undefined && (typeof row.archiveDays !== "number" || !Number.isFinite(row.archiveDays) || row.archiveDays < 0 || row.archiveDays > 7)) throw new Error("EPG_REQUEST");
        const identity = [String(row.tvgId || "").trim(), normalize(row.tvgName), normalize(row.name)];
        if (!identity.some(Boolean)) throw new Error("EPG_REQUEST");
        const key = JSON.stringify(identity), previous = unique.get(key);
        identity.push(Math.max(1, row.archiveDays || 0, previous ? previous[3] : 0));
        unique.set(key, identity);
    }
    return Array.from(unique.values()).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
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
        const wantedIds = new Set(requested.map(row => row[0]).filter(Boolean));
        const wantedNames = new Set(requested.flatMap(row => row.slice(1, 3)).filter(Boolean));
        const wantedAliases = new Set(Array.from(wantedNames, canonicalName).filter(Boolean));
        const idDepths = new Map(), nameDepths = new Map(), aliasDepths = new Map(), candidateDepths = new Map();
        function retainDepth(map, key, days) { if (key) map.set(key, Math.max(map.get(key) || 1, days)); }
        for (const row of requested) {
            retainDepth(idDepths, row[0], row[3]);
            for (const name of row.slice(1, 3)) { retainDepth(nameDepths, name, row[3]); retainDepth(aliasDepths, canonicalName(name), row[3]); }
        }
        const metadata = new Map(), aliases = new Map(), canonicalAliases = new Map(), programmes = new Map(), nextCandidates = new Map(), truncated = new Set();
        const parser = new SaxesParser(), utf8 = new StringDecoder("utf8");
        const clock = now() / 1000, startWindow = clock - Math.max(...requested.map(row => row[3])) * 86400, endWindow = clock + 86400;
        let done = false, outgoing = null, incoming = null, decoder = null, timer;
        let wire = 0, decoded = 0, programmeCount = 0, depth = 0, sawRoot = false, item = null, field = null, gap = 0;
        let programmeCap = limits.perChannel, candidateCount = wantedIds.size;
        function priority(entry) { return entry.begin <= clock && (entry.end === null || entry.end > clock) ? -1000000000000 + clock - entry.begin : nextCandidates.get(entry.id) === entry ? -500000000000 + entry.begin - clock : Math.abs(entry.begin - clock); }
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
                const channelStart = clock - Math.max(idDepths.get(id) || 1, candidateDepths.get(id) || 1) * 86400;
                item = begin !== null && begin < endWindow && (end === null ? begin >= channelStart : end > channelStart && end > begin) && (wantedIds.has(id) || metadata.has(id)) ? { kind: "programme", id, start: String(tag.attributes.start), stop: String(tag.attributes.stop || ""), begin, end, title: "", desc: "", catchupId: String(tag.attributes["catchup-id"] || "") } : null;
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
                    const matches = item.names.map(normalize).filter(name => wantedNames.has(name));
                    const canonicalMatches = item.names.map(canonicalName).filter(name => wantedAliases.has(name));
                    if (wantedIds.has(item.id) || matches.length || canonicalMatches.length) {
                        if (metadata.size >= 16384 && !metadata.has(item.id)) invalid("EPG_TOO_LARGE");
                        let days = idDepths.get(item.id) || 1;
                        for (const name of matches) days = Math.max(days, nameDepths.get(name) || 1);
                        for (const name of canonicalMatches) days = Math.max(days, aliasDepths.get(name) || 1);
                        retainDepth(candidateDepths, item.id, days);
                        const previous = metadata.get(item.id);
                        if (previous) { previous.names = Array.from(new Set(previous.names.concat(item.names))); if (!previous.icon) previous.icon = item.icon; }
                        else { metadata.set(item.id, item); if (!wantedIds.has(item.id)) candidateCount++; }
                        for (const name of matches) { if (!aliases.has(name)) aliases.set(name, new Set()); aliases.get(name).add(item.id); }
                        for (const name of canonicalMatches) { if (!canonicalAliases.has(name)) canonicalAliases.set(name, new Set()); canonicalAliases.get(name).add(item.id); }
                    }
                } else {
                    // Reserve an equal bounded share for every candidate, including
                    // programme-only exact IDs, before retaining any schedule.
                    programmeCap = Math.max(1, Math.min(programmeCap, Math.floor(limits.programmes / Math.max(1, candidateCount, requested.length))));
                    if (!programmes.has(item.id)) programmes.set(item.id, []);
                    const entries = programmes.get(item.id);
                    if (item.begin > clock && (!nextCandidates.has(item.id) || item.begin < nextCandidates.get(item.id).begin)) {
                        nextCandidates.set(item.id, item);
                        entries.sort((left, right) => priority(left) - priority(right));
                    }
                    const score = priority(item);
                    if (entries.length >= programmeCap) {
                        truncated.add(item.id);
                        if (score >= priority(entries[entries.length - 1])) { item = null; depth--; return; }
                        entries.pop(); programmeCount--;
                    }
                    if (programmeCount >= limits.programmes) { truncated.add(item.id); item = null; depth--; return; }
                    let low = 0, high = entries.length;
                    while (low < high) { const middle = (low + high) >>> 1; if (priority(entries[middle]) <= score) low = middle + 1; else high = middle; }
                    entries.splice(low, 0, item); programmeCount++;
                }
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
                const selected = new Set(), selectedDepths = new Map();
                function select(id, days) { selected.add(id); retainDepth(selectedDepths, id, days); }
                for (const row of requested) {
                    const candidates = (index, key) => Array.from(index.get(key) || []);
                    const id = core.chooseGuideChannel(
                        row[0] && (metadata.has(row[0]) || programmes.has(row[0])) ? [row[0]] : [],
                        row.slice(1, 3).map(name => candidates(aliases, name)),
                        row.slice(1, 3).map(name => candidates(canonicalAliases, canonicalName(name)))
                    );
                    if (id !== null) select(id, row[3]);
                }
                let xml = "", size = 512;
                function append(value) { size += Buffer.byteLength(value); if (size > limits.output) invalid("EPG_TOO_LARGE"); xml += value; }
                // Keep relevant unselected metadata too: removing one side of an
                // ambiguous alias would make the browser falsely see a unique name.
                const visibleMetadata = new Set([...metadata.keys(), ...selected]);
                for (const id of visibleMetadata) {
                    const channel = metadata.get(id) || { names: [], icon: "" };
                    append('<channel id="' + escape(id) + '">' + channel.names.map(name => '<display-name>' + escape(name) + '</display-name>').join("") + (channel.icon ? '<icon src="' + escape(channel.icon) + '"/>' : "") + '</channel>');
                }
                const schedules = Array.from(selected, id => {
                    const lower = clock - (selectedDepths.get(id) || 1) * 86400;
                    const entries = (programmes.get(id) || []).filter(entry => entry.end === null ? entry.begin >= lower : entry.end > lower);
                    const selection = core.selectGuideSchedule(entries.map(entry => ({ start: entry.begin, end: entry.end })), clock, true);
                    const current = entries[selection.current], next = entries[selection.next];
                    return { id, entries: [current, next].filter(Boolean).concat(entries.filter(entry => entry !== current && entry !== next)) };
                });
                let outputCount = 0;
                // Round-robin serialization gives every channel its current and
                // next programme before spending remaining bytes on nearby shows.
                for (let round = 0; round < limits.perChannel; round++) for (const schedule of schedules) {
                    const entry = schedule.entries[round];
                    if (!entry) continue;
                    const fragment = '<programme channel="' + escape(schedule.id) + '" start="' + escape(entry.start) + '"' + (entry.stop ? ' stop="' + escape(entry.stop) + '"' : "") + (entry.catchupId ? ' catchup-id="' + escape(entry.catchupId) + '"' : "") + '><title>' + escape(entry.title) + '</title>' + (entry.desc ? '<desc>' + escape(entry.desc) + '</desc>' : "") + '</programme>';
                    const bytes = Buffer.byteLength(fragment);
                    if (size + bytes > limits.output || outputCount >= limits.programmes) { truncated.add(schedule.id); continue; }
                    append(fragment); outputCount++;
                }
                const truncatedChannels = Array.from(truncated).filter(id => selected.has(id)).length;
                const header = '<?xml version="1.0" encoding="UTF-8"?><tv generator-info-name="OTT-play 2 filtered guide" data-window-start="' + Math.floor(startWindow) + '" data-window-end="' + Math.floor(endWindow) + '" data-programme-limit="' + programmeCap + '" data-truncated-channels="' + truncatedChannels + '" data-truncated="' + (truncatedChannels ? 'true' : 'false') + '">';
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
