"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_EPG_URL, canonicalName } = require("../scripts/epg.cjs");
const zlib = require("node:zlib");
const { fixture, invoke, clock, document, dto } = require("./epg-fixture.cjs");

test("default EPG service streams gzip and returns matched icons plus the 48-hour window", async () => {
    const f = fixture(); const result = await invoke(f.epg).result;
    assert.equal(result.status, 200, result.body);
    assert(result.body.includes('id="news"'));
    assert(result.body.includes('src="https://cdn.epg.one/logos/news.png"'));
    assert(result.body.includes('id="empty"'));
    assert(result.body.includes("Current &amp; live"));
    assert(result.body.includes("&lt;description&gt;"));
    assert(result.body.includes("Next")); assert(result.body.includes("Archive"));
    for (const excluded of ["Unrequested", "Too old", "Too far", 'id="other"', 'id="exact"']) assert(!result.body.includes(excluded));
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, DEFAULT_EPG_URL);
    assert.equal(f.calls[0].configuration.rejectUnauthorized, true);
    assert.equal(f.calls[0].configuration.headers.Cookie, undefined);
    assert.equal(result.headers["Content-Type"], "application/xml; charset=utf-8");
});

test("matching prioritizes exact IDs and exact names, refusing ambiguous quality aliases", async () => {
    const xml = document.replace('<channel id="other">', '<channel id="second-news"><display-name>Новости FHD</display-name></channel><channel id="other">');
    const f = fixture({}, { body: Buffer.from(xml) });
    const result = await invoke(f.epg, { channels: [{ tvgId: "exact", name: "Новости" }, { name: "Новости UHD" }] }).result;
    assert.equal(result.status, 200, result.body);
    assert(result.body.includes('id="exact"'));
    assert(result.body.includes('id="news"'), "Ambiguous candidate metadata must survive for browser matching");
    assert(result.body.includes('id="second-news"'));
    assert(!result.body.includes('<programme channel="news"'));
    const exact = await invoke(f.epg, { channels: [{ name: "Новости" }] }).result;
    assert(exact.body.includes('id="news"')); assert(exact.body.includes('<programme channel="news"'));
    for (const [name, expected] of [[" FHD News HD ", "news"], ["News (+2) HD", "news (+2)"], ["News Moscow HD", "news moscow"], ["HDNews", "hdnews"]]) assert.equal(canonicalName(name), expected);
});

test("EPG API accepts only same-origin JSON POST with bounded identity data", async () => {
    const f = fixture();
    assert.equal((await invoke(f.epg, dto, { method: "GET" }).result).status, 405);
    assert.equal((await invoke(f.epg, dto, { headers: { origin: "https://other.test" } }).result).status, 403);
    assert.equal((await invoke(f.epg, dto, { headers: { "content-type": "text/plain" } }).result).status, 415);
    for (const value of [null, [], {}, { channels: [] }, { channels: [{}] }, { ...dto, url: "https://private.test/" }, { channels: [{ name: "News", url: "https://private.test/" }] }, { channels: [{ name: "x".repeat(513) }] }]) assert.equal((await invoke(f.epg, value).result).body, "EPG_REQUEST");
    assert.equal((await invoke(f.epg, "x".repeat(4 * 1024 * 1024 + 1)).result).status, 413);
    assert.equal(f.calls.length, 0);
});
test("legacy TV requests without Origin require the custom header and a socket-matching Host", async () => {
    const f = fixture();
    assert.equal((await invoke(f.epg, dto, { headers: { origin: undefined, "x-ott2-epg": "1" } }).result).status, 200);
    assert.equal((await invoke(f.epg, dto, { headers: { origin: undefined } }).result).status, 403);
    for (const headers of [
        { origin: "https://attacker.test", "x-ott2-epg": "1" },
        { origin: "null", "x-ott2-epg": "1" },
        { origin: undefined, host: "attacker.test", "x-ott2-epg": "1" },
        { origin: undefined, host: "127.0.0.1:80", "x-ott2-epg": "1" }
    ]) assert.equal((await invoke(f.epg, dto, { headers }).result).status, 403);
    const preflight = await invoke(f.epg, dto, { method: "OPTIONS", headers: { origin: "https://attacker.test", "access-control-request-headers": "x-ott2-epg" } }).result;
    assert.equal(preflight.status, 405);
    assert(!Object.keys(preflight.headers).some(name => /^access-control/i.test(name)));
});

test("EPG requests share in-flight work and cache normalized identities without local IDs", async () => {
    let current = clock;
    const f = fixture({ now: () => current });
    const first = invoke(f.epg), second = invoke(f.epg, { channels: [{ name: " Empty " }, { id: "another-local-id", tvgId: "proxy-news", name: " новости   HD " }] });
    const results = await Promise.all([first.result, second.result]);
    assert.equal(results[0].status, 200); assert.equal(results[1].body, results[0].body); assert.equal(f.calls.length, 1);
    assert.equal((await invoke(f.epg).result).status, 200); assert.equal(f.calls.length, 1);
    current += 31 * 60000;
    assert.equal((await invoke(f.epg).result).status, 200); assert.equal(f.calls.length, 2);
});

test("cancellation detaches one consumer and aborts upstream after the last consumer leaves", async () => {
    const f = fixture({}, { hang: true });
    const first = invoke(f.epg), second = invoke(f.epg);
    assert.equal(f.calls.length, 1);
    first.cancel(); assert.equal(f.calls[0].req.destroyed, false);
    const busy = await invoke(f.epg, { channels: [{ name: "Other" }] }).result;
    assert.equal(busy.body, "EPG_BUSY");
    second.cancel(); assert.equal(f.calls[0].req.destroyed, true);
    const retry = invoke(f.epg); assert.equal(f.calls.length, 2); retry.cancel();
});

test("EPG service rejects broken gzip, invalid XML and every configured size bound", async () => {
    const cases = [
        [{}, { body: Buffer.from([0x1f, 0x8b, 0x08, 0x00]) }, "EPG_GZIP"],
        [{}, { body: Buffer.from("<tv><channel></tv>") }, "EPG_XML"],
        [{}, { body: Buffer.from('<!DOCTYPE tv [<!ENTITY xx "bad">]><tv/>') }, "EPG_XML"],
        [{}, { body: Buffer.from("<html>Server failed</html>") }, "EPG_XML"],
        [{ wireLimit: 16 }, {}, "EPG_WIRE_TOO_LARGE"],
        [{ decodedLimit: 32 }, {}, "EPG_DECODED_TOO_LARGE"],
        [{ outputLimit: 128 }, {}, "EPG_TOO_LARGE"],
        [{ timeout: 5 }, { hang: true }, "EPG_TIMEOUT"]
    ];
    for (const [options, route, error] of cases) {
        const f = fixture(options, route), result = await invoke(f.epg).result;
        assert.equal(result.body, error); assert.equal(f.calls[0].req.destroyed, true);
    }
});
test("chatty channels retain nearby programmes with explicit coverage rather than failing the guide", async () => {
    const f = fixture({ channelProgrammeLimit: 2 });
    const result = await invoke(f.epg).result;
    assert.equal(result.status, 200, result.body);
    assert(result.body.includes('data-truncated="true"'));
    assert(result.body.includes('data-truncated-channels="1"'));
    assert(result.body.includes('data-programme-limit="2"'));
    assert(result.body.includes("Current &amp; live")); assert(result.body.includes("Next"));
    assert(!result.body.includes("Archive"));
    const global = fixture({ programmeLimit: 2 });
    const limited = await invoke(global.epg).result;
    assert.equal(limited.status, 200, limited.body);
    assert((limited.body.match(/<programme /g) || []).length <= 2);
    assert(limited.body.includes('data-truncated="true"'));
});

test("feed chunks split within gzip magic and multibyte XML keep the same result", async () => {
    for (const buffer of [zlib.gzipSync(Buffer.from(document)), Buffer.from(document)]) {
        const f = fixture({}, { chunks: Array.from(buffer, byte => Buffer.from([byte])) });
        const result = await invoke(f.epg).result;
        assert.equal(result.status, 200, result.body); assert(result.body.includes("Новости"));
    }
});

test("archive depth is per channel, bounded to seven days and part of cache identity", async () => {
    const past = '<programme channel="news" start="20260911110000 +0000" stop="20260911130000 +0000"><title>Three days ago</title></programme>' +
        '<programme channel="news" start="20260907120000 +0000" stop="20260907130000 +0000"><title>Seven day boundary</title></programme>' +
        '<programme channel="news" start="20260906110000 +0000" stop="20260906130000 +0000"><title>Beyond retention</title></programme>' +
        '<programme channel="other" start="20260911110000 +0000" stop="20260911130000 +0000"><title>Other old</title></programme>';
    const f = fixture({}, { body: Buffer.from(document.replace('</tv>', past + '</tv>')) });
    const standard = await invoke(f.epg, { channels: [{ tvgId: 'news' }] }).result;
    assert(!standard.body.includes('Three days ago'));
    const archive = await invoke(f.epg, { channels: [{ tvgId: 'news', archiveDays: 7 }, { tvgId: 'other', archiveDays: 0 }] }).result;
    assert.equal(archive.status, 200, archive.body);
    assert(archive.body.includes('Three days ago')); assert(archive.body.includes('Seven day boundary'));
    assert(archive.body.includes('Current &amp; live')); assert(archive.body.includes('Next'));
    assert(!archive.body.includes('Other old')); assert(!archive.body.includes('Beyond retention'));
    assert(archive.body.includes('data-window-start="' + (clock / 1000 - 7 * 86400) + '"'));
    assert.equal(f.calls.length, 2, 'A different archive depth must not reuse a shallow cache');
    const named = await invoke(f.epg, { channels: [{ name: 'Новости HD', archiveDays: 3 }] }).result;
    assert(named.body.includes('Three days ago')); assert(!named.body.includes('Seven day boundary'));
    for (const days of [-1, 8, '7', null, {}, true]) assert.equal((await invoke(f.epg, { channels: [{ name: 'News', archiveDays: days }] }).result).status, 400);
    const bounded = fixture({ channelProgrammeLimit: 2 }, { body: Buffer.from(document.replace('</tv>', past + '</tv>')) });
    const limited = await invoke(bounded.epg, { channels: [{ tvgId: 'news', archiveDays: 7 }] }).result;
    assert.equal(limited.status, 200); assert(limited.body.includes('Current &amp; live')); assert(limited.body.includes('Next'));
    assert(limited.body.includes('data-truncated="true"')); assert((limited.body.match(/<programme /g) || []).length <= 2);
});

test("bounded archive output preserves a distant next programme ahead of nearby history", async () => {
    const xml = '<tv><channel id="n"><display-name>News</display-name></channel>' +
        '<programme channel="n" start="20260914110000" stop="20260914130000"><title>Playing</title></programme>' +
        '<programme channel="n" start="20260914105900" stop="20260914110000"><title>Nearby history</title></programme>' +
        '<programme channel="n" start="20260914230000" stop="20260915000000"><title>Distant next</title></programme></tv>';
    const f = fixture({ channelProgrammeLimit: 2 }, { body: Buffer.from(xml) });
    const result = await invoke(f.epg, { channels: [{ tvgId: 'n', archiveDays: 7 }] }).result;
    assert.equal(result.status, 200); assert(result.body.includes('Playing')); assert(result.body.includes('Distant next'));
    assert(!result.body.includes('Nearby history')); assert(result.body.includes('data-truncated="true"'));
});

test("large channel catalogs accept 8000 identities within fixed request and response bounds", async () => {
    const channels = Array.from({ length: 8000 }, (_, i) => ({ tvgId: 'catalog-' + i, name: 'Catalog station ' + i, archiveDays: i % 2 ? 7 : 0 }));
    channels[7999] = { tvgId: 'news', archiveDays: 7 };
    const f = fixture();
    const result = await invoke(f.epg, { channels }).result;
    assert.equal(result.status, 200, result.body);
    assert(result.body.includes('Current &amp; live'), 'An identity past the old 4096 limit still receives its programme');
    assert(result.body.includes('Next'));
    assert(Buffer.byteLength(result.body) <= 16 * 1024 * 1024);
    assert((result.body.match(/<programme /g) || []).length <= 50000);
    assert.equal((await invoke(f.epg, { channels: Array.from({ length: 16385 }, (_, i) => ({ name: 'Channel ' + i })) }).result).status, 400);
    assert.equal((await invoke(f.epg, 'x'.repeat(4 * 1024 * 1024 + 1)).result).status, 413);
    assert.equal(f.calls.length, 1, 'Oversized identities and bytes are rejected before upstream work');
});

test("shared global programme budget counts exact identities once when reserving current and next", async () => {
    let xml = '<tv><channel id="a"><display-name>A</display-name></channel><channel id="b"><display-name>B</display-name></channel>';
    for (const id of ['a', 'b']) xml += '<programme channel="' + id + '" start="20260914110000" stop="20260914130000"><title>' + id + ' current</title></programme><programme channel="' + id + '" start="20260914130000" stop="20260914140000"><title>' + id + ' next</title></programme>';
    const f = fixture({ programmeLimit: 4 }, { body: Buffer.from(xml + '</tv>') });
    const result = await invoke(f.epg, { channels: [{ tvgId: 'a', archiveDays: 7 }, { tvgId: 'b', archiveDays: 7 }] }).result;
    assert.equal(result.status, 200, result.body);
    for (const title of ['a current', 'a next', 'b current', 'b next']) assert(result.body.includes(title), title);
    assert.equal((result.body.match(/<programme /g) || []).length, 4);
});
