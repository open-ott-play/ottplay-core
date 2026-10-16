'use strict';
// Reuse the real provider and EPG journeys; native media decoding remains its own gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = process.env.CI_BROWSER_DIAGNOSTICS;
assert(output && path.isAbsolute(output), 'CI_BROWSER_DIAGNOSTICS must be absolute');
const runtime = JSON.parse(fs.readFileSync(path.join(output, 'runtime.json'), 'utf8'));
const scenarios = [];
fs.rmSync(process.env.CI_BROWSER_EVIDENCE, { force: true });
for (const name of ['providers', 'epg']) {
    const reportPath = path.join(output, `browser-${name}-report.json`);
    fs.rmSync(reportPath, { force: true });
    const result = spawnSync(process.execPath, [path.join(root, `tests/browser-${name}.cjs`)], {
        cwd: root, env: { ...process.env, OTT2_BROWSER_OUTPUT: output, OTT2_TEST_MEDIA: path.join(root, 'tests/fixtures/browser-media/probe.mp4') }, encoding: 'utf8', timeout: 8 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(output, `${name}.log`), (result.stdout || '') + (result.stderr || ''));
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name} journey failed; inspect ${name}.log`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.passed, true);
    if (name === 'providers') assert.equal(report.realSyntheticPlayback, true, 'Provider journey must decode synthetic media');
    for (const field of ['engine', 'channel', 'playwrightVersion', 'browserVersion']) assert.equal(report[field], runtime[field], `${name}: ${field}`);
    assert(Array.isArray(report.scenarios) && report.scenarios.length > 0, `${name}: no actual scenarios`);
    assert.deepEqual(report.pageErrors, []);
    scenarios.push(...report.scenarios.map(scenario => `${name}: ${scenario}`));
    console.log(`PASS ${name}: ${report.scenarios.length} scenarios on ${report.engine} ${report.browserVersion}`);
}
assert.equal(new Set(scenarios).size, scenarios.length, 'Each scenario must be distinct');
fs.writeFileSync(process.env.CI_BROWSER_EVIDENCE, JSON.stringify({
    ...runtime, testsPassed: scenarios.length, testsFailed: 0, scenarios,
}, null, 2) + '\n');
