"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function fixture(options = {}) {
    const modules = {}, nodes = {}, handlers = {}, timers = new Map(), sourceCalls = [], resolveCalls = [], browseCalls = [], guideCalls = [], toasts = [], mediaLoads = [];
    let securityClock = Date.now();
    let timerId = 0, viewAction, model, stored, media, controller, destroyViewCalls = 0, destroyMediaCalls = 0, dialogCalls = 0, dialog = false, dialogTitle = "", selectedId = "", focusedId = "", menuOpen = false;
    const ids = ["foss2-home", "player-video", "player-osd", "player-status", "player-title", "player-home", "player-pause", "player-stop", "player-fullscreen", "player-stage", "player-info-hitarea", "player-programme-title", "player-programme-time", "player-programme-details", "player-description", "player-next"];
    for (const id of ids) nodes[id] = { id, style: {}, textContent: "", onclick: null, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    nodes["player-description"].tagName = "P";
    nodes["player-description"].parentNode = nodes["player-programme-details"];
    nodes["player-programme-details"].parentNode = nodes["player-osd"];
    const listeners = {}, documentListeners = {};
    const video = nodes["player-video"];
    Object.assign(video, {
        src: "", currentTime: 0, duration: 300, readyState: 4, volume: 1, muted: false, playCalls: 0,
        addEventListener(name, callback) { (listeners[name] || (listeners[name] = [])).push(callback); },
        removeEventListener(name, callback) { listeners[name] = (listeners[name] || []).filter(x => x !== callback); },
        removeAttribute(name) { if (name === "src") { this.src = ""; this.currentTime = 0; } },
        canPlayType() { return ""; },
        play() { this.playCalls++; if (options.playError) throw options.playError; }, pause() {}, load() {},
        fire(name) { for (const callback of (listeners[name] || []).slice()) callback({ type: name }); }
    });
    const document = {
        body: { style: {} }, documentElement: { clientWidth: 1280, clientHeight: 720 }, activeElement: null,
        getElementById(id) { return nodes[id] || null; }, fullscreenElement: null, exits: 0,
        addEventListener(name, callback) { (documentListeners[name] || (documentListeners[name] = [])).push(callback); },
        removeEventListener(name, callback) { documentListeners[name] = (documentListeners[name] || []).filter(value => value !== callback); },
        fire(name) { for (const callback of (documentListeners[name] || []).slice()) callback({type:name}); },
        exitFullscreen() { this.exits++; this.fullscreenElement = null; }
    };
    nodes["player-stage"].requestFullscreen = function () { document.fullscreenElement = this; };
    const environment = {
        document, innerWidth: 1280, innerHeight: 720,
        localStorage: { getItem() { return stored; }, setItem(key, value) { stored = value; } },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        addEventListener(name, callback) { handlers[name] = callback; },
        removeEventListener(name, callback) { if (handlers[name] === callback) delete handlers[name]; },
        OTT2: { define(name, factory) { modules[name] = factory(id => modules[id]); } }
    };
    Object.assign(environment, options.environment || {});
    environment.window = environment;
    const context = vm.createContext(environment);
    require("./load-core.cjs")(context);
    for (const file of ["security", "library", "channel-identity", "features", "playback-preferences", "playback-view", "playback-info", "state", "media", "devices"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/" + file + ".js"), "utf8"), context);
    const securityCreate = modules.security.create;
    modules.security.create = function (config) { config.now = () => securityClock; return securityCreate(config); };
    const createMedia = modules.media.create;
    modules.media = { create(config) {
        media = createMedia(config);
        const load = media.load, destroy = media.destroy;
        media.destroy = function () { destroyMediaCalls++; return destroy(); };
        media.load = function (channel, selection) { mediaLoads.push({ channel, selection }); return load(channel, selection); };
        return media;
    } };
    const defaults = modules.state.defaults();
    defaults.sources = [{ id: "source", name: "Source", type: "m3u", url: "https://media.example/playlist.m3u", text: "" }];
    defaults.activeSourceId = "source";
    if (options.language) defaults.settings.language = options.language;
    Object.assign(defaults.settings, options.settings || {});
    if (options.protected) { const gate = modules.security.create({getState: () => defaults, persist: value => { defaults.security = value; }}); gate.configure("", "1234"); gate.verify("1234"); gate.setProtected("source:live", true); gate.lock(); }
    if (options.bookmark) defaults.bookmarks["source:film"] = options.bookmark;
    if (options.lastChannel) defaults.lastChannel = options.lastChannel;
    stored = JSON.stringify(options.saved || defaults);
    const devices = modules.devices;
    modules.devices = {
        detect: devices.detect, init: devices.init, keyCode: devices.keyCode,
        normalize(event, profile) { return event.command || devices.normalize(event, profile); }
    };
    modules.transport = { create() { return function (url, callback, requestOptions) { const call = {url, callback, options: requestOptions, cancelled: false}; guideCalls.push(call); return function () { call.cancelled = true; }; }; } };
    modules.providers = { httpUrl(value) { return /^https?:\/\//.test(value || '') ? value : ''; }, create() { return {
        load(source, callback) { const call = { source, callback, cancelled: false }; sourceCalls.push(call); return function () { call.cancelled = true; }; },
        resolve(channel, callback) { const call = { channel, callback, cancelled: false }; resolveCalls.push(call); return function () { call.cancelled = true; }; },
        browse(source, node, callback) { const call = { source, node, callback, cancelled: false }; browseCalls.push(call); return function () { call.cancelled = true; }; }
    }; } };
    modules.epg = options.epg || {};
    modules.view = { create(config) {
        viewAction = config.onAction;
        return {
            render(value) { model = value; }, dialog(title) { dialogCalls++; if (dialog && config.onDialogClose) config.onDialogClose(); dialog = true; dialogTitle = title; }, closeDialog() { if (dialog && config.onDialogClose) config.onDialogClose(); dialog = false; }, hasDialog() { return dialog; }, focus(id) { focusedId = id; },
            selectedChannelId() { return selectedId; },
            setMenuOpen(value) { menuOpen = value; },
            focusChannel(id, fallback) { const rows = model.rows; const match = rows.findIndex(row => row.id === id); const index = match >= 0 ? match : Math.max(0, Math.min(rows.length - 1, fallback || 0)); if (rows[index]) { selectedId = rows[index].id; focusedId = 'channel-' + index; } },
            previewRect() { return options.preview && model.homeVisible && model.currentChannel && ['tv','favorites'].includes(model.screen) ? {left:900,top:120,width:320,height:180} : null; },
            btn() { return ""; }, field() { return ""; }, escape(value) { return String(value); },
            toast(message) { toasts.push(message); }, destroy() { destroyViewCalls++; this.closeDialog(); },
            command(command) { if (dialog && command === "back") { this.closeDialog(); return true; } return dialog || model.homeVisible && ["left", "right", "up", "down", "ok"].includes(command); }
        };
    } };
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8"), context);
    controller = modules.app.start(environment);
    const live = { id: "source:live", name: "Live", kind: "live", url: "https://media.example/live.mp4", group: "News" };
    const film = { id: "source:film", name: "Film", kind: "vod", url: "https://media.example/film.mp4", group: "Movies" };
    if (!options.deferSource) sourceCalls[0].callback(null, { channels: [live, film].concat(options.extraChannels || []), epgUrls: options.epgUrls || [], warnings: [] });
    return {
        controller, nodes, document, video, media, environment, timers, sourceCalls, resolveCalls, browseCalls, guideCalls, toasts, mediaLoads, live, film,
        action(name, value, values) { viewAction(name, value, values); },
        key(command, extra = {}) { handlers.keydown(Object.assign({ command, preventDefault() {} }, extra)); },
        keyDown(keyCode, extra = {}) { const event = Object.assign({ keyCode, preventDefault() { this.defaultPrevented = true; } }, extra); if (handlers.keydown) handlers.keydown(event); return event; },
        keyUp(keyCode, extra = {}) { if (handlers.keyup) handlers.keyup(Object.assign({ keyCode }, extra)); },
        press(keyCode, extra = {}) { const event = this.keyDown(keyCode, extra); this.keyUp(keyCode, extra); return event; },
        blur() { if (handlers.blur) handlers.blur(); },
        fireWindow(name) { if (handlers[name]) handlers[name]({ type: name }); },
        resolve(index = resolveCalls.length - 1) { const call = resolveCalls[index]; call.callback(null, { url: call.channel.url }); },
        runDelay(delay) { const entry = Array.from(timers.entries()).find(x => x[1].delay === delay); assert.ok(entry); timers.delete(entry[0]); entry[1].callback(); },
        advance(milliseconds) { securityClock += milliseconds; },
        get selectedId() { return selectedId; }, get focusedId() { return focusedId; }, get menuOpen() { return menuOpen; }, get saved() { return JSON.parse(stored); }, get hasDialog() { return dialog; }, get dialogCalls() { return dialogCalls; }, get model() { return model; }, get destroyViewCalls() { return destroyViewCalls; }, get destroyMediaCalls() { return destroyMediaCalls; }, get dialogTitle() { return dialogTitle; }, get listenerNames() { return Object.keys(handlers); }, get documentListenerCount() { return Object.values(documentListeners).reduce((count, entries) => count + entries.length, 0); }
    };
}

test("VOD resume consumes the bookmark before synchronous seek events", () => {
    const f = fixture({ bookmark: 75 });
    f.action("resume", f.film.id); f.resolve();
    assert.doesNotThrow(() => f.video.fire("playing"));
    assert.equal(f.video.currentTime, 75);
    assert.equal(f.saved.history[0].id, f.film.id);
    assert.equal(f.saved.history.length, 1);
    f.controller.destroy();
});

test("playing hides the view model as well as the DOM so keys reach playback", () => {
    const f = fixture();
    f.action("play", f.film.id); f.resolve(); f.video.fire("playing");
    assert.equal(f.model.homeVisible, false);
    f.video.currentTime = 20;
    f.key("right");
    assert.equal(f.video.currentTime, 35);
    f.press(80);
    assert.equal(f.media.getState().state, "paused");
    f.press(80);
    assert.equal(f.video.playCalls, 2);
    f.key(null, { keyCode: 82 });
    assert.equal(f.video.currentTime, 20);
    f.key(null, { keyCode: 70 });
    assert.equal(f.video.currentTime, 35);
    f.controller.destroy();
});

test("Stop invalidates an unresolved stream and pending numeric channel selection", () => {
    const f = fixture();
    f.action("play", f.live.id);
    f.key("digit2");
    f.key("stop");
    assert.equal(f.resolveCalls[0].cancelled, true);
    f.resolve(0);
    assert.equal(f.video.playCalls, 0);
    assert.equal(f.media.getState().state, "stopped");
    assert.equal(f.model.homeVisible, true);
    assert.ok(Array.from(f.timers.values()).every(timer => timer.delay !== 1200));
    f.controller.destroy();
});

test("Pause during resolution defers loading until an explicit Play", () => {
    const f = fixture();
    f.action("play", f.live.id);
    f.key("pause");
    f.resolve();
    assert.equal(f.video.playCalls, 0);
    f.nodes["player-pause"].onclick();
    assert.equal(f.video.playCalls, 1);
    assert.equal(f.video.src, f.live.url);
    f.controller.destroy();
});

test("a channel switch stops previous playback while the new URL resolves", () => {
    const f = fixture();
    f.action("play", f.film.id); f.resolve(); f.video.fire("playing");
    f.video.currentTime = 48;
    f.action("play", f.live.id);
    assert.equal(f.video.src, "");
    assert.equal(f.saved.bookmarks[f.film.id], 48);
    f.resolve();
    assert.equal(f.video.src, f.live.url);
    f.controller.destroy();
});

test("Back exits native fullscreen before rendering home outside the stage", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve();
    f.nodes["player-fullscreen"].onclick();
    assert.equal(f.document.fullscreenElement, f.nodes["player-stage"]);
    f.key("back");
    assert.equal(f.document.exits, 1);
    assert.equal(f.document.fullscreenElement, null);
    assert.equal(f.model.homeVisible, true);
    f.controller.destroy();
});

test("media failures never expose stream credentials in visible error text", () => {
    const f = fixture({ playError: { name: "NotSupportedError", message: "Failed https://media.example/user/SECRET-token/movie.mp4" } });
    f.action("play", f.live.id); f.resolve();
    assert.equal(f.media.getState().state, "error");
    assert.ok(f.nodes["player-status"].textContent.length > 0);
    assert.equal(f.nodes["player-status"].textContent.includes("SECRET"), false);
    f.controller.destroy();
});

test("switching sources clears stale channels and cancels the old resolver", () => {
    const f = fixture();
    f.action("play", f.live.id);
    f.action("loadSource", "source");
    assert.equal(f.resolveCalls[0].cancelled, true);
    assert.equal(f.model.channels.length, 0);
    assert.equal(f.model.loading, true);
    f.resolve(0);
    assert.equal(f.video.playCalls, 0);
    f.sourceCalls[1].callback(new Error("offline"));
    assert.equal(f.model.loading, false);
    f.controller.destroy();
});

test("sleep stops pending resolution and destroy clears handlers, timers and callbacks", () => {
    const f = fixture();
    f.action("play", f.live.id);
    f.action("setSleep", "15");
    f.runDelay(15 * 60000);
    f.resolve();
    assert.equal(f.video.playCalls, 0);
    f.action("play", f.film.id);
    f.controller.destroy();
    f.resolve();
    assert.equal(f.video.playCalls, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.nodes["player-pause"].onclick, null);
    assert.equal(f.destroyViewCalls, 1);
    f.controller.destroy();
    assert.equal(f.destroyViewCalls, 1);
});

test("a finished movie's bookmark stays deleted when Stop follows ended", () => {
    const f = fixture({ bookmark: 75 });
    f.action("play", f.film.id); f.resolve(); f.video.fire("playing");
    f.video.currentTime = 300; f.video.fire("ended");
    f.key("stop");
    assert.equal(f.saved.bookmarks[f.film.id], undefined);
    f.controller.destroy();
});

test("importing settings cannot reinsert the previous session's bookmark", () => {
    const f = fixture();
    f.action("play", f.film.id); f.resolve(); f.video.fire("playing");
    f.video.currentTime = 90;
    const incoming = f.saved;
    incoming.sources = []; incoming.activeSourceId = ""; incoming.bookmarks = {};
    f.action("applyImport", "", { "import-json": JSON.stringify(incoming) });
    assert.equal(f.saved.bookmarks[f.film.id], undefined);
    assert.equal(f.media.getState().state, "stopped");
    assert.equal(f.model.channels.length, 0);
    f.controller.destroy();
});


test("English is the default and an explicit Russian choice persists", () => {
    const f = fixture();
    assert.equal(f.saved.settings.language, "en");
    assert.equal(f.document.documentElement.lang, "en");
    assert.equal(f.nodes["player-home"].textContent, "Home");
    f.action("language", "ru");
    assert.equal(f.saved.settings.language, "ru");
    assert.equal(f.document.documentElement.lang, "ru");
    assert.equal(f.nodes["player-home"].textContent, "Главная");
    f.controller.destroy();
    const russian = fixture({language: "ru"});
    assert.equal(russian.model.settings.language, "ru");
    russian.controller.destroy();
});

test("protected playback and resume require a PIN, lock stops the protected stream", () => {
    const f = fixture({protected: true});
    f.action("play", f.live.id);
    assert.equal(f.resolveCalls.length, 0);
    f.action("unlock", "", {"access-pin": "0000"});
    assert.equal(f.resolveCalls.length, 0);
    f.action("unlock", "", {"access-pin": "1234"});
    assert.equal(f.resolveCalls.length, 1);
    f.resolve(); f.video.fire("playing");
    f.action("lockPIN");
    assert.equal(f.media.getState().state, "stopped");
    f.action("play", f.live.id);
    assert.equal(f.resolveCalls.length, 1);
    f.action("unlock", "", {"access-pin": "1234"});
    assert.equal(f.resolveCalls.length, 2);
    f.controller.destroy();
});

test("channel edits and hidden state persist and history metadata stays source-local", () => {
    const f = fixture();
    f.action("saveChannel", f.live.id, {"channel-name": "Edited", "channel-group": "Custom", "channel-order": "1", "channel-hidden": true});
    assert.equal(f.saved.channelOverrides[f.live.id].name, "Edited");
    assert.equal(f.model.rows.length, 0);
    f.action("unhideChannel", f.live.id);
    assert.equal(f.model.rows[0].name, "Edited");
    f.action("screen", "vod");
    assert.equal(f.model.rows[0].id, f.film.id);
    f.controller.destroy();
});

test("opening a channel reuses catalog decoration and observes edits, hiding and source replacement", () => {
    let reads = 0;
    const extra = Array.from({length: 100}, (_, i) => ({id: 'source:extra-' + i, kind: 'live', group: '', url: 'https://media.example/' + i + '.mp4', get name() { reads++; return 'Extra ' + i; }}));
    const f = fixture({extraChannels: extra});
    reads = 0;
    for (let i = 0; i < 10; i++) f.action('channel', f.live.id);
    assert.equal(reads, 0, 'Selecting one channel must not copy and sort unrelated provider records');
    assert.equal(f.dialogTitle, 'Live');
    f.action('saveChannel', f.live.id, {'channel-name': 'Hidden edit', 'channel-group': '', 'channel-order': '50', 'channel-hidden': true});
    f.action('channel', f.live.id);
    assert.equal(f.dialogTitle, 'Hidden edit', 'Explicit lookup retains hidden channels and refreshed overrides');
    f.action('resetChannel', f.live.id);
    f.action('channel', f.live.id);
    assert.equal(f.dialogTitle, 'Live');
    f.action('loadSource', 'source');
    f.sourceCalls[1].callback(null, {channels: [{...f.live, name: 'Replacement'}], epgUrls: [], warnings: []});
    f.action('channel', f.live.id);
    assert.equal(f.dialogTitle, 'Replacement', 'Replaced source arrays invalidate the decorated catalog');
    f.controller.destroy();
});

test("revisited folders keep unaffected discoveries and the final duplicate in provider order", () => {
    const folder = {id: 'source:series', sourceId: 'source', kind: 'folder', name: 'Series', group: ''};
    const episode = (id, name) => ({id: 'source:' + id, sourceId: 'source', kind: 'vod', name, group: '', url: 'https://media.example/' + id + '.mp4'});
    const f = fixture({extraChannels: [folder]});
    f.action('channel', folder.id);
    f.browseCalls[0].callback(null, {items: [episode('a', 'A'), episode('b', 'B')]});
    f.action('channel', folder.id);
    f.browseCalls[1].callback(null, {items: [episode('b', 'Stale B'), episode('c', 'C'), episode('b', 'Latest B')]});
    f.action('play', 'source:a');
    assert.equal(f.resolveCalls.at(-1).channel.name, 'A');
    assert.equal(f.resolveCalls.at(-1).channel.originalIndex, 3);
    f.action('play', 'source:c');
    assert.equal(f.resolveCalls.at(-1).channel.originalIndex, 4);
    f.action('play', 'source:b');
    assert.equal(f.resolveCalls.at(-1).channel.name, 'Latest B');
    assert.equal(f.resolveCalls.at(-1).channel.originalIndex, 5);
    f.action('favorite', 'source:b');
    assert.deepEqual(f.saved.favoriteItems['source:b'].parents, [folder.id], 'Retained items keep the path used to restore nested favorites');
    f.controller.destroy();
});

test("remembering a large folder scans earlier discoveries once", () => {
    let idReads = 0;
    const folder = {id: 'source:series', sourceId: 'source', kind: 'folder', name: 'Series', group: ''};
    const episodes = Array.from({length: 200}, (_, i) => ({get id() { idReads++; return 'source:old-' + i; }, sourceId: 'source', kind: 'vod', name: 'Old ' + i, group: ''}));
    const f = fixture({extraChannels: [folder]});
    f.action('channel', folder.id);
    f.browseCalls[0].callback(null, {items: episodes});
    f.action('channel', folder.id);
    idReads = 0;
    f.browseCalls[1].callback(null, {items: Array.from({length: 200}, (_, i) => ({id: 'source:new-' + i, sourceId: 'source', kind: 'vod', name: 'New ' + i, group: ''}))});
    assert(idReads <= episodes.length * 2, 'Folder size must not multiply scans of previously discovered records: ' + idReads);
    f.action('channel', 'source:old-199');
    assert.equal(f.dialogTitle, 'Old 199');
    f.action('channel', 'source:new-199');
    assert.equal(f.dialogTitle, 'New 199');
    f.controller.destroy();
});


test("a paused protected stream and delayed resolver recheck an expired PIN grant", () => {
    const f = fixture({protected: true});
    f.action("play", f.live.id); f.action("unlock", "", {"access-pin": "1234"});
    f.advance(6 * 60000); f.resolve();
    assert.equal(f.video.playCalls, 0, "An old resolver may not consume an expired grant");
    f.action("unlock", "", {"access-pin": "1234"}); f.video.fire("playing");
    assert.equal(f.video.playCalls, 1);
    f.key("pause"); f.advance(6 * 60000); f.key("play");
    assert.equal(f.video.playCalls, 1, "Resume must reauthorize");
    f.action("unlock", "", {"access-pin": "1234"});
    assert.equal(f.video.playCalls, 2);
    f.controller.destroy();
});


test("first PIN setup can protect the channel that opened the setup flow", () => {
    const f = fixture();
    f.action("protectChannel", f.live.id);
    f.action("configurePIN", "", {"pin-new":"5678", "pin-repeat":"5678", "pin-channel":f.live.id});
    assert.equal(f.saved.security.enabled, true);
    assert.deepEqual(f.saved.security.protectedIds, [f.live.id]);
    f.action("play", f.live.id);
    assert.equal(f.resolveCalls.length, 0);
    f.action("unlock", "", {"access-pin":"5678"});
    assert.equal(f.resolveCalls.length, 1);
    f.controller.destroy();
});


test("saved engine and format are forwarded to each resolved stream and survive restart", () => {
    const f = fixture({ settings: { playerEngine: "native", streamFormat: "file" } });
    f.action("play", f.live.id); f.resolve();
    assert.deepEqual(JSON.parse(JSON.stringify(f.mediaLoads[0].selection)), { engine: "native", format: "file" });
    assert.equal(f.media.getState().engine, "native");
    assert.equal(f.media.getState().formatPreference, "file");
    f.action("selectEngine", "auto"); f.action("selectFormat", "auto");
    const saved = f.saved;
    f.controller.destroy();
    const restarted = fixture({ saved });
    restarted.action("play", restarted.film.id); restarted.resolve();
    assert.deepEqual(JSON.parse(JSON.stringify(restarted.mediaLoads[0].selection)), { engine: "auto", format: "auto" });
    restarted.controller.destroy();
});

test("engine changes during resolution apply only to the resulting stream", () => {
    const f = fixture();
    f.action("play", f.live.id);
    f.action("selectEngine", "native"); f.action("selectFormat", "file");
    assert.equal(f.mediaLoads.length, 0);
    assert.equal(f.video.playCalls, 0);
    f.resolve();
    assert.deepEqual(JSON.parse(JSON.stringify(f.mediaLoads[0].selection)), { engine: "native", format: "file" });
    assert.equal(f.video.playCalls, 1);
    f.controller.destroy();
});

test("paused unresolved playback retains a changed engine until explicit Play", () => {
    const f = fixture();
    f.action("play", f.live.id); f.key("pause"); f.resolve();
    f.action("selectEngine", "native"); f.action("selectFormat", "file");
    assert.equal(f.mediaLoads.length, 0);
    assert.equal(f.video.playCalls, 0);
    f.action("closeDialog"); f.key("play");
    assert.equal(f.video.playCalls, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.mediaLoads[0].selection)), { engine: "native", format: "file" });
    f.controller.destroy();
});

test("expired PIN grants prevent engine and format changes until successful authorization", () => {
    for (const [action, value, field] of [["selectEngine", "native", "playerEngine"], ["selectFormat", "file", "streamFormat"]]) {
        const f = fixture({ protected: true });
        f.action("play", f.live.id); f.action("unlock", "", { "access-pin": "1234" });
        f.resolve(); f.video.fire("playing");
        f.advance(6 * 60000);
        f.action(action, value);
        assert.equal(f.hasDialog, true);
        assert.equal(f.saved.settings[field], "auto", "Expired access cannot change the saved playback preference");
        assert.equal(f.video.playCalls, 1, "Expired access cannot restart a protected channel through an engine change");
        f.action("unlock", "", { "access-pin": "9999" });
        assert.equal(f.saved.settings[field], "auto");
        assert.equal(f.video.playCalls, 1);
        f.action("unlock", "", { "access-pin": "1234" });
        assert.equal(f.saved.settings[field], value);
        assert.equal(f.video.playCalls, 2);
        f.controller.destroy();
    }
});

test("changing engine or format after Stop persists preferences without reviving playback", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing"); f.key("stop");
    f.action("selectEngine", "native"); f.action("selectFormat", "file");
    assert.equal(f.saved.settings.playerEngine, "native");
    assert.equal(f.saved.settings.streamFormat, "file");
    assert.equal(f.media.getState().state, "stopped");
    assert.equal(f.video.src, "");
    assert.equal(f.video.playCalls, 1);
    f.action("selectEngine", "not-an-engine"); f.action("selectFormat", "not-a-format");
    assert.equal(f.saved.settings.playerEngine, "native");
    assert.equal(f.saved.settings.streamFormat, "file");
    assert.equal(f.video.playCalls, 1);
    f.controller.destroy();
});

test("the app uses condensed TV typography by default and preserves a chosen font", () => {
    const f = fixture();
    assert.equal(f.model.settings.fontFamily, "RobotoCondensed");
    assert.match(f.document.body.style.fontFamily, /RobotoCondensed/);
    f.action("font", "Gabriela");
    assert.equal(f.saved.settings.fontFamily, "Gabriela");
    const saved = f.saved;
    f.controller.destroy();
    const restarted = fixture({ saved });
    assert.equal(restarted.model.settings.fontFamily, "Gabriela");
    assert.match(restarted.document.body.style.fontFamily, /Gabriela/);
    restarted.controller.destroy();
});

test('EPG priority is explicit settings, playlist header, then built-in metadata-only request', () => {
    const automatic = fixture();
    assert.equal(automatic.guideCalls[0].url, 'https://cdn.epg.one/epg2.xml.gz');
    assert.equal(automatic.guideCalls[0].options.builtinEPG, true);
    assert.equal(automatic.guideCalls[0].options.channels.length, 1);
    assert.equal('url' in automatic.guideCalls[0].options.channels[0], false);
    assert.match(automatic.model.epgStatus, /loading/);
    automatic.controller.destroy();
    assert.equal(automatic.guideCalls[0].cancelled, true);
    const playlist = fixture({epgUrls:['https://guide.example/from-header.xml']});
    assert.equal(playlist.guideCalls[0].url, 'https://guide.example/from-header.xml');
    assert.equal(playlist.guideCalls[0].options.builtinEPG, false);
    const explicit = fixture({epgUrls:['https://guide.example/from-header.xml'], settings:{epgUrls:['https://guide.example/chosen.xml']}});
    assert.equal(explicit.guideCalls[0].url, 'https://guide.example/chosen.xml');
    explicit.action('saveEPG', '', {'epg-url-value':''});
    assert.equal(explicit.guideCalls[0].cancelled, true);
    assert.equal(explicit.guideCalls[1].url, 'https://guide.example/from-header.xml');
    assert.equal(explicit.saved.settings.epgUrl, '');
    playlist.controller.destroy(); explicit.controller.destroy();
});

test('EPG updates behind dialogs, reports safe errors, and rejects stale source responses', () => {
    const programmes = [{start:1,end:9e9,title:'Current'}, {start:9e9,end:9e9+60,title:'Next'}];
    const parsings = [];
    const epg = {
        parseXML(text, parser, url) { parsings.push(url); return {text}; },
        mergeGuides(guides) { return guides[0]; },
        matchMetadata(channel) { return channel.kind === 'live' ? {logo:'https://guide.example/news.png'} : null; },
        matchChannel(channel) { return channel.kind === 'live' ? programmes : []; },
        currentNext(entries) { return {current:entries[0],next:entries[1]}; }
    };
    const f = fixture({epg});
    f.action('epgSource');
    f.guideCalls[0].callback(null, '<tv/>');
    assert.equal(f.hasDialog, true);
    assert.equal(f.model.logosById[f.live.id], 'https://guide.example/news.png');
    assert.equal(f.model.nowById[f.live.id].title, 'Current');
    assert.equal(f.model.nextById[f.live.id].title, 'Next');
    assert.match(f.model.epgStatus, /1 channels.*1 on now/);
    assert.equal(parsings[0], 'https://cdn.epg.one/epg2.xml.gz');
    f.action('refreshEPG');
    f.guideCalls[1].callback(Object.assign(new Error('https://private.example/?token=secret'), {code:'NETWORK'}));
    assert.match(f.model.epgStatus, /network/);
    assert.equal(f.model.epgStatus.includes('secret'), false);
    f.action('refreshEPG');
    const late = f.guideCalls[2];
    f.action('loadSource', 'source');
    assert.equal(late.cancelled, true);
    late.callback(null, '<tv/>');
    assert.equal(parsings.length, 1);
    assert.equal(f.model.nowById[f.live.id], undefined);
    f.controller.destroy();
});


test("returning to the channel list preserves the live media session and focuses its page", () => {
    const extraChannels = Array.from({length:26}, (_, i) => ({id:'source:extra-' + i, name:'Extra ' + i, kind:'live', group:'Other', url:'https://media.example/' + i + '.mp4'}));
    const f = fixture({preview:true,extraChannels});
    const channel = extraChannels[20];
    f.action('play', channel.id); f.resolve(); f.video.fire('playing'); f.video.currentTime = 45;
    const loads = f.mediaLoads.length, resolves = f.resolveCalls.length, playCalls = f.video.playCalls;
    f.key('back');
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.model.currentChannel.id, channel.id);
    assert.equal(f.selectedId, channel.id);
    const playingIndex = 21, size = f.model.pageSize;
    assert.ok(size >= 20, 'normal TV text uses a dense channel page');
    assert.equal(f.model.page, Math.floor(playingIndex / size));
    assert.equal(f.focusedId, 'channel-' + playingIndex % size);
    assert.equal(f.video.src, channel.url);
    assert.equal(f.video.currentTime, 45);
    assert.equal(f.media.getState().state, 'playing');
    assert.equal(f.nodes['player-stage'].style.width, '320px');
    assert.equal(f.nodes['player-stage'].style.zIndex, '1501');
    assert.equal(f.nodes['player-osd'].style.display, 'none');
    const lastPage = Math.ceil(f.model.filteredTotal / size) - 1;
    f.action('channelPage', String(lastPage), {rowIndex:size - 1});
    assert.equal(f.focusedId, 'channel-' + (f.model.rows.length - 1), 'short final page clamps the cursor');
    assert.equal(f.model.currentChannel.id, channel.id);
    f.action('resumePlayback');
    assert.equal(f.model.homeVisible, false);
    assert.equal(f.nodes['player-stage'].style.width, '');
    assert.equal(f.video.currentTime, 45);
    assert.equal(f.mediaLoads.length, loads);
    assert.equal(f.resolveCalls.length, resolves);
    assert.equal(f.video.playCalls, playCalls);
    f.nodes['player-home'].onclick();
    assert.equal(f.selectedId, channel.id, 'return uses playing channel, not last browsed channel');
    assert.equal(f.model.page, Math.floor(playingIndex / size));
    f.controller.destroy();
});

test("browsing preserves pause and handles a resolver that completes behind the list", () => {
    const f = fixture({preview:true});
    f.action('play', f.live.id);
    f.nodes['player-home'].onclick();
    assert.equal(f.model.homeVisible, true);
    f.resolve(); f.video.fire('playing');
    assert.equal(f.nodes['player-osd'].style.display, 'none');
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.nodes['player-stage'].style.width, '320px');
    f.action('resumePlayback'); f.key('pause');
    const playCalls = f.video.playCalls;
    f.key('back'); f.action('resumePlayback');
    assert.equal(f.media.getState().state, 'paused');
    assert.equal(f.video.playCalls, playCalls);
    f.key('back'); f.action('screen','sources');
    assert.equal(f.nodes['player-stage'].style.width, '', 'no floating rectangle over another screen');
    assert.equal(f.video.src, f.live.url);
    f.controller.destroy();
});

test("video clicks toggle channel preview and window playback without retuning or changing pause", () => {
    const f = fixture({preview:true,extraChannels:[{id:'source:other',name:'Other',kind:'live',url:'https://media.example/other.mp4'}]});
    f.action('play', f.live.id); f.resolve(); f.video.fire('playing'); f.video.currentTime = 38;
    const loads = f.mediaLoads.length, playCalls = f.video.playCalls, resolves = f.resolveCalls.length;
    f.nodes['player-fullscreen'].onclick();
    f.video.onclick();
    assert.equal(f.document.fullscreenElement, null, 'Video click exits native fullscreen before showing channels');
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.focusedId, 'channel-0');
    assert.equal(f.nodes['player-stage'].style.width, '320px');
    f.action('channelPage', '0', {rowIndex:1});
    f.key('pause');
    f.video.onclick();
    assert.equal(f.model.homeVisible, false, 'Preview click expands the current video to the whole application window');
    assert.equal(f.nodes['player-stage'].style.width, '', 'Expanded video leaves the preview rectangle');
    assert.equal(f.document.fullscreenElement, null, 'Preview expansion does not request native fullscreen');
    assert.equal(f.model.currentChannel.id, f.live.id, 'The highlighted channel does not replace the playing stream');
    assert.equal(f.media.getState().state, 'paused', 'Preview expansion cannot resume a paused stream');
    assert.equal(f.video.currentTime, 38);
    assert.equal(f.video.src, f.live.url);
    assert.equal(f.mediaLoads.length, loads);
    assert.equal(f.resolveCalls.length, resolves);
    assert.equal(f.video.playCalls, playCalls);
    f.video.onclick();
    assert.equal(f.model.homeVisible, true, 'Clicking window playback returns to the channel list');
    assert.equal(f.selectedId, f.live.id, 'Returning to the list selects the actual playing channel');
    assert.equal(f.nodes['player-stage'].style.width, '320px');
    assert.equal(f.media.getState().state, 'paused');
    assert.equal(f.mediaLoads.length, loads);
    assert.equal(f.video.playCalls, playCalls);
    f.action('resumePlayback'); f.key('menu');
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.menuOpen, true, 'Remote Menu opens sections from playback');
    f.video.onclick();
    assert.equal(f.menuOpen, false, 'Preview expansion closes the sections menu');
    assert.equal(f.model.homeVisible, false);
    f.video.onclick();
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.menuOpen, false, 'The video returns to a channel list with sections collapsed');
    f.action('favorite', f.live.id);
    f.key('back');
    f.action('screen', 'favorites');
    f.video.onclick();
    assert.equal(f.model.homeVisible, false, 'A favorites preview also expands into window playback');
    assert.equal(f.media.getState().state, 'paused');
    f.video.onclick();
    assert.equal(f.model.screen, 'favorites', 'The favorite channel returns to its favorites list');
    assert.equal(f.selectedId, f.live.id);
    assert.equal(f.mediaLoads.length, loads);
    assert.equal(f.video.playCalls, playCalls);
    f.controller.destroy();
    assert.equal(f.video.onclick, null);
});

test("L toggles fullscreen once per press and recovers after keyboard focus leaves the window", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    f.keyDown(76, {code:"KeyL", keyCode:76});
    assert.equal(f.document.fullscreenElement, f.nodes["player-stage"]);
    f.keyDown(76, {code:"KeyL", keyCode:76, repeat:true});
    f.keyDown(76, {code:"KeyL", keyCode:76});
    assert.equal(f.document.fullscreenElement, f.nodes["player-stage"], "Both modern repeat and legacy held-key repeats are ignored");
    f.keyUp(76, {code:"KeyL", keyCode:76});
    f.press(76, {code:"KeyL", keyCode:76});
    assert.equal(f.document.fullscreenElement, null);
    f.keyDown(76, {code:"KeyL", keyCode:76});
    f.blur();
    f.press(76, {code:"KeyL", keyCode:76});
    assert.equal(f.document.fullscreenElement, null, "A lost keyup does not disable the shortcut after window blur");
    assert.equal(f.mediaLoads.length, 1);
    assert.equal(f.video.playCalls, 1);
    f.controller.destroy();
});

test("Escape exits fullscreen only, then windowed Escape asks to exit with No selected", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing"); f.video.currentTime = 38;
    f.press(76);
    f.press(27);
    assert.equal(f.document.fullscreenElement, null);
    assert.equal(f.hasDialog, false);
    assert.equal(f.model.homeVisible, false);
    f.press(27);
    assert.equal(f.hasDialog, true);
    assert.equal(f.dialogTitle, "Exit player?");
    assert.equal(f.focusedId, "quit-no");
    assert.equal(f.nodes["player-osd"].style.display, "none");
    f.press(27);
    assert.equal(f.hasDialog, false, "Escape cancels the confirmation rather than confirming it");
    assert.equal(f.video.currentTime, 38);
    assert.equal(f.video.playCalls, 1);
    assert.equal(f.mediaLoads.length, 1);
    f.controller.destroy();
});

test("Browser-consumed fullscreen Escape cannot fall through into quit confirmation", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    f.press(76);
    f.document.fullscreenElement = null;
    f.document.fire("fullscreenchange");
    f.press(27);
    assert.equal(f.hasDialog, false, "A late keydown from the native fullscreen exit is consumed");
    f.press(27);
    assert.equal(f.hasDialog, true, "A separate Escape press in windowed mode still asks to exit");
    assert.equal(f.focusedId, "quit-no");
    f.controller.destroy();
});

test("Declining windowed Exit preserves an unresolved stream and a pause requested before resolution", () => {
    const f = fixture();
    f.action("play", f.live.id); f.key("pause");
    f.press(27);
    assert.equal(f.dialogTitle, "Exit player?");
    f.action("cancelQuit");
    assert.equal(f.hasDialog, false);
    assert.equal(f.resolveCalls[0].cancelled, false);
    f.resolve();
    assert.equal(f.mediaLoads.length, 0, "The resolved stream remains pending while paused");
    f.key("play");
    assert.equal(f.mediaLoads.length, 1);
    assert.equal(f.video.src, f.live.url);
    assert.equal(f.resolveCalls.length, 1);
    f.controller.destroy();
});

test("Declining windowed Exit keeps an already paused channel paused at its current position", () => {
    const f = fixture();
    f.action("play", f.film.id); f.resolve(); f.video.fire("playing"); f.video.currentTime = 76;
    f.key("pause");
    const playCalls = f.video.playCalls;
    f.press(27); f.action("cancelQuit");
    assert.equal(f.media.getState().state, "paused");
    assert.equal(f.video.currentTime, 76);
    assert.equal(f.video.playCalls, playCalls);
    assert.equal(f.mediaLoads.length, 1);
    f.runDelay(6000);
    assert.equal(f.nodes["player-osd"].style.display, "none", "Information still auto-hides while playback is paused");
    f.controller.destroy();
});

test("Numeric Q exits immediately, destroys exactly once and cancels pending work when window.close throws", () => {
    let closeCalls = 0;
    const f = fixture({environment:{close() { closeCalls++; throw new Error("This browser cannot close a user-opened tab"); }}});
    f.action("play", f.live.id);
    f.key("digit1"); f.action("setSleep", "15");
    assert.ok(f.timers.size >= 3);
    assert.doesNotThrow(() => f.press(81, {key:"й", code:"Unidentified"}));
    assert.equal(f.dialogCalls, 0, "Q must not open an exit confirmation");
    assert.equal(f.hasDialog, false);
    assert.equal(closeCalls, 1);
    assert.equal(f.destroyViewCalls, 1);
    assert.equal(f.destroyMediaCalls, 1);
    assert.equal(f.resolveCalls[0].cancelled, true);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.listenerNames, []);
    assert.equal(f.documentListenerCount, 0);
    assert.equal(f.nodes["player-stage"].style.display, "none");
    assert.match(f.nodes["foss2-home"].innerHTML, /id="player-exited"/);
    assert.match(f.nodes["foss2-home"].innerHTML, /Player closed/);
    assert.equal(f.video.src, "");
    f.resolve();
    assert.equal(f.mediaLoads.length, 0, "A late resolver callback cannot restart exited playback");
    f.action("confirmQuit"); f.controller.destroy();
    assert.equal(closeCalls, 1);
    assert.equal(f.destroyViewCalls, 1);
    assert.equal(f.destroyMediaCalls, 1);
});

test("Immediate Q preserves the last live channel and the paused VOD bookmark", () => {
    let closeCalls = 0;
    const f = fixture({environment:{close() { closeCalls++; }}});
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    const lastChannel = f.saved.lastChannel;
    f.action("play", f.film.id); f.resolve(); f.video.fire("playing");
    f.video.currentTime = 76; f.key("pause");
    f.press(81);
    assert.equal(f.dialogCalls, 0);
    assert.equal(closeCalls, 1);
    assert.equal(f.saved.bookmarks[f.film.id], 76);
    assert.deepEqual(f.saved.lastChannel, lastChannel);
    assert.equal(f.video.src, "");
    assert.equal(f.destroyMediaCalls, 1);
    assert.equal(f.destroyViewCalls, 1);
    assert.equal(f.timers.size, 0);
    f.press(81); f.action("confirmQuit"); f.controller.destroy();
    assert.equal(closeCalls, 1);
    assert.equal(f.destroyMediaCalls, 1);
});

test("Q exits fullscreen and closes an existing non-editing dialog without another confirmation", () => {
    for (const openDialog of [false, true]) {
        let closeCalls = 0;
        const f = fixture({environment:{close() { closeCalls++; }}});
        f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
        f.press(76);
        if (openDialog) f.action("search");
        const dialogs = f.dialogCalls;
        f.document.activeElement = {tagName:"BUTTON"};
        f.press(81);
        assert.equal(f.document.fullscreenElement, null);
        assert.equal(f.hasDialog, false);
        assert.equal(f.dialogCalls, dialogs, "Q cannot open an exit confirmation from fullscreen or another dialog");
        assert.equal(closeCalls, 1);
        assert.equal(f.video.src, "");
        assert.equal(f.destroyMediaCalls, 1);
        assert.deepEqual(f.listenerNames, []);
        f.controller.destroy();
    }
});

test("Unmapped LG numeric 81 cannot inherit the desktop direct-exit action", () => {
    let closeCalls = 0;
    const f = fixture({environment:{location:{pathname:"/f/lg/webos/"},close() { closeCalls++; }}});
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    assert.notEqual(f.press(81, {key:"q",code:"KeyQ"}).defaultPrevented, true);
    assert.equal(closeCalls, 0);
    assert.equal(f.destroyMediaCalls, 0);
    assert.equal(f.hasDialog, false);
    assert.equal(f.video.src, f.live.url);
    f.controller.destroy();
});

test("Profile keyboard controls leave text fields, editable content and modified browser shortcuts alone", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    for (const active of [{tagName:"INPUT"}, {tagName:"TEXTAREA"}, {tagName:"SELECT"}, {tagName:"DIV",isContentEditable:true}, {tagName:"DIV",getAttribute(name) { return name === "contenteditable" ? "true" : null; }}]) {
        f.document.activeElement = active;
        for (const [key, code] of [["q",81], ["l",76], ["i",73]]) {
            const event = f.press(code, {key});
            assert.notEqual(event.defaultPrevented, true, key + " remains editable input");
            assert.equal(f.hasDialog, false);
            assert.equal(f.document.fullscreenElement, null);
            assert.equal(f.nodes["player-osd"].attributes["data-expanded"], "false");
        }
    }
    f.document.activeElement = null;
    for (const modifier of ["ctrlKey","metaKey","altKey"]) for (const key of ["q","l","i"]) {
        const extra = {keyCode:key.toUpperCase().charCodeAt(0)}; extra[modifier] = true;
        const event = f.press(extra.keyCode, extra);
        assert.notEqual(event.defaultPrevented, true, modifier + "+" + key + " remains a browser shortcut");
        assert.equal(f.hasDialog, false);
        assert.equal(f.document.fullscreenElement, null);
    }
    f.action("search"); f.document.activeElement = {tagName:"INPUT"};
    f.press(27);
    assert.equal(f.hasDialog, false, "Escape still closes an active dialog while editing");
    assert.equal(f.video.playCalls, 1);
    f.controller.destroy();
});

test("Escape cancels an asynchronous fullscreen request and rejects its late completion", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    let complete;
    f.nodes["player-stage"].requestFullscreen = function () { return { then(success) { complete = success; } }; };
    f.press(76);
    assert.equal(typeof complete, "function");
    f.press(27);
    assert.equal(f.hasDialog, false, "The pending fullscreen Escape is not a request to quit");
    f.document.fullscreenElement = f.nodes["player-stage"];
    complete();
    assert.equal(f.document.fullscreenElement, null, "Late fulfillment immediately exits the cancelled fullscreen request");
    assert.equal(f.document.exits, 1);
    assert.equal(f.hasDialog, false);
    assert.equal(f.mediaLoads.length, 1);
    f.controller.destroy();
});

test("Arrow and page keys scroll a focused expanded description without seeking or changing channels", () => {
    const f = fixture({extraChannels:[{id:"source:other",name:"Other",kind:"live",url:"https://media.example/other.mp4"}]});
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing"); f.video.currentTime = 42;
    f.runDelay(6000); f.press(73); f.press(73);
    assert.equal(f.nodes["player-osd"].attributes["data-expanded"], "true");
    f.document.activeElement = f.nodes["player-description"];
    Object.assign(f.document.activeElement, {scrollTop:100, scrollLeft:50, clientHeight:200, scrollHeight:1200, clientWidth:200, scrollWidth:600});
    for (const [key, keyCode, top, left] of [["ArrowUp",38,60,50],["ArrowDown",40,100,50],["ArrowLeft",37,100,10],["ArrowRight",39,100,50],["PageUp",33,0,50],["PageDown",34,180,50],["Home",36,0,50],["End",35,1000,50]]) {
        const event = f.press(keyCode, {key});
        assert.equal(event.defaultPrevented, true, key + " scrolls through the selected profile");
        assert.equal(f.video.currentTime, 42);
        assert.equal(f.resolveCalls.length, 1);
        assert.equal(f.mediaLoads.length, 1);
        assert.equal(f.document.activeElement.scrollTop, top);
        assert.equal(f.document.activeElement.scrollLeft, left);
    }
    f.controller.destroy();
});

test("Tizen numeric Info, Return, Exit and Power retain distinct controller behavior", () => {
    const f = fixture({environment:{location:{pathname:"/f/samsung/tizen/"}}});
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    f.runDelay(6000);
    f.press(457, {key:"q", code:"KeyQ"});
    assert.equal(f.nodes["player-osd"].style.display, "block");
    assert.equal(f.hasDialog, false);
    f.press(457);
    assert.equal(f.nodes["player-osd"].attributes["data-expanded"], "true");
    f.press(10009, {key:"Escape"});
    assert.equal(f.model.homeVisible, true, "Return opens the browser without requesting exit");
    assert.equal(f.hasDialog, false);
    f.action("resumePlayback");
    f.nodes["player-fullscreen"].onclick();
    f.press(10182);
    assert.equal(f.document.fullscreenElement, null);
    assert.equal(f.hasDialog, false);
    f.press(10182);
    assert.equal(f.dialogTitle, "Exit player?");
    f.press(10009);
    assert.equal(f.hasDialog, false, "Return cancels the confirmation");
    const dialogs = f.dialogCalls;
    f.press(10005);
    assert.equal(f.hasDialog, false, "Tizen Power exits without confirmation");
    assert.equal(f.dialogCalls, dialogs);
    assert.equal(f.destroyMediaCalls, 1);
    assert.match(f.nodes["foss2-home"].innerHTML, /id="player-exited"/);
    assert.equal(f.video.playCalls, 1);
    assert.equal(f.mediaLoads.length, 1);
    f.controller.destroy();
});

test("Android remote description navigation uses numeric profile actions and Back remains navigation", () => {
    const f = fixture({environment:{location:{pathname:"/f/android/"}}});
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    f.video.currentTime = 42; f.press(165);
    const node = f.nodes["player-description"];
    Object.assign(node, {scrollTop:80, clientHeight:200, scrollHeight:600});
    f.document.activeElement = node;
    f.press(20, {key:"ArrowUp"}); assert.equal(node.scrollTop, 120);
    f.press(19, {key:"MediaPause"}); assert.equal(node.scrollTop, 80);
    f.press(21); f.press(22);
    assert.equal(f.video.currentTime, 42);
    assert.equal(f.media.getState().state, "playing");
    f.press(9, {key:"Tab"});
    assert.equal(f.toasts[f.toasts.length - 1], "2", "Android 9 remains digit2 instead of Tab");
    f.press(4, {key:"Escape"});
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.hasDialog, false);
    f.controller.destroy();
});

test("Maple Stop cannot become Info and Blue cannot become description PageUp", () => {
    const f = fixture({environment:{location:{pathname:"/f/samsung/maple/"}}});
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    f.press(99);
    const node = f.nodes["player-description"];
    Object.assign(node, {scrollTop:80, clientHeight:200, scrollHeight:600});
    f.document.activeElement = node;
    f.press(33, {key:"PageUp"});
    assert.equal(node.scrollTop, 80);
    f.press(73, {key:"i", code:"KeyI"});
    assert.equal(f.media.getState().state, "stopped");
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.nodes["player-osd"].style.display, "none");
    f.controller.destroy();
});

test("Remote controls recover after absent keyup and release their timers on blur and teardown", () => {
    const f = fixture({environment:{location:{pathname:"/f/lg/webos/"}}});
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing"); f.runDelay(6000);
    f.keyDown(457);
    const firstRelease = [...f.timers].find(([, entry]) => entry.delay === 350)[0];
    f.keyDown(457);
    assert.equal(f.timers.has(firstRelease), false, "A legacy repeat refreshes the release timeout");
    assert.equal(f.nodes["player-osd"].attributes["data-expanded"], "false", "A held Info does not expand the footer");
    f.runDelay(350); f.keyDown(457);
    assert.equal(f.nodes["player-osd"].attributes["data-expanded"], "true", "An independent keydown-only press works after the quiet gap");
    f.runDelay(350); f.runDelay(6000); f.keyDown(457);
    assert.equal(f.nodes["player-osd"].style.display, "block", "A lost release cannot disable Info permanently");
    f.keyUp(457);
    assert.ok([...f.timers.values()].every(entry => entry.delay !== 350));
    f.keyDown(457); f.blur();
    assert.ok([...f.timers.values()].every(entry => entry.delay !== 350));
    f.keyDown(27);
    assert.equal(f.hasDialog, true);
    f.keyDown(27);
    assert.equal(f.hasDialog, true, "A held Exit cannot cancel the dialog it opened");
    f.runDelay(350); f.keyDown(27);
    assert.equal(f.hasDialog, false, "A later Exit cancels even without a release event");
    f.runDelay(350); f.keyDown(457, {repeat:true});
    assert.equal(f.nodes["player-osd"].attributes["data-expanded"], "false", "An explicit repeat stays inert even after timeout");
    f.controller.destroy();
    assert.equal(f.timers.size, 0);
});

test("Desktop keypad digits and media keys use numeric aliases without affecting editable input", () => {
    const f = fixture();
    f.action("play", f.live.id); f.resolve(); f.video.fire("playing");
    f.press(97);
    assert.equal(f.toasts[f.toasts.length - 1], "1");
    f.press(179); assert.equal(f.media.getState().state, "paused");
    f.press(179); assert.equal(f.video.playCalls, 2);
    f.document.activeElement = {tagName:"INPUT"};
    const before = f.toasts.length;
    assert.notEqual(f.press(97).defaultPrevented, true);
    assert.equal(f.toasts.length, before);
    f.document.activeElement = null;
    f.press(178);
    assert.equal(f.media.getState().state, "stopped");
    assert.equal(f.model.homeVisible, true);
    f.controller.destroy();
});

test("Confirmed live playback is persisted before exit and restores directly into video on restart", () => {
    const first = fixture({settings:{playerEngine:"native",streamFormat:"file"}});
    first.action("play", first.live.id); first.resolve(); first.video.fire("playing");
    assert.deepEqual(first.saved.lastChannel, {sourceId:"source",id:"source:live",name:"Live",group:"News"});
    const reboot = fixture({saved:first.saved});
    assert.equal(reboot.model.homeVisible, false, "Startup enters video before the stream resolves");
    assert.equal(reboot.resolveCalls[0].channel.id, first.live.id);
    reboot.resolve(); reboot.video.fire("playing");
    assert.equal(reboot.video.playCalls, 1);
    assert.equal(reboot.mediaLoads[0].selection.engine, "native");
    assert.equal(reboot.mediaLoads[0].selection.format, "file");
    first.press(81);
    assert.deepEqual(first.saved.lastChannel, {sourceId:"source",id:"source:live",name:"Live",group:"News"});
    reboot.controller.destroy(); first.controller.destroy();
});

test("Browsing another source cannot replace the last played channel or its startup source", () => {
    const seed = fixture(), state = seed.saved; seed.controller.destroy();
    state.sources.push({id:"other",name:"Other",type:"m3u",url:"https://media.example/other.m3u",text:""});
    const first = fixture({saved:state});
    first.action("play", first.live.id); first.resolve(); first.video.fire("playing");
    first.action("loadSource", "other");
    first.sourceCalls[1].callback(null, {channels:[{id:"other:live",sourceId:"other",name:"Other Live",kind:"live",url:"https://media.example/other.mp4"}],epgUrls:[]});
    assert.equal(first.saved.activeSourceId, "other");
    assert.equal(first.saved.lastChannel.sourceId, "source");
    const reboot = fixture({saved:first.saved});
    assert.equal(reboot.sourceCalls[0].source.id, "source");
    assert.equal(reboot.resolveCalls[0].channel.id, "source:live");
    assert.equal(reboot.model.homeVisible, false);
    first.controller.destroy(); reboot.controller.destroy();
});

test("A failed channel and later VOD playback leave the last successful live channel intact", () => {
    const first = fixture({extraChannels:[{id:"source:bad",name:"Bad",kind:"live",url:"https://media.example/bad.mp4"}]});
    first.action("play", first.live.id); first.resolve(); first.video.fire("playing");
    first.action("play", "source:bad");
    first.resolveCalls[1].callback(new Error("No stream"));
    assert.equal(first.saved.lastChannel.id, first.live.id);
    first.action("play", first.film.id); first.resolve(); first.video.fire("playing");
    assert.equal(first.saved.history[0].id, first.film.id);
    assert.equal(first.saved.lastChannel.id, first.live.id);
    first.key("stop");
    assert.equal(first.saved.lastChannel.id, first.live.id);
    first.controller.destroy();
});

test("Legacy history migrates to automatic startup once while explicit opt-out remains effective", () => {
    const seed = fixture(), state = seed.saved; seed.controller.destroy();
    state.history = [{id:"source:live",name:"Live",time:Date.now()}];
    state.settings.restore = false; delete state.settings.startupVersion;
    state.sources.unshift({id:"\ud800",name:"Malformed unrelated ID",type:"m3u",url:"https://media.example/unrelated.m3u",text:""});
    const upgraded = fixture({saved:state});
    assert.equal(upgraded.saved.settings.restore, true);
    assert.equal(upgraded.sourceCalls[0].source.id, "source");
    assert.equal(upgraded.resolveCalls[0].channel.id, "source:live");
    const optedOut = upgraded.saved;
    optedOut.settings.restore = false;
    upgraded.controller.destroy();
    const reboot = fixture({saved:optedOut});
    assert.equal(reboot.model.homeVisible, true);
    assert.equal(reboot.resolveCalls.length, 0);
    reboot.controller.destroy();
});

test("Missing startup channels leave a usable list without silently selecting another channel", () => {
    const f = fixture({lastChannel:{sourceId:"source",id:"source:missing"}});
    assert.equal(f.model.homeVisible, true);
    assert.equal(f.resolveCalls.length, 0);
    assert.equal(f.model.rows.length, 1);
    assert.ok(f.toasts.some(message => /last channel is unavailable/i.test(message)));
    f.controller.destroy();
});

test("History without a live-channel reference cannot guess another source or turn missing VOD into live playback", () => {
    for (const id of ["deleted:m3u:tvg:live", "source:xtream:vod:42", "source:m3u:tvg:live"]) {
        const seed = fixture(), state = seed.saved; seed.controller.destroy();
        state.lastChannel = null;
        state.history = [{id,name:"Live",time:1}];
        const f = fixture({saved:state,deferSource:true});
        f.sourceCalls[0].callback(null,{channels:[{...f.live,tvgId:"live"}],epgUrls:[]});
        assert.equal(f.model.homeVisible,true,id);
        assert.equal(f.resolveCalls.length,0,id);
        assert.equal(f.saved.lastChannel,null);
        f.controller.destroy();
    }
});

test("History-only startup still restores an exact VOD ID and its bookmark", () => {
    const seed = fixture(), state = seed.saved; seed.controller.destroy();
    state.lastChannel = null;
    state.history = [{id:"source:film",name:"Film",time:1}];
    state.bookmarks["source:film"] = 42;
    const f = fixture({saved:state});
    assert.equal(f.resolveCalls[0].channel.kind,"vod");
    f.resolve(); f.video.fire("playing");
    assert.equal(f.video.currentTime,42);
    assert.equal(f.saved.lastChannel,null,"VOD cannot become a confirmed live reference");
    f.controller.destroy();
});

test("Legacy startup identity uses the matching history entry and resolves the refreshed channel URL", () => {
    const seed = fixture(), state = seed.saved; seed.controller.destroy();
    state.lastChannel = {sourceId:"source",id:"source:old-live"};
    state.history = [{id:"source:film",name:"Film",time:2},{id:"source:old-live",name:"Live",time:1}];
    const f = fixture({saved:state});
    assert.equal(f.model.homeVisible, false);
    assert.equal(f.resolveCalls[0].channel.id, "source:live", "The newer VOD history entry cannot replace live identity");
    assert.equal(f.saved.lastChannel.id, "source:old-live", "Resolving alone cannot commit the new identity");
    f.resolve(); f.video.fire("playing");
    assert.equal(f.video.src, f.live.url);
    assert.deepEqual(f.saved.lastChannel, {sourceId:"source",id:"source:live",name:"Live",group:"News"});
    const next = f.saved; next.history = [];
    f.controller.destroy();
    const reboot = fixture({saved:next,deferSource:true});
    const fresh = {...reboot.live,id:"source:newest-live",url:"https://media.example/fresh.mp4?token=newest"};
    reboot.sourceCalls[0].callback(null,{channels:[fresh],epgUrls:[]});
    assert.equal(reboot.resolveCalls[0].channel.id,fresh.id,"The saved metadata works after history is cleared");
    reboot.resolve(); reboot.video.fire("playing");
    assert.equal(reboot.video.src,fresh.url);
    assert.equal(reboot.saved.lastChannel.id,fresh.id);
    assert.equal(JSON.stringify(reboot.saved.lastChannel).includes("token"),false);
    reboot.controller.destroy();
});

test("Saved startup identity uses raw provider metadata rather than custom display overrides", () => {
    const seed = fixture(), state = seed.saved; seed.controller.destroy();
    state.channelOverrides["source:live"] = {name:"My news",group:"My group",order:0,hidden:false};
    const f = fixture({saved:state,deferSource:true});
    f.sourceCalls[0].callback(null,{channels:[{...f.live,tvgId:"news",tvgName:"Provider News"}],epgUrls:[]});
    f.action("play",f.live.id);
    assert.equal(f.resolveCalls[0].channel.name,"My news");
    f.resolve(); f.video.fire("playing");
    assert.deepEqual(f.saved.lastChannel,{sourceId:"source",id:"source:live",tvgId:"news",tvgName:"Provider News",name:"Live",group:"News"});
    f.controller.destroy();
});

test("Equivalent M3U copies restore the same HD broadcast from an old reference without losing its PIN", () => {
    const oldID = "source:m3u:tvg:shared:aaaa-bbbb";
    const seed = fixture({protected:true}), state = seed.saved; seed.controller.destroy();
    state.lastChannel = {sourceId:"source",id:oldID};
    state.history = [{id:oldID,name:"Station HD",time:1}];
    state.security.protectedIds = [oldID];
    const f = fixture({saved:state,deferSource:true});
    const hd = {id:"source:m3u:tvg:shared:1111-2222",sourceId:"source",kind:"live",name:"Station HD",tvgId:"shared",tvgName:"",group:"HD",url:"https://media.example/primary.mp4?q=fresh"};
    const duplicate = {...hd,id:"source:m3u:tvg:shared:3333-4444",url:"https://media.example/secondary.mp4?q=fresh"};
    f.sourceCalls[0].callback(null,{channels:[hd,{...hd,id:"uhd",name:"Station UHD",group:"News"},{...hd,id:"sd",name:"Station",group:"Other"},duplicate],epgUrls:[]});
    assert.equal(f.dialogTitle,"PIN required");
    assert.equal(f.resolveCalls.length,0,"Equivalent copies cannot bypass authorization");
    f.action("unlock","",{"access-pin":"1234"});
    assert.equal(f.resolveCalls[0].channel.id,hd.id);
    f.resolve(); f.video.fire("playing");
    assert.equal(f.model.homeVisible,false);
    assert.equal(f.saved.lastChannel.id,hd.id);
    assert.equal(f.saved.lastChannel.name,"Station HD");
    assert.equal(f.saved.lastChannel.group,"HD");
    assert.ok(f.saved.security.protectedIds.includes(hd.id));
    f.controller.destroy();
});

test("A refreshed startup channel retains its PIN protection before resolution and on another restart", () => {
    const f = fixture({protected:true,lastChannel:{sourceId:"source",id:"source:live",name:"Live"},deferSource:true});
    const fresh = {...f.live,id:"source:fresh",sourceId:"source"};
    f.sourceCalls[0].callback(null,{channels:[fresh],epgUrls:[]});
    assert.equal(f.dialogTitle,"PIN required");
    assert.equal(f.resolveCalls.length,0);
    assert.deepEqual(f.saved.security.protectedIds,["source:fresh"], "Confirmed identity migration moves the protected ID atomically");
    f.action("unlock","",{"access-pin":"1234"});
    assert.equal(f.resolveCalls[0].channel.id,fresh.id);
    f.resolve(); f.video.fire("playing");
    assert.equal(f.saved.lastChannel.id,fresh.id);
    const next = f.saved; f.controller.destroy();
    const reboot = fixture({saved:next,deferSource:true});
    reboot.sourceCalls[0].callback(null,{channels:[fresh],epgUrls:[]});
    assert.equal(reboot.dialogTitle,"PIN required");
    assert.equal(reboot.resolveCalls.length,0);
    reboot.controller.destroy();
});

test("User navigation or a quit dialog cancels delayed automatic startup without stealing the current screen", () => {
    for (const intention of ["settings", "search", "menuLayout", "quit"]) {
        const f = fixture({lastChannel:{sourceId:"source",id:"source:live"},deferSource:true});
        if (intention === "settings") f.action("screen", "settings");
        else if (intention === "quit") f.press(27);
        else f.action(intention);
        const dialog = f.hasDialog;
        f.sourceCalls[0].callback(null, {channels:[f.live],epgUrls:[]});
        assert.equal(f.resolveCalls.length, 0, intention);
        assert.equal(f.model.homeVisible, true);
        assert.equal(f.hasDialog, dialog);
        if (intention === "settings") assert.equal(f.model.screen, "settings");
        f.controller.destroy();
    }
});

test("Failed startup and canceled source loads cannot re-arm automatic playback", () => {
    const f = fixture({lastChannel:{sourceId:"source",id:"source:live"},deferSource:true});
    f.sourceCalls[0].callback(new Error("Source unavailable"));
    f.action("loadSource", "source");
    f.sourceCalls[1].callback(null, {channels:[f.live],epgUrls:[]});
    assert.equal(f.resolveCalls.length, 0);
    assert.equal(f.model.homeVisible, true);
    f.controller.destroy();
    const delayed = fixture({lastChannel:{sourceId:"source",id:"source:live"},deferSource:true});
    delayed.action("loadSource", "source");
    delayed.sourceCalls[0].callback(null, {channels:[delayed.live],epgUrls:[]});
    assert.equal(delayed.resolveCalls.length, 0);
    delayed.sourceCalls[1].callback(null, {channels:[delayed.live],epgUrls:[]});
    assert.equal(delayed.resolveCalls.length, 0);
    delayed.controller.destroy();
});

test("Restoring a protected channel requires a new PIN before resolving or playing", () => {
    const f = fixture({protected:true,lastChannel:{sourceId:"source",id:"source:live"}});
    assert.equal(f.dialogTitle, "PIN required");
    assert.equal(f.resolveCalls.length, 0);
    f.action("unlock", "", {"access-pin":"1234"});
    assert.equal(f.model.homeVisible, false);
    assert.equal(f.resolveCalls.length, 1);
    f.resolve(); f.video.fire("playing");
    assert.equal(f.video.playCalls, 1);
    f.controller.destroy();
});

test("Autoplay denial retains its Play instruction and does not steal focus on later media events", () => {
    const f = fixture({lastChannel:{sourceId:"source",id:"source:live"}});
    let blocked = true, focused = 0;
    f.nodes["player-pause"].focus = function () { focused++; f.document.activeElement = this; };
    f.video.play = function () { this.playCalls++; if (blocked) { const error = new Error("User gesture required"); error.name = "NotAllowedError"; throw error; } };
    f.resolve();
    assert.equal(f.model.homeVisible, false);
    assert.equal(f.media.getState().state, "paused");
    assert.equal(f.nodes["player-status"].textContent, "Press Play to start playback.");
    assert.equal(f.nodes["player-osd"].style.display, "block");
    assert.ok([...f.timers.values()].every(entry => entry.delay !== 6000), "The blocked instruction cannot auto-hide");
    const focusCalls = focused;
    f.document.activeElement = {id:"player-fullscreen",tagName:"BUTTON"};
    f.video.fire("loadedmetadata"); f.media.volume(0.5);
    assert.equal(f.nodes["player-status"].textContent, "Press Play to start playback.");
    assert.equal(focused, focusCalls);
    assert.equal(f.video.muted, false);
    blocked = false; f.nodes["player-pause"].onclick(); f.video.fire("playing");
    assert.equal(f.media.getState().state, "playing");
    f.runDelay(6000);
    assert.equal(f.nodes["player-osd"].style.display, "none", "Normal startup timing returns after actual playback");
    f.controller.destroy();
});

test("Tizen dedicated audio and picture keys open playback options through numeric actions", () => {
    const f = fixture({ environment: { location: { pathname: '/f/samsung/tizen/' } } });
    f.action('play', f.live.id); f.resolve(); f.video.fire('playing');
    for (const code of [10195, 10140]) {
        assert.equal(f.press(code).defaultPrevented, true);
        assert.equal(f.dialogTitle, 'Playback options');
        f.action('closeDialog');
    }
    f.controller.destroy();
});

test("PreviousChannel toggles confirmed broadcasts instead of adjacent catalog rows", () => {
    const second = { id: 'source:second', sourceId: 'source', name: 'Second', kind: 'live', url: 'https://media.example/second.mp4' };
    const middle = { id: 'source:middle', sourceId: 'source', name: 'Middle', kind: 'live', url: 'https://media.example/middle.mp4' };
    const f = fixture({ environment: { location: { pathname: '/f/samsung/tizen/' } }, extraChannels: [middle, second] });
    f.action('play', f.live.id); f.resolve(); f.video.fire('playing');
    f.action('play', second.id); f.resolve(); f.video.fire('playing');
    assert.equal(f.saved.previousChannel.id, f.live.id);
    f.press(10190); assert.equal(f.resolveCalls.at(-1).channel.id, f.live.id);
    f.resolve(); f.video.fire('playing');
    assert.equal(f.saved.previousChannel.id, second.id);
    f.press(10190); assert.equal(f.resolveCalls.at(-1).channel.id, second.id);
    f.resolve(); f.video.fire('playing');
    const snapshot = f.saved;
    f.controller.destroy();
    const reopened = fixture({ saved: snapshot, extraChannels: [middle, second], environment: { location: { pathname: '/f/samsung/tizen/' } } });
    reopened.resolve(); reopened.video.fire('playing'); reopened.press(10190);
    assert.equal(reopened.resolveCalls.at(-1).channel.id, reopened.live.id, 'Confirmed history survives restarting the player');
    reopened.controller.destroy();
});

test("PreviousChannel explicitly restores a different source even with startup restore disabled", () => {
    const f = fixture({ settings: { restore: false } });
    f.action('play', f.live.id); f.resolve(); f.video.fire('playing');
    const snapshot = f.saved;
    snapshot.sources.push({ id: 'other', name: 'Other', type: 'm3u', url: 'https://media.example/other.m3u', text: '' });
    snapshot.previousChannel = { sourceId: 'other', id: 'other:live', name: 'Other live' };
    f.controller.destroy();
    const reopened = fixture({ saved: snapshot });
    reopened.key('previousChannel');
    assert.equal(reopened.sourceCalls.at(-1).source.id, 'other');
    const channel = { id: 'other:live', sourceId: 'other', kind: 'live', name: 'Other live', url: 'https://media.example/other.mp4' };
    reopened.sourceCalls.at(-1).callback(null, { channels: [channel], epgUrls: [] });
    assert.equal(reopened.resolveCalls.at(-1).channel.id, channel.id);
    assert.equal(reopened.saved.settings.restore, false);
    reopened.controller.destroy();
});

test("Legacy keydown repeats cannot repeatedly toggle Play/Pause, mute or PreviousChannel", () => {
    const f = fixture({ environment: { location: { pathname: '/f/samsung/tizen/' } } });
    f.action('play', f.live.id); f.resolve(); f.video.fire('playing');
    f.keyDown(10252); f.keyDown(10252);
    assert.equal(f.media.getState().paused, true);
    assert.equal(f.video.playCalls, 1);
    f.runDelay(350); f.keyDown(10252);
    assert.equal(f.video.playCalls, 2, 'A separate missing-keyup press works after the quiet gap');
    f.keyUp(10252);
    f.keyDown(449); f.keyDown(449);
    assert.equal(f.saved.settings.muted, true);
    f.keyUp(449); f.keyDown(449); assert.equal(f.saved.settings.muted, false);
    f.controller.destroy();
});

test("VOD digits seek by percentage without creating a delayed live channel change", () => {
    const f = fixture();
    f.action('play', f.film.id); f.resolve(); f.video.fire('playing');
    f.press(53); assert.equal(f.video.currentTime, 150);
    f.press(48); assert.equal(f.video.currentTime, 0);
    assert.equal(f.resolveCalls.length, 1);
    assert.ok(Array.from(f.timers.values()).every(timer => timer.delay !== 1200));
    f.controller.destroy();
});

test("Hiding or closing the page flushes VOD position and releases lifecycle listeners", () => {
    const f = fixture();
    f.action('play', f.film.id); f.resolve(); f.video.fire('playing');
    f.video.currentTime = 123; f.document.hidden = true; f.document.fire('visibilitychange');
    assert.equal(f.saved.bookmarks[f.film.id], 123);
    f.video.currentTime = 125; f.fireWindow('pagehide'); assert.equal(f.saved.bookmarks[f.film.id], 125);
    f.video.currentTime = 127; f.fireWindow('beforeunload'); assert.equal(f.saved.bookmarks[f.film.id], 127);
    f.controller.destroy(); assert.deepEqual(f.listenerNames, []); assert.equal(f.documentListenerCount, 0);
});

test("Per-channel audio, subtitles and picture choices restore after track reordering", () => {
    const f = fixture();
    f.video.audioTracks = [{ language: 'en', label: 'English', enabled: true }, { language: 'ru', label: 'Russian', enabled: false }];
    f.video.textTracks = [{ language: 'en', label: 'English', kind: 'subtitles', mode: 'showing' }];
    f.action('play', f.live.id); f.resolve(); f.video.fire('playing');
    f.action('audioTrack', '1'); f.action('subtitleTrack', 'off'); f.action('aspect', '4:3'); f.action('zoom', '1.25');
    assert.equal(f.saved.playbackPreferences[0].audio.language, 'ru');
    assert.equal(f.saved.playbackPreferences[0].subtitle.off, true);
    assert.equal(f.saved.settings.aspect, 'auto', 'Channel picture settings do not overwrite the global fallback');
    const snapshot = f.saved; f.controller.destroy();
    const reopened = fixture({ saved: snapshot });
    reopened.video.audioTracks = [{ language: 'ru', label: 'Russian stereo', enabled: false }, { language: 'en', label: 'English', enabled: true }];
    reopened.video.textTracks = [{ language: 'en', label: 'English', kind: 'subtitles', mode: 'showing' }];
    reopened.resolve(); reopened.video.fire('loadedmetadata'); reopened.video.fire('playing');
    assert.equal(reopened.video.audioTracks[0].enabled, true);
    assert.equal(reopened.video.audioTracks[1].enabled, false);
    assert.equal(reopened.video.textTracks[0].mode, 'disabled');
    assert.equal(reopened.media.getState().aspect, '4:3'); assert.equal(reopened.media.getState().zoom, 1.25);
    reopened.action('play', reopened.film.id); reopened.resolve(); reopened.video.fire('playing');
    assert.equal(reopened.media.getState().aspect, 'fit'); assert.equal(reopened.media.getState().zoom, 1);
    reopened.controller.destroy();
});

test("PreviousChannel cannot load another source through a locked source PIN scope", () => {
    const initial = fixture({ protected: true });
    const snapshot = initial.saved; initial.controller.destroy();
    snapshot.security.scopes.source = true;
    snapshot.security.protectedIds = [];
    snapshot.sources.push({id:'other',name:'Other',type:'m3u',url:'https://media.example/other.m3u',text:''});
    snapshot.previousChannel={sourceId:'other',id:'other:live',name:'Other live'};
    const f=fixture({saved:snapshot}); const before=f.sourceCalls.length;
    f.key('previousChannel');
    assert.equal(f.sourceCalls.length,before); assert.equal(f.dialogTitle,'PIN required');
    f.action('unlock','',{'access-pin':'1234'});
    assert.equal(f.sourceCalls.length,before+1); assert.equal(f.sourceCalls.at(-1).source.id,'other');
    f.controller.destroy();
});

test('Tizen Guide opens the guide during playback without resolving another stream and respects dialogs/editors', () => {
    const f = fixture({environment:{location:{pathname:'/f/samsung/tizen/'}}});
    f.action('play', f.live.id); f.resolve(); f.video.fire('playing');
    f.nodes['player-fullscreen'].onclick(); assert.equal(f.document.fullscreenElement,f.nodes['player-stage']);
    f.press(458);
    assert.equal(f.document.fullscreenElement,null);
    assert.equal(f.model.screen,'guide'); assert.equal(f.model.homeVisible,true);
    assert.equal(f.media.getState().state,'playing'); assert.equal(f.resolveCalls.length,1);
    f.action('screen','tv'); f.action('epgSource'); f.press(458);
    assert.equal(f.model.screen,'tv'); assert.equal(f.hasDialog,true);
    f.key('back'); f.document.activeElement={tagName:'INPUT'}; f.press(458);
    assert.equal(f.model.screen,'tv'); f.controller.destroy();
});

function refreshingEPG() {
    return { parseXML(text) { return {text}; }, mergeGuides(guides) { return guides[0]; },
        matchChannel() { return []; }, currentNext() { return {}; } };
}
test('EPG refreshes after thirty minutes, backs off failures, retains data and rejects stale callbacks', () => {
    let now = Date.now();
    class Clock extends Date { static now() { return now; } }
    const f = fixture({environment:{Date:Clock},epg:refreshingEPG()});
    f.guideCalls[0].callback(null,'first');
    now += 1799000; f.runDelay(30000); assert.equal(f.guideCalls.length,1);
    now += 1000; f.runDelay(30000); assert.equal(f.guideCalls.length,2);
    f.runDelay(30000); assert.equal(f.guideCalls.length,2,'No overlapping refresh');
    f.guideCalls[1].callback(Object.assign(new Error('offline'),{code:'NETWORK'}));
    now += 59000; f.runDelay(30000); assert.equal(f.guideCalls.length,2);
    now += 1000; f.runDelay(30000); assert.equal(f.guideCalls.length,3);
    f.guideCalls[2].callback(null,'second');
    f.action('refreshEPG'); const stale=f.guideCalls[3];
    f.action('loadSource','source'); stale.callback(null,'stale');
    assert.equal(stale.cancelled,true); assert.equal(f.model.loading,true);
    f.controller.destroy();
});
test('Foreground reconciles overdue EPG and built-in archive requests include bounded channel history', () => {
    let now=Date.now(); class Clock extends Date { static now() { return now; } }
    const f=fixture({environment:{Date:Clock},epg:refreshingEPG(),extraChannels:[{id:'source:archive',name:'Archive',kind:'live',catchup:{days:30}}]});
    assert.equal(f.guideCalls[0].options.channels.find(c=>c.id==='source:archive').archiveDays,7);
    f.guideCalls[0].callback(null,'guide'); f.document.hidden=true;
    now+=3600000; f.runDelay(30000); assert.equal(f.guideCalls.length,1);
    f.document.hidden=false; f.document.fire('visibilitychange'); assert.equal(f.guideCalls.length,2);
    f.controller.destroy();
});
test('TV foreground restores playback intent and position while deliberate pause stays paused', () => {
    for (const paused of [false,true]) {
        const f=fixture({environment:{location:{pathname:'/f/lg/webos/'}}});
        f.action('play',f.film.id); f.resolve(); f.video.fire('playing'); f.video.currentTime=51;
        if(paused) f.key('pause');
        const calls=f.video.playCalls;
        f.document.hidden=true; f.document.fire('visibilitychange');
        assert.equal(f.media.getState().suspended,true);
        f.video.fire('pause'); f.document.hidden=false; f.document.fire('visibilitychange');
        assert.equal(f.video.playCalls,calls+(paused?0:1));
        if(paused) { assert.equal(f.media.getState().paused,true); f.key('play'); }
        f.video.fire('loadedmetadata'); f.video.fire('playing'); assert.equal(f.video.currentTime,51);
        f.controller.destroy();
    }
});
test('TV hidden resolution defers attachment; foreground rechecks expired PIN and respects Stop', () => {
    const f=fixture({protected:true,environment:{location:{pathname:'/f/lg/webos/'}}});
    f.action('play',f.live.id); f.action('unlock','',{'access-pin':'1234'});
    f.document.hidden=true; f.document.fire('visibilitychange'); f.resolve();
    assert.equal(f.video.playCalls,0);
    f.advance(31*60000); f.document.hidden=false; f.document.fire('visibilitychange');
    assert.equal(f.video.playCalls,0); assert.equal(f.media.getState().state,'stopped');
    f.action('play',f.film.id); f.resolve(); f.video.fire('playing');
    f.document.hidden=true; f.document.fire('visibilitychange'); f.key('stop');
    const calls=f.video.playCalls; f.document.hidden=false; f.document.fire('visibilitychange');
    assert.equal(f.video.playCalls,calls); f.controller.destroy();
});

function identityPlaylist(rows) {
    const modules={}, context=vm.createContext({OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}});
    context.window=context;
    require("./load-core.cjs")(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/providers.js'),'utf8'),context);
    return JSON.parse(JSON.stringify(modules.providers.parseM3U('#EXTM3U\n'+rows.map(row=>'#EXTINF:-1 tvg-id="news" group-title="News",'+row.name+'\nhttps://media.example/'+row.path+'.mp4').join('\n'),{id:'source',type:'m3u',url:'https://media.example/list.m3u'})));
}

test('catalog variant splits reconcile favorites and PIN before startup autoplay or a manual channel selection', () => {
    const before=identityPlaylist([{name:'News HD',path:'hd'}]);
    const after=identityPlaylist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]);
    const oldId=before.channels[0].id, newId=after.channels[1].id;
    const initial=fixture({deferSource:true}); initial.sourceCalls[0].callback(null,before);
    initial.action('favorite',oldId); initial.action('closeDialog');
    initial.action('saveChannel',oldId,{'channel-name':'My News','channel-group':'Favorites','channel-order':'1','channel-hidden':false});
    initial.action('protectChannel',oldId);
    initial.action('configurePIN','',{'pin-new':'1234','pin-repeat':'1234','pin-channel':oldId});
    initial.action('play',oldId); assert.equal(initial.resolveCalls.length,0);
    initial.action('unlock','',{'access-pin':'1234'});initial.resolve();initial.video.fire('playing');
    assert.equal(initial.saved.channelReferences.find(ref=>ref.id===oldId).name,'News HD','Persistence remembers the raw provider identity, not its custom display name');
    const saved=initial.saved;initial.controller.destroy();
    const reboot=fixture({saved,deferSource:true});reboot.sourceCalls[0].callback(null,after);
    assert.equal(reboot.resolveCalls.length,0,'No provider resolve before PIN authorization');assert.equal(reboot.dialogTitle,'PIN required');
    assert.deepEqual(reboot.saved.favorites.default,[newId]);assert.deepEqual(reboot.saved.security.protectedIds,[newId]);
    assert.equal(reboot.saved.channelOverrides[newId].name,'My News');assert.equal(reboot.saved.lastChannel.id,newId);
    reboot.key('back');reboot.action('screen','favorites');
    assert.equal(reboot.model.rows.length,1);assert.equal(reboot.model.rows[0].id,newId);assert.equal(reboot.model.rows[0].name,'My News');
    reboot.action('play',newId);assert.equal(reboot.resolveCalls.length,0);assert.equal(reboot.dialogTitle,'PIN required');
    reboot.action('unlock','',{'access-pin':'1234'});assert.equal(reboot.resolveCalls.length,1);assert.equal(reboot.resolveCalls[0].channel.id,newId);
    reboot.controller.destroy();
});

test('legacy ambiguous catalog splits retain the original restriction and gate both candidates instead of guessing a favorite',()=>{
    const before=identityPlaylist([{name:'News HD',path:'hd'}]), after=identityPlaylist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]);
    const seed=fixture({protected:true}), saved=seed.saved;seed.controller.destroy();
    saved.security.protectedIds=[before.channels[0].id];saved.favorites.default=[before.channels[0].id];
    saved.channelOverrides[before.channels[0].id]={name:'My protected favorite',hidden:false};
    saved.lastChannel=null;saved.previousChannel=null;saved.history=[];saved.channelReferences=[];saved.playbackPreferences=[];
    const f=fixture({saved,deferSource:true});f.sourceCalls[0].callback(null,after);
    assert.deepEqual(f.saved.favorites.default,[before.channels[0].id]);assert.ok(f.toasts.some(text=>/need review/.test(text)));
    for(const row of after.channels) {f.action('play',row.id);assert.equal(f.dialogTitle,'PIN required');assert.equal(f.resolveCalls.length,0);f.key('back');}
    f.controller.destroy();
});

test('Equivalent built-in EPG URLs deduplicate and fractional archive days survive the request DTO', () => {
    const f=fixture({epgUrls:['http://epg.it999.ru/epg2.xml.gz','https://cdn.epg.one/epg2.xml.gz'],extraChannels:[{id:'source:half',name:'Half',kind:'live',catchup:{days:1.5}}]});
    assert.equal(f.guideCalls.length,1);
    assert.equal(f.guideCalls[0].options.channels.find(c=>c.id==='source:half').archiveDays,1.5);
    f.controller.destroy();
});

test('TV host Pause arriving before visibility cannot overwrite explicit playback intent',()=>{
    for(const paused of [false,true]) {
        const f=fixture({environment:{location:{pathname:'/f/lg/webos/'}}});
        f.action('play',f.film.id);f.resolve();f.video.fire('playing');f.video.currentTime=51;
        if(paused) f.key('pause');
        const calls=f.video.playCalls;
        f.video.paused=true;f.video.fire('pause');
        f.document.hidden=true;f.document.fire('visibilitychange');
        f.document.hidden=false;f.document.fire('visibilitychange');
        assert.equal(f.video.playCalls,calls+(paused?0:1));
        if(!paused) {f.video.paused=false;f.video.fire('loadedmetadata');f.video.fire('playing');assert.equal(f.video.currentTime,51);}
        f.controller.destroy();
    }
});
