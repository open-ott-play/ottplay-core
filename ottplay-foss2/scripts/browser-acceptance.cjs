'use strict';
// Reuse the real provider and EPG journeys; native media decoding remains its own gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadFixtures, selectFixture, mediaCoverage } = require('../tests/browser-media-fixture.cjs');
const root = path.resolve(__dirname, '..');
const output = process.env.CI_BROWSER_DIAGNOSTICS;
assert(output && path.isAbsolute(output), 'CI_BROWSER_DIAGNOSTICS must be absolute');
const runtime = JSON.parse(fs.readFileSync(path.join(output, 'runtime.json'), 'utf8'));
const fixtures = loadFixtures();
const context = { platform: process.platform, engine: runtime.engine, runnerEnvironment: process.env.RUNNER_ENVIRONMENT || 'local' };
assert.equal(runtime.platform, process.platform);
const fixture = selectFixture(context, fixtures);
const coverage = mediaCoverage(fixture, fixtures, context);
if (fixture.id === 'h264-video-only') {
    const probe = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference = 'Stop'; $devices = @(Get-CimInstance Win32_PnPEntity -Filter \"PNPClass='AudioEndpoint'\"); ConvertTo-Json -InputObject @($devices | Select-Object Name,Status) -Compress"],
        { encoding: 'utf8', timeout: 30000 });
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, 'Audio endpoint inventory must be available');
    const endpoints = JSON.parse(probe.stdout.trim());
    assert.deepEqual(endpoints, [], 'Hosted Windows audio capabilities changed; review the media qualification contract');
    coverage.audioEndpointInventory = endpoints;
}
const scenarios = [];
fs.rmSync(process.env.CI_BROWSER_EVIDENCE, { force: true });
for (const name of ['providers', 'epg']) {
    const reportPath = path.join(output, `browser-${name}-report.json`);
    fs.rmSync(reportPath, { force: true });
    const result = spawnSync(process.execPath, [path.join(root, `tests/browser-${name}.cjs`)], {
        cwd: root, env: { ...process.env, OTT2_BROWSER_OUTPUT: output, OTT2_TEST_MEDIA: fixture.path, OTT2_BROWSER_MEDIA_FIXTURE: fixture.id }, encoding: 'utf8', timeout: 8 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(output, `${name}.log`), (result.stdout || '') + (result.stderr || ''));
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name} journey failed; inspect ${name}.log`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.passed, true);
    if (name === 'providers') {
        assert.equal(report.realSyntheticPlayback, true, 'Provider journey must decode synthetic media');
        assert.deepEqual(report.mediaCoverage, mediaCoverage(fixture, fixtures, context));
    }
    for (const field of ['engine', 'channel', 'playwrightVersion', 'browserVersion']) assert.equal(report[field], runtime[field], `${name}: ${field}`);
    assert(Array.isArray(report.scenarios) && report.scenarios.length > 0, `${name}: no actual scenarios`);
    assert.deepEqual(report.pageErrors, []);
    scenarios.push(...report.scenarios.map(scenario => `${name}: ${scenario}`));
    console.log(`PASS ${name}: ${report.scenarios.length} scenarios on ${report.engine} ${report.browserVersion}`);
}
assert.equal(new Set(scenarios).size, scenarios.length, 'Each scenario must be distinct');
fs.writeFileSync(process.env.CI_BROWSER_EVIDENCE, JSON.stringify({
    ...runtime, mediaCoverage: coverage, testsPassed: scenarios.length, testsFailed: 0, scenarios,
}, null, 2) + '\n');
