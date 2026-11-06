"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/local-media.js"), "utf8");
const endpoint = "http://127.0.0.1:44000/offline-media/" + "a".repeat(64);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 1000; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); } assert.fail("condition did not settle"); }
async function settled() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
async function poll(f, delay) { await settled(); f.runTimer(delay); await settled(); }
function file(name, wait) {
    return { kind: "file", name, reads: 0, async getFile() { this.reads++; if (wait) await wait; return { name, type: "video/mp4", size: 10 }; } };
}
function folder(files, name = "Movies") {
    return { kind: "directory", name, queryPermission: async () => "granted", getFileHandle: async name => { const found = files.find(item => item.name === name); if (!found) throw Error("missing"); return found; }, values() { let i = 0; return { next: async () => i < files.length ? { value: files[i++], done: false } : { done: true } }; } };
}
function fixture(options = {}) {
    let api, state, rows = [], dbRecords = options.dbRecords || new Map();
    const values = options.values || {}, starts = [], requests = [], revoked = [], created = [], timers = new Map(), changes = [];
    const storage = { getItem: key => values[key] || null, setItem: (key, value) => { values[key] = value; } };
    const env = {
        setTimeout(callback, delay) { const id = {}; timers.set(id, { callback, delay }); if (!delay) queueMicrotask(() => { if (timers.delete(id)) callback(); }); return id; },
        clearTimeout(id) { timers.delete(id); },
        URL: { createObjectURL(blob) { const value = "blob:test-" + created.length; created.push(blob); return value; }, revokeObjectURL: value => revoked.push(value) },
        showDirectoryPicker: options.pick || (async () => options.folder),
        XMLHttpRequest: class {
            open(method, url) { this.method = method; this.url = url; }
            send() { requests.push(this); }
            abort() { this.aborted = true; }
            respond(body, status = 200) { this.status = status; this.responseText = JSON.stringify(body); this.onload(); }
        },
        indexedDB: { open() { const open = {}; queueMicrotask(() => { open.result = {
            close() {}, transaction() { const tx = {}; tx.objectStore = () => ({
                get(id) { const request = {}; queueMicrotask(() => { request.result = dbRecords.get(id); tx.oncomplete(); }); return request; },
                put(value) { const request = {}; queueMicrotask(() => { dbRecords.set(value.id, value); tx.oncomplete(); }); return request; },
                delete(id) { const request = {}; queueMicrotask(() => { dbRecords.delete(id); tx.oncomplete(); }); return request; }
            }); return tx; }
        }; open.onsuccess(); }); return open; } }
    };
    vm.runInNewContext(source, { Promise, Date, Math, Object, Array, JSON, Error, encodeURIComponent, decodeURIComponent, isFinite, OTT2: { define(name, factory) { api = factory(); } } });
    const local = api.create(env, { storage, changed(next, snapshot) { rows = next; state = snapshot; changes.push(snapshot); }, start(row, resume) { starts.push({ row, resume }); if (options.start) options.start(row, resume); } });
    return { local, env, values, starts, requests, revoked, created, dbRecords, timers, changes,
        runTimer(delay) { const entry = Array.from(timers).find(([, timer]) => timer.delay === delay); assert(entry, "missing timer " + delay); timers.delete(entry[0]); entry[1].callback(); },
        get rows() { return rows; }, get state() { return state || local.snapshot(); }, key: api.key };
}
function catalog(items, generation = 1, state = "scanning") {
    return { scanning: true, sources: [{ id: "movies", name: "Movies", kind: "folder", available: true }], sourceScans: [{ sourceId: "movies", generation, state }], items: items.map(id => ({ id, name: id + ".mp4", sourceId: "movies", available: true, url: endpoint + "/" + id })) };
}
async function helper(f) {
    const connecting = f.local.connect(endpoint);
    assert.equal(f.requests[0].url, endpoint + "/sources");
    f.requests[0].respond({ sources: [{ id: "movies", name: "Movies", kind: "folder" }] });
    await connecting;
    return f.local.snapshot().sources[0].id;
}
test("browser first file plays before a blocked second original read; append retains the selected item", async () => {
    const tail = deferred(), first = file("first.mp4"), second = file("second.mp4", tail.promise), f = fixture({ folder: folder([first, second]) });
    const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => f.starts.length === 1 && second.reads === 1);
    assert.equal(f.starts[0].row.name, "first.mp4"); assert.equal(f.state.scanning, true);
    const selected = f.starts[0].row.id;
    tail.resolve(); await until(() => !f.state.scanning);
    assert.equal(f.rows.length, 2); assert.equal(f.starts.length, 1); assert.equal(f.state.current, selected);
    f.local.destroy();
});
test("blocked first original does not prevent a ready sibling from starting", async () => {
    const held = deferred(), stalled = file("stalled.mp4", held.promise), ready = file("ready.mp4"), f = fixture({ folder: folder([stalled, ready]) });
    const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => f.starts.length === 1);
    assert.equal(stalled.reads, 1); assert.equal(ready.reads, 1); assert.equal(f.starts[0].row.name, "ready.mp4"); assert.equal(f.state.scanning, true);
    held.resolve(); await until(() => !f.state.scanning); assert.equal(f.starts.length, 1); f.local.destroy();
});
test("stalled nested iterator cannot retain its parent cursor", async () => {
    const held = deferred(); let returned = 0, nestedCalls = 0;
    const nested = { kind: "directory", name: "nested", values: () => ({ next: () => { nestedCalls++; return held.promise; }, return: async () => { returned++; return { done: true }; } }) };
    const f = fixture({ folder: folder([nested, file("ready.mp4")]) });
    const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => f.starts.length === 1); assert.equal(nestedCalls, 1); assert.equal(f.starts[0].row.name, "ready.mp4");
    f.local.leave(); assert.equal(returned, 1); held.resolve({ done: true }); await settled(); assert.equal(f.starts.length, 1); f.local.destroy();
});
test("a discovered file outranks queued metadata when all four iterator slots are saturated", async () => {
    const blocked = Array.from({ length: 5 }, deferred), calls = [0, 0, 0, 0], trace = []; let rootCalls = 0;
    const dirs = calls.map((_, index) => ({ kind: "directory", name: "dir-" + index, values: () => ({ next() {
        calls[index]++; trace.push("iterator-" + index);
        return calls[index] === 1 ? blocked[index].promise : Promise.resolve({ done: true });
    }, return: async () => ({ done: true }) }) }));
    const ready = { kind: "file", name: "ready.mp4", getFile: async () => { trace.push("file"); return { name: "ready.mp4", type: "video/mp4" }; } };
    const root = { kind: "directory", name: "root", values: () => ({ next() {
        rootCalls++; return rootCalls <= 4 ? Promise.resolve({ done: false, value: dirs[rootCalls - 1] }) : blocked[4].promise;
    }, return: async () => ({ done: true }) }) };
    const f = fixture({ folder: root }); const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => rootCalls === 5 && calls[0] === 1 && calls[1] === 1 && calls[2] === 1);
    assert.equal(calls[3], 0, "fourth directory is queued behind the occupied iterator slots");
    blocked[0].resolve({ done: false, value: ready }); await until(() => f.starts.length === 1);
    assert.equal(f.starts[0].row.name, "ready.mp4");
    assert(trace.indexOf("file") < trace.indexOf("iterator-3") || !trace.includes("iterator-3"));
    f.local.destroy(); blocked.slice(1).forEach(wait => wait.resolve({ done: true })); await settled();
});
test("cancelled and timed-out generations retain shared admission until actual reads drain", async () => {
    const held = Array.from({ length: 12 }, deferred); let inFlight = 0, maximum = 0, started = 0;
    const files = held.map((wait, index) => ({ kind: "file", name: index + ".mp4", async getFile() { started++; inFlight++; maximum = Math.max(maximum, inFlight); await wait.promise; inFlight--; return { name: index + ".mp4", type: "video/mp4" }; } }));
    const f = fixture(); f.env.showOpenFilePicker = async () => files; const id = await f.local.importFiles();
    f.local.select(id, false, false, true); await until(() => started === 4);
    for (let i = 0; i < 20; i++) { f.local.select(id, false, false, true); await settled(); }
    assert.equal(started, 4); assert.equal(maximum, 4); assert.equal(f.starts.length, 0);
    f.runTimer(60000); await settled(); assert.equal(f.state.scanning, false); assert.match(f.state.error, /timed out/);
    f.local.select(id, false, false, true); await settled(); assert.equal(started, 4);
    held[0].resolve(); await until(() => started > 4); assert.equal(maximum, 4);
    f.local.destroy(); held.forEach(wait => wait.resolve()); await settled(); assert.equal(inFlight, 0);
});
test("browser enumeration is bounded at 100000 entries with an explicit error", async () => {
    const repeated = file("same.mp4"); let entries = 0;
    const root = { kind: "directory", name: "large", values: () => ({ next: async () => ({ done: false, value: (entries++, repeated) }), return: async () => ({ done: true }) }) };
    const f = fixture({ folder: root }); const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => !f.state.scanning); assert.equal(entries, 100001); assert.match(f.state.error, /100000/); assert.equal(repeated.reads, 1); f.local.destroy();
});
for (const action of ["append", "pause", "seek", "stop", "replace", "leave"]) test("pending browser EOF: " + action, async () => {
    const tail = deferred(), f = fixture({ folder: folder([file("first.mp4"), file("second.mp4", tail.promise)]) });
    const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => f.starts.length === 1); f.local.ended(f.starts[0].row.id);
    assert.equal(f.starts.length, 1);
    if (["pause", "seek", "stop"].includes(action)) f.local.interrupt();
    if (action === "replace") f.local.choose(f.rows[0].id, false);
    if (action === "leave") f.local.leave();
    const count = f.starts.length;
    tail.resolve(); await until(() => action === "leave" || !f.state.scanning);
    assert.equal(f.starts.length, count + (action === "append" ? 1 : 0));
    f.local.destroy();
});
test("saved exact browser file is read before enumeration and keeps its bookmark after reopen", async () => {
    const first = file("first.mp4"), selected = file("selected.mp4"), root = folder([first, selected]);
    const f = fixture({ folder: root }); const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => !f.state.scanning); const chosen = f.rows[1].id;
    f.local.choose(chosen, false); f.local.checkpoint(chosen, 47); f.local.destroy();
    first.reads = selected.reads = 0;
    const blocked = deferred(); root.values = () => ({ next: () => blocked.promise });
    const restored = fixture({ values: f.values, dbRecords: f.dbRecords });
    restored.local.select(id, false, true, false); await until(() => restored.starts.length === 1);
    assert.equal(restored.starts[0].row.id, chosen); assert.equal(restored.starts[0].resume, true); assert.equal(restored.state.position, 47);
    assert.equal(first.reads, 0); assert.equal(selected.reads, 1);
    restored.local.destroy(); blocked.resolve({ done: true });
});
test("multiple picked files do not wait for later permissions and keep same-name grants distinct", async () => {
    const permission = deferred(), a = file("same.mp4"), b = file("same.mp4"), f = fixture();
    b.queryPermission = () => permission.promise;
    f.env.showOpenFilePicker = async () => [a, b];
    const id = await f.local.importFiles(); f.local.select(id, false, false, true);
    await until(() => f.starts.length === 1); assert.equal(a.reads, 1); assert.equal(b.reads, 0);
    permission.resolve("granted"); await until(() => !f.state.scanning);
    assert.equal(f.rows.length, 2); assert.notEqual(f.rows[0].id, f.rows[1].id);
    const chosen = f.rows[1].id; f.local.choose(chosen, false); f.local.checkpoint(chosen, 19); f.local.destroy();
    const blocked = deferred(); a.queryPermission = () => blocked.promise;
    const restored = fixture({ values: f.values, dbRecords: f.dbRecords }); restored.local.select(id, false, true, false);
    await until(() => restored.starts.length === 1); assert.equal(restored.starts[0].row.id, chosen); assert.equal(restored.state.position, 19);
    restored.local.destroy(); blocked.resolve("granted");
});
for (const prompt of [false, true]) test("denied picked file preserves a readable sibling without an unauthorized prompt: " + prompt, async () => {
    const held = deferred(), denied = file("denied.mp4"), ready = file("ready.mp4", held.promise), f = fixture();
    let prompts = 0;
    denied.queryPermission = async () => "prompt";
    denied.requestPermission = async () => { prompts++; return "denied"; };
    f.env.showOpenFilePicker = async () => [denied, ready]; const id = await f.local.importFiles();
    f.local.select(id, false, false, prompt); await until(() => ready.reads === 1);
    held.resolve(); await until(() => !f.state.scanning);
    assert.equal(f.starts.length, 1); assert.equal(f.starts[0].row.name, "ready.mp4");
    assert.equal(denied.reads, 0); assert.equal(prompts, prompt ? 1 : 0);
    assert.match(f.state.error, /permission/i); assert.match(f.state.error, /denied\.mp4/);
    denied.queryPermission = async () => "granted";
    f.local.select(id, false, false, false); await until(() => !f.state.scanning);
    assert.equal(f.rows.length, 2); assert.equal(f.state.error, ""); f.local.destroy();
});
test("revoked picked file read preserves other readable files", async () => {
    const held = deferred(), denied = file("revoked.mp4"), ready = file("ready.mp4", held.promise), f = fixture();
    denied.getFile = async () => { const failure = new Error("revoked"); failure.name = "NotAllowedError"; throw failure; };
    f.env.showOpenFilePicker = async () => [denied, ready]; const id = await f.local.importFiles();
    f.local.select(id, false, false, false); await until(() => ready.reads === 1);
    held.resolve(); await until(() => !f.state.scanning);
    assert.equal(f.starts.length, 1); assert.equal(f.rows[0].name, "ready.mp4");
    assert.match(f.state.error, /revoked\.mp4/); f.local.destroy();
});
test("partial browser tail becomes visible while an unrelated read remains held", async () => {
    const tail = deferred(), blocked = deferred(), second = file("second.mp4", tail.promise), held = file("held.mp4", blocked.promise);
    const f = fixture({ folder: folder([file("first.mp4"), second, held]) });
    const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => f.starts.length === 1 && second.reads === 1 && held.reads === 1);
    const chosen = f.starts[0].row.id; tail.resolve(); await settled();
    f.runTimer(100);
    assert.equal(f.rows.length, 2); assert.equal(f.state.scanning, true);
    assert.equal(f.starts.length, 1); assert.equal(f.state.current, chosen);
    f.local.destroy(); blocked.resolve(); await settled();
});
test("notification timer cannot publish a partial browser tail after cancellation", async () => {
    const tail = deferred(), blocked = deferred(), second = file("second.mp4", tail.promise);
    const f = fixture({ folder: folder([file("first.mp4"), second, file("held.mp4", blocked.promise)]) });
    const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => f.starts.length === 1 && second.reads === 1); tail.resolve(); await settled();
    const notification = [...f.timers.values()].find(timer => timer.delay === 100);
    assert(notification, "partial tail owns one bounded notification timer");
    f.local.leave(); const changes = f.changes.length;
    notification.callback(); blocked.resolve(); await settled();
    assert.equal(f.changes.length, changes); assert.equal(f.starts.length, 1); assert.equal(f.timers.size, 0); f.local.destroy();
});
test("delayed preferred file remains the head while ready siblings stay unplayed", async () => {
    const held = deferred(), preferred = file("preferred.mp4", held.promise), other = file("other.mp4");
    const values = { "ottplay2:local:v1": JSON.stringify({ version: 1, sources: [{ id: "saved", name: "Movies", kind: "browser" }], selected: "saved", current: "saved:preferred.mp4", position: 9, shuffle: true }) };
    const f = fixture({ values, dbRecords: new Map([["saved", { id: "saved", handles: [folder([other, preferred])] }]]) });
    f.local.select("saved", true, true, false); await until(() => other.reads === 1); assert.equal(f.starts.length, 0);
    held.resolve(); await until(() => !f.state.scanning); assert.equal(f.starts[0].row.name, "preferred.mp4"); assert.equal(f.rows[0].name, "preferred.mp4");
    f.local.ended(f.starts[0].row.id); assert.equal(f.starts[1].row.name, "other.mp4"); f.local.destroy();
});
test("helper inventory makes no catalog request and preserves unknown source availability", async () => {
    const f = fixture(), id = await helper(f);
    assert.equal(f.requests.length, 1); assert.equal(f.state.sources[0].available, undefined);
    f.local.select(id, true, false, false);
    assert.equal(f.requests[1].url, endpoint + "?sourceId=movies");
    f.requests[1].respond(catalog(["a"])); await until(() => f.starts.length === 1);
    assert.equal(f.state.scanning, true); assert.equal(f.state.shuffle, true);
    await poll(f, 10000); assert.equal(f.requests.length, 3); f.requests[2].respond(catalog(["a", "b", "c"], 1, "complete"));
    await until(() => !f.state.scanning); assert.equal(f.rows.length, 3); assert.equal(f.starts.length, 1); assert.equal(f.rows[0].id, f.starts[0].row.id);
    f.local.destroy();
});
test("partial helper tail becomes visible after each response without changing the decoder", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    f.requests[1].respond(catalog(["first"])); await until(() => f.starts.length === 1);
    const chosen = f.starts[0].row.id;
    await poll(f, 10000); f.requests[2].respond(catalog(["first", "second"])); await settled();
    assert.equal(f.rows.length, 2); assert.equal(f.state.scanning, true);
    assert.equal(f.starts.length, 1); assert.equal(f.state.current, chosen);
    assert(![...f.timers.values()].some(timer => timer.delay === 100)); f.local.destroy();
});
test("explicit helper refresh restarts once, then polls the same generation without refresh", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    f.requests[1].respond(catalog(["old"], 1, "complete")); await until(() => !f.state.scanning);
    f.local.select(id, false, true, false, true);
    assert.equal(f.requests[2].url, endpoint + "?sourceId=movies&preferredId=old&refresh=true");
    f.requests[2].respond(catalog(["old"], 2, "scanning")); await until(() => f.starts.length === 2);
    await poll(f, 10000); assert.equal(f.requests[3].url, endpoint + "?sourceId=movies&preferredId=old");
    f.requests[3].respond(catalog(["old", "new"], 2, "complete")); await until(() => !f.state.scanning);
    assert.equal(f.rows.length, 2); assert.equal(f.rows[1].name, "new.mp4"); assert.equal(f.starts.length, 2); f.local.destroy();
});
test("helper backs off while playing and wakes immediately for pending EOF", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    f.requests[1].respond(catalog([])); await settled(); assert([...f.timers.values()].some(timer => timer.delay === 1000));
    await poll(f, 1000); f.requests[2].respond(catalog(["first"])); await until(() => f.starts.length === 1);
    await settled(); assert([...f.timers.values()].some(timer => timer.delay === 10000));
    f.local.ended(f.starts[0].row.id); await settled(); assert.equal(f.requests.length, 4);
    assert(![...f.timers.values()].some(timer => timer.delay === 10000));
    f.requests[3].respond(catalog(["first"])); await settled(); assert([...f.timers.values()].some(timer => timer.delay === 1000));
    f.local.interrupt(); f.local.leave(); assert.equal(f.timers.size, 0); f.local.destroy();
});
test("helper generation, ownership and token path are mandatory for early rows", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    const invalid = catalog(["outside", "other", "valid"]);
    invalid.items[0].url = "https://other.example/video"; invalid.items[1].sourceId = "other";
    delete invalid.sourceScans; f.requests[1].respond(invalid);
    await poll(f, 1000); assert.equal(f.requests.length, 3); assert.equal(f.starts.length, 0);
    invalid.sourceScans = [{ sourceId: "movies", generation: 1, state: "scanning" }]; f.requests[2].respond(invalid);
    await until(() => f.starts.length === 1); assert.equal(f.rows.length, 1); assert.equal(f.starts[0].row.name, "valid.mp4");
    await poll(f, 10000); assert.equal(f.requests.length, 4); f.requests[3].respond(catalog(["next"], 2));
    await until(() => !f.state.scanning); assert.ok(f.state.error); assert.equal(f.starts.length, 1); f.local.destroy();
});
test("helper 401 does not fall back or expose the endpoint", async () => {
    const f = fixture(), pending = f.local.connect(endpoint); f.requests[0].respond({}, 401);
    await assert.rejects(pending, /HELPER_REQUEST/); assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.state).includes("aaaa")); f.local.destroy();
});
test("helper traversal error preserves and starts its validated prefix without repeat-all wrap", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    const result = catalog(["first", "second"], 1, "error"); result.scanning = false;
    f.requests[1].respond(result); await until(() => !f.state.scanning);
    assert.equal(f.starts.length, 1); assert.equal(f.starts[0].row.name, "first.mp4");
    assert.equal(f.rows.length, 2); assert.ok(f.state.error);
    f.local.repeat(); f.local.ended(f.starts[0].row.id);
    assert.equal(f.starts.length, 2); assert.equal(f.starts[1].row.name, "second.mp4");
    f.local.ended(f.starts[1].row.id); assert.equal(f.starts.length, 2); f.local.destroy();
});
test("helper error does not authorize an unavailable source prefix", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    const result = catalog(["first"], 1, "error"); result.sources[0].available = false;
    f.requests[1].respond(result); await until(() => !f.state.scanning);
    assert.equal(f.starts.length, 0); assert.equal(f.rows.length, 0); assert.ok(f.state.error); f.local.destroy();
});
test("only matching authoritative missing proof releases saved helper selection before scan completes", async () => {
    const values = { "ottplay2:local:v1": JSON.stringify({ version: 1, sources: [{ id: "saved", name: "Movies", kind: "helper", endpoint, rootId: "movies" }], selected: "saved", current: "saved:gone", position: 9 }) };
    const f = fixture({ values }); f.local.select("saved", false, true, false);
    assert.equal(f.requests[0].url, endpoint + "?sourceId=movies&preferredId=gone");
    let result = catalog(["ready"]); result.preferred = { id: "gone", state: "pending" };
    f.requests[0].respond(result); await poll(f, 1000); assert.equal(f.starts.length, 0);
    result = catalog(["ready"]); result.preferred = { id: "other", state: "missing" };
    f.requests[1].respond(result); await poll(f, 1000); assert.equal(f.starts.length, 0);
    result = catalog(["ready"]); result.preferred = { id: "gone", state: "missing" };
    f.requests[2].respond(result); await until(() => f.starts.length === 1);
    assert.equal(f.starts[0].row.name, "ready.mp4"); assert.equal(f.starts[0].resume, false);
    assert.equal(f.local.snapshot().position, 0); assert.equal(f.state.scanning, true); f.local.destroy();
});
test("missing helper selection starts a newly discovered prefix in the same response", async () => {
    const values = { "ottplay2:local:v1": JSON.stringify({ version: 1, sources: [{ id: "saved", name: "Movies", kind: "helper", endpoint, rootId: "movies" }], selected: "saved", current: "saved:gone", position: 9 }) };
    const f = fixture({ values }); f.local.select("saved", false, true, false);
    const result = catalog(["ready"]); result.preferred = { id: "gone", state: "missing" };
    f.requests[0].respond(result); await until(() => f.starts.length === 1);
    assert.equal(f.starts[0].row.name, "ready.mp4"); assert.equal(f.starts[0].resume, false); assert.equal(f.state.scanning, true); f.local.destroy();
});
test("helper pending generation cannot publish a stale saved row", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    f.requests[1].respond(catalog(["stale"], 1, "pending"));
    await poll(f, 1000); assert.equal(f.requests.length, 3); assert.equal(f.starts.length, 0);
    f.requests[2].respond(catalog(["validated"], 1, "complete"));
    await until(() => !f.state.scanning); assert.equal(f.starts.length, 1); assert.equal(f.rows[0].name, "validated.mp4"); f.local.destroy();
});
test("legacy helper inventory only falls back on unsupported endpoint", async () => {
    const f = fixture(), pending = f.local.connect(endpoint); f.requests[0].respond({}, 404);
    await until(() => f.requests.length === 2); assert.equal(f.requests[1].url, endpoint);
    f.requests[1].respond({ sources: [{ id: "movies", name: "Movies" }] }); await pending;
    assert.equal(f.state.sources.length, 1); f.local.destroy();
});
test("cancel retires in-flight helper response and cannot publish a late source", async () => {
    const f = fixture(), id = await helper(f); f.local.select(id, false, false, false);
    f.local.leave(); assert.equal(f.requests[1].aborted, true); f.requests[1].respond(catalog(["late"]));
    await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.starts.length, 0); f.local.destroy();
});
test("object URLs are created only for selection, old selection is released, and originals reopen", async () => {
    const first = file("first.mp4"), second = file("second.mp4"), f = fixture({ folder: folder([first, second]) });
    const id = await f.local.importFolder(); f.local.select(id, false, false, true); await until(() => !f.state.scanning);
    assert.equal(f.created.length, 0);
    function resolve(row) { return new Promise((done, reject) => f.local.resolve(row, (error, result) => error ? reject(error) : done(result))); }
    await resolve(f.rows[0]); await resolve(f.rows[1]); assert.equal(f.created.length, 2); assert.equal(f.revoked.length, 1);
    await resolve(f.rows[0]); assert.equal(first.reads, 2); f.local.destroy(); assert.equal(f.revoked.length, 3);
});
test("playback reopens use independent admission while four catalog reads are stalled", async () => {
    const held = Array.from({ length: 4 }, deferred), ready = file("ready.mp4"), stalled = held.map((wait, index) => file("blocked-" + index + ".mp4", wait.promise));
    const f = fixture({ folder: folder([ready, ...stalled]) }); const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => stalled.every(handle => handle.reads === 1)); assert.equal(f.state.scanning, true);
    const row = f.starts[0].row;
    await new Promise((done, reject) => f.local.resolve(row, (error, result) => error ? reject(error) : done(result)));
    await new Promise((done, reject) => f.local.resolve(row, (error, result) => error ? reject(error) : done(result)));
    assert.equal(ready.reads, 2); assert.equal(f.created.length, 2); assert.equal(f.state.scanning, true);
    f.local.destroy(); held.forEach(wait => wait.resolve()); await settled();
});
test("retired playback reopens retain both slots; queued replacements cancel without I/O", async () => {
    const original = file("ready.mp4"), f = fixture({ folder: folder([original]) }); const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => !f.state.scanning); const row = f.rows[0];
    await new Promise(done => f.local.resolve(row, done));
    let inFlight = 0, maximum = 0, callbacks = 0, cancel; const held = [];
    original.getFile = async () => { const wait = deferred(); held.push(wait); inFlight++; maximum = Math.max(maximum, inFlight); await wait.promise; inFlight--; return { name: "ready.mp4", type: "video/mp4" }; };
    for (let i = 0; i < 20; i++) { if (cancel) cancel(); cancel = f.local.resolve(row, () => callbacks++); await settled(); }
    assert.equal(held.length, 2); assert.equal(maximum, 2); assert.equal(callbacks, 0);
    cancel(); held.forEach(wait => wait.resolve()); await settled(); assert.equal(held.length, 2); assert.equal(inFlight, 0); assert.equal(callbacks, 0); assert.equal(f.created.length, 1);
    f.local.destroy();
});
for (const repeat of ["off", "all", "one"]) test("completed browser queue repeat " + repeat, async () => {
    const f = fixture({ folder: folder([file("first.mp4")]) }); const id = await f.local.importFolder(); f.local.select(id, false, false, true);
    await until(() => !f.state.scanning); while (f.state.repeat !== repeat) f.local.repeat();
    f.local.ended(f.rows[0].id); assert.equal(f.starts.length, repeat === "off" ? 1 : 2); f.local.destroy();
});
