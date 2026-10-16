"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadFixtures, selectFixture, mediaCoverage, rangeOf, startMediaServer } = require('./browser-media-fixture.cjs');

test('only hosted Windows WebKit selects a declared video-only fixture before playback', () => {
    const fixtures = loadFixtures();
    let limited = 0;
    for (const platform of ['linux', 'darwin', 'win32']) for (const engine of ['chromium', 'firefox', 'webkit']) {
        for (const runnerEnvironment of ['github-hosted', 'self-hosted', 'local']) {
            const context = { platform, engine, runnerEnvironment };
            const fixture = selectFixture(context, fixtures);
            const coverage = mediaCoverage(fixture, fixtures, context);
            const expected = platform === 'win32' && engine === 'webkit' && runnerEnvironment === 'github-hosted';
            assert.equal(fixture.id, expected ? 'h264-video-only' : 'h264-aac');
            assert.equal(coverage.audio, expected ? 'audio_not_verified_due_to_missing_endpoint' : 'muxed_aac_pipeline_advanced_no_audible_assertion');
            assert.equal(coverage.fixtures.length, 2);
            assert.deepEqual(coverage.environment, context);
            assert.deepEqual(coverage.selectedFixture.streams.map(s => s.codec), expected ? ['h264'] : ['h264', 'aac']);
            limited += Number(expected);
        }
    }
    assert.equal(limited, 1);
    assert.throws(() => selectFixture({ platform: 'unknown', engine: 'webkit' }), /Assertion/);
});
test('source-bound fixture inventory rejects modified media and path traversal', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'media-fixture-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.cpSync(path.join(__dirname, 'fixtures/browser-media'), directory, { recursive: true });
    fs.appendFileSync(path.join(directory, 'probe.mp4'), 'changed');
    assert.throws(() => loadFixtures(directory), /Changed media fixture bytes/);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
    manifest.fixtures[0].file = '../probe.mp4';
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => loadFixtures(directory), /Assertion/);
});
test('byte range parser bounds ordinary, suffix and open-ended reads and rejects malformed ranges', () => {
    assert.equal(rangeOf(undefined, 8), null);
    assert.deepEqual(rangeOf('bytes=0-', 8), { start: 0, end: 7 });
    assert.deepEqual(rangeOf('bytes=1-3', 8), { start: 1, end: 3 });
    assert.deepEqual(rangeOf('bytes=5-900', 8), { start: 5, end: 7 });
    assert.deepEqual(rangeOf('bytes=-3', 8), { start: 5, end: 7 });
    assert.deepEqual(rangeOf('bytes=-900', 8), { start: 0, end: 7 });
    for (const value of ['bytes=-', 'bytes=-0', 'bytes=8-', 'bytes=5-4', 'bytes=0-1,3-4', 'words=0-1', 'bytes=1e2-', 'bytes=9007199254740992-']) {
        assert.equal(rangeOf(value, 8), false, value);
    }
    assert.equal(rangeOf('bytes=0-', 0), false);
});
test('real loopback server serves exact full/ranged bytes and never reads arbitrary paths', async t => {
    const bytes = Buffer.from('01234567'), requests = [];
    const transport = await startMediaServer(bytes, new Set(['/series/user/password/70.mp4']), requests);
    t.after(() => new Promise(resolve => transport.server.close(resolve)));
    const url = transport.origin + '/series/user/password/70.mp4';
    for (const [range, status, expected, contentRange] of [
        [undefined, 200, '01234567', null], ['bytes=2-4', 206, '234', 'bytes 2-4/8'],
        ['bytes=6-', 206, '67', 'bytes 6-7/8'], ['bytes=-2', 206, '67', 'bytes 6-7/8'],
        ['bytes=8-', 416, '', 'bytes */8'],
    ]) {
        const response = await fetch(url, { headers: range ? { Range: range } : {} });
        assert.equal(response.status, status);
        assert.equal(response.headers.get('content-range'), contentRange);
        assert.equal(response.headers.get('accept-ranges'), 'bytes');
        assert.equal(await response.text(), expected);
    }
    const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=1-3' } });
    assert.equal(head.status, 206); assert.equal(head.headers.get('content-length'), '3');
    assert.equal(await head.text(), '');
    assert.equal((await fetch(transport.origin + '/other.mp4')).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal(requests.filter(r => r.method === 'GET' && r.pathname === '/series/user/password/70.mp4').length, 5);
});
