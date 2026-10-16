const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const plain = value => JSON.parse(JSON.stringify(value));
function modules() {
    const found = {}, context = vm.createContext({});
    context.OTT2 = {define(name, factory) {found[name] = factory(id => found[id]);}};
    require('./load-core.cjs')(context);
    for (const name of ['security', 'state']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/' + name + '.js'), 'utf8'), context);
    return {found, context};
}
function storage(initial, key) {
    const values = {[key]: JSON.stringify(initial)};
    return {values, writes: 0, failAt: 0, dropAt: 0,
        getItem(key) {return values[key] || null;},
        setItem(key, value) {this.writes++; if (this.writes === this.failAt) throw new Error('Quota'); if (this.writes !== this.dropAt) values[key] = value;}};
}
function initialState(m) {
    const state = plain(m.state.defaults());
    state.sources = [{id: 'source', name: 'Private provider', type: 'm3u', url: 'https://private.invalid/list?token=synthetic'}];
    state.activeSourceId = 'source';
    let hash = crypto.createHash('sha256').update('legacy-public-salt:123456').digest('hex');
    for (let i = 1; i < 1024; i++) hash = crypto.createHash('sha256').update('legacy-public-salt:' + hash).digest('hex');
    state.security = {...state.security, enabled: true, salt: 'legacy-public-salt', hash, iterations: 1024, protectedIds: ['source:adult']};
    return state;
}
function gate(m, repo) {
    return m.security.create({crypto: crypto.webcrypto, Uint8Array, getState: () => repo.snapshot(), persist: config => repo.updateSecurity(config)});
}
const verify = (g, pin) => new Promise(resolve => g.verify(pin, resolve));
function oldReader(context, store) {
    let reader;
    const legacy = {defaults: () => context.OttPlayCore.parentalDefaults(), validate(value) {
        // Candidate-core CI replaces the compiled vendor with the new core.
        // Retain the old core's schema1-only boundary for this old-reader probe.
        if (value && value.schema !== 1) throw new Error('Unsupported parental-control format');
        return context.OttPlayCore.parentalValidate(value);
    }};
    context.OTT2 = {define(name, factory) {reader = factory(() => legacy);}};
    // Exact frozen pre-migration storage implementation, not a new approximation.
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/legacy-state-reader.js'), 'utf8'), context);
    return reader.create(store);
}
test('migration stores canonical state before the old-reader guard and grants only after final read-back', async () => {
    const {found: m, context} = modules(), original = initialState(m), store = storage(original, m.state.key);
    const repo = m.state.create(store), g = gate(m, repo);
    assert.equal((await verify(g, '123456')).ok, true);
    assert.equal(store.writes, 3);
    assert.equal(repo.snapshot().security.schema, 2);
    assert.equal(m.state.create(store).snapshot().sources[0].url, original.sources[0].url);
    const old = oldReader(context, store), oldState = old.snapshot();
    assert.equal(old.status().persistent, true, 'Old parser must accept guard, never reset to defaults');
    assert.equal(oldState.security.enabled, true); assert.equal(oldState.sources.length, 0);
    for (const scope of ['settings', 'source', 'import', 'restore', 'export', 'proxy', 'remote']) assert.equal(context.OttPlayCore.parentalProtected(oldState.security, '', scope), true);
    assert.equal(oldState.security.hash, '0'.repeat(64));
    assert(!store.values[m.state.key].includes('private.invalid'));
    assert(!store.values[m.state.secureKey].includes(original.security.hash), 'Completed upgrade removes legacy verifier');
    assert.equal((await verify(gate(m, m.state.create(store)), '123456')).ok, true);
});
test('every migration write failure preserves recoverable prior credentials and never grants', async () => {
    for (const failAt of [1, 2, 3]) {
        const {found: m} = modules(), original = initialState(m), store = storage(original, m.state.key);
        store.failAt = failAt;
        const repo = m.state.create(store), g = gate(m, repo), result = await verify(g, '123456');
        assert.equal(result.ok, false); assert.equal(g.status().unlocked, false);
        assert.equal(repo.snapshot().security.enabled, true);
        const saved = store.values[m.state.secureKey] ? JSON.parse(store.values[m.state.secureKey]).state : JSON.parse(store.values[m.state.key]);
        assert.equal(saved.security.hash, original.security.hash);
        store.failAt = 0;
        const reopened = m.state.create(store);
        assert.equal((await verify(gate(m, reopened), '123456')).ok, true, 'Retry can migrate retained old PIN');
    }
});
test('a dropped write cannot masquerade as durable success', async () => {
    for (const dropAt of [1, 2, 3]) {
        const {found: m} = modules(), store = storage(initialState(m), m.state.key); store.dropAt = dropAt;
        const repo = m.state.create(store), g = gate(m, repo);
        assert.equal((await verify(g, '123456')).ok, false); assert.equal(g.status().unlocked, false);
    }
});
test('corrupt canonical state and interrupted guard repair stay locked without overwriting recoverable data', async () => {
    const {found: m} = modules(), store = storage(initialState(m), m.state.key);
    let repo = m.state.create(store); await verify(gate(m, repo), '123456');
    const good = store.values[m.state.secureKey];
    store.values[m.state.secureKey] = '{bad'; repo = m.state.create(store);
    assert.equal(repo.snapshot().security.enabled, true); assert.equal(repo.snapshot().sources.length, 0);
    assert.throws(() => repo.updateSecurity(m.security.defaults())); assert.equal(store.values[m.state.secureKey], '{bad');
    store.values[m.state.secureKey] = good; store.values[m.state.key] = ''; store.failAt = store.writes + 1;
    repo = m.state.create(store); assert.equal(repo.status().persistent, false);
    assert.throws(() => repo.updateSecurity(m.security.defaults())); assert.equal(store.values[m.state.secureKey], good);
    store.failAt = 0; repo = m.state.create(store); assert.equal((await verify(gate(m, repo), '123456')).ok, true);
});
test('an unreadable store cannot masquerade as an empty unprotected installation', () => {
    for (const failAt of [1, 2]) {
        const {found: m} = modules(), store = storage(initialState(m), m.state.key);
        const original = {...store.values}, get = store.getItem; let reads = 0;
        store.getItem = function (key) { if (++reads === failAt) throw new Error('SecurityError'); return get.call(this, key); };
        const repo = m.state.create(store), state = repo.snapshot();
        assert.equal(state.security.enabled, true); assert.equal(state.sources.length, 0);
        assert.equal(repo.status().persistent, false);
        assert.throws(() => repo.updateSecurity(m.security.defaults()));
        assert.equal(store.writes, 0); assert.deepEqual(store.values, original);
    }
});
test('another tab cannot overwrite a newer PIN from a stale canonical snapshot', async () => {
    const {found: m} = modules(), store = storage(initialState(m), m.state.key);
    let first = m.state.create(store); await verify(gate(m, first), '123456');
    first = m.state.create(store); const second = m.state.create(store);
    const newer = gate(m, second);
    assert.equal((await new Promise(resolve => newer.configure('123456', '987654', resolve))).ok, true);
    const g = gate(m, first); assert.equal((await verify(g, '123456')).ok, false); assert.equal(g.status().unlocked, false);
    assert.equal((await verify(gate(m, m.state.create(store)), '987654')).ok, true);
});
test('invalid imported KDF metadata rejects atomically; old reader rejects a v2 export', async () => {
    const {found: m, context} = modules(), store = storage(initialState(m), m.state.key), repo = m.state.create(store);
    await verify(gate(m, repo), '123456'); const exported = repo.exportJSON(true), before = repo.snapshot();
    for (const mutate of [x => x.security.algorithm = 'SHA-1', x => x.security.iterations = 1, x => x.security.schema = 9]) {
        const incoming = JSON.parse(exported); mutate(incoming);
        assert.throws(() => repo.importJSON(JSON.stringify(incoming))); assert.deepEqual(plain(repo.snapshot()), plain(before));
    }
    const old = oldReader(context, store); assert.throws(() => old.importJSON(exported));
    assert.equal(old.snapshot().security.enabled, true);
});
