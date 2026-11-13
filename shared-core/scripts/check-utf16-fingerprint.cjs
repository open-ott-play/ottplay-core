"use strict";
// Frozen goldens and three independent pre-extraction host loops; no sibling checkout required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const vectors = require("./fixtures/utf16-fingerprint-vectors.json");
const original = require("./fixtures/utf16-fingerprint-baseline.cjs");
const bundle = process.argv[2] || path.join(__dirname, "../dist/ottplay-core.js");
const bytes = fs.readFileSync(bundle, "utf8");
const context = vm.createContext({});
vm.runInContext(bytes, context, { timeout: 10000 });
const core = context["play.ott:ottplay-shared-core"];
assert.equal(typeof core.utf16Dual32Fingerprint, "function");
function check(value, expectedDash, expectedDot) {
    const dash = original.identity(value), provider = original.provider(value), dot = original.source(value).slice("fingerprint@".length);
    assert.equal(provider, dash);
    assert.equal(dot, dash.replace("-", "."));
    if (expectedDash !== undefined) assert.equal(dash, expectedDash);
    if (expectedDot !== undefined) assert.equal(dot, expectedDot);
    assert.equal(core.utf16Dual32Fingerprint(value, "-"), dash);
    assert.equal(core.utf16Dual32Fingerprint(value, "."), dot);
}
for (const vector of vectors.vectors) {
    const value = vector.repeat ? String.fromCharCode(vector.repeat.unit).repeat(vector.repeat.count) : String.fromCharCode(...vector.units);
    check(value, vector.dash, vector.dot);
}
let seed = 0x8cfa9531;
const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
for (let i = 0; i < 8192; i++) {
    let value = "";
    const length = next() % 129;
    for (let j = 0; j < length; j++) value += String.fromCharCode(next() & 0xffff);
    check(value);
}
assert.equal(core.utf16Dual32Fingerprint("hello", "::"), "4f9f2cab::a9cede7");
assert.equal(core.utf16Dual32Fingerprint("hello", ""), "4f9f2caba9cede7");
console.log(JSON.stringify({ status: "passed", goldenVectors: vectors.vectors.length, generatedUtf16Vectors: 8192,
    oracleCount: 3, bundleSha256: createHash("sha256").update(bytes).digest("hex") }));
