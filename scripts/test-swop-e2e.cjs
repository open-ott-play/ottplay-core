#!/usr/bin/env node
/* Run the shipped player SWOP adapter against the shipped Worker over loopback HTTP.
 * UI/timers are substituted. Legacy Workers use a KV substitute; atomic-session
 * candidates run in workerd with SQLite Durable Objects and a rate-limit binding.
 * This verifies sequential protocol compatibility, not live deployment policy.
 * Usage: node scripts/test-swop-e2e.cjs PLAYER_CHECKOUT WORKER_CHECKOUT [REPORT.json] [--installation]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { webcrypto, createHash } = require('node:crypto');

const [playerArg, workerArg, output, mode] = process.argv.slice(2);
assert(mode === undefined || mode === "--installation", "Unknown authentication mode");
const installation = mode === "--installation";
const installationToken = "synthetic_server_" + "a".repeat(48);
let relayCredential = installationToken;
assert(playerArg && workerArg, 'Provide player and Worker checkout paths');
const player = path.resolve(playerArg);
const workerRoot = path.resolve(workerArg);
const ts = createRequire(path.join(player, 'package.json'))('typescript');

function load(file, globals = {}, imports = {}) {
    const source = fs.readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const context = vm.createContext({
        exports: {}, URL, Request, Response, TextEncoder, crypto: webcrypto,
        console, ...globals,
        require(name) {
            assert(Object.hasOwn(imports, name), `Unmocked import ${name} in ${file}`);
            return imports[name];
        },
    });
    context.window = context;
    vm.runInContext(code, context, { filename: file });
    return context;
}

function receipt(root, files) {
    return {
        commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        tracked_worktree_dirty: Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()),
        files: Object.fromEntries(files.map(file => [file,
            createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
    };
}

async function main() {
    const playerWire = load(path.join(player, 'src/shared/wire-contracts.ts')).exports;
    const workerWire = load(path.join(workerRoot, 'src/wire-contracts.ts')).exports;
    const swopPolicy = wire => Object.fromEntries(Object.entries(wire).filter(([key]) => key.startsWith('swop')));
    assert.deepEqual(swopPolicy(playerWire.wire), swopPolicy(workerWire.wire));
    const usesDurableSessions = fs.existsSync(path.join(workerRoot, 'src/session.ts'));
    let runtime;
    const worker = usesDurableSessions ? {
        async fetch(request) { return (await runtime.getWorker()).fetch(request); },
    } : load(path.join(workerRoot, 'src/index.ts'), {}, { './wire-contracts': workerWire }).exports.default;
    assert(!installation || usesDurableSessions, "Installation mode requires the current Worker");
    const records = new Map();
    const env = {
        PUBLIC_BASE_URL: '', ADMIN_TOKEN: 'synthetic-local-admin-token', SESSION_TTL_SECONDS: '600',
        SWOP: {
            async get(key) {
                const record = records.get(key);
                if (!record || record.expires <= Date.now()) return null;
                return record.value;
            },
            async put(key, value, options = {}) {
                records.set(key, { value, expires: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : Infinity });
            },
            async delete(key) { records.delete(key); },
            async list({ prefix }) { return { keys: [...records.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) }; },
        },
    };
    const server = http.createServer(async (req, res) => {
        try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = Buffer.concat(chunks);
            let route = req.url;
            const headers = new Headers(req.headers);
            // A minimal loopback relay fixture models the installation boundary.
            // It is not the production relay and cannot attest its deployment.
            if (route.startsWith('/swop/')) {
                if (!installation || !['/swop/session', '/swop/val'].includes(route)) {
                    res.writeHead(404); res.end(); return;
                }
                if (headers.get('Origin') !== env.PUBLIC_BASE_URL) {
                    res.writeHead(403); res.end(); return;
                }
                route = route.slice('/swop'.length);
                headers.set('Authorization', 'Bearer ' + relayCredential);
            }
            const response = await worker.fetch(new Request(env.PUBLIC_BASE_URL + route, {
                method: req.method, headers, ...(body.length ? { body } : {}),
            }), env);
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
            res.writeHead(500); res.end(String(error));
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    env.PUBLIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    const requests = [];
    async function localFetch(url, options) {
        assert.equal(new URL(url).origin, env.PUBLIC_BASE_URL, 'No external requests');
        const response = await fetch(url, { ...options, redirect: 'error' });
        requests.push({ path: new URL(url).pathname, method: options?.method || 'GET', status: response.status });
        return response;
    }
    const clientId = 'dev_00000000000000000000000000000001';
    const otherId = 'dev_00000000000000000000000000000002';
    const header = workerWire.wire.swopClientHeader;
    const post = (route, data, headers = {}) => localFetch(env.PUBLIC_BASE_URL + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data),
    });
    const scenarios = [];
    try {
        if (usesDurableSessions) {
            const workerRequire = createRequire(path.join(workerRoot, 'package.json'));
            const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare');
            const { build } = workerRequire('esbuild');
            const bundle = await build({ entryPoints: [path.join(workerRoot, 'src/index.ts')], bundle: true, format: 'esm', write: false });
            runtime = new Miniflare(convertV4MiniflareOptions({
                name: 'swop-e2e', modules: true, script: bundle.outputFiles[0].text,
                compatibilityDate: '2025-09-01', kvNamespaces: ['SWOP'],
                durableObjects: { SESSIONS: { className: 'SwopSession', useSQLite: true } },
                ratelimits: { REQUEST_RATE_LIMIT: { namespace_id: '1001', simple: { limit: 240, period: 60 } } },
                bindings: { PUBLIC_BASE_URL: env.PUBLIC_BASE_URL, ADMIN_TOKEN: env.ADMIN_TOKEN, SESSION_TTL_SECONDS: '600',
                    INSTALLATION_CREDENTIALS_JSON: JSON.stringify([{ id: 'contract-server', token: installationToken, origins: [env.PUBLIC_BASE_URL] }]) },
            }));
            await runtime.ready;
        }
        assert.equal((await post('/admin/clients', { clientId })).status, 401);
        assert.equal((await post('/admin/clients', { clientId }, { Authorization: 'Bearer incorrect' })).status, 401);
        for (const id of [clientId, otherId]) {
            assert.equal((await post('/admin/clients', { clientId: id }, { Authorization: `Bearer ${env.ADMIN_TOKEN}` })).status, 201);
        }
        scenarios.push('admin rejects missing/wrong bearer; provisions two clients with correct bearer');
        assert.equal((await post('/session', {})).status, 401);
        assert.equal((await post('/session', {}, { [header]: 'unlisted-client' })).status, 403);
        scenarios.push('session rejects missing and unlisted client identities');

        const pending = [];
        const timers = new Map();
        let timerSequence = 0;
        let returned = 0;
        let session;
        const uiMessages = [];
        const ui = {
            find() { return this; }, hide() { return this; }, show() { return this; },
            html(value) { uiMessages.push(value); return this; },
            text(value) { uiMessages.push(value); return this; },
        };
        const $ = () => ui;
        $.ajax = options => {
            pending.push((async () => {
                assert(!JSON.stringify(options).includes(installationToken), 'Client must never receive the installation secret');
                const response = await localFetch(options.url, {
                    method: options.type, headers: { ...options.headers, ...(installation ? { Origin: env.PUBLIC_BASE_URL } : {}) }, body: options.data,
                });
                const data = await response.json();
                if (new URL(options.url).pathname.endsWith('/session') && response.ok) session = data;
                assert(!JSON.stringify(data).includes(installationToken), 'Response must not expose the installation secret');
                if (response.ok) options.success(data);
                else options.error({ status: response.status, responseJSON: data });
            })());
        };
        async function drain() { while (pending.length) await pending.shift(); }
        async function poll() {
            const timer = [...timers].find(([, item]) => item.delay < 10000);
            assert(timer, 'The real client scheduled another poll');
            timers.delete(timer[0]); timer[1].fn(); await drain();
        }
        const settings = { deviceUuid: clientId, swopBaseUrl: env.PUBLIC_BASE_URL + (installation ? '/swop' : '') };
        const hasHereNowUi = fs.existsSync(path.join(player, 'src/swop/herenow-ui.ts'));
        const adapterImports = {
            '../localization': { translate: value => value },
            '../settings': { settings, saveSettings() {} },
            '../shared/wire-contracts': playerWire,
            '../utils/qr-code': { makeQrSvg: () => '' },
        };
        // Recent clients import this separate UI route even when the fixture
        // selects the installation/legacy relay. Load its real dependencies;
        // older released clients have neither module and need no import entry.
        if (hasHereNowUi) {
            adapterImports['./herenow-ui'] = load(path.join(player, 'src/swop/herenow-ui.ts'), {}, {
                './herenow': load(path.join(player, 'src/swop/herenow.ts')).exports,
            }).exports;
        }
        const context = load(path.join(player, 'src/swop/index.ts'), {
            $, document: { getElementById: () => null },
            localStorage: { getItem: () => null, setItem() {} },
            deviceUUID: clientId, editCaption: 'Enter <URL>', editvar: 'draft<&', curColor: '',
            keys: { RETURN: 1, EXIT: 2 }, showEditKey() { returned++; },
            alert(message) { throw new Error(message); },
            setTimeout(fn, delay) { timers.set(++timerSequence, { fn, delay }); return timerSequence; },
            clearTimeout(id) { timers.delete(id); },
        }, adapterImports);
        context.exports.swopLoadValue();
        await drain();
        assert(session?.code && session.url);
        assert.equal(session.expiresIn, 600);
        const form = await (await localFetch(session.url)).text();
        assert(form.includes('Enter &lt;URL&gt;') && form.includes('draft&lt;&amp;'));
        await poll();
        assert.equal(returned, 0);
        scenarios.push('real client creates session; form preserves escaped caption/draft; waiting poll continues');
        assert.equal((await localFetch(env.PUBLIC_BASE_URL + '/val?c=' + session.code, { headers: { [header]: otherId } })).status, 403);
        scenarios.push('a different allowlisted client cannot read the session');
        const value = 'https://example.invalid/плейлист.m3u?name=ТВ&token=<synthetic>\n第二行';
        const submitToken = new URL(session.url).searchParams.get('t');
        if (installation) {
            assert(session.sessionToken && submitToken && session.sessionToken !== submitToken);
            assert.equal((await localFetch(env.PUBLIC_BASE_URL + '/?c=' + session.code)).status, 403);
            assert.equal((await post('/submit', { code: session.code, value })).status, 403);
            assert.equal((await post('/submit', { code: session.code, value, token: session.sessionToken })).status, 403);
            const authenticated = { Authorization: 'Bearer ' + installationToken, Origin: env.PUBLIC_BASE_URL };
            for (const body of [
                { code: session.code, clientId: otherId, sessionToken: session.sessionToken },
                { code: session.code, clientId, sessionToken: submitToken },
            ]) assert.equal((await post('/val', body, authenticated)).status, 403);
            scenarios.push('installation sessions require distinct write/read capabilities and the matching owner');
            assert(uiMessages.some(message => String(message).includes(session.entryCode)));
            assert(uiMessages.some(message => String(message).includes(session.entryUrl)));
            assert(!uiMessages.some(message => String(message).includes(session.sessionToken)));
            scenarios.push('real client displays manual entry URL/code without its read capability');
        }
        const phone = { code: session.code, value, ...(installation ? { token: submitToken } : {}) };
        assert.equal((await post('/submit', phone)).status, 200);
        assert.equal((await post('/submit', { ...phone, value: 'overwrite' })).status, 409);
        await poll();
        assert.equal(context.editvar, value);
        assert.equal(returned, 1);
        assert.equal(timers.size, 0);
        scenarios.push('phone submission reaches real client unchanged; sequential duplicate rejected; polling stops');
        const consumed = await localFetch(env.PUBLIC_BASE_URL + '/val?c=' + session.code, { headers: { [header]: clientId } });
        assert.deepEqual(await consumed.json(), { status: 'gone' });
        scenarios.push('sequential re-read after delivery returns gone');
        if (installation) {
            context.exports.swopLoadValue(); await drain();
            const manual = await localFetch(env.PUBLIC_BASE_URL + '/?entry=' + encodeURIComponent(session.entryCode));
            assert.equal(manual.status, 200);
            assert.equal((await post('/submit', { code: session.code, entryCode: session.entryCode, value: 'Ручной ввод' })).status, 200);
            await poll();
            assert.equal(context.editvar, 'Ручной ввод');
            scenarios.push('manual TV code delivers text through the installation-authenticated polling path');
            relayCredential = 'invalid-server-credential';
        } else {
            settings.deviceUuid = 'unlisted-client'; context.deviceUUID = 'unlisted-client';
        }
        context.exports.swopLoadValue(); await drain();
        assert(uiMessages.some(message => String(message).includes('Remote text entry denied')));
        scenarios.push('real client renders authorization denial from Worker');
        const report = {
            observed_at: new Date().toISOString(), status: 'passed', authentication: installation ? 'server installation credential + per-session capabilities' : 'legacy client allowlist', scenarios, requests,
            player: receipt(player, ['src/swop/index.ts', 'src/shared/wire-contracts.ts',
                ...(hasHereNowUi ? ['src/swop/herenow-ui.ts', 'src/swop/herenow.ts'] : [])]),
            worker: receipt(workerRoot, ['src/index.ts', 'src/wire-contracts.ts', ...(usesDurableSessions ? ['src/session.ts'] : [])]),
            runtime: usesDurableSessions ? 'workerd with SQLite Durable Objects and rate-limit binding' : 'Node VM with synthetic KV',
            limitations: [installation ? 'UI, timers and same-origin relay are fixtures; the actual FOSS adapter and Worker communicate over loopback HTTP. Production relay code/deployment is not qualified by this test.' : 'UI and timers substituted; real client adapter and Worker communicate over loopback HTTP.',
                usesDurableSessions ? 'Sequential cross-client test; concurrent storage scenarios run in the Worker integration suite.' : 'Synthetic in-memory KV does not model eventual consistency or qualify atomic consumption.',
                ...(hasHereNowUi ? ['here.now modules are loaded from this client checkout; their DOM, cryptography and hosted transport paths are not exercised by these relay scenarios.'] : []),
                'No live Cloudflare traffic, rate-limit or deployed secret validation.'],
        };
        if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        console.log(`PASS: ${scenarios.length} SWOP cross-repository scenarios (${requests.length} local HTTP requests)`);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        if (runtime) await runtime.dispose();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
