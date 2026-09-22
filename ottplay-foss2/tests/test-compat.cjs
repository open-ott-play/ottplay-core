const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");

const root = path.resolve(__dirname, "..");
const bootstrap = fs.readFileSync(path.join(root, "src/compat.js"), "utf8");
const polyfills = fs.readFileSync(path.join(root, "vendor/core-js.min.js"), "utf8");
const hls = fs.readFileSync(path.join(root, "vendor/hls.min.js"), "utf8");

const removeModern = `
    Promise = Symbol = Map = Set = WeakMap = WeakSet = URL = URLSearchParams = undefined;
    performance = undefined;
    ["assign", "entries", "values", "is", "getOwnPropertyDescriptors", "getOwnPropertySymbols", "setPrototypeOf"].forEach(function (key) { delete Object[key]; });
    ["from", "of"].forEach(function (key) { delete Array[key]; });
    ["includes", "find", "findIndex"].forEach(function (key) { delete Array.prototype[key]; });
    ["includes", "startsWith", "endsWith"].forEach(function (key) { delete String.prototype[key]; });
    delete String.fromCodePoint;
    ["isFinite", "isNaN", "isInteger", "isSafeInteger"].forEach(function (key) { delete Number[key]; });
    ["imul", "clz32", "log2", "trunc"].forEach(function (key) { delete Math[key]; });
    var typedArrayConstructor = Object.getPrototypeOf(Uint8Array);
    var typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    ["from", "of", "fromBase64", "fromHex"].forEach(function (key) { delete typedArrayConstructor[key]; delete Uint8Array[key]; });
    ["slice", "includes", "find", "findIndex"].forEach(function (key) { delete typedArrayPrototype[key]; });
    delete ArrayBuffer.isView;
`;

function realm(options = {}) {
    const context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval });
    vm.runInContext("self = this;" + (options.worker ? "" : "window = this;"), context);
    if (options.legacy) vm.runInContext(removeModern, context);
    if (options.before) vm.runInContext(options.before, context);
    vm.runInContext(bootstrap, context, { filename: "compat.js" });
    if (options.polyfills !== false) {
        vm.runInContext(polyfills, context, { filename: "core-js.min.js" });
        vm.runInContext("OTT2Compat.install();", context);
    }
    return context;
}

function value(context, source) {
    return JSON.parse(vm.runInContext("JSON.stringify(" + source + ")", context));
}

test("the browser legacy fixture also boots the upstream polyfills in an isolated VM", () => {
    const browserTest = fs.readFileSync(path.join(root, "tests/browser-compat.cjs"), "utf8");
    const match = browserTest.match(/const removeLegacyGlobals = (`[\s\S]*?`);/);
    assert.ok(match, "The real browser test must expose its legacy API removal fixture");
    const removal = vm.runInNewContext(match[1]);
    const context = realm({ before: removal });
    assert.equal(context.OTT2Compat.ready, true, String(context.OTT2Compat.missing));
    assert.equal(context.OTT2Compat.nativeBinary, true);
    assert.equal(vm.runInContext("typeof Map", context), "function");
});

test("compatibility bootstrap and unmodified upstream bundle parse as ES5", () => {
    acorn.parse(bootstrap, { ecmaVersion: 5 });
    acorn.parse(polyfills, { ecmaVersion: 5 });
});

test("working native constructors and performance clock retain identity", () => {
    const context = realm({ before: `
        nativeReferences = { Promise: Promise, Map: Map, Set: Set, WeakMap: WeakMap,
            WeakSet: WeakSet, Symbol: Symbol, Uint8Array: Uint8Array, DataView: DataView,
            ArrayBuffer: ArrayBuffer, assign: Object.assign, from: Array.from };
        performance = { now: function () { return 10; }, timeOrigin: 123 };
        nativeClock = performance.now;
    ` });
    assert.equal(vm.runInContext(`Object.keys(nativeReferences).every(function (name) {
        return nativeReferences[name] === (name === 'assign' ? Object.assign : name === 'from' ? Array.from : self[name]);
    })`, context), true);
    assert.equal(vm.runInContext("performance.now === nativeClock && performance.timeOrigin === 123", context), true);
    assert.equal(context.OTT2Compat.nativeBinary, true);
    assert.equal(context.OTT2Compat.ready, true);
});

for (const worker of [false, true]) {
    test((worker ? "Worker" : "window") + " restores required language APIs before Hls.js evaluation", () => {
        const context = realm({ worker, legacy: true });
        assert.equal(context.OTT2Compat.nativeBinary, true);
        assert.equal(context.OTT2Compat.ready, true, String(context.OTT2Compat.missing));
        assert.equal(vm.runInContext("typeof fetch", context), "undefined");
        assert.equal(vm.runInContext("typeof ReadableStream", context), "undefined");
        assert.equal(vm.runInContext("typeof MediaSource", context), "undefined");
        vm.runInContext(hls, context, { filename: "hls.min.js" });
        assert.equal(vm.runInContext("Hls.version", context), "1.7.3");
        assert.equal(vm.runInContext("Hls.isSupported()", context), false);
    });
}

test("collections preserve keys, insertion order, NaN and frozen weak keys", () => {
    const context = realm({ legacy: true });
    const result = value(context, `(function () {
        var first = {}, second = {}, map = new Map(), set = new Set(), weak = new WeakMap();
        map.set(first, 'first'); map.set(NaN, 'nan'); map.set(second, 'second');
        map.set(-0, 'zero'); map.set(0, 'updated'); map.set(first, 'changed');
        set.add(NaN); set.add(NaN); set.add(-0); set.add(0);
        var frozen = Object.freeze({}); weak.set(frozen, 7);
        var iterator = map.entries(), iteratorFirst = iterator.next();
        return [map.size, map.get(NaN), map.get(first), map.get(0), set.size,
            weak.get(frozen), iteratorFirst.value[0] === first, iteratorFirst.value[1],
            Array.from(map.values()), Array.from(set).length];
    })()`);
    assert.deepEqual(result, [4, "nan", "changed", "updated", 2, 7, true, "changed", ["changed", "nan", "second", "updated"], 2]);
});

test("Symbol keys remain non-string keys and iterables work with Array.from", () => {
    const context = realm({ legacy: true });
    assert.deepEqual(value(context, `(function () {
        var key = Symbol('private'), object = { visible: 1 }, iterable = {}, count = 0;
        object[key] = 2;
        iterable[Symbol.iterator] = function () { return { next: function () { return count < 3 ? { value: count++, done: false } : { done: true }; } }; };
        return [Object.keys(object), Object.getOwnPropertyNames(object), Object.getOwnPropertySymbols(object).length,
            JSON.stringify(object), Array.from(iterable), Array.from('A\\uD83D\\uDE00B')];
    })()`), [["visible"], ["visible"], 1, '{"visible":1}', [0, 1, 2], ["A", "😀", "B"]]);
});

test("Promise is asynchronous, assimilates thenables and supports withResolvers", async () => {
    const context = realm({ legacy: true });
    const result = vm.runInContext(`(function () {
        var order = [], deferred = Promise.withResolvers();
        var promise = Promise.resolve({ then: function (resolve) { resolve(4); resolve(99); } })
            .then(function (number) { order.push(number); return deferred.promise; })
            .finally(function () { order.push('finally'); });
        order.push('sync'); deferred.resolve(8);
        return promise.then(function (number) { return [number, order]; });
    })()`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(await result)), [8, ["sync", 4, "finally"]]);
});

test("typed-array helpers retain native buffers and correct slice semantics", () => {
    const context = realm({ legacy: true });
    assert.deepEqual(value(context, `(function () {
        var source = Uint8Array.from([10, 20, 30, 40]), slice = source.slice(-3, -1);
        slice[0] = 99;
        return [Array.from(source), Array.from(slice), slice.buffer !== source.buffer,
            ArrayBuffer.isView(source), ArrayBuffer.isView(new DataView(source.buffer)),
            Array.from(Uint8Array.fromHex('cafe')), Array.from(Uint8Array.fromBase64('T0s='))];
    })()`), [[10, 20, 30, 40], [99, 30], true, true, true, [202, 254], [79, 75]]);
});

test("numeric, string and object helpers retain standards behavior", () => {
    const context = realm({ legacy: true });
    assert.deepEqual(value(context, `(function () {
        var source = {}; Object.defineProperty(source, 'value', { get: function () { return 17; }, enumerable: true });
        var assigned = Object.assign({}, source);
        return [Number.isFinite('1'), Number.isFinite(1), Number.isNaN('NaN'), Number.isNaN(NaN),
            Number.isSafeInteger(9007199254740992), Math.imul(0xffffffff, 5), Math.clz32(1),
            Math.log2(8), Math.trunc(-2.8), [NaN].includes(NaN), new Array(1).includes(undefined),
            'channel'.startsWith('chan'), 'channel'.endsWith('nel'), Object.is(-0, 0), Object.is(NaN, NaN),
            Object.entries(assigned), typeof Object.getOwnPropertyDescriptors(source).value.get];
    })()`), [false, true, false, true, false, -5, 31, 3, -2, true, true, true, true, false, true, [["value", 17]], "function"]);
});

test("URL replacement preserves prefixed object URL calls and resolves manifest URLs", () => {
    const context = realm({ legacy: true, before: `
        urlCalls = [];
        webkitURL = {
            createObjectURL: function (object) { urlCalls.push(this === webkitURL); return 'blob:legacy/' + object.id; },
            revokeObjectURL: function (url) { urlCalls.push(this === webkitURL); urlCalls.push(url); }
        };
    ` });
    assert.deepEqual(value(context, `(function () {
        var objectURL = URL.createObjectURL({ id: 'video' }); URL.revokeObjectURL(objectURL);
        var url = new URL('../segment.ts?a=1&a=2', 'https://example.test/live/master.m3u8');
        url.searchParams.append('title', 'news & weather');
        return [objectURL, urlCalls, url.href, url.searchParams.getAll('a')];
    })()`), ["blob:legacy/video", [true, true, "blob:legacy/video"], "https://example.test/segment.ts?a=1&a=2&title=news+%26+weather", ["1", "2"]]);
});

test("capability capture cannot mistake JavaScript-emulated buffers for native media support", () => {
    const context = realm({ legacy: true, before: `
        ArrayBuffer = DataView = Uint8Array = Int8Array = Uint16Array = Int16Array = Uint32Array = Int32Array = Float32Array = Float64Array = undefined;
    ` });
    assert.equal(context.OTT2Compat.nativeBinary, false);
    assert.equal(vm.runInContext("typeof Uint8Array", context), "function");
    vm.runInContext(bootstrap, context);
    vm.runInContext("OTT2Compat.install();", context);
    assert.equal(context.OTT2Compat.nativeBinary, false);
    assert.equal(vm.runInContext("typeof MediaSource", context), "undefined");
    assert.equal(vm.runInContext("typeof Worker", context), "undefined");
});

test("missing compatibility bundle reports missing capabilities instead of claiming readiness", () => {
    const context = realm({ legacy: true, polyfills: false });
    vm.runInContext("OTT2Compat.install();", context);
    assert.equal(context.OTT2Compat.ready, false);
    assert.ok(Array.from(context.OTT2Compat.missing).includes("Promise"));
    assert.ok(Array.from(context.OTT2Compat.missing).includes("Object.entries"));
});

test("fallback performance clock stays nonnegative and monotonic across wall-clock corrections", () => {
    const context = realm({ polyfills: false, before: `
        performance = undefined; simulatedTime = 1000;
        Date = function () { this.getTime = function () { return simulatedTime; }; };
    ` });
    vm.runInContext("OTT2Compat.install();", context);
    assert.deepEqual(value(context, `(function () {
        var readings = [performance.now()]; simulatedTime = 1050; readings.push(performance.now());
        simulatedTime = 900; readings.push(performance.now()); simulatedTime = 1100; readings.push(performance.now());
        return readings;
    })()`), [0, 50, 50, 100]);
});
