"use strict";
// Exact JS boundary vectors: JVM Double formatting must never substitute for Number/String.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bundle = process.argv[2] || path.join(__dirname, "../dist/ottplay-core.js");
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(bundle, "utf8"), context, { timeout: 10000 });
const core = context["play.ott:ottplay-shared-core"];
assert(core, "Qualified classic export required");
const create = core.createClassicChannelReferences;
assert.equal(typeof create, "function");
const plain = value => JSON.parse(JSON.stringify(value));
const eq = (actual, expected) => assert.deepEqual(plain(actual), expected);

let graph = create({ 1: { itemId: "one" }, 2: { itemId: "two", legacyChannelId: 1 } });
eq(graph.resolve(1, "canonical"), { itemId: "one" });
eq(graph.resolve(1, "raw"), { legacyId: 1, origin: "raw", ambiguous: true });
eq(graph.resolve("2", "raw"), { itemId: "two" });
assert.equal(graph.project({ itemId: "two" }), 2);
assert.equal(graph.project({ itemId: 2 }), null);
assert.equal(graph.project(null), null);

graph = create({ 3: { itemId: "third" } }, { 1: 2, 2: 3 });
eq(graph.resolve(1, "raw"), { itemId: "third" });
eq(graph.resolve(1, "canonical"), { legacyId: 1, origin: "canonical" });
for (const [aliases, expected] of [
    [{ 1: 2, 2: 1 }, true], [{ 1: 1 }, true], [{ 3: 3 }, false], [{ 3: null }, true],
]) {
    const value = Object.hasOwn(aliases, "3") ? 3 : 1;
    assert.equal(!!create({ 3: { itemId: "third" } }, aliases).resolve(value, "raw").ambiguous, expected);
}
graph = create({ 2: { itemId: "same", legacyChannelId: 1 }, 3: { itemId: "same", legacyChannelId: 1 } });
eq(graph.resolve(1, "raw"), { itemId: "same" });
assert.equal(graph.project(graph.resolve(1, "raw")), null);

// Object.keys order is significant for normalized-key collisions.
graph = create({ "01": { itemId: "newer" }, "1": { itemId: "older" } });
eq(graph.resolve("001", "canonical"), { itemId: "newer" });
assert.equal(graph.project({ itemId: "older" }), 1);

graph = create({
    "-00": {}, "9007199254740993": {}, "1000000000000000000000": {}, "1000000000000000128": {},
});
for (const [value, expected] of [
    [-0, "channel:0"], ["00", "channel:0"], ["9007199254740992", "channel:9007199254740992"],
    ["1000000000000000000000", "channel:1e+21"], ["1000000000000000100", "channel:1000000000000000100"],
]) eq(graph.resolve(value, "canonical"), { itemId: expected });
for (const raw of ["1e3", "+1", " 1", "1.0", "", "9".repeat(310), 1e21, Infinity, NaN, null, undefined, true, {}, []]) {
    const pending = graph.resolve(raw, "raw");
    assert.equal(pending.legacyId, raw, "Pending values retain exact type/value/object identity");
    assert.equal(pending.origin, "raw");
    assert.equal(Object.hasOwn(pending, "ambiguous"), false);
}
eq(create({ "1000000000000000000000": { legacyChannelId: 1 } }).resolve(1, "raw"),
    { legacyId: 1, origin: "raw", ambiguous: true });

const special = Object.create(null);
special["1"] = { itemId: "__proto__" };
special["2"] = { itemId: "constructor" };
special["3"] = { itemId: 0 };
special["4"] = { itemId: { toString: () => "opaque" } };
graph = create(special, Object.create(null));
eq(graph.resolve(1, "raw"), { itemId: "__proto__" });
eq(graph.resolve(3, "raw"), { itemId: "channel:3" });
eq(graph.resolve(4, "raw"), { itemId: "opaque" });
assert.equal(graph.project({ itemId: "constructor" }), 2);

let itemReads = 0, legacyReads = 0;
const accessors = {
    "1": {
        get itemId() { itemReads++; return "getter-item"; },
        get legacyChannelId() { legacyReads++; return 2; },
    },
    invalid: {
        get itemId() { throw new Error("Invalid numeric rows must not be read"); },
    },
};
graph = create(accessors);
assert.equal(itemReads, 1, "Classic itemId getter reads once");
assert.equal(legacyReads, 2, "Classic defined legacy ID getter is checked, then read");
eq(graph.resolve(2, "raw"), { itemId: "getter-item" });

const presets = core.m3uUserAgentPresets();
assert.deepEqual(Object.keys(presets), ["dune", "mag", "tizen", "viera", "webos"]);
for (const [key, value] of Object.entries(presets)) {
    assert.equal(core.resolveM3uUserAgent(key), value);
    assert.equal(core.resolveM3uUserAgent(key.toUpperCase()), value);
}
for (const raw of [null, undefined, ""]) assert.equal(core.resolveM3uUserAgent(raw), "OTT-play-FOSS/1.0");
for (const raw of [" ", " WebOS ", "CUSTOM/Ä", "__proto__", "constructor", "KODI", "TİZEN", "WEBOſ", "ẞ"]) assert.equal(core.resolveM3uUserAgent(raw), raw);
presets.webos = "changed";
assert.notEqual(core.resolveM3uUserAgent("WebOS"), "changed");
assert.equal(core.m3uDefaultUserAgent(), "OTT-play-FOSS/1.0");
console.log("PASS classic reference numeric graph, raw-value preservation, and M3U user-agent JS boundaries");
