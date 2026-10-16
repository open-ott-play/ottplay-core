'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepare } = require('../scripts/prepare-browser-candidate.cjs');
const source = 'a'.repeat(40);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-browser-candidate-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'candidate'), app = path.join(root, 'app'), diagnostics = path.join(root, 'diagnostics');
    fs.mkdirSync(dir); fs.mkdirSync(path.join(app, 'vendor'), { recursive: true });
    const content = Object.fromEntries(['ottplay-core.js', 'ottplay-core.d.ts', 'ottplay-core.jar', 'ottplay-core.LICENSE.txt'].map(name => [name, Buffer.from('compiled ' + name)]));
    const manifest = { schema: 1, name: 'ottplay-shared-core', version: '1.2.3-rc.1', artifacts: Object.fromEntries(Object.entries(content).map(([name, bytes]) => [name, { sha256: hash(bytes), bytes: bytes.length }])) };
    content['ottplay-core.manifest.json'] = Buffer.from(JSON.stringify(manifest));
    content.SHA256SUMS = Buffer.from('checksums');
    for (const [name, bytes] of Object.entries(content)) fs.writeFileSync(path.join(dir, name), bytes);
    const receipt = { source_sha: source, artifacts: Object.entries(content).map(([name, bytes]) => ({ name, sha256: hash(bytes), size: bytes.length })) };
    fs.writeFileSync(path.join(dir, 'release-inputs-shared-core.json'), JSON.stringify(receipt));
    return { dir, app, diagnostics, content, receipt };
}
test('browser candidate preserves exact packaged JS and records source-bound identity', t => {
    const f = fixture(t), identity = prepare(f.dir, f.app, f.diagnostics, source);
    assert.deepEqual(fs.readFileSync(path.join(f.app, 'vendor/ottplay-core.js')), f.content['ottplay-core.js']);
    assert.equal(identity.version, '1.2.3-rc.1'); assert.equal(identity.filesVerified, 6);
});
test('browser candidate rejects stale source and altered bytes before staging', t => {
    const f = fixture(t);
    assert.throws(() => prepare(f.dir, f.app, f.diagnostics, 'b'.repeat(40)), /source differs/);
    fs.appendFileSync(path.join(f.dir, 'ottplay-core.js'), 'changed');
    assert.throws(() => prepare(f.dir, f.app, f.diagnostics, source), /Changed candidate/);
    assert.deepEqual(fs.readdirSync(path.join(f.app, 'vendor')), []);
});
test('browser candidate rejects incomplete receipt and unexpected files', t => {
    const f = fixture(t); f.receipt.artifacts.pop();
    fs.writeFileSync(path.join(f.dir, 'release-inputs-shared-core.json'), JSON.stringify(f.receipt));
    assert.throws(() => prepare(f.dir, f.app, f.diagnostics, source), /receipt inventory/);
    fs.writeFileSync(path.join(f.dir, 'unexpected'), 'extra');
    assert.throws(() => prepare(f.dir, f.app, f.diagnostics, source), /candidate inventory/);
});
test('browser candidate rejects symlinked output without touching its target', t => {
    const f = fixture(t), sentinel = path.join(f.app, 'sentinel'); fs.writeFileSync(sentinel, 'keep');
    fs.symlinkSync(sentinel, path.join(f.app, 'vendor/ottplay-core.js'));
    assert.throws(() => prepare(f.dir, f.app, f.diagnostics, source), /vendor destination/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});
