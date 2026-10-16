/* Source-bound fixtures and loopback transport for real browser media. */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const fixtureRoot = path.join(__dirname, 'fixtures/browser-media');

function loadFixtures(root = fixtureRoot) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schema, 1);
    assert.deepEqual(manifest.fixtures.map(f => f.id), ['h264-aac', 'h264-video-only']);
    return manifest.fixtures.map(fixture => {
        assert.equal(path.basename(fixture.file), fixture.file);
        const file = path.join(root, fixture.file);
        assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
        const bytes = fs.readFileSync(file);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), fixture.sha256, 'Changed media fixture bytes');
        assert.deepEqual(fixture.streams.map(s => s.codec), fixture.id === 'h264-aac' ? ['h264', 'aac'] : ['h264']);
        return { ...fixture, path: file, bytes };
    });
}
function selectFixture({ platform, engine, runnerEnvironment }, fixtures = loadFixtures()) {
    assert(['linux', 'darwin', 'win32'].includes(platform));
    assert(['chromium', 'firefox', 'webkit'].includes(engine));
    const limited = platform === 'win32' && engine === 'webkit' && runnerEnvironment === 'github-hosted';
    return fixtures.find(f => f.id === (limited ? 'h264-video-only' : 'h264-aac'));
}
function mediaCoverage(fixture, fixtures, context) {
    const publicFixture = f => ({ id: f.id, file: f.file, sha256: f.sha256, streams: f.streams });
    return {
        schema: 1,
        video: 'decoded',
        audio: fixture.id === 'h264-video-only' ? 'audio_not_verified_due_to_missing_endpoint' : 'muxed_aac_pipeline_advanced_no_audible_assertion',
        selectedFixture: publicFixture(fixture),
        fixtures: fixtures.map(publicFixture),
        environment: context,
    };
}
function rangeOf(header, size) {
    if (header === undefined) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2]) || size === 0) return false;
    let start, end;
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
        start = Math.max(0, size - suffix); end = size - 1;
    } else {
        start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
        end = Math.min(end, size - 1);
    }
    return { start, end };
}
async function startMediaServer(bytes, allowedPaths, requests = []) {
    assert(Buffer.isBuffer(bytes));
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        requests.push({ method: request.method, pathname, range: request.headers.range || null });
        if (!allowedPaths.has(pathname)) { response.writeHead(404); response.end(); return; }
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
        const range = rangeOf(request.headers.range, bytes.length);
        if (range === false) { response.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + bytes.length }); response.end(); return; }
        const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
        headers['Content-Length'] = body.length;
        if (range) headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + bytes.length;
        response.writeHead(range ? 206 : 200, headers);
        response.end(request.method === 'HEAD' ? undefined : body);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { server, origin: 'http://127.0.0.1:' + server.address().port };
}
module.exports = { loadFixtures, selectFixture, mediaCoverage, rangeOf, startMediaServer };
