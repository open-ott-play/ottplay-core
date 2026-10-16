const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../src/security.js'), 'utf8');
acorn.parse(source, {ecmaVersion: 5});
let security;
const context = vm.createContext({OTT2: {define(name, factory) {security = factory();}}});
require('./load-core.cjs')(context);
vm.runInContext(source, context);
const plain = value => JSON.parse(JSON.stringify(value));
const call = (gate, method, ...args) => new Promise(resolve => gate[method](...args, resolve));
function fixture(extra = {}) {
    let now = 1e6;
    const state = {security: security.defaults(), activeSourceId: 'a'}, writes = [];
    const options = {crypto: crypto.webcrypto, Uint8Array, getState: () => state,
        persist(config) {state.security = plain(config); writes.push(plain(config)); return true;},
        now: () => now, ...extra};
    return {gate: security.create(options), options, state, writes, tick(ms) {now += ms;}};
}
function legacy(pin, salt = 'public-legacy-salt-1234', count = 2048) {
    let hash = crypto.createHash('sha256').update(salt + ':' + pin).digest('hex');
    for (let i = 1; i < count; i++) hash = crypto.createHash('sha256').update(salt + ':' + hash).digest('hex');
    return {...plain(security.defaults()), enabled: true, salt, hash, iterations: count};
}
test('native PBKDF2 matches independent implementation; each new PIN has fresh salt', async () => {
    const f = fixture();
    assert.equal((await call(f.gate, 'configure', '', '876543')).code, 'CONFIGURED');
    const config = f.state.security;
    assert.equal(config.schema, 2); assert.equal(config.algorithm, 'PBKDF2-HMAC-SHA256');
    assert.equal(config.iterations, 600000);
    assert.equal(config.hash, crypto.pbkdf2Sync('876543', Buffer.from(config.salt, 'hex'), 600000, 32, 'sha256').toString('hex'));
    assert.equal((await call(f.gate, 'configure', 'wrong', '654321')).ok, false);
    assert.equal(f.state.security.salt, config.salt);
    assert.equal((await call(f.gate, 'configure', '876543', '654321')).ok, true);
    assert.notEqual(f.state.security.salt, config.salt);
    assert.equal((await call(f.gate, 'verify', '876543')).ok, false);
    assert.equal((await call(f.gate, 'verify', '654321')).ok, true);
    assert(!JSON.stringify(f.writes).includes('876543'));
    assert(!JSON.stringify(f.writes).includes('654321'));
});
test('old verifier only migrates after correct PIN; does not drop protected state', async () => {
    const f = fixture(); f.state.security = legacy('123456');
    f.state.security.protectedIds = ['a:adult']; f.state.security.scopes.settings = false;
    const before = plain(f.state.security);
    assert.equal((await call(f.gate, 'verify', '999999')).ok, false);
    assert.equal(f.state.security.schema, 1); assert.equal(f.state.security.hash, before.hash);
    assert.equal((await call(f.gate, 'verify', '123456')).ok, true);
    assert.equal(f.state.security.schema, 2); assert.notEqual(f.state.security.hash, before.hash);
    assert.deepEqual(f.state.security.protectedIds, ['a:adult']); assert.equal(f.state.security.scopes.settings, false);
    assert.equal(f.gate.status().unlocked, true);
});
test('invalid PIN format cannot alter configuration', async () => {
    const f = fixture();
    for (const pin of ['', '123', '1234567890123', '12a4', '１２３４', 1234, '1234\n']) {
        assert.equal((await call(f.gate, 'configure', '', pin)).code, 'PIN_FORMAT');
        assert.equal(f.state.security.enabled, false);
    }
});
test('all protected playback and sensitive routes share the bounded grant', async () => {
    const f = fixture();
    assert.equal(f.gate.setProtected('a:adult', true).code, 'PIN_NOT_CONFIGURED');
    await call(f.gate, 'configure', '', '1234');
    assert.equal(f.gate.setProtected('a:adult', true).ok, false);
    assert.equal((await call(f.gate, 'setProtected', 'a:adult', true, '1234')).ok, true);
    f.gate.lock();
    for (const action of ['playback', 'play', 'archive', 'vod', 'history', 'bookmark', 'preview', 'pip']) {
        assert.equal(f.gate.authorize(action, 'a:adult').code, 'PIN_REQUIRED');
        assert.equal(f.gate.authorize(action, 'a:free').ok, true);
        assert.equal(f.gate.authorize(action, '').ok, false);
    }
    for (const action of ['settings', 'source', 'import', 'restore', 'export', 'proxy', 'remote', 'new-action']) assert.equal(f.gate.authorize(action).ok, false);
    assert.equal((await call(f.gate, 'authorize', 'play', 'a:adult', '1234')).ok, true);
    assert.equal(f.gate.authorize('import').ok, true);
    f.tick(300000); assert.equal(f.gate.authorize('play', 'a:adult').ok, false);
});
test('sessions revoke on source switch, reload, explicit lock and clock rollback', async () => {
    const f = fixture(); await call(f.gate, 'configure', '', '1234'); await call(f.gate, 'verify', '1234');
    f.state.activeSourceId = 'b'; assert.equal(f.gate.authorize('settings').ok, false);
    await call(f.gate, 'verify', '1234'); assert.equal(security.create(f.options).authorize('settings').ok, false);
    f.gate.lock(); assert.equal(f.gate.authorize('settings').ok, false);
    await call(f.gate, 'verify', '1234'); f.tick(-1); assert.equal(f.gate.authorize('settings').ok, false);
});
test('persistent cooldown includes correct PIN and survives a new gate', async () => {
    const f = fixture(); await call(f.gate, 'configure', '', '1234');
    for (let i = 0; i < 4; i++) assert.equal((await call(f.gate, 'verify', '9999')).code, 'WRONG_PIN');
    assert.equal((await call(f.gate, 'verify', '9999')).code, 'RATE_LIMIT');
    assert.equal((await call(f.gate, 'verify', '1234')).retryAfter, 30);
    assert.equal((await call(security.create(f.options), 'verify', '1234')).code, 'RATE_LIMIT');
    f.tick(30000); assert.equal((await call(f.gate, 'verify', '9999')).retryAfter, 60);
    f.tick(60000); assert.equal((await call(f.gate, 'verify', '1234')).ok, true);
});
test('security editing stays protected when ordinary settings are unprotected', async () => {
    const f = fixture(); await call(f.gate, 'configure', '', '1234');
    assert.equal((await call(f.gate, 'setScopes', {settings: false}, '1234')).ok, true);
    assert.equal(f.gate.authorize('settings').ok, true);
    assert.equal(f.gate.setProtected('a:adult', true).ok, false);
    assert.equal(f.gate.setScopes({settings: true}).ok, false);
    assert.equal((await call(f.gate, 'disable', '9999')).ok, false);
    assert.equal((await call(f.gate, 'disable', '1234')).ok, true);
    assert.equal(f.state.security.enabled, false); assert.equal(f.state.security.hash, '');
});
test('unknown algorithms, nonfinite work factors and corrupt KDF parameters reject', async () => {
    const f = fixture(); await call(f.gate, 'configure', '', '1234');
    for (const change of [v => v.schema = 3, v => v.enabled = 'true', v => v.algorithm = 'SHA-1', v => delete v.algorithm,
        v => v.hash = 'plaintext', v => v.salt = 'f'.repeat(31), v => v.iterations = 599999, v => v.iterations = 2000001,
        v => v.iterations = 600000.5, v => v.iterations = NaN, v => v.iterations = Infinity, v => v.protectedIds = [null]]) {
        const bad = plain(f.state.security); change(bad); assert.throws(() => security.validate(bad));
    }
    for (const count of [NaN, Infinity, 1024.5, 1023, 8193]) assert.throws(() => security.validate({...legacy('1234'), iterations: count}));
});
test('unavailable WebCrypto or entropy leaves existing protection enabled', async () => {
    for (const cryptoApi of [undefined, {}, {subtle: {}}]) {
        const f = fixture({crypto: cryptoApi}); f.state.security = legacy('1234'); const before = plain(f.state.security);
        assert.equal((await call(f.gate, 'verify', '1234')).code, 'CRYPTO_UNAVAILABLE');
        assert.equal((await call(f.gate, 'configure', '1234', '5678')).code, 'CRYPTO_UNAVAILABLE');
        assert.deepEqual(f.state.security, before); assert.equal(f.gate.status().unlocked, false);
    }
    for (const randomBytes of [() => {throw new Error('No entropy');}, () => [], () => Array(16).fill(NaN), () => Array(16).fill(256)]) {
        const f = fixture({randomBytes});
        assert.equal((await call(f.gate, 'configure', '', '1234')).code, 'RANDOM_UNAVAILABLE');
        assert.equal(f.state.security.enabled, false);
    }
    const broken = fixture({crypto: {getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto), subtle: {
        importKey() {throw new Error('Unsupported algorithm');}, deriveBits() {}, digest() {}
    }}});
    assert.equal((await call(broken.gate, 'configure', '', '1234')).code, 'CRYPTO_UNAVAILABLE');
    assert.equal(broken.state.security.enabled, false); assert.equal(broken.gate.status().busy, false);
});
test('unconfirmed persistence never grants or announces a PIN', async () => {
    const f = fixture({persist() {return false;}});
    assert.equal((await call(f.gate, 'configure', '', '1234')).code, 'STORAGE_UNAVAILABLE');
    assert.equal(f.state.security.enabled, false);
    f.state.security = legacy('1234');
    assert.equal((await call(f.gate, 'verify', '1234')).code, 'STORAGE_UNAVAILABLE');
    assert.equal(f.state.security.schema, 1); assert.equal(f.gate.status().unlocked, false);
});
test('synchronous persistence observers cannot change source or cancel and still grant', async () => {
    for (const changed of ['source', 'cancel', 'clock']) {
        const f = fixture(); await call(f.gate, 'configure', '', '1234');
        const persist = f.options.persist;
        f.options.persist = config => { persist(config); if (changed === 'source') f.state.activeSourceId = 'b'; else if (changed === 'clock') f.tick(-1); else f.gate.lock(); return true; };
        assert.equal((await call(f.gate, 'verify', '1234')).code, 'CANCELLED');
        assert.equal(f.gate.status().unlocked, false);
    }
});
test('pending derivation is single-flight and cancellation/source changes discard its result', async () => {
    for (const cancel of [f => f.gate.lock(), f => {f.state.activeSourceId = 'changed';}, f => f.tick(-1)]) {
        let release;
        const subtle = crypto.webcrypto.subtle;
        const f = fixture({crypto: {getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto), subtle: {
            importKey: subtle.importKey.bind(subtle), digest: subtle.digest.bind(subtle),
            deriveBits() {return new Promise(resolve => {release = resolve;});}
        }}});
        const result = call(f.gate, 'configure', '', '1234');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal((await call(f.gate, 'configure', '', '5678')).code, 'BUSY');
        cancel(f); release(new Uint8Array(32).buffer);
        assert.equal((await result).code, 'CANCELLED'); assert.equal(f.writes.length, 0);
        assert.equal(f.state.security.enabled, false); assert.equal(f.gate.status().unlocked, false);
    }
});
