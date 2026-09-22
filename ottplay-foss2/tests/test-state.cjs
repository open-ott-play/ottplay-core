const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");

const code = fs.readFileSync(path.join(__dirname, "../src/state.js"), "utf8");
acorn.parse(code, { ecmaVersion: 5 });
let state; const modules = {};
const sandbox = vm.createContext({ OTT2: { define(name, factory) {
    modules[name] = factory(id => modules[id]); if (name === "state") state = modules[name];
} } });
vm.runInContext("Promise = undefined; fetch = undefined; Map = undefined; Set = undefined; URL = undefined; Object.assign = undefined;", sandbox);
require("./load-core.cjs")(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/security.js"), "utf8"), sandbox);
vm.runInContext(code, sandbox);
const plain = (value) => JSON.parse(JSON.stringify(value));

function memory(initial) {
    let stored = initial || "";
    const writes = [];
    return { writes, getItem(key) { assert.equal(key, state.key); return stored; },
        setItem(key, value) { assert.equal(key, state.key); stored = value; writes.push(value); } };
}
function populated() {
    const value = plain(state.defaults());
    value.sources = [
        { id: "source-a", name: "My URL source", type: "m3u", url: "https://provider.test/list?token=secret-url", text: "", username: "name-secret", password: "password-secret", mac: "mac-secret" },
        { id: "source-b", name: "My pasted source", type: "m3u", url: "", text: "#EXTM3U\n#EXTINF:-1,Channel\nhttps://stream.test/a?secret=paste-secret" }
    ];
    value.activeSourceId = "source-b";
    value.lastChannel = { sourceId: "source-a", id: "source-a:one" };
    value.favorites = { default: ["source-a:one"], Sports: ["source-b:one"] };
    value.activeFavorites = "Sports";
    value.history = [{ id: "source-a:one", name: "Channel", time: 1000 }];
    value.bookmarks = { "source-b:one": 120 };
    value.settings.epgUrl = "https://provider.test/epg?key=secret-epg";
    return value;
}

for (const storage of [undefined, { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } }, memory("{broken"), memory('{"schema":999,"sources":[]}')]) {
    const repository = state.create(storage);
    assert.equal(repository.snapshot().sources.length, 0);
    assert.equal(repository.status().persistent, false);
    repository.update((draft) => { draft.settings.language = "en"; });
    assert.equal(repository.snapshot().settings.language, "en", "Storage failure cannot prevent in-memory settings");
}
const quota = state.create({ getItem() { return ""; }, setItem() { throw new Error("QuotaExceededError"); } });
quota.update((draft) => { draft.settings.fontFamily = "Caveat"; });
assert.equal(quota.snapshot().settings.fontFamily, "Caveat");
assert.equal(quota.status().persistent, false);

const persisted = memory();
const repository = state.create(persisted);
repository.importJSON(JSON.stringify(populated()));
assert.equal(repository.status().persistent, true);
assert.equal(state.create(persisted).snapshot().activeSourceId, "source-b");
const before = repository.snapshot();
const writesBefore = persisted.writes.length;
const malformed = ["{", "null", '{"schema":2,"sources":[]}', JSON.stringify({ schema: 1, sources: "wrong" })];
for (const change of [
    (v) => { v.sources[0].id = "__proto__"; },
    (v) => { v.sources[0].id = "constructor"; },
    (v) => { v.sources[0].id = "prototype"; },
    (v) => { v.sources[1].id = v.sources[0].id; },
    (v) => { v.sources[0].type = "unsupported"; },
    (v) => { v.sources[0].url = "javascript:alert(1)"; },
    (v) => { v.sources[0].text = false; },
    (v) => { v.sources[0].text = { source: "incorrect" }; },
    (v) => { v.favorites.default = "incorrect"; }
]) { const incoming = populated(); change(incoming); malformed.push(JSON.stringify(incoming)); }
for (const incoming of malformed) {
    assert.throws(() => repository.importJSON(incoming), "Reject malformed import atomically");
    assert.deepEqual(plain(repository.snapshot()), plain(before));
    assert.equal(persisted.writes.length, writesBefore, "No storage writes on rejected import");
}
assert.throws(() => repository.update((draft) => { draft.sources[0].id = "constructor"; }));
assert.deepEqual(plain(repository.snapshot()), plain(before));
assert.equal({}.polluted, undefined);

const publicExport = repository.exportJSON(false);
for (const secret of ["secret-url", "paste-secret", "password-secret", "name-secret", "mac-secret", "secret-epg", "https://provider.test", "https://stream.test"]) {
    assert(!publicExport.includes(secret), "Public export excludes source data: " + secret);
}
const publicData = JSON.parse(publicExport);
assert.deepEqual(publicData.sources, []);
assert.equal(publicData.activeSourceId, "");
assert.equal(publicData.lastChannel, null, "An export without sources cannot retain a playback source reference");
assert.equal(publicData.settings.epgUrl, "");
assert.equal(publicData.settings.language, before.settings.language);
assert.deepEqual(publicData.favorites, plain(before.favorites), "Personal selections survive an export without source secrets");
const fullExport = repository.exportJSON(true);
for (const secret of ["secret-url", "paste-secret", "password-secret", "name-secret", "mac-secret", "secret-epg"]) {
    assert(fullExport.includes(secret), "Explicit full export retains source data: " + secret);
}
assert.equal(state.create(memory(fullExport)).snapshot().activeSourceId, "source-b");
assert.deepEqual(plain(state.create(memory(fullExport)).snapshot().lastChannel), plain(before.lastChannel));

let notified = 0;
const unsubscribe = repository.subscribe((snapshot) => { notified++; snapshot.favorites.Sports.push("external-mutation"); });
repository.update((draft) => { draft.favorites.Sports.push("source-b:two"); });
assert.deepEqual(plain(repository.snapshot().favorites.default), ["source-a:one"]);
assert.deepEqual(plain(repository.snapshot().favorites.Sports), ["source-b:one", "source-b:two"]);
repository.update((draft) => { draft.activeFavorites = "default"; });
assert.equal(repository.snapshot().activeFavorites, "default");
unsubscribe(); unsubscribe();
repository.update((draft) => { draft.settings.fontFamily = "Roboto"; });
assert.equal(notified, 2);
const detached = repository.snapshot();
detached.sources[0].password = "changed outside";
detached.history[0].name = "changed outside";
detached.favorites.default.push("changed outside");
assert.equal(repository.snapshot().sources[0].password, "password-secret");
assert.equal(repository.snapshot().history[0].name, "Channel");
assert.deepEqual(plain(repository.snapshot().favorites.default), ["source-a:one"]);

let retainedDraft;
repository.update((draft) => { retainedDraft = draft; draft.history[0].name = "Saved title"; });
retainedDraft.history[0].name = "Late mutation";
assert.equal(repository.snapshot().history[0].name, "Saved title", "The update callback cannot retain a mutable internal reference");
const input = populated();
input.history[0].url = "https://private.test/media?secret=metadata-secret";
const validated = state.validate(input);
input.history[0].name = "External mutation";
assert.equal(validated.history[0].name, "Channel", "Validation returns independent canonical history records");
assert.equal(validated.history[0].url, undefined, "History cannot smuggle source URLs into a credential-free export");
console.log("PASS: ES5 state storage recovery, atomic import, secret-free/full export, source safety, favorites isolation and detached state");


const test = require("node:test");

test("fresh settings choose condensed TV typography and automatic stream handling", () => {
    const snapshot = state.create(memory()).snapshot(), settings = snapshot.settings;
    assert.equal(snapshot.lastChannel, null);
    assert.equal(settings.restore, true);
    assert.equal(settings.startupVersion, 1);
    assert.equal(settings.fontFamily, "RobotoCondensed");
    assert.equal(settings.interfaceVersion, 2);
    assert.equal(settings.playerEngine, "auto");
    assert.equal(settings.streamFormat, "auto");
    assert.equal(settings.language, "en");
});

test("old startup defaults migrate once and retain the saved playback source", () => {
    for (const version of [undefined, null, 0, "1"]) {
        const legacy = populated();
        legacy.settings.startupVersion = version;
        legacy.settings.restore = false;
        const store = memory(JSON.stringify(legacy)), migrated = state.create(store);
        assert.equal(migrated.snapshot().settings.restore, true);
        assert.equal(migrated.snapshot().settings.startupVersion, 1);
        assert.deepEqual(plain(migrated.snapshot().lastChannel), legacy.lastChannel);
        migrated.update(draft => { draft.settings.restore = false; });
        const reopened = state.create(store).snapshot();
        assert.equal(reopened.settings.restore, false, "An explicit choice after migration remains disabled");
        assert.equal(reopened.settings.startupVersion, 1);
        assert.deepEqual(plain(reopened.lastChannel), legacy.lastChannel, "Disabling automatic playback preserves the remembered channel");
    }
});

test("explicit startup opt-out survives validation, storage and import", () => {
    const value = populated();
    value.settings.restore = false;
    value.settings.startupVersion = 1;
    const store = memory(JSON.stringify(value)), repo = state.create(store);
    assert.equal(repo.snapshot().settings.restore, false);
    repo.update(draft => { draft.settings.language = "ru"; });
    assert.equal(state.create(store).snapshot().settings.restore, false);
    for (const includeCredentials of [false, true]) {
        const imported = state.create(memory());
        imported.importJSON(repo.exportJSON(includeCredentials));
        assert.equal(imported.snapshot().settings.restore, false);
        assert.equal(imported.snapshot().settings.startupVersion, 1);
    }
});

test("remembered channels retain detached identifiers and bounded matching metadata", () => {
    const input = populated();
    input.lastChannel = {
        sourceId: "source-a", id: "source-a:one", name: "Original channel", tvgId: "channel-1", tvgName: " Channel One ", group: "News",
        url: "https://provider.test/play?token=transient-secret", token: "transient-token",
        programme: { title: "Transient EPG", start: 1000 }, position: 40
    };
    const checked = state.validate(input);
    assert.deepEqual(plain(checked.lastChannel), { sourceId: "source-a", id: "source-a:one", name: "Original channel", tvgId: "channel-1", tvgName: "Channel One", group: "News" });
    assert.equal(checked.activeSourceId, "source-b", "Browsing another source does not change the last playback source");
    input.lastChannel.id = "changed outside";
    assert.equal(checked.lastChannel.id, "source-a:one");
    const repo = state.create(memory(JSON.stringify(checked)));
    const snapshot = repo.snapshot();
    snapshot.lastChannel.id = "changed snapshot";
    assert.equal(repo.snapshot().lastChannel.id, "source-a:one");
    assert(!repo.exportJSON(true).includes("transient"), "Resolved stream URLs and programme data are never persisted in the channel reference");
});

test("startup matching metadata rejects nonstrings and bounds every supported field", () => {
    const input = populated();
    input.lastChannel = {sourceId:"source-a", id:"source-a:one", tvgId:"t".repeat(600), tvgName:"n".repeat(600), name:"c".repeat(600), group:"g".repeat(600)};
    const checked = state.validate(input);
    for (const field of ["tvgId", "tvgName", "name", "group"]) assert.equal(checked.lastChannel[field].length, 512);
    for (const invalid of [null, false, 42, {}, ["News"], "   "]) {
        input.lastChannel = {sourceId:"source-a", id:"source-a:one", tvgId:invalid, tvgName:invalid, name:invalid, group:invalid};
        assert.deepEqual(plain(state.validate(input).lastChannel), {sourceId:"source-a", id:"source-a:one"});
    }
    input.lastChannel = checked.lastChannel;
    const repo = state.create(memory(JSON.stringify(input)));
    assert.deepEqual(plain(state.create(memory(repo.exportJSON(true))).snapshot().lastChannel), plain(checked.lastChannel));
    assert.equal(JSON.parse(repo.exportJSON(false)).lastChannel, null);
});

test("malformed and unknown playback references are discarded without losing valid settings", () => {
    const malformed = [
        undefined, null, false, 12, "source-a:one", [], {},
        { id: "source-a:one" }, { sourceId: "source-a" },
        { sourceId: "missing-source", id: "source-a:one" },
        { sourceId: "__proto__", id: "source-a:one" },
        { sourceId: "constructor", id: "source-a:one" },
        { sourceId: "prototype", id: "source-a:one" },
        { sourceId: ["source-a"], id: "source-a:one" },
        ...[undefined, null, false, 12, [], {}, "", "__proto__", "constructor", "prototype"].map(id => ({ sourceId: "source-a", id }))
    ];
    for (const lastChannel of malformed) {
        const input = populated();
        input.lastChannel = lastChannel;
        const checked = state.validate(input);
        assert.equal(checked.lastChannel, null);
        assert.equal(checked.sources.length, 2);
        assert.equal(checked.activeSourceId, "source-b");
        assert.equal(checked.settings.restore, true);
    }
});

test("removing a remembered source clears its playback reference", () => {
    const store = memory(JSON.stringify(populated())), repo = state.create(store);
    repo.update(draft => { draft.sources = draft.sources.filter(source => source.id !== "source-a"); });
    assert.equal(repo.snapshot().lastChannel, null);
    assert.equal(state.create(store).snapshot().lastChannel, null);
    assert.equal(repo.snapshot().activeSourceId, "source-b");
});

test("opaque channel identifiers up to 4096 characters survive full export", () => {
    for (const id of ["a", "source-a:folder/item?edition=2#entry", "source-a:" + "x".repeat(4087)]) {
        const input = populated();
        input.lastChannel = { sourceId: "source-a", id };
        const repo = state.create(memory(JSON.stringify(input)));
        assert.deepEqual(plain(repo.snapshot().lastChannel), input.lastChannel);
        assert.deepEqual(plain(state.create(memory(repo.exportJSON(true))).snapshot().lastChannel), input.lastChannel);
        assert.equal(JSON.parse(repo.exportJSON(false)).lastChannel, null);
    }
    const input = populated();
    input.lastChannel.id = "x".repeat(4097);
    assert.equal(state.validate(input).lastChannel, null);
});

test("engine and stream format choices validate and survive storage and full export", () => {
    for (const engine of ["auto", "native", "hls.js", "shaka", "mpegts"]) {
        for (const format of ["auto", "hls", "dash", "mpegts", "flv", "file"]) {
            const store = memory(), repo = state.create(store);
            repo.update(draft => { draft.settings.playerEngine = engine; draft.settings.streamFormat = format; });
            const saved = state.create(store).snapshot().settings;
            assert.equal(saved.playerEngine, engine);
            assert.equal(saved.streamFormat, format);
            const imported = state.create(memory(repo.exportJSON(true))).snapshot().settings;
            assert.equal(imported.playerEngine, engine);
            assert.equal(imported.streamFormat, format);
        }
    }
});

test("unsupported engine and format values normalize safely to Auto", () => {
    for (const value of [undefined, null, true, 123, {}, [], "__proto__", "native;alert(1)", "HLS"]) {
        const input = populated();
        input.settings.playerEngine = value; input.settings.streamFormat = value;
        const checked = state.validate(input);
        assert.equal(checked.settings.playerEngine, "auto");
        assert.equal(checked.settings.streamFormat, "auto");
        assert.equal(checked.activeSourceId, input.activeSourceId);
        assert.equal(checked.sources.length, input.sources.length);
    }
});

test("old system-font defaults migrate once while retaining explicit font selections", () => {
    const legacy = populated();
    delete legacy.settings.interfaceVersion;
    delete legacy.settings.playerEngine;
    delete legacy.settings.streamFormat;
    legacy.settings.fontFamily = "system";
    legacy.settings.language = "ru";
    legacy.settings.fontScale = 1.15;
    const store = memory(JSON.stringify(legacy)), migrated = state.create(store);
    assert.equal(migrated.snapshot().settings.fontFamily, "RobotoCondensed");
    assert.equal(migrated.snapshot().settings.interfaceVersion, 2);
    assert.equal(migrated.snapshot().settings.playerEngine, "auto");
    assert.equal(migrated.snapshot().settings.streamFormat, "auto");
    assert.equal(migrated.snapshot().settings.language, "ru");
    assert.equal(migrated.snapshot().settings.fontScale, 1.15);
    assert.equal(migrated.snapshot().sources[0].password, "password-secret");
    migrated.update(draft => { draft.settings.fontFamily = "system"; });
    assert.equal(state.create(store).snapshot().settings.fontFamily, "system", "A subsequent explicit System choice is not migrated again");
    for (const font of ["Roboto", "RobotoCondensed", "Caveat", "Liberation", "Gabriela", "PTSansNarrow"]) {
        legacy.settings.fontFamily = font;
        const saved = state.create(memory(JSON.stringify(legacy))).snapshot();
        assert.equal(saved.settings.fontFamily, font);
        assert.equal(saved.settings.language, "ru");
    }
});

test('Previous channel and bounded playback preferences validate, migrate and respect source deletion and export', () => {
    const input = state.defaults();
    input.sources = [{id:'source',name:'Source',type:'m3u',url:'https://fixture.invalid/list',text:''}];
    input.previousChannel = {sourceId:'source',id:'source:old',name:'Old',url:'secret-stream'};
    input.playbackPreferences = Array.from({length:205}, (_,i) => ({reference:{sourceId:'source',id:'source:'+i,name:'Channel '+i,url:'secret-stream'},audio:{language:'ru',label:'Russian',id:'1',backend:'native',url:'secret-track'},subtitle:{off:true},aspect:'4:3',zoom:1.25}));
    const checked = state.validate(input);
    assert.equal(checked.playbackPreferences.length,200);
    assert.equal(checked.previousChannel.url,undefined);
    assert.equal(checked.playbackPreferences[0].audio.url,undefined);
    const repo = state.create(memory(JSON.stringify(checked)));
    const exported = JSON.parse(repo.exportJSON(false));
    assert.equal(exported.previousChannel,null); assert.deepEqual(exported.playbackPreferences,[]);
    assert.equal(state.create(memory(repo.exportJSON(true))).snapshot().playbackPreferences[0].audio.language,'ru');
    repo.update(value => { value.sources=[]; });
    assert.equal(repo.snapshot().previousChannel,null); assert.equal(repo.snapshot().playbackPreferences.length,0);
    const malformed = state.defaults(); malformed.sources=input.sources;
    malformed.playbackPreferences=[null,{reference:{sourceId:'source',id:'__proto__'}},{reference:{sourceId:'absent',id:'x'}},{reference:{sourceId:'source',id:'ok'},audio:{id:'nan',backend:'broken'},subtitle:{off:true},aspect:'unknown',zoom:999}];
    const clean=state.validate(malformed);
    assert.equal(clean.playbackPreferences.length,1); assert.equal(clean.playbackPreferences[0].audio,undefined);
    assert.equal(clean.playbackPreferences[0].aspect,undefined); assert.equal(clean.playbackPreferences[0].zoom,undefined);
});


test("captured durable state normalization preserves all public records and errors", () => {
    const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/state/browser-state-before-core.json"), "utf8"));
    for (const row of cases) {
        let actual;
        try { actual = { value: plain(state.validate(row.input)) }; }
        catch (error) { actual = { error: { name: error.name, message: error.message } }; }
        assert.deepEqual(actual, row.expected, row.name);
    }
});
