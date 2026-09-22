"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parse } = require("parse5");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/boot.js"), "utf8");

function fixture(overrides = {}) {
    const scripts = [], removed = [], timers = new Map(), calls = [];
    let serial = 0;
    const window = {
        OTT2Compat: { ready: true, nativeBinary: true },
        URL: { createObjectURL() {} }, MediaSource() {},
        setTimeout(callback) { const id = ++serial; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
        OTT2: { require(name) { assert.equal(name, "app"); return { start() { calls.push("start"); } }; } },
        shaka: { polyfill: { installAll() { calls.push("shaka-polyfills"); } } },
        ...overrides
    };
    const document = { createElement() { return {}; }, head: {
        appendChild(script) { scripts.push(script); script.parentNode = this; },
        removeChild(script) { removed.push(script); script.parentNode = null; }
    } };
    vm.runInNewContext(source, { window, document });
    return { scripts, removed, timers, calls, window };
}

test("HTML and Worker bootstrap install polyfills before application or media code", () => {
    const scripts = [];
    function visit(node) {
        if (node.tagName === "script") {
            const attrs = Object.fromEntries((node.attrs || []).map(x => [x.name, x.value]));
            assert.ok(!("async" in attrs) && !("defer" in attrs), "Bootstrap scripts must remain ordered");
            if (attrs.src) scripts.push(attrs.src);
        }
        for (const child of node.childNodes || []) visit(child);
    }
    visit(parse(fs.readFileSync(path.join(root, "index.html"), "utf8")));
    assert.deepEqual(scripts.slice(0, 4), ["/src/compat.js", "/vendor/core-js.min.js", "/src/compat-ready.js", "/src/runtime.js"]);
    assert.equal(scripts.at(-1), "/src/boot.js");
    const imports = [], workerSource = fs.readFileSync(path.join(root, "src/hls-worker.js"), "utf8");
    vm.runInNewContext(workerSource, {
        self: { OTT2Compat: { ready: true, nativeBinary: true } },
        importScripts(...urls) { imports.push(...urls); }
    });
    assert.deepEqual(imports, ["/src/compat.js", "/vendor/core-js.min.js", "/src/compat-ready.js", "/vendor/hls.worker.js"]);
    for (const compatibility of [undefined, {ready:false,nativeBinary:true}, {ready:true,nativeBinary:false}]) {
        const failedImports = [];
        assert.throws(() => vm.runInNewContext(workerSource, {
            self: { OTT2Compat: compatibility },
            importScripts(...urls) { failedImports.push(...urls); }
        }));
        assert.deepEqual(failedImports, ["/src/compat.js", "/vendor/core-js.min.js", "/src/compat-ready.js"], "Failed worker compatibility cannot evaluate the HLS payload");
    }
});

function publish(f, name) {
    let library;
    if (name === "Hls") { library = function Hls() {}; library.isSupported = () => true; }
    else if (name === "shaka") { library = { Player() {}, polyfill: { installAll() { f.calls.push("shaka-polyfills"); } } }; }
    else { library = { createPlayer() {}, isSupported: () => true }; }
    f.window[name] = library;
    return library;
}

test("UI starts immediately without requesting optional engines", () => {
    const f = fixture();
    assert.deepEqual(f.calls, ["start"]);
    assert.equal(f.scripts.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.window.OTT2VendorLoader.status("Hls"), "idle");
    assert.equal(f.window.OTT2Vendors.shaka, null, "Preexisting globals are not accepted engines");
});

test("requested engines load once and accepted results are shared", () => {
    const f = fixture(), received = [], loader = f.window.OTT2VendorLoader;
    loader.load("Hls", (error, value) => received.push([error, value]));
    loader.load("Hls", (error, value) => received.push([error, value]));
    assert.equal(f.scripts.length, 1);
    assert.equal(loader.status("Hls"), "loading");
    assert.equal(f.scripts[0].src, "/vendor/hls.min.js");
    assert.equal(f.scripts[0].async, true, "An unrelated slow engine must not defer this script's execution");
    const oldLoad = f.scripts[0].onload, hls = publish(f, "Hls");
    oldLoad(); oldLoad();
    assert.equal(received.length, 2);
    assert(received.every(item => item[0] === null && item[1] === hls));
    loader.load("Hls", (error, value) => received.push([error, value]));
    assert.equal(received.length, 3);
    assert.equal(f.scripts.length, 1);
    assert.equal(loader.status("Hls"), "ready");
    assert.equal(f.window.OTT2Vendors.Hls, hls);
    assert.equal(f.window.OTT2Vendors.mpegts, null);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.calls, ["start"]);
});

test("independent engine requests do not block each other", () => {
    const f = fixture(), loader = f.window.OTT2VendorLoader, received = [];
    loader.load("Hls", error => received.push(["Hls", error && error.code]));
    loader.load("shaka", error => received.push(["shaka", error && error.code]));
    loader.load("mpegts", error => received.push(["mpegts", error && error.code]));
    assert.equal(f.scripts.length, 3);
    publish(f, "shaka"); f.scripts[1].onload();
    assert.deepEqual(f.calls, ["start", "shaka-polyfills"]);
    assert.deepEqual(received, [["shaka", null]]);
    f.scripts[0].onerror(); publish(f, "mpegts"); f.scripts[2].onload();
    assert.deepEqual(received, [["shaka", null], ["Hls", "vendor_load"], ["mpegts", null]]);
});

test("missing compatibility, binary storage, MSE or object URLs keeps native UI usable", () => {
    for (const overrides of [
        { OTT2Compat: undefined },
        { OTT2Compat: { ready: false, nativeBinary: true } },
        { OTT2Compat: { ready: true, nativeBinary: false } },
        { MediaSource: undefined },
        { URL: {} }
    ]) {
        const f = fixture(overrides), loader = f.window.OTT2VendorLoader;
        let error;
        loader.load("shaka", value => { error = value; });
        assert.equal(error.code, "vendor_unavailable");
        assert.equal(loader.status("shaka"), "unavailable");
        assert.equal(loader.canLoad("shaka"), false);
        assert.equal(f.scripts.length, 0);
        assert.deepEqual(f.calls, ["start"]);
        assert.equal(f.window.OTT2Vendors.shaka, null);
    }
});

test("prefixed WebKitMediaSource remains eligible after explicit demand", () => {
    const f = fixture({ MediaSource: undefined, WebKitMediaSource() {} });
    assert.equal(f.scripts.length, 0);
    f.window.OTT2VendorLoader.load("Hls", () => {});
    assert.equal(f.scripts[0].src, "/vendor/hls.min.js");
    f.scripts[0].onerror();
    assert.deepEqual(f.calls, ["start"]);
});

test("legacy readyState completes once and invalid globals are rejected", () => {
    const f = fixture(), loader = f.window.OTT2VendorLoader, errors = [];
    loader.load("Hls", error => errors.push(error && error.code));
    f.scripts[0].readyState = "loading"; f.scripts[0].onreadystatechange();
    assert.equal(loader.status("Hls"), "loading");
    const ready = f.scripts[0].onreadystatechange;
    f.window.Hls = {};
    f.scripts[0].readyState = "complete"; ready(); ready();
    assert.deepEqual(errors, ["vendor_invalid"]);
    assert.equal(loader.canLoad("Hls"), false);
    assert.equal(f.window.OTT2Vendors.Hls, null);
});

test("timed-out engines cannot become accepted through late globals or retries", () => {
    const f = fixture(), loader = f.window.OTT2VendorLoader, errors = [];
    loader.load("Hls", error => errors.push(error.code));
    const lateLoad = f.scripts[0].onload;
    f.timers.values().next().value();
    assert.deepEqual(errors, ["vendor_timeout"]);
    publish(f, "Hls"); lateLoad();
    loader.load("Hls", error => errors.push(error.code));
    assert.deepEqual(errors, ["vendor_timeout", "vendor_timeout"]);
    assert.equal(f.scripts.length, 1, "A late earlier request cannot impersonate a retry");
    assert.equal(f.window.OTT2Vendors.Hls, null);
    assert.deepEqual(f.removed, [f.scripts[0]]);
    assert.equal(f.timers.size, 0);
});

test("a cancelled caller cannot receive another session's completed load", () => {
    const f = fixture(), loader = f.window.OTT2VendorLoader, received = [];
    const cancel = loader.load("Hls", () => received.push("old"));
    loader.load("Hls", () => received.push("current"));
    cancel(); cancel();
    publish(f, "Hls"); f.scripts[0].onload();
    assert.deepEqual(received, ["current"]);
    assert.equal(loader.status("Hls"), "ready");
    assert.equal(f.scripts.length, 1);
});

test("failed or late Shaka never installs upstream polyfills", () => {
    const f = fixture(), loader = f.window.OTT2VendorLoader;
    loader.load("shaka", () => {});
    const late = f.scripts[0].onload;
    f.scripts[0].onerror(); publish(f, "shaka"); late();
    assert.deepEqual(f.calls, ["start"]);
    assert.equal(f.window.OTT2Vendors.shaka, null);
});

test("Shaka polyfill errors remain a bounded optional-engine failure", () => {
    const f = fixture(); let error;
    f.window.OTT2VendorLoader.load("shaka", value => { error = value; });
    f.window.shaka = { Player() {}, polyfill: { installAll() { throw new Error("Fixture"); } } };
    f.scripts[0].onload();
    assert.equal(error.code, "vendor_polyfill");
    assert.equal(f.window.OTT2Vendors.shaka, null);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.calls, ["start"]);
});

test("unknown engine names do not create requests or read inherited keys", () => {
    const f = fixture(), loader = f.window.OTT2VendorLoader;
    for (const name of ["toString", "__proto__", "constructor", "unknown", null]) {
        let error;
        loader.load(name, value => { error = value; });
        assert.equal(error.code, "vendor_unavailable");
        assert.equal(loader.canLoad(name), false);
    }
    assert.equal(f.scripts.length, 0);
});

test("an immutable preexisting global cannot impersonate a requested engine", () => {
    const f = fixture(), old = publish(f, "Hls");
    Object.defineProperty(f.window, "Hls", { value: old, writable: false });
    let error;
    f.window.OTT2VendorLoader.load("Hls", value => { error = value; });
    assert.equal(error.code, "vendor_invalid");
    assert.equal(f.window.OTT2Vendors.Hls, null);
    assert.equal(f.scripts.length, 0);
    assert.equal(f.timers.size, 0);
});
