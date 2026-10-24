'use strict';
// Verify the published compiler payload before loading its exact JS in the browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const outputs = ['ottplay-core.js', 'ottplay-core.d.ts', 'ottplay-core.jar', 'ottplay-core.LICENSE.txt'];
const manifestName = 'ottplay-core.manifest.json';
const receiptName = 'release-inputs-shared-core.json';
const payloads = [...outputs, manifestName, 'SHA256SUMS'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function prepare(directory, app, diagnostics, sourceSha) {
    assert(/^[a-f0-9]{40}$/.test(sourceSha), 'Expected exact candidate source SHA');
    assert.deepEqual(fs.readdirSync(directory).sort(), [...payloads, receiptName].sort(), 'Unexpected candidate inventory');
    const content = {};
    for (const name of [...payloads, receiptName]) {
        const file = path.join(directory, name), stat = fs.lstatSync(file);
        assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 100 * 1024 * 1024, 'Invalid candidate file: ' + name);
        content[name] = fs.readFileSync(file);
    }
    const receipt = JSON.parse(content[receiptName]);
    assert.equal(receipt.source_sha, sourceSha, 'Candidate source differs from this run');
    assert(Array.isArray(receipt.artifacts), 'Missing candidate receipt');
    assert.deepEqual(receipt.artifacts.map(item => item.name).sort(), payloads.slice().sort(), 'Incomplete receipt inventory');
    for (const item of receipt.artifacts) {
        assert.equal(item.sha256, digest(content[item.name]), 'Changed candidate: ' + item.name);
        assert.equal(item.size, content[item.name].length, 'Changed candidate size: ' + item.name);
    }
    const manifest = JSON.parse(content[manifestName]);
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.name, 'ottplay-shared-core');
    assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version), 'Invalid compiler package version');
    assert.deepEqual(Object.keys(manifest.artifacts).sort(), outputs.slice().sort(), 'Incomplete compiler inventory');
    for (const name of outputs) {
        assert.deepEqual(manifest.artifacts[name], { sha256: digest(content[name]), bytes: content[name].length }, 'Changed compiler output: ' + name);
    }
    const vendor = path.join(app, 'vendor');
    assert(fs.lstatSync(vendor).isDirectory() && !fs.lstatSync(vendor).isSymbolicLink(), 'Vendor must be a real directory');
    const browserFiles = ['ottplay-core.js', 'ottplay-core.LICENSE.txt', manifestName];
    for (const name of browserFiles) {
        const target = path.join(vendor, name);
        try {
            const stat = fs.lstatSync(target);
            assert(stat.isFile() && !stat.isSymbolicLink(), 'Invalid vendor destination');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    for (const name of browserFiles) fs.writeFileSync(path.join(vendor, name), content[name]);
    const identity = { sourceSha, version: manifest.version, receiptSha256: digest(content[receiptName]),
        javascriptSha256: digest(content['ottplay-core.js']), filesVerified: payloads.length };
    fs.mkdirSync(diagnostics, { recursive: true });
    fs.writeFileSync(path.join(diagnostics, 'candidate.json'), JSON.stringify(identity, null, 2) + '\n');
    return identity;
}
module.exports = { prepare };
if (require.main === module) {
    console.log(prepare(process.argv[2], path.resolve(__dirname, '..'), process.env.CI_BROWSER_DIAGNOSTICS, process.env.GITHUB_SHA));
}
