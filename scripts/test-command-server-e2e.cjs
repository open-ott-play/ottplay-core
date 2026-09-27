#!/usr/bin/env node
/* Actual FOSS command adapter + XHR in Chromium against the actual Go executable.
 * Usage: node scripts/test-command-server-e2e.cjs PLAYER SERVER [REPORT.json]
 * Only platform dispatch/persistence callbacks are substituted. All traffic is loopback.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { execFileSync, spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const [playerArg, serverArg, output] = process.argv.slice(2);
assert(playerArg && serverArg, 'Provide the FOSS and control-server checkout paths');
const player = path.resolve(playerArg), serverRoot = path.resolve(serverArg);
const playerRequire = createRequire(path.join(player, 'package.json'));
const { build } = playerRequire('esbuild');
const { chromium } = playerRequire('@playwright/test');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message) {
    const deadline = Date.now() + 10000;
    while (!await check()) {
        assert(Date.now() < deadline, message);
        await pause(20);
    }
}
async function listen(server) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}
function receipt(root, file) {
    return { commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        tracked_worktree_dirty: !!execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
        file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') };
}

async function main() {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ottplay-command-contract-'));
    let child, browser, ui, deniedUi;
    const scenarios = [], requests = [], pageErrors = [], acknowledgements = [];
    const admin = 'synthetic_admin_' + 'a'.repeat(32);
    const token = 'synthetic_device_' + 'b'.repeat(32);
    const otherToken = 'synthetic_device_' + 'c'.repeat(32);
    try {
        const binary = path.join(temporary, 'control-server');
        execFileSync('go', ['build', '-o', binary, './cmd/ottplay-control-server'], { cwd: serverRoot, stdio: 'pipe' });
        const bundle = await build({ entryPoints: [path.join(player, 'src/plugins/command-server.ts')], bundle: true, format: 'iife', globalName: 'CommandAdapter', write: false });
        const source = bundle.outputFiles[0].text;
        const html = '<!doctype html><title>Command contract</title><script src="/adapter.js"></script><script>' +
            'window.contract={calls:[],saved:[],outcome:"accepted"};' +
            'contract.connection=CommandAdapter.createCommandServer(window,CommandAdapter.createCommandServerTransport(window),' +
            'c=>contract.saved.push(c),c=>{contract.calls.push(c);return contract.outcome;});</script>';
        const handler = (req, res) => {
            res.setHeader('Content-Type', req.url === '/adapter.js' ? 'application/javascript' : 'text/html');
            res.end(req.url === '/adapter.js' ? source : html);
        };
        ui = http.createServer(handler); deniedUi = http.createServer(handler);
        const origin = await listen(ui), deniedOrigin = await listen(deniedUi);
        const reservation = net.createServer();
        const backend = await listen(reservation);
        await new Promise(resolve => reservation.close(resolve));
        const config = {
            listen: new URL(backend).host, admin_token: admin, allowed_origins: [origin],
            allow_null_origin: false, command_ttl_seconds: 5, max_pending_per_device: 50,
            devices: [{ id: 'living-room', token }, { id: 'other-room', token: otherToken }],
        };
        const configFile = path.join(temporary, 'config.json');
        fs.writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
        child = spawn(binary, ['serve', '--config', configFile], { stdio: ['ignore', 'ignore', 'pipe'] });
        await waitFor(async () => {
            if (child.exitCode !== null) throw new Error('Go server exited before readiness');
            try { return (await fetch(backend + '/readyz')).ok; } catch { return false; }
        }, 'Go server did not become ready');
        const endpoint = backend + '/api/webhook/commands?device_id=living-room';
        const active = { address: endpoint, enabled: true, token };
        async function send(data, credential = admin) {
            return fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        }
        async function pending() {
            const response = await fetch(backend + '/api/devices', { headers: { Authorization: 'Bearer ' + admin } });
            const data = await response.json();
            return data.devices.find(device => device.id === 'living-room').pending;
        }
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const allowed = new Set([origin, deniedOrigin, backend]);
        await context.route('**/*', async route => {
            assert(allowed.has(new URL(route.request().url()).origin), 'No external requests');
            return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('request', request => {
            if (request.url().startsWith(backend)) requests.push({ method: request.method(), path: new URL(request.url()).pathname });
        });
        page.on('response', response => {
            if (new URL(response.url()).pathname === '/api/webhook/commands/ack') acknowledgements.push(response.status());
        });
        await page.goto(origin);
        assert.equal((await send({ command: 'set_volume', volume: 35 }, token)).status, 403);
        scenarios.push('device credential cannot enqueue administrator commands');

        let failedAck = false;
        await page.route('**/api/webhook/commands/ack**', async route => {
            if (!failedAck) { failedAck = true; return route.abort('failed'); }
            return route.continue();
        });
        assert.equal((await send({ command: 'set_volume', volume: 35 })).status, 202);
        await page.evaluate(config => contract.connection.configure(config), active);
        await page.waitForFunction(() => contract.calls.length === 1);
        await waitFor(() => failedAck, 'No acknowledgement request');
        assert.equal(await pending(), 1);
        // Reconnect before the failed ACK retry: the server redelivers, while
        // the actual client retains its seen IDs and acknowledges without redispatch.
        await page.evaluate(config => contract.connection.configure(config), active);
        await waitFor(async () => await pending() === 0, 'Command was not acknowledged');
        await waitFor(() => acknowledgements.includes(200), 'No successful ACK after reconnect');
        assert.equal(await page.evaluate(() => contract.calls.length), 1);
        assert.equal(await page.evaluate(() => contract.calls[0].volume), 35);
        scenarios.push('real browser XHR polls and ACKs; lost ACK plus reconnect does not dispatch twice');

        await page.evaluate(config => contract.connection.configure({ ...config, enabled: false }), active);
        assert.equal((await send({ command: 'popup_message', message: 'Привет ТВ' })).status, 202);
        await page.evaluate(config => contract.connection.configure(config), { ...active, token: otherToken });
        await page.waitForFunction(() => contract.connection.status().state === 'error');
        assert.equal(await page.evaluate(() => contract.calls.length), 1);
        assert.equal(await pending(), 1);
        await page.evaluate(config => contract.connection.configure(config), active);
        await page.waitForFunction(() => contract.calls.length === 2);
        await waitFor(async () => await pending() === 0, 'Owner did not acknowledge');
        assert.equal(await page.evaluate(() => contract.calls[1].message), 'Привет ТВ');
        scenarios.push('other device denied; owner receives the unchanged Unicode command');

        const deniedPage = await context.newPage();
        await deniedPage.goto(deniedOrigin);
        await deniedPage.evaluate(config => contract.connection.configure(config), active);
        await deniedPage.waitForFunction(() => contract.connection.status().state === 'error');
        assert.equal(await deniedPage.evaluate(() => contract.calls.length), 0);
        await deniedPage.close();
        scenarios.push('unlisted browser origin is blocked by real CORS/preflight enforcement');

        await page.evaluate(config => contract.connection.configure({ ...config, enabled: false }), active);
        const beforeExpiry = await page.evaluate(() => contract.calls.length);
        assert.equal((await send({ command: 'set_volume', volume: 90 })).status, 202);
        await pause(5100);
        await page.evaluate(config => contract.connection.configure(config), active);
        await page.waitForFunction(() => contract.connection.status().state === 'connected');
        assert.equal(await page.evaluate(() => contract.calls.length), beforeExpiry);
        assert.equal(await pending(), 0);
        scenarios.push('expired queued commands are not dispatched after reconnect');

        await page.evaluate(() => { contract.outcome = 'unsupported'; });
        assert.equal((await send({ command: 'exit_player' })).status, 202);
        await page.waitForFunction(count => contract.calls.length === count + 1, beforeExpiry);
        await waitFor(async () => await pending() === 0, 'Rejected attempt was not acknowledged');
        assert((await page.evaluate(() => contract.connection.status().message)).includes('rejected'));
        scenarios.push('unsupported platform dispatch is acknowledged as handled, not claimed executed');
        assert.deepEqual(pageErrors, []);
        const report = { observed_at: new Date().toISOString(), status: 'passed', scenarios, requests, pageErrors, acknowledgements, chromium: browser.version(),
            player: receipt(player, 'src/plugins/command-server.ts'), server: receipt(serverRoot, 'internal/control/server.go'),
            limitations: ['Real Chromium XHR, Go server, CORS, authentication, queues and ACK delivery.',
                'Platform command dispatch and settings persistence callbacks are substitutes; no picture/audio or hardware volume confirmation.',
                'Loopback HTTP and synthetic credentials only; production deployment and TLS not qualified.'] };
        if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        console.log(`PASS: ${scenarios.length} browser ↔ Go command delivery scenarios`);
    } finally {
        if (browser) await browser.close();
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            const timeout = setTimeout(() => child.kill('SIGKILL'), 12000);
            await once(child, 'exit'); clearTimeout(timeout);
        }
        for (const server of [ui, deniedUi]) if (server) {
            server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        }
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
