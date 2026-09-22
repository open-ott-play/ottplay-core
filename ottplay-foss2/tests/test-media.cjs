"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/media.js"), "utf8");

function fixture(settings = {}) {
    const listeners = {};
    const timers = new Map();
    const events = [];
    let timerId = 0;
    let module;
    const video = {
        currentTime: 0,
        duration: NaN,
        readyState: 4,
        volume: 1,
        muted: false,
        src: "",
        playCalls: 0,
        pauseCalls: 0,
        loadCalls: 0,
        addEventListener(name, callback) { (listeners[name] || (listeners[name] = [])).push(callback); },
        removeEventListener(name, callback) { listeners[name] = (listeners[name] || []).filter(x => x !== callback); },
        removeAttribute(name) { if (name === "src") this.src = ""; },
        canPlayType(mime) { return settings.nativeHls && /mpegurl/i.test(mime) ? "probably" : ""; },
        play() { this.playCalls++; return settings.playResult ? settings.playResult() : undefined; },
        pause() { this.pauseCalls++; },
        load() { this.loadCalls++; },
        fire(name) { for (const callback of (listeners[name] || []).slice()) callback({ type: name }); }
    };
    const environment = {
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        Promise: undefined,
        Map: undefined,
        Set: undefined,
        URL: undefined,
        OTT2: { define(name, factory) { assert.equal(name, "media"); module = factory(); } }
    };
    Object.assign(video, settings.video || {});
    Object.assign(environment, settings.environment || {});
    environment.window = environment;
    const context = vm.createContext(environment);
    vm.runInContext("Object.assign=undefined;Object.entries=undefined;Array.from=undefined;Array.prototype.includes=undefined;", context);
    vm.runInContext(source, context, { filename: "media.js" });
    const player = module.create({ video, environment, onEvent(event) { events.push(event); }, options: settings.options || {} });
    return {
        player, video, events, listeners, timers,
        nextTimer() {
            const entry = timers.entries().next().value;
            assert.ok(entry, "Expected a pending timer");
            timers.delete(entry[0]);
            entry[1].callback();
        }
    };
}

const live = { id: "news", name: "News", kind: "live", url: "https://media.example/live.mp4" };
const vod = { id: "film", name: "Film", kind: "vod", url: "https://media.example/film.mp4" };

test("native playback works with no Promise, Map, Set, URL or Object.assign", () => {
    const f = fixture();
    assert.equal(f.player.load(live), true);
    assert.equal(f.video.src, live.url);
    assert.equal(f.video.playCalls, 1);
    f.video.fire("playing");
    assert.equal(f.player.getState().state, "playing");
    assert.equal(f.timers.size, 1, "Playing retains a no-progress watchdog");
    assert.equal(f.player.capabilities().hlsJs, false);
    f.player.destroy();
    assert.equal(f.player.getState().state, "destroyed");
    assert.equal(f.video.src, "");
    assert.ok(Object.values(f.listeners).every(list => list.length === 0));
});

test("native HLS has priority over an optional Hls backend", () => {
    function Hls() { throw new Error("The optional backend must not be invoked"); }
    Hls.isSupported = () => true;
    const f = fixture({ nativeHls: true, environment: { Hls, Promise } });
    assert.equal(f.player.load({ kind: "live", url: "https://media.example/live.m3u8" }), true);
    assert.equal(f.player.getState().backend, "native");
    assert.equal(f.video.playCalls, 1);
});

test("unsupported HLS and DASH fail visibly without crashing old runtimes", () => {
    const f = fixture();
    assert.equal(f.player.load({ kind: "live", url: "https://media.example/live.m3u8" }), false);
    assert.equal(f.events.at(-1).error.code, "hls_unsupported");
    assert.equal(f.player.load({ kind: "live", url: "https://media.example/live.mpd" }), false);
    assert.equal(f.events.at(-1).error.code, "dash_unsupported");
    assert.equal(f.video.playCalls, 0);
    assert.equal(f.timers.size, 0);
});

test("channel switches invalidate old listeners, timeouts and rejected play attempts", () => {
    const pending = [];
    const f = fixture({ playResult: () => ({ then(resolve, reject) { pending.push({ resolve, reject }); } }) });
    f.player.load(live);
    const oldPlaying = f.listeners.playing[0];
    const oldTimeout = f.timers.values().next().value.callback;
    f.player.load(vod);
    const before = f.events.length;
    oldPlaying();
    oldTimeout();
    pending[0].reject({ name: "NotAllowedError", message: "Old attempt" });
    assert.equal(f.events.length, before);
    assert.equal(f.video.src, vod.url);
    assert.equal(f.player.getState().state, "loading");
    assert.equal(f.player.getState().retries, 0);
    f.video.fire("playing");
    assert.equal(f.player.getState().state, "playing");
    assert.equal(f.timers.size, 1, "A stale callback must not discard the new generation's progress watchdog");
});

test("a live outage stops after three recovery attempts, even after intermittent playing", () => {
    const f = fixture();
    f.player.load(live);
    for (let attempt = 1; attempt <= 3; attempt++) {
        f.video.fire("playing");
        f.video.error = { code: 2 };
        f.video.fire("error");
        assert.equal(f.player.getState().retries, attempt);
        assert.equal(f.player.getState().state, "retrying");
        f.nextTimer();
    }
    f.video.fire("playing");
    f.video.error = { code: 2 };
    f.video.fire("error");
    assert.equal(f.player.getState().state, "error");
    assert.equal(f.player.getState().retries, 3);
    assert.equal(f.video.playCalls, 4);
    assert.equal(f.timers.size, 0);
});

test("VOD network failure is terminal and never retries automatically", () => {
    const f = fixture();
    f.player.load(vod);
    f.video.error = { code: 2 };
    f.video.fire("error");
    assert.equal(f.player.getState().state, "error");
    assert.equal(f.player.getState().retries, 0);
    assert.equal(f.timers.size, 0);
});

test("user pause cancels a queued recovery; explicit Play starts a fresh attempt", () => {
    const f = fixture();
    f.player.load(live);
    f.video.error = { code: 2 };
    f.video.fire("error");
    const oldRetry = f.timers.values().next().value.callback;
    f.player.pause();
    oldRetry();
    f.video.fire("waiting");
    assert.equal(f.player.getState().state, "paused");
    assert.equal(f.video.playCalls, 1);
    assert.equal(f.timers.size, 0);
    f.player.play();
    assert.equal(f.video.playCalls, 2);
    assert.equal(f.player.getState().retries, 0);
});

test("user pause survives delayed autoplay rejection and late playing event", () => {
    let rejected;
    const f = fixture({ playResult: () => ({ then(resolve, reject) { rejected = reject; } }) });
    f.player.load(live);
    f.player.pause();
    rejected({ name: "NotAllowedError" });
    const pauseCalls = f.video.pauseCalls;
    f.video.fire("playing");
    assert.equal(f.player.getState().state, "paused");
    assert.equal(f.video.pauseCalls, pauseCalls + 1);
    assert.equal(f.timers.size, 0);
});

test("autoplay denial requests a user gesture without recovery loops", () => {
    const f = fixture({ playResult: () => ({ then(resolve, reject) { reject({ name: "NotAllowedError" }); } }) });
    f.player.load(live);
    assert.equal(f.player.getState().state, "paused");
    assert.equal(f.events.at(-1).type, "autoplayblocked");
    assert.equal(f.timers.size, 0);
});

test("buffer starvation is bounded, and pause prevents watchdog restarts", () => {
    const f = fixture({ options: { stallTimeout: 50, maxRetries: NaN } });
    f.player.load(live);
    f.video.fire("playing");
    f.video.fire("waiting");
    f.nextTimer();
    assert.equal(f.player.getState().state, "retrying");
    f.player.pause();
    assert.equal(f.timers.size, 0);
    f.video.fire("stalled");
    assert.equal(f.timers.size, 0);
});

test("seek and volume clamp finite values and reject invalid numbers", () => {
    const f = fixture();
    f.player.load(vod);
    f.video.duration = 90;
    assert.equal(f.player.seek(120), true);
    assert.equal(f.video.currentTime, 90);
    assert.equal(f.player.seek(-4), true);
    assert.equal(f.video.currentTime, 0);
    assert.equal(f.player.seek(NaN), false);
    assert.equal(f.player.volume(12), true);
    assert.equal(f.video.volume, 1);
    assert.equal(f.player.volume(-3), true);
    assert.equal(f.video.volume, 0);
    assert.equal(f.player.volume(Infinity), false);
    f.player.mute(true);
    assert.equal(f.video.muted, true);
});

test("destroy invalidates callbacks and public playback operations", () => {
    const f = fixture();
    f.player.load(live);
    const oldWaiting = f.listeners.waiting[0];
    const oldTimer = f.timers.values().next().value.callback;
    f.player.destroy();
    const eventCount = f.events.length;
    oldWaiting();
    oldTimer();
    assert.equal(f.player.load(vod), false);
    assert.equal(f.player.play(), false);
    assert.equal(f.player.seek(1), false);
    f.player.destroy();
    assert.equal(f.events.length, eventCount);
    assert.equal(f.timers.size, 0);
});

test("an optional Hls adapter starts on manifest and destroys on channel switch", () => {
    const instances = [];
    function Hls() { this.handlers = {}; this.destroyCalls = 0; instances.push(this); }
    Hls.isSupported = () => true;
    Hls.Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
    Hls.ErrorTypes = { NETWORK_ERROR: "network" };
    Hls.prototype.on = function (name, callback) { this.handlers[name] = callback; };
    Hls.prototype.attachMedia = function (video) { this.video = video; };
    Hls.prototype.loadSource = function (url) { this.url = url; };
    Hls.prototype.destroy = function () { this.destroyCalls++; };
    const f = fixture({ environment: { Promise, Hls } });
    f.player.load({ kind: "live", url: "https://media.example/live.m3u8" });
    assert.equal(f.video.playCalls, 0);
    assert.equal(f.player.getState().backend, "hls.js");
    instances[0].handlers.manifest();
    assert.equal(f.video.playCalls, 1);
    f.player.load(vod);
    assert.equal(instances[0].destroyCalls, 1);
    const count = f.events.length;
    instances[0].handlers.error("error", { fatal: true, type: "network" });
    instances[0].handlers.manifest();
    assert.equal(f.events.length, count);
    assert.equal(f.video.playCalls, 2);
});

test("script and unsupported protocols never reach the media element", () => {
    const f = fixture();
    assert.equal(f.player.load({ url: "javascript:alert(1)" }), false);
    assert.equal(f.player.load({ url: "file:///private/movie.mp4" }), false);
    assert.equal(f.video.playCalls, 0);
    assert.equal(f.video.src, "");
});

test("Shaka asynchronous attachment cannot start a previous channel after a switch", () => {
    const attached = [];
    const loaded = [];
    const instances = [];
    function Player() { this.destroyCalls = 0; instances.push(this); }
    Player.isBrowserSupported = () => true;
    Player.prototype.addEventListener = function () {};
    Player.prototype.attach = function () { return { then(resolve, reject) { attached.push({ resolve, reject }); } }; };
    Player.prototype.load = function (url) { this.url = url; return { then(resolve, reject) { loaded.push({ resolve, reject }); } }; };
    Player.prototype.destroy = function () { this.destroyCalls++; };
    const f = fixture({ environment: { Promise, shaka: { Player } } });
    f.player.load({ kind: "vod", url: "https://media.example/film.mpd" });
    assert.equal(f.player.getState().backend, "shaka");
    f.player.load(vod);
    attached[0].resolve();
    assert.equal(instances[0].destroyCalls, 1);
    assert.equal(loaded.length, 0);
    assert.equal(f.video.playCalls, 1);
    f.player.load({ kind: "vod", url: "https://media.example/new.mpd" });
    attached[1].resolve();
    f.player.pause();
    loaded[0].resolve();
    assert.equal(f.video.playCalls, 1, "A completed manifest must respect the user's pause");
    f.player.play();
    assert.equal(f.video.playCalls, 2);
});

test("terminal decoder failure invalidates a delayed playing event", () => {
    const f = fixture();
    f.player.load(live);
    const playing = f.listeners.playing[0];
    f.video.error = { code: 3 };
    f.video.fire("error");
    playing();
    assert.equal(f.player.getState().state, "error");
    assert.equal(f.timers.size, 0);
});

test("native audio and subtitle selection is instance-local and preserves metadata tracks", () => {
    const audioTracks = [{ label: "English", language: "en", enabled: true }, { label: "Russian", language: "ru", enabled: false }];
    const textTracks = [{ kind: "metadata", mode: "hidden", label: "Segments" }, { kind: "subtitles", language: "en", mode: "disabled" }, { kind: "captions", language: "ru", mode: "showing" }];
    const f = fixture({ video: { audioTracks, textTracks } });
    const other = fixture();
    f.player.load(vod); other.player.load(vod);
    assert.equal(f.player.listTracks().audio.length, 2);
    assert.equal(f.player.listTracks().subtitles.length, 2);
    assert.equal(other.player.listTracks().audio.length, 0);
    assert.equal(f.player.selectAudio("1"), true);
    assert.deepEqual(audioTracks.map(t => t.enabled), [false, true]);
    assert.equal(f.player.selectSubtitle("1"), true);
    assert.deepEqual(textTracks.map(t => t.mode), ["hidden", "showing", "disabled"]);
    assert.equal(f.player.selectSubtitle("off"), true);
    assert.deepEqual(textTracks.map(t => t.mode), ["hidden", "disabled", "disabled"]);
    assert.equal(f.player.listTracks().subtitlesOff, true);
    assert.equal(f.player.selectSubtitle("0"), false);
    assert.equal(f.player.selectAudio("nonsense"), false);
    assert.equal(f.player.selectAudio(""), false);
    f.player.destroy();
    assert.equal(f.player.selectAudio("0"), false);
});

test("track-list change events are removed and invalidated at the session boundary", () => {
    const handlers = {};
    const tracks = [{ enabled: true, language: "en" }];
    tracks.addEventListener = (name, handler) => { handlers[name] = handler; };
    tracks.removeEventListener = (name, handler) => { if (handlers[name] === handler) delete handlers[name]; };
    const f = fixture({ video: { audioTracks: tracks } });
    f.player.load(vod);
    handlers.change();
    assert.equal(f.events.at(-1).type, "tracks");
    const stale = handlers.change;
    f.player.stop();
    const before = f.events.length;
    stale();
    assert.equal(f.events.length, before);
    assert.equal(Object.keys(handlers).length, 0);
});

test("HLS exposes backend tracks and subtitle off without native track interference", () => {
    let hls;
    function Hls() { hls = this; this.handlers = {}; this.audioTracks = [{ name: "Main", lang: "en" }, { name: "Commentary", lang: "en" }]; this.audioTrack = 0; this.subtitleTracks = [{ name: "English", lang: "en" }]; this.subtitleTrack = -1; }
    Hls.isSupported = () => true;
    Hls.Events = { MANIFEST_PARSED: "manifest", ERROR: "error", AUDIO_TRACK_SWITCHED: "audio" };
    Hls.ErrorTypes = { NETWORK_ERROR: "network" };
    Hls.prototype.on = function (name, callback) { this.handlers[name] = callback; };
    Hls.prototype.attachMedia = function () {};
    Hls.prototype.loadSource = function () {};
    Hls.prototype.destroy = function () {};
    const f = fixture({ environment: { Hls, Promise } });
    f.player.load({ kind: "live", url: "https://media.example/live.m3u8" });
    assert.equal(f.player.selectAudio("1"), false, "A pending manifest cannot select tracks");
    hls.handlers.manifest();
    assert.equal(f.player.selectAudio("1"), true);
    assert.equal(hls.audioTrack, 1);
    assert.equal(f.player.listTracks().audio[1].selected, true);
    assert.equal(f.player.selectSubtitle("0"), true);
    assert.equal(hls.subtitleTrack, 0);
    assert.equal(hls.subtitleDisplay, true);
    assert.equal(f.player.selectSubtitle("off"), true);
    assert.equal(hls.subtitleTrack, -1);
    assert.equal(hls.subtitleDisplay, false);
});

test("Shaka 5 track contract selects audio objects and disables text with null", () => {
    let adapter;
    function Player() { adapter = this; this.audio = [{ language: "en", active: true }, { language: "ru", active: false }]; this.text = [{ id: 17, language: "en", active: false }]; }
    Player.isBrowserSupported = () => true;
    Player.prototype.attach = function () {};
    Player.prototype.load = function () {};
    Player.prototype.destroy = function () {};
    Player.prototype.getAudioTracks = function () { return this.audio; };
    Player.prototype.getTextTracks = function () { return this.text; };
    Player.prototype.selectAudioTrack = function (track) { this.selectedAudio = track; };
    Player.prototype.selectTextTrack = function (track) { this.selectedText = track; };
    const f = fixture({ environment: { Promise, shaka: { Player } } });
    f.player.load({ kind: "vod", url: "https://media.example/film.mpd" });
    assert.equal(f.player.selectAudio("1"), true);
    assert.equal(adapter.selectedAudio, adapter.audio[1]);
    assert.equal(f.player.selectSubtitle("0"), true);
    assert.equal(adapter.selectedText, adapter.text[0]);
    assert.equal(f.player.selectSubtitle("off"), true);
    assert.equal(adapter.selectedText, null);
});

test("asynchronous adapter destruction completes before the next source uses the video", async () => {
    let disposed;
    let adapter;
    function Player() { adapter = this; }
    Player.isBrowserSupported = () => true;
    Player.prototype.attach = function () {};
    Player.prototype.load = function () {};
    Player.prototype.destroy = function () { return new Promise(resolve => { disposed = resolve; }); };
    const f = fixture({ environment: { Promise, shaka: { Player } } });
    f.player.load({ kind: "vod", url: "https://media.example/film.mpd" });
    assert.ok(adapter);
    f.player.load(vod);
    assert.equal(f.video.src, "");
    assert.equal(f.video.playCalls, 1);
    f.player.load(live);
    f.player.pause();
    disposed();
    await Promise.resolve();
    assert.equal(f.video.src, live.url, "Only the latest request may attach after disposal");
    assert.equal(f.video.playCalls, 1, "A pause while destruction completes must survive");
    f.player.play();
    assert.equal(f.video.playCalls, 2);
});

test("live seek requires a DVR range and skips unavailable gaps while paused", () => {
    const f = fixture();
    f.player.load(live);
    assert.equal(f.player.seek(20), false);
    assert.equal(f.player.capabilities().seek, false);
    f.video.seekable = { length: 2, start(i) { return [100, 160][i]; }, end(i) { return [140, 200][i]; } };
    f.player.pause();
    assert.equal(f.player.seek(0), true);
    assert.equal(f.video.currentTime, 100);
    f.player.seek(147);
    assert.equal(f.video.currentTime, 140);
    f.player.seek(157);
    assert.equal(f.video.currentTime, 160);
    f.player.seek(999);
    assert.equal(f.video.currentTime, 200);
    assert.equal(f.player.getState().paused, true);
    assert.equal(f.video.playCalls, 1);
    assert.equal(f.player.getState().seekRange.live, true);
});

test("OS or native-control pause is retained through late playing and recovery events", () => {
    const f = fixture();
    f.player.load(live);
    f.video.fire("playing");
    f.video.paused = true;
    f.video.fire("pause");
    f.video.fire("waiting");
    f.video.fire("playing");
    assert.equal(f.player.getState().paused, true);
    assert.equal(f.player.getState().state, "paused");
    assert.equal(f.timers.size, 0);
});

test("aspect and zoom compute legacy CSS dimensions and restore original inline styles", () => {
    const style = { cssText: "opacity: .9" };
    const f = fixture({ video: { style, parentNode: { clientWidth: 1920, clientHeight: 1080 }, videoWidth: 640, videoHeight: 480 } });
    f.player.load(vod);
    assert.equal(style.width, "1440px");
    assert.equal(style.marginLeft, "240px");
    f.player.setAspect("fill");
    assert.equal(style.height, "1440px");
    assert.equal(style.marginTop, "-180px");
    f.player.setAspect("stretch");
    assert.equal(style.width, "1920px");
    assert.equal(style.height, "1080px");
    f.player.setZoom(1.5);
    assert.equal(style.width, "2880px");
    assert.equal(style.marginLeft, "-480px");
    assert.equal(f.player.setAspect("anything"), false);
    assert.equal(f.player.setZoom(NaN), false);
    assert.equal(f.player.setZoom(100), false);
    f.player.destroy();
    assert.equal(style.cssText, "opacity: .9");
});

test("PiP capability is truthful and rejected entry never terminates playback", () => {
    const f = fixture();
    f.player.load(vod);
    assert.equal(f.player.capabilities().pip, false);
    assert.equal(f.player.enterPip(), false);
    const document = { pictureInPictureEnabled: true, exitPictureInPicture() {} };
    const p = fixture({ video: { ownerDocument: document, requestPictureInPicture() { return { then(resolve, reject) { reject(new Error("gesture required")); } }; } } });
    p.player.load(vod); p.video.fire("playing");
    assert.equal(p.player.capabilities().pip, true);
    assert.equal(p.player.enterPip(), true);
    assert.equal(p.events.at(-1).type, "piperror");
    assert.equal(p.player.getState().state, "playing");
});

test("canceled standard PiP entry closes a late window without notifying a new session", () => {
    let ready;
    let exits = 0;
    const document = { pictureInPictureEnabled: true, pictureInPictureElement: null, exitPictureInPicture() { exits++; this.pictureInPictureElement = null; } };
    const f = fixture({ video: { ownerDocument: document, requestPictureInPicture() { return { then(resolve) { ready = resolve; } }; } } });
    f.player.load(vod);
    f.player.enterPip();
    f.player.load(live);
    const count = f.events.length;
    document.pictureInPictureElement = f.video;
    ready();
    assert.equal(exits, 1);
    assert.equal(f.player.getState().pip, false);
    assert.equal(f.events.length, count);
});

test("WebKit PiP runs without Promise and closes on stop", () => {
    const f = fixture({ video: { webkitPresentationMode: "inline", webkitSupportsPresentationMode(mode) { return mode === "picture-in-picture"; }, webkitSetPresentationMode(mode) { this.webkitPresentationMode = mode; } } });
    f.player.load(vod);
    assert.equal(f.player.enterPip(), true);
    assert.equal(f.player.getState().pip, true);
    f.player.stop();
    assert.equal(f.video.webkitPresentationMode, "inline");
    assert.equal(f.player.getState().pip, false);
});

function mockHls() {
    const instances = [];
    function Hls(config) { this.config = config; this.events = {}; instances.push(this); }
    Hls.isSupported = () => true;
    Hls.Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
    Hls.ErrorTypes = { NETWORK_ERROR: "network" };
    Hls.prototype.on = function (name, callback) { this.events[name] = callback; };
    Hls.prototype.attachMedia = function (video) { this.video = video; };
    Hls.prototype.loadSource = function (url) { this.url = url; };
    Hls.prototype.destroy = function () { this.destroyed = true; };
    Hls.instances = instances;
    return Hls;
}

test("HLS workers use the separate bootstrap only when native worker and binary APIs exist", () => {
    for (const compatibility of [undefined, { ready: true, nativeBinary: false, nativeWorker: true }, { ready: true, nativeBinary: true, nativeWorker: false }, { ready: true, nativeBinary: true, nativeWorker: true }]) {
        const Hls = mockHls();
        const f = fixture({ environment: { Promise, Hls, OTT2Compat: compatibility } });
        f.player.load({ id: "worker-hls", kind: "live", url: "https://media.example/live.m3u8" }, { engine: "hls.js" });
        assert.equal(Hls.instances[0].config.enableWorker, !!(compatibility && compatibility.nativeBinary && compatibility.nativeWorker));
        assert.equal(Hls.instances[0].config.workerPath, "/src/hls-worker.js");
        f.player.destroy();
    }
});

test("worker failure disables workers on later loads without changing the selected engine", () => {
    const Hls = mockHls();
    const f = fixture({ environment: { Promise, Hls, OTT2Compat: { ready: true, nativeBinary: true, nativeWorker: true } } });
    f.player.load({ id: "worker-one", kind: "live", url: "https://media.example/one.m3u8" }, { engine: "hls.js" });
    Hls.instances[0].events.error("error", { fatal: false, event: "demuxerWorker" });
    assert.equal(f.player.getState().engine, "hls.js");
    f.player.load({ id: "worker-two", kind: "live", url: "https://media.example/two.m3u8" });
    assert.equal(Hls.instances[1].config.enableWorker, false);
    f.player.destroy();
});

test("a late media global cannot enable a dependency rejected during startup", () => {
    const Hls = mockHls();
    const f = fixture({ environment: { Promise, Hls, OTT2Vendors: { Hls: null, shaka: null, mpegts: null } } });
    assert.equal(f.player.capabilities().hlsJs, false);
    assert.equal(f.player.load({ id: "late", kind: "live", url: "https://media.example/late.m3u8" }, { engine: "hls.js" }), false);
    assert.equal(Hls.instances.length, 0);
    f.player.destroy();
});

function mockProbe() {
    const requests = [];
    function XHR() { this.readyState = 0; this.status = 0; this.responseText = ""; requests.push(this); }
    XHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
    XHR.prototype.send = function () {};
    XHR.prototype.abort = function () { this.aborted = true; };
    XHR.prototype.getResponseHeader = function () { return this.mime || "application/octet-stream"; };
    XHR.prototype.respond = function (mime, body = "", loaded) {
        this.readyState = body ? 3 : 2; this.status = 200; this.mime = mime; this.responseText = body;
        if (this.onreadystatechange) this.onreadystatechange({ loaded: loaded || body.length });
    };
    XHR.requests = requests;
    return XHR;
}

function mockMpegts(features = { msePlayback: true, mseLivePlayback: true }) {
    const instances = [];
    return {
        isSupported: () => true, getFeatureList: () => features,
        Events: { ERROR: "error" }, ErrorTypes: { NETWORK_ERROR: "network" }, instances,
        createPlayer(source, config) {
            const player = { source, config, attachMediaElement(video) { this.video = video; }, load() {}, destroy() { this.destroyed = true; }, on(name, fn) { this[name] = fn; } };
            instances.push(player); return player;
        }
    };
}

test("Chrome chooses Hls.js despite optimistic native HLS canPlayType; LG chooses native", () => {
    const Hls = mockHls();
    const chrome = fixture({ nativeHls: true, environment: { Promise, Hls, navigator: { userAgent: "Chrome/145.0" } } });
    chrome.player.load({ ...live, url: "https://media.example/play?output=m3u8" });
    assert.equal(chrome.player.getState().backend, "hls.js");
    assert.equal(chrome.player.getState().format, "hls");
    const lg = fixture({ environment: { Promise, Hls, navigator: { userAgent: "Mozilla/5.0 Web0S Chrome/68.0 SmartTV" } } });
    lg.player.load({ ...live, url: "https://media.example/play?format=application%2Fx-mpegURL" });
    assert.equal(lg.player.getState().backend, "native");
    const profile = fixture({ options: { device: "lg/webos" }, environment: { Promise, Hls, navigator: { userAgent: "Chrome/145.0" } } });
    profile.player.load({ ...live, url: "https://media.example/playlist.m3u8" });
    assert.equal(profile.player.getState().backend, "native");
});

test("extensionless HLS is detected from response MIME or a bounded body and the probe aborts", () => {
    const Hls = mockHls(), XMLHttpRequest = mockProbe();
    const f = fixture({ environment: { Promise, Hls, XMLHttpRequest, navigator: { userAgent: "Chrome/145.0" } } });
    f.player.load({ ...live, url: "https://media.example/live/123" });
    assert.equal(f.player.getState().detecting, true);
    assert.equal(f.video.playCalls, 0);
    XMLHttpRequest.requests[0].respond("application/vnd.apple.mpegurl");
    assert.equal(XMLHttpRequest.requests[0].aborted, true);
    assert.equal(f.player.getState().backend, "hls.js");
    f.player.load({ ...live, url: "https://media.example/live/456" });
    XMLHttpRequest.requests[1].respond("application/octet-stream", "\ufeff  #EXTM3U\n#EXT-X-TARGETDURATION:6\n");
    assert.equal(f.player.getState().backend, "hls.js");
    assert.equal(f.player.getState().detecting, false);
    assert.equal(XMLHttpRequest.requests[1].aborted, true);
});

test("unknown-stream probes stop at their size/time bound and CORS failure remains native", () => {
    const XMLHttpRequest = mockProbe();
    const f = fixture({ environment: { XMLHttpRequest } });
    f.player.load({ ...live, url: "https://media.example/live/1" });
    XMLHttpRequest.requests[0].respond("application/octet-stream", "x", 65536);
    assert.equal(XMLHttpRequest.requests[0].aborted, true);
    assert.equal(f.player.getState().backend, "native");
    assert.equal(f.video.playCalls, 1);
    f.player.load({ ...live, url: "https://media.example/live/2" });
    f.nextTimer();
    assert.equal(XMLHttpRequest.requests[1].aborted, true);
    assert.equal(f.video.playCalls, 2);
    f.player.load({ ...live, url: "https://media.example/live/3" });
    XMLHttpRequest.requests[2].onerror();
    assert.equal(f.player.getState().detecting, false);
    assert.equal(f.video.playCalls, 3);
});

test("channel switches and stop invalidate sniff callbacks and preserve pause during detection", () => {
    const XMLHttpRequest = mockProbe(), Hls = mockHls();
    const f = fixture({ environment: { XMLHttpRequest, Hls, Promise } });
    f.player.load({ ...live, url: "https://media.example/live/1" });
    const first = XMLHttpRequest.requests[0], late = first.onreadystatechange;
    f.player.load({ ...live, url: "https://media.example/live/2" });
    assert.equal(first.aborted, true);
    first.readyState = 3; first.status = 200; first.mime = "application/vnd.apple.mpegurl"; late();
    assert.equal(Hls.instances.length, 0);
    f.player.pause();
    XMLHttpRequest.requests[1].respond("application/vnd.apple.mpegurl");
    Hls.instances[0].events.manifest();
    assert.equal(f.player.getState().paused, true);
    assert.equal(f.video.playCalls, 0);
    f.player.load({ ...live, url: "https://media.example/live/3" });
    const third = XMLHttpRequest.requests[2], thirdLate = third.onreadystatechange;
    f.player.stop(); third.readyState = 3; third.status = 200; third.mime = "application/vnd.apple.mpegurl"; thirdLate();
    assert.equal(f.player.getState().state, "stopped");
    assert.equal(f.timers.size, 0);
});

test("auto falls back once per compatible engine while explicit engine never silently changes", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Promise, Hls, navigator: { userAgent: "Web0S" } } });
    f.player.load({ ...live, url: "https://media.example/live.m3u8" });
    f.video.error = { code: 4 }; f.video.fire("error");
    assert.equal(f.player.getState().backend, "hls.js");
    assert.equal(f.player.getState().fallbackCount, 1);
    Hls.instances[0].events.error("error", { fatal: true, type: "media" });
    assert.equal(f.player.getState().state, "error");
    assert.equal(f.player.getState().fallbackCount, 1);
    f.player.load({ ...live, url: "https://media.example/live.m3u8" }, { engine: "native" });
    f.video.fire("error");
    assert.equal(f.player.getState().state, "error");
    assert.equal(f.player.getState().backend, "native");
    assert.equal(f.player.getState().fallbackCount, 0);
});

test("manual engine choice reports unavailable, skips sniffing and never restarts a stopped channel", () => {
    const XMLHttpRequest = mockProbe(), Hls = mockHls();
    const f = fixture({ environment: { XMLHttpRequest, Hls, Promise } });
    f.player.load({ ...live, url: "https://media.example/opaque" }, { engine: "hls.js" });
    assert.equal(XMLHttpRequest.requests.length, 0);
    assert.equal(f.player.getState().backend, "hls.js");
    f.player.stop();
    const plays = f.video.playCalls;
    f.player.setEngine("native");
    assert.equal(f.player.getState().state, "stopped");
    assert.equal(f.video.playCalls, plays);
    assert.equal(f.player.setEngine("nonsense"), false);
    f.player.play();
    assert.equal(f.player.getState().backend, "native");
    assert.equal(f.player.setEngine("shaka"), false);
    assert.equal(f.events.at(-1).error.code, "engine_unavailable");
    assert.equal(f.player.getState().engine, "shaka");
});

test("switching engines retains paused seek position until the replacement has metadata", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Promise, Hls }, video: { duration: 120 } });
    f.player.load({ ...vod, url: "https://media.example/movie.m3u8" });
    f.video.fire("playing"); f.player.seek(51); f.player.pause();
    const playCalls = f.video.playCalls;
    f.player.setEngine("hls.js");
    f.video.currentTime = 0;
    Hls.instances[0].events.manifest();
    f.video.fire("loadedmetadata");
    assert.equal(f.video.currentTime, 51);
    assert.equal(f.player.getState().paused, true);
    assert.equal(f.video.playCalls, playCalls);
    f.player.play();
    assert.equal(f.video.playCalls, playCalls + 1);
});

test("MPEG-TS sniffing and explicit FLV use only a live-capable transmuxer", () => {
    const XMLHttpRequest = mockProbe(), mpegts = mockMpegts();
    const f = fixture({ environment: { Promise, XMLHttpRequest, mpegts } });
    f.player.load({ ...live, url: "https://media.example/transport/1" });
    const packet = "G" + "x".repeat(187);
    XMLHttpRequest.requests[0].respond("application/octet-stream", packet.repeat(3));
    assert.equal(f.player.getState().format, "mpegts");
    assert.equal(f.player.getState().backend, "mpegts");
    assert.equal(mpegts.instances[0].source.isLive, true);
    f.player.load({ ...live, url: "https://media.example/live.flv" });
    assert.equal(mpegts.instances[1].source.type, "flv");
    const unsupported = fixture({ environment: { Promise, mpegts: mockMpegts({ msePlayback: true, mseLivePlayback: false }) } });
    assert.equal(unsupported.player.load({ ...live, url: "https://media.example/live.ts" }), false);
    assert.equal(unsupported.player.getState().state, "error");
    assert.equal(unsupported.player.load({ ...vod, url: "https://media.example/movie.ts" }), true);
});

test("manual stream format bypasses a failed probe and obeys stopped-session intent", () => {
    const Hls = mockHls();
    const f = fixture({ environment: { Promise, Hls } });
    f.player.load({ ...live, url: "https://media.example/opaque" });
    f.player.setFormat("hls");
    assert.equal(f.player.getState().backend, "hls.js");
    assert.equal(f.player.getState().formatPreference, "hls");
    f.player.stop();
    f.player.setFormat("file");
    assert.equal(f.player.getState().state, "stopped");
    assert.equal(f.player.setFormat("invalid"), false);
});

test("Shaka's early metadata cannot consume a paused resume before load completion", () => {
    let loaded;
    function Player() {}
    Player.isBrowserSupported = () => true;
    Player.prototype.attach = function () {};
    Player.prototype.load = function () { return { then(resolve) { loaded = resolve; } }; };
    Player.prototype.destroy = function () {};
    Player.prototype.seekRange = function () { return { start: 0, end: 120 }; };
    const f = fixture({ environment: { Promise, shaka: { Player } }, video: { duration: 120 } });
    f.player.load(vod); f.player.seek(51); f.player.pause();
    f.player.setEngine("shaka");
    f.video.currentTime = 0; f.video.fire("loadedmetadata");
    assert.equal(f.video.currentTime, 0, "Shaka still owns initial positioning until its load completes");
    loaded();
    assert.equal(f.video.currentTime, 51);
    assert.equal(f.player.getState().paused, true);
    assert.equal(f.video.playCalls, 1);
});

test("LG receives a typed HLS source and source-element errors trigger bounded fallback", () => {
    const Hls = mockHls();
    const sources = [];
    const document = { createElement(tag) {
        assert.equal(tag, "source");
        const element = { attrs: {}, handlers: {}, setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, fn) { this.handlers[name] = fn; }, removeEventListener(name, fn) { if (this.handlers[name] === fn) delete this.handlers[name]; } };
        sources.push(element); return element;
    } };
    const f = fixture({ options: { device: "lg/webos" }, environment: { Promise, Hls, document }, video: {
        appendChild(child) { child.parentNode = this; }, removeChild(child) { child.parentNode = null; }
    } });
    f.player.load({ ...live, url: "https://media.example/opaque", mime: "application/vnd.apple.mpegurl" });
    assert.equal(f.player.getState().backend, "native");
    assert.equal(sources[0].attrs.type, "application/vnd.apple.mpegurl");
    const staleError = sources[0].handlers.error;
    staleError();
    assert.equal(f.player.getState().backend, "hls.js");
    assert.equal(f.player.getState().fallbackCount, 1);
    assert.equal(sources[0].parentNode, null);
    assert.equal(sources[0].handlers.error, undefined);
    staleError();
    assert.equal(f.player.getState().backend, "hls.js");
    assert.equal(f.player.getState().fallbackCount, 1);
});


test("preview resize recomputes video geometry without reloading or changing pause and zoom", () => {
    const parent = {clientWidth:1280,clientHeight:720}, style = {cssText:''};
    const f = fixture({video:{style,parentNode:parent,videoWidth:640,videoHeight:480}});
    f.player.load(live); f.video.fire('playing'); f.video.currentTime=32;
    f.player.setAspect('4:3'); f.player.setZoom(1.2); f.player.pause();
    const counts = [f.video.playCalls,f.video.pauseCalls,f.video.loadCalls], events=f.events.length;
    parent.clientWidth=320; parent.clientHeight=180;
    assert.equal(f.player.resize(),true);
    assert.equal(style.width,'288px'); assert.equal(style.height,'216px');
    assert.equal(style.marginLeft,'16px'); assert.equal(style.marginTop,'-18px');
    assert.equal(f.player.getState().paused,true); assert.equal(f.video.currentTime,32);
    assert.equal(f.video.src,live.url); assert.deepEqual([f.video.playCalls,f.video.pauseCalls,f.video.loadCalls],counts);
    assert.equal(f.events.length,events,'resize is presentation-only and emits no playback transition');
    parent.clientWidth=1280; parent.clientHeight=720; f.player.resize();
    assert.equal(style.width,'1152px'); assert.equal(style.height,'864px');
    f.player.destroy(); assert.equal(f.player.resize(),false);
});

test("Auto advances after silent native startup or no-progress timeout; manual stays native", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise, navigator: { userAgent: "Web0S" } }, options: { stallTimeout: 50 } });
    f.player.load({ ...live, url: "https://media.example/stream.m3u8" });
    f.nextTimer();
    assert.equal(f.player.getState().backend, "hls.js");
    assert.equal(f.player.getState().fallbackCount, 1);
    f.player.load({ ...live, url: "https://media.example/stream.m3u8" }, { engine: "native" });
    f.video.fire("playing"); f.video.currentTime = 1; f.video.fire("timeupdate");
    f.nextTimer();
    assert.equal(f.player.getState().backend, "native");
    assert.equal(f.player.getState().fallbackCount, 0);
    assert.equal(f.player.getState().state, "retrying");
    f.player.pause(); assert.equal(f.timers.size, 0);
});

test("moving audio-only radio is healthy while evidenced missing video has a separate deadline", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, options: { stallTimeout: 50, videoTimeout: 80 }, video: { audioTracks: [{}], videoTracks: [] } });
    f.player.load({ ...live, radio: true, video: true, url: "https://media.example/radio.m3u8" });
    f.video.fire("playing");
    for (let i = 1; i < 6; i++) { f.video.currentTime = i; f.video.fire("timeupdate"); }
    assert.equal(f.player.getState().backend, "native");
    assert.deepEqual(Array.from(f.timers.values(), timer => timer.delay), [50], "Radio has only the progress timer, never a first-video deadline");
    f.player.load({ ...live, video: true, url: "https://media.example/tv.m3u8" });
    f.video.fire("playing"); f.video.currentTime = 1; f.video.fire("timeupdate");
    const videoDeadline = Array.from(f.timers.values()).find(timer => timer.delay === 80);
    assert.ok(videoDeadline);
    videoDeadline.callback();
    assert.equal(f.player.getState().backend, "hls.js");
    assert.equal(f.events.find(event => event.type === "enginefallback").error.code, "video_missing");
    f.player.destroy();
});

test("native master codec evidence distinguishes video from radio and cannot affect a later channel", () => {
    const Hls = mockHls(), XMLHttpRequest = mockProbe();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise, XMLHttpRequest }, options: { videoTimeout: 80 }, video: { audioTracks: [{}], videoTracks: [] } });
    f.player.load({ ...live, url: "https://media.example/master.m3u8" });
    f.video.fire("playing");
    assert.equal(XMLHttpRequest.requests.length, 1);
    XMLHttpRequest.requests[0].respond("application/vnd.apple.mpegurl", '#EXTM3U\n#EXT-X-STREAM-INF:CODECS="mp4a.40.2,avc1.42e01e"\nvideo.m3u8');
    assert.ok(Array.from(f.timers.values()).some(timer => timer.delay === 80));
    const stale = Array.from(f.timers.values()).find(timer => timer.delay === 80).callback;
    f.player.load(vod); const count = f.events.length; stale();
    assert.equal(f.events.length, count);
    assert.equal(f.video.src, vod.url);
    f.player.load({ ...live, url: "https://media.example/radio.m3u8" }); f.video.fire("playing");
    XMLHttpRequest.requests[1].respond("application/vnd.apple.mpegurl", '#EXTM3U\n#EXT-X-STREAM-INF:CODECS="mp4a.40.2"\naudio.m3u8');
    assert.equal(Array.from(f.timers.values()).some(timer => timer.delay === 80), false);
    f.player.destroy();
});

test("late native video, pause and stale callbacks cancel first-video recovery", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, options: { videoTimeout: 80 }, video: { videoWidth: 0, videoHeight: 0 } });
    f.player.load({ ...live, video: true, url: "https://media.example/tv.m3u8" });
    const stale = Array.from(f.timers.values()).find(timer => timer.delay === 80).callback;
    f.player.pause(); stale();
    assert.equal(f.player.getState().paused, true); assert.equal(f.timers.size, 0);
    f.player.play(); f.video.videoWidth = 1280; f.video.videoHeight = 720; f.video.fire("resize");
    assert.equal(Array.from(f.timers.values()).some(timer => timer.delay === 80), false);
    assert.equal(f.player.getState().backend, "native");
    f.player.destroy();
});

test("live fallback maps distance to the new live edge instead of copying native seconds", () => {
    const Hls = mockHls(); let range = [1000, 1100];
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, video: { seekable: { length: 1, start() { return range[0]; }, end() { return range[1]; } } } });
    f.player.load({ ...live, url: "https://media.example/tv.m3u8" });
    f.video.currentTime = 1088; f.video.error = { code: 4 }; f.video.fire("error");
    range = [0, 90]; f.video.currentTime = 0;
    Hls.instances[0].events.manifest();
    assert.equal(f.video.currentTime, 78, "Twelve seconds behind the live edge is retained on the new timeline");
    f.player.destroy();
});

test("unreliable live timestamps resume at the replacement edge; paused DVR stays paused", () => {
    const Hls = mockHls(); let range = null;
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, video: { seekable: { get length() { return range ? 1 : 0; }, start() { return range[0]; }, end() { return range[1]; } } } });
    f.player.load({ ...live, url: "https://media.example/tv.m3u8" });
    f.video.currentTime = 1700000000; f.player.pause(); const plays = f.video.playCalls;
    f.player.setEngine("hls.js"); range = [0, 80]; f.video.currentTime = 0;
    Hls.instances[0].events.manifest();
    assert.equal(f.video.currentTime, 80); assert.equal(f.player.getState().paused, true); assert.equal(f.video.playCalls, plays);
    f.player.destroy();
});

test("one HLS decode recovery caps quality and never loops across same-session reloads", () => {
    const Hls = mockHls(); Hls.ErrorTypes.MEDIA_ERROR = "media";
    Hls.prototype.recoverMediaError = function () { this.recoveries = (this.recoveries || 0) + 1; };
    const f = fixture({ environment: { Hls, Promise }, options: { device: "lg/webos" } });
    f.player.load({ ...live, url: "https://media.example/tv.m3u8" }, { engine: "hls.js" });
    const hls = Hls.instances[0]; hls.levels = [{}, {}, {}]; hls.currentLevel = 2;
    hls.events.error("error", { fatal: true, type: "media", frag: { level: 2 } });
    assert.equal(hls.recoveries, 1); assert.equal(hls.autoLevelCapping, 1); assert.equal(hls.nextLevel, 1);
    hls.events.error("error", { fatal: true, type: "network" }); f.nextTimer();
    const replacement = Hls.instances[1]; replacement.events.error("error", { fatal: true, type: "media" });
    assert.equal(replacement.recoveries, undefined); assert.equal(f.player.getState().state, "error");
    f.player.destroy();
});

test("HLS buffer presets constrain TV memory without capping quality to preview size", () => {
    const Hls = mockHls();
    for (const device of ["lg/webos", "lg/netcast", "samsung/tizen", "mag", "panasonic", "pc"]) {
        const f = fixture({ environment: { Hls, Promise }, options: { device } });
        f.player.load({ ...live, url: "https://media.example/tv.m3u8" }, { engine: "hls.js" });
        const config = Hls.instances.at(-1).config;
        assert.equal(config.maxBufferSize, device === "pc" ? 60000000 : 30000000);
        assert.equal(config.maxBufferLength, device === "pc" ? 30 : 15);
        assert.equal(config.backBufferLength, device === "pc" ? 30 : 10);
        assert.equal(config.capLevelToPlayerSize, false);
        f.player.destroy();
    }
});

function lazyFixture() {
    const Hls = mockHls(), registry = { Hls: null, shaka: null, mpegts: null }, pending = [];
    const loader = {
        canLoad(name) { return name === "Hls"; },
        load(name, callback) { const item = { name, callback, canceled: false }; pending.push(item); return () => { item.canceled = true; }; }
    };
    return { Hls, registry, pending, f: fixture({ environment: { Promise, OTT2Vendors: registry, OTT2VendorLoader: loader } }) };
}

test("lazy engines load on demand and preserve pause until the accepted library is ready", () => {
    const { Hls, registry, pending, f } = lazyFixture();
    assert.equal(f.player.capabilities().hlsJs, true); assert.equal(pending.length, 0);
    f.player.load({ ...live, url: "https://media.example/tv.m3u8" });
    assert.equal(pending.length, 1); assert.equal(f.player.getState().ready, false);
    f.player.pause(); registry.Hls = Hls; pending[0].callback(null, Hls); Hls.instances[0].events.manifest();
    assert.equal(f.video.playCalls, 0); assert.equal(f.player.getState().paused, true);
    f.player.play(); assert.equal(f.video.playCalls, 1);
    f.player.destroy();
});

test("canceled lazy completion cannot attach to a later channel or resurrect a stopped one", () => {
    const { Hls, registry, pending, f } = lazyFixture();
    f.player.load({ ...live, url: "https://media.example/tv.m3u8" }); f.player.load(vod);
    assert.equal(pending[0].canceled, true);
    registry.Hls = Hls; pending[0].callback(null, Hls);
    assert.equal(Hls.instances.length, 0); assert.equal(f.video.src, vod.url);
    f.player.destroy();
});

test("lazy loader failure remains visible without falling into a synchronous load loop", () => {
    const f = fixture({ environment: { Promise, OTT2Vendors: {}, OTT2VendorLoader: { canLoad() { return true; }, load(name, callback) { callback(new Error("blocked")); return () => {}; } } } });
    assert.equal(f.player.load({ ...live, url: "https://media.example/tv.m3u8" }, { engine: "hls.js" }), false);
    assert.equal(f.player.getState().lastError.code, "engine_unavailable"); assert.equal(f.video.playCalls, 0);
    f.player.destroy();
});

test("native master inspection renews a possible relay session once without retuning radio", () => {
    const Hls = mockHls(), XMLHttpRequest = mockProbe();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise, XMLHttpRequest }, video: { audioTracks: [{}], videoTracks: [] } });
    f.player.load({ ...live, url: "https://media.example/radio.m3u8" }); f.video.fire("playing");
    const loads = f.video.loadCalls, request = XMLHttpRequest.requests[0];
    request.readyState = 4; request.responseText = '#EXTM3U\n#EXTINF:6\naudio.ts'; request.onreadystatechange();
    assert.equal(f.video.loadCalls, loads + 1); assert.equal(f.player.getState().backend, "native");
    f.video.fire("playing"); f.video.fire("timeupdate");
    assert.equal(XMLHttpRequest.requests.length, 1, "An inconclusive master never triggers repeated probes");
    f.player.destroy();
});

test("paused fatal HLS error defers recovery until Play without changing pause intent", () => {
    const Hls = mockHls(); Hls.ErrorTypes.MEDIA_ERROR = "media";
    Hls.prototype.recoverMediaError = function () { this.recoveries = (this.recoveries || 0) + 1; };
    const f = fixture({ environment: { Hls, Promise } });
    f.player.load({ ...vod, url: "https://media.example/movie.m3u8" }, { engine: "hls.js" });
    Hls.instances[0].events.manifest(); f.player.pause();
    Hls.instances[0].events.error("error", { fatal: true, type: "media" });
    assert.equal(f.player.getState().paused, true); assert.equal(Hls.instances[0].recoveries, undefined); assert.equal(f.video.playCalls, 1);
    f.player.play(); assert.equal(Hls.instances.length, 2);
    Hls.instances[1].events.manifest(); assert.equal(f.video.playCalls, 2);
    f.player.destroy();
});

test("a decoder recovery's internal pause event is not mistaken for a user pause", () => {
    const Hls = mockHls(); Hls.ErrorTypes.MEDIA_ERROR = "media";
    const f = fixture({ environment: { Hls, Promise } });
    Hls.prototype.recoverMediaError = function () { f.video.paused = true; f.video.fire("pause"); };
    f.player.load({ ...live, url: "https://media.example/tv.m3u8" }, { engine: "hls.js" }); Hls.instances[0].events.manifest(); f.video.fire("playing");
    Hls.instances[0].events.error("error", { fatal: true, type: "media" });
    assert.equal(f.player.getState().paused, false); assert.equal(f.player.getState().state, "loading");
    f.player.destroy();
});

test("old native engines with missing timeupdate events remain healthy when their clock advances", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, options: { stallTimeout: 50 } });
    f.player.load({ ...live, url: "https://media.example/legacy.m3u8" }); f.video.fire("playing");
    f.video.currentTime = 3; f.nextTimer();
    assert.equal(f.player.getState().backend, "native"); assert.equal(f.player.getState().fallbackCount, 0);
    assert.equal(f.timers.size, 1, "The bounded watchdog observes another interval");
    f.nextTimer(); assert.equal(f.player.getState().backend, "hls.js");
    f.player.destroy();
});

test("a video container MIME alone does not misclassify an audio-only MP4 as missing video", () => {
    const f = fixture({ options: { videoTimeout: 80 }, video: { audioTracks: [{}], videoTracks: [], videoWidth: 0, videoHeight: 0 } });
    f.player.load({ ...live, mime: "video/mp4" }); f.video.fire("playing");
    f.video.currentTime = 1; f.video.fire("timeupdate");
    assert.equal(Array.from(f.timers.values()).some(timer => timer.delay === 80), false);
    assert.equal(f.player.getState().state, "playing");
    f.player.destroy();
});

test("repeated waiting and unchanged timeupdate events cannot postpone the progress deadline", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, options: { stallTimeout: 50 }, video: { readyState: 4 } });
    f.player.load({ ...live, url: "https://media.example/stuck.m3u8" }); f.video.fire("playing");
    const timer = Array.from(f.timers.keys())[0];
    for (let i = 0; i < 6; i++) { f.video.fire("waiting"); f.video.fire("timeupdate"); }
    assert.deepEqual(Array.from(f.timers.keys()), [timer], "No new timer is scheduled without clock advancement");
    assert.equal(f.player.getState().state, "buffering");
    f.nextTimer(); assert.equal(f.player.getState().backend, "hls.js");
    f.player.destroy();
});

test("a temporarily rejected live seek keeps its edge distance as the destination range moves", () => {
    const Hls = mockHls(); let range = [1000, 1100];
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, video: { seekable: { length: 1, start() { return range[0]; }, end() { return range[1]; } } } });
    f.player.load({ ...live, url: "https://media.example/tv.m3u8" }); f.video.currentTime = 1088; f.player.pause(); f.player.setEngine("hls.js");
    range = [0, 90]; let position = 0, reject = true; const attempts = [];
    Object.defineProperty(f.video, "currentTime", { configurable: true, get() { return position; }, set(value) { attempts.push(value); if (reject) { reject = false; throw new Error("Not ready"); } position = value; } });
    Hls.instances[0].events.manifest(); assert.deepEqual(attempts, [78]);
    range = [0, 100]; f.video.fire("loadedmetadata");
    assert.deepEqual(attempts, [78, 88]); assert.equal(position, 88); assert.equal(f.player.getState().paused, true);
    f.player.destroy();
});

test("lagging empty video TrackList cannot reject positive dimensions on old firmware", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, options: { videoTimeout: 80 }, video: { videoTracks: [], videoWidth: 1280, videoHeight: 720 } });
    f.player.load({ ...live, video: true, url: "https://media.example/tv.m3u8" }); f.video.fire("playing");
    assert.equal(Array.from(f.timers.values()).some(timer => timer.delay === 80), false);
    assert.equal(f.player.getState().backend, "native"); f.player.destroy();
});

test("decoded frames validate video despite lagging metadata while static counters cannot", () => {
    const Hls = mockHls(); let frames = 8;
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, options: { videoTimeout: 80 }, video: { videoTracks: [], videoWidth: 1280, videoHeight: 720, getVideoPlaybackQuality() { return { totalVideoFrames: frames, droppedVideoFrames: 0 }; } } });
    f.player.load({ ...live, video: true, url: "https://media.example/tv.m3u8" });
    assert.ok(Array.from(f.timers.values()).some(timer => timer.delay === 80), "Earlier channel frames and dimensions cannot validate the new decode");
    frames = 1; f.video.videoWidth = 0; f.video.videoHeight = 0; f.video.fire("timeupdate");
    assert.equal(Array.from(f.timers.values()).some(timer => timer.delay === 80), false, "A counter reset followed by a decoded frame validates video");
    f.player.destroy();
});

test("advertised dimensions with no decoded frames still trigger bounded recovery for evidenced video", () => {
    const Hls = mockHls();
    const f = fixture({ nativeHls: true, environment: { Hls, Promise }, options: { videoTimeout: 80 }, video: { videoTracks: [{}], videoWidth: 1280, videoHeight: 720, webkitDecodedFrameCount: 0 } });
    f.player.load({ ...live, video: true, url: "https://media.example/tv.m3u8" }); f.video.fire("playing");
    const deadline = Array.from(f.timers.values()).find(timer => timer.delay === 80); assert.ok(deadline);
    deadline.callback(); assert.equal(f.player.getState().backend, "hls.js");
    f.player.destroy();
});

test("snapshot session changes for a source restart but remains stable through an ordinary pause", () => {
    const f = fixture(); f.player.load(live);
    const session = f.player.getState().session;
    f.player.pause(); assert.equal(f.player.getState().session, session);
    f.player.play(); assert.equal(f.player.getState().session, session);
    f.player.load(live); assert.ok(f.player.getState().session > session);
    f.player.destroy();
});

test("native video probes never treat provider error pages as codec evidence", () => {
    for (const response of [{ status: 403, body: '#EXTM3U\n#EXT-X-STREAM-INF:CODECS="avc1.42e01e"\nblocked.m3u8' }, { status: 200, body: '<html>Unsupported CODECS="avc1.42e01e"</html>' }]) {
        const Hls = mockHls(), XMLHttpRequest = mockProbe();
        const f = fixture({ nativeHls: true, environment: { Hls, Promise, XMLHttpRequest }, options: { videoTimeout: 80 }, video: { audioTracks: [{}], videoTracks: [] } });
        f.player.load({ ...live, url: "https://media.example/protected.m3u8" }); f.video.fire("playing");
        const request = XMLHttpRequest.requests[0]; request.readyState = 4; request.status = response.status; request.responseText = response.body; request.onreadystatechange();
        assert.equal(Array.from(f.timers.values()).some(timer => timer.delay === 80), false);
        assert.equal(f.player.getState().backend, "native");
        f.player.destroy();
    }
});

function recoveringShaka(settings = {}) {
    const instances = [];
    function Player() { this.handlers = {}; instances.push(this); }
    Player.isBrowserSupported = () => true;
    Player.prototype.addEventListener = function (name, callback) { this.handlers[name] = callback; };
    Player.prototype.attach = function () {};
    Player.prototype.load = function () { return settings.load && settings.load(); };
    Player.prototype.destroy = function () { this.destroyed = true; return settings.destroy && settings.destroy(); };
    Player.prototype.seekRange = function () { return settings.range ? settings.range() : { start: 0, end: 120 }; };
    return { Player, instances };
}

test("Shaka recoverable runtime errors retain its adapter and the original progress deadline", () => {
    const shaka = recoveringShaka();
    const f = fixture({ environment: { Promise, shaka }, options: { stallTimeout: 50, maxRetries: 0 } });
    f.player.load({ ...live, url: "https://media.example/live.mpd" }, { engine: "shaka" });
    f.video.fire("playing"); const timer = Array.from(f.timers.keys())[0];
    for (let i = 0; i < 5; i++) shaka.instances[0].handlers.error({ detail: { severity: 1, code: 1001 } });
    assert.equal(shaka.instances[0].destroyed, undefined);
    assert.equal(f.player.getState().state, "buffering");
    assert.deepEqual(Array.from(f.timers.keys()), [timer], "Repeated recoverable errors cannot postpone the deadline");
    f.video.currentTime = 3; f.video.fire("timeupdate");
    assert.equal(f.player.getState().state, "playing");
    assert.notDeepEqual(Array.from(f.timers.keys()), [timer]);
    shaka.instances[0].handlers.error({ detail: { severity: 1 } }); f.nextTimer();
    assert.equal(f.player.getState().state, "error");
    assert.equal(f.player.getState().engine, "shaka", "Manual selection must not silently switch engines");
    assert.equal(shaka.instances[0].destroyed, true); assert.equal(f.timers.size, 0);
});

test("Shaka critical runtime errors retain bounded Auto fallback while rejected loads remain terminal", () => {
    const shaka = recoveringShaka();
    const f = fixture({ environment: { Promise, shaka }, video: { canPlayType(type) { return type === "application/dash+xml" ? "probably" : ""; } } });
    f.player.load({ ...live, url: "https://media.example/live.mpd" }); f.video.fire("playing");
    shaka.instances[0].handlers.error({ detail: { severity: 2, code: 3016 } });
    assert.equal(f.player.getState().backend, "native"); assert.equal(f.player.getState().fallbackCount, 1);
    assert.equal(shaka.instances[0].destroyed, true); f.player.destroy();
    const failed = recoveringShaka({ load() { return { then(resolve, reject) { reject({ severity: 1, code: 1001 }); } }; } });
    const g = fixture({ environment: { Promise, shaka: failed } });
    g.player.load({ ...vod, url: "https://media.example/film.mpd" }, { engine: "shaka" });
    assert.equal(g.player.getState().state, "error", "A rejected load is not an active recoverable runtime session");
    assert.equal(failed.instances[0].destroyed, true);
});

test("terminal native, HLS and Shaka VOD errors preserve position for explicit Play and engine changes", () => {
    for (const engine of ["native", "hls.js", "shaka"]) {
        for (const action of ["play", "engine"]) {
            const Hls = mockHls(), shaka = recoveringShaka();
            const f = fixture({ environment: { Promise, Hls, shaka }, video: { duration: 120, load() { this.loadCalls++; this.currentTime = 0; } } });
            f.player.load(vod, { engine }); if (engine === "hls.js") Hls.instances[0].events.manifest();
            f.video.currentTime = 51; f.video.fire("playing");
            if (engine === "hls.js") Hls.instances[0].events.error("error", { fatal: true, type: "network" });
            else if (engine === "shaka") shaka.instances[0].handlers.error({ detail: { severity: 2 } });
            else { f.video.error = { code: 2 }; f.video.fire("error"); }
            assert.equal(f.player.getState().state, "error");
            if (action === "play") { f.player.play(); if (engine === "hls.js") Hls.instances[1].events.manifest(); }
            else f.player.setEngine("native");
            f.video.fire("loadedmetadata");
            assert.equal(f.video.currentTime, 51, engine + " " + action + " restores the last valid position");
            f.player.destroy();
        }
    }
});

test("paused Shaka archive failure defers restart and keeps position and pause intent on engine change", () => {
    const shaka = recoveringShaka();
    const f = fixture({ environment: { Promise, shaka }, video: { duration: 120, load() { this.loadCalls++; this.currentTime = 0; } } });
    f.player.load({ ...vod, kind: "archive" }, { engine: "shaka" }); f.video.currentTime = 51; f.player.pause();
    const plays = f.video.playCalls;
    shaka.instances[0].handlers.error({ detail: { severity: 1 } });
    assert.equal(shaka.instances[0].destroyed, undefined); assert.equal(f.timers.size, 0);
    shaka.instances[0].handlers.error({ detail: { severity: 2 } });
    assert.equal(f.player.getState().paused, true); assert.equal(shaka.instances[0].destroyed, true);
    f.player.setEngine("native"); f.video.fire("loadedmetadata");
    assert.equal(f.video.currentTime, 51); assert.equal(f.player.getState().paused, true); assert.equal(f.video.playCalls, plays);
    f.player.play(); assert.equal(f.video.playCalls, plays + 1); f.player.destroy();
});

test("Stop, completion and a new channel discard error resume positions", () => {
    for (const action of ["stop", "ended", "load"]) {
        const f = fixture({ video: { duration: 120, load() { this.loadCalls++; this.currentTime = 0; } } });
        f.player.load(vod); f.video.currentTime = 51; f.video.fire("playing");
        if (action !== "ended") { f.video.error = { code: 2 }; f.video.fire("error"); }
        if (action === "stop") { f.player.stop(); f.player.play(); }
        else if (action === "ended") { f.video.currentTime = 120; f.video.fire("ended"); f.player.play(); }
        else f.player.load({ ...vod, id: "other", url: "https://media.example/other.mp4" });
        f.video.fire("loadedmetadata"); assert.equal(f.video.currentTime, 0, action + " must start a new timeline");
        f.player.destroy();
    }
});

test("multi-hop fallback retains the original DVR distance through constructor and pre-metadata failures", () => {
    for (const failure of ["constructor", "manifest"]) {
        let range = null, f;
        const Hls = failure === "constructor" ? function () { throw new Error("No decoder"); } : mockHls();
        Hls.isSupported = () => true;
        const shaka = recoveringShaka({ load() { f.video.readyState = 4; }, range() { return { start: 0, end: 90 }; } });
        f = fixture({ nativeHls: true, environment: { Promise, Hls, shaka }, video: {
            seekable: { get length() { return range ? 1 : 0; }, start() { return range[0]; }, end() { return range[1]; } },
            load() { this.loadCalls++; this.currentTime = 0; this.readyState = 0; range = null; }
        } });
        f.player.load({ ...live, url: "https://media.example/live.m3u8" });
        range = [1000, 1100]; f.video.readyState = 4; f.video.currentTime = 1088; f.video.fire("playing");
        f.video.error = { code: 4 }; f.video.fire("error");
        if (failure === "manifest") Hls.instances[0].events.error("error", { fatal: true, type: "media" });
        assert.equal(f.player.getState().backend, "shaka"); assert.equal(f.player.getState().fallbackCount, 2);
        assert.equal(f.video.currentTime, 78, "Twelve seconds behind the live edge survives " + failure);
        f.player.destroy();
    }
});

test("paused DVR survives a failed lazy vendor and restores against the final moving range", () => {
    let range = null, f, finish;
    const shaka = recoveringShaka({ load() { f.video.readyState = 4; }, range() { return { start: 0, end: 100 }; } });
    f = fixture({ nativeHls: true, environment: { Promise, shaka, navigator: { userAgent: "Chrome/120" }, OTT2VendorLoader: {
        canLoad(name) { return name === "Hls"; }, load(name, callback) { finish = callback; return function () {}; }
    } }, video: {
        seekable: { get length() { return range ? 1 : 0; }, start() { return range[0]; }, end() { return range[1]; } },
        load() { this.loadCalls++; this.currentTime = 0; this.readyState = 0; range = null; }
    } });
    f.player.load({ ...live, url: "https://media.example/live.m3u8" }, { engine: "native" });
    range = [1000, 1100]; f.video.readyState = 4; f.video.currentTime = 1088; f.player.pause(); const plays = f.video.playCalls;
    f.player.setEngine("auto"); assert.equal(f.player.getState().backend, "hls.js");
    finish(new Error("Vendor unavailable"));
    assert.equal(f.player.getState().backend, "shaka"); assert.equal(f.video.currentTime, 88);
    assert.equal(f.player.getState().paused, true); assert.equal(f.video.playCalls, plays); f.player.destroy();
});

test("TV suspension preserves playback intent and VOD position despite stale host pause and playing events", () => {
    const f = fixture({ video: { duration: 120, load() { this.loadCalls++; this.currentTime = 0; } } });
    f.player.load(vod); f.video.currentTime = 51; f.video.fire("playing");
    const hostPause = f.listeners.pause[0], hostPlaying = f.listeners.playing[0];
    assert.equal(f.player.suspend(), true); const loads = f.video.loadCalls;
    assert.equal(f.player.getState().state, "suspended"); assert.equal(f.player.getState().suspended, true);
    assert.equal(f.player.getState().paused, false); assert.equal(f.player.getState().position, 51);
    assert.equal(f.player.getState().ready, false); assert.equal(f.timers.size, 0);
    assert.equal(f.player.suspend(), true); assert.equal(f.video.loadCalls, loads, "Repeated hidden events are idempotent");
    f.video.paused = true; hostPause(); hostPlaying();
    assert.equal(f.player.getState().paused, false); assert.equal(f.video.playCalls, 1);
    assert.equal(f.player.resume(), true); f.video.fire("loadedmetadata");
    assert.equal(f.video.currentTime, 51); assert.equal(f.video.playCalls, 2); assert.equal(f.player.getState().suspended, false);
    assert.equal(f.player.resume(), false); f.player.destroy();
});

test("TV foreground never attaches a user-paused decoder until an explicit Play", () => {
    for (const when of ["before", "hidden"]) {
        const f = fixture({ video: { duration: 120, load() { this.loadCalls++; this.currentTime = 0; } } });
        f.player.load(vod); f.video.currentTime = 51; f.video.fire("playing");
        if (when === "before") f.player.pause();
        f.player.suspend(); if (when === "hidden") f.player.pause();
        const loads = f.video.loadCalls, plays = f.video.playCalls;
        assert.equal(f.player.resume(), true); assert.equal(f.player.getState().state, "paused");
        assert.equal(f.player.getState().ready, false); assert.equal(f.player.getState().paused, true);
        assert.equal(f.video.loadCalls, loads); assert.equal(f.video.playCalls, plays); assert.equal(f.timers.size, 0);
        f.player.play(); f.video.fire("loadedmetadata");
        assert.equal(f.video.currentTime, 51); assert.equal(f.video.playCalls, plays + 1); f.player.destroy();
    }
});

test("hidden Play and engine changes update intent without starting a decoder", () => {
    const Hls = mockHls();
    const f = fixture({ environment: { Hls, Promise }, video: { duration: 120 } });
    f.player.load(vod); f.video.currentTime = 51; f.player.pause(); f.player.suspend();
    const plays = f.video.playCalls;
    f.player.setEngine("hls.js"); f.player.setFormat("hls"); f.player.play();
    assert.equal(Hls.instances.length, 0); assert.equal(f.video.playCalls, plays);
    assert.equal(f.player.getState().paused, false); assert.equal(f.player.getState().suspended, true);
    f.player.resume(); assert.equal(Hls.instances.length, 1); Hls.instances[0].events.manifest();
    assert.equal(f.video.currentTime, 51); assert.equal(f.video.playCalls, plays + 1); f.player.destroy();
});

test("Stop, new channels and destroy cancel suspended sessions and stale callbacks", () => {
    for (const action of ["stop", "load", "destroy"]) {
        const f = fixture(); f.player.load(live); const hostPlaying = f.listeners.playing[0];
        f.player.suspend();
        if (action === "load") f.player.load(vod);
        else f.player[action]();
        const plays = f.video.playCalls; hostPlaying();
        assert.equal(f.player.resume(), false); assert.equal(f.video.playCalls, plays);
        assert.equal(f.player.getState().suspended, false);
        if (action === "load") assert.equal(f.player.getState().channel.id, vod.id);
        else assert.equal(f.player.getState().state, action === "stop" ? "stopped" : "destroyed");
        f.player.destroy();
    }
    const f = fixture(); assert.equal(f.player.suspend(), false); f.player.load(vod); f.video.fire("ended");
    assert.equal(f.player.suspend(), false); assert.equal(f.player.resume(), false); f.player.destroy();
});

test("TV resume preserves DVR delay across a changed live timeline", () => {
    let range = null;
    const f = fixture({ video: {
        seekable: { get length() { return range ? 1 : 0; }, start() { return range[0]; }, end() { return range[1]; } },
        load() { this.loadCalls++; this.currentTime = 0; this.readyState = 0; range = null; }
    } });
    f.player.load(live); range = [1000, 1100]; f.video.readyState = 4; f.video.currentTime = 1088; f.video.fire("playing");
    f.player.suspend(); f.player.resume(); range = [0, 90]; f.video.readyState = 4; f.video.fire("loadedmetadata");
    assert.equal(f.video.currentTime, 78); assert.equal(f.player.getState().paused, false); f.player.destroy();
});

test("suspension waits for asynchronous teardown and invalidates a canceled manifest", () => {
    let release, loaded;
    const shaka = recoveringShaka({
        load() { return { then(resolve) { loaded = resolve; } }; },
        destroy() { return { then(resolve) { release = resolve; } }; }
    });
    const f = fixture({ environment: { Promise, shaka } });
    f.player.load({ ...vod, url: "https://media.example/live.mpd" });
    const staleLoaded = loaded;
    f.player.suspend(); f.player.resume();
    assert.equal(shaka.instances.length, 1); staleLoaded(); assert.equal(f.video.playCalls, 0);
    f.player.pause(); release(); assert.equal(shaka.instances.length, 2);
    loaded(); assert.equal(f.video.playCalls, 0); assert.equal(f.player.getState().paused, true);
    f.player.play(); assert.equal(f.video.playCalls, 1); f.player.destroy();
});

test("foreground autoplay rejection returns to user gesture without a resume loop", () => {
    let denied = false;
    const f = fixture({ playResult() { return { then(resolve, reject) { if (denied) reject({ name: "NotAllowedError" }); } }; } });
    f.player.load(live); f.video.fire("playing"); f.player.suspend(); denied = true;
    f.player.resume();
    assert.equal(f.player.getState().state, "paused"); assert.equal(f.events.at(-1).type, "autoplayblocked");
    assert.equal(f.timers.size, 0); assert.equal(f.player.resume(), false);
    f.player.suspend(); f.player.resume(); assert.equal(f.video.playCalls, 2, "Denied autoplay is preserved as paused intent");
    f.player.destroy();
});

test("repeated Shaka recovery and host playing events without progress cannot extend its watchdog", () => {
    const shaka = recoveringShaka();
    const f = fixture({ environment: { Promise, shaka }, options: { stallTimeout: 50, maxRetries: 0 } });
    f.player.load({ ...live, url: "https://media.example/live.mpd" }, { engine: "shaka" }); f.video.fire("playing");
    const timer = Array.from(f.timers.keys())[0];
    for (let i = 0; i < 5; i++) { shaka.instances[0].handlers.error({ detail: { severity: 1 } }); f.video.fire("playing"); }
    assert.deepEqual(Array.from(f.timers.keys()), [timer]); f.nextTimer();
    assert.equal(f.player.getState().state, "error"); assert.equal(shaka.instances[0].destroyed, true);
});

test("VOD resume waits for replacement media metadata even when a stale duration remains", () => {
    const Hls = mockHls();
    const f = fixture({ environment: { Promise, Hls }, video: { duration: 120, load() { this.loadCalls++; this.currentTime = 0; this.readyState = 0; } } });
    f.player.load(vod); f.video.readyState = 4; f.video.currentTime = 51; f.player.pause(); f.player.setEngine("hls.js");
    Hls.instances[0].events.manifest(); assert.equal(f.video.currentTime, 0, "Manifest metadata alone cannot consume VOD restoration");
    f.video.readyState = 1; f.video.fire("loadedmetadata"); assert.equal(f.video.currentTime, 51); f.player.destroy();
});

test("confirmed TV suspension can distinguish an earlier host pause from explicit user intent", () => {
    for (const explicitPause of [false, true, undefined]) {
        const f = fixture({ video: { duration: 120, load() { this.loadCalls++; this.currentTime = 0; } } });
        f.player.load(vod); f.video.currentTime = 51; f.video.fire("playing");
        f.video.paused = true; f.video.fire("pause");
        assert.equal(f.player.getState().paused, true, "An unexplained native pause remains conservative before host suspension is known");
        const plays = f.video.playCalls;
        f.player.suspend(explicitPause === undefined ? undefined : { paused: explicitPause });
        assert.equal(f.player.getState().position, 51);
        f.player.resume();
        if (explicitPause === false) {
            assert.equal(f.video.playCalls, plays + 1); assert.equal(f.player.getState().paused, false);
            f.video.fire("loadedmetadata"); assert.equal(f.video.currentTime, 51);
        } else {
            assert.equal(f.video.playCalls, plays); assert.equal(f.player.getState().paused, true);
            assert.equal(f.player.getState().state, "paused"); assert.equal(f.player.getState().ready, false);
        }
        f.player.destroy();
    }
});

test("repeated suspension notifications cannot replace a user pause made while hidden", () => {
    const f = fixture(); f.player.load(live); f.player.suspend({ paused: false }); f.player.pause();
    f.player.suspend({ paused: false }); f.player.resume();
    assert.equal(f.player.getState().paused, true); assert.equal(f.video.playCalls, 1); f.player.destroy();
});
