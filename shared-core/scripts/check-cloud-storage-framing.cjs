"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(process.argv[2] || path.join(root, "dist/ottplay-core.js"), "utf8"), context, { timeout: 10000 });
const core = context["play.ott:ottplay-shared-core"];
for (const api of ["readClassicCloudStorage", "readVersionedCloudStorage", "cloudStorageHeader", "cloudStorageEntry"]) assert.equal(typeof core[api], "function", api);
const vectors = JSON.parse(fs.readFileSync(path.join(root, "vectors/cloud-storage-framing.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));
function write(items) { return [core.cloudStorageHeader(), ...Object.keys(items).map(key => core.cloudStorageEntry(key, items[key])), "</properties>"].join("\n"); }
let cases = 0;
for (const row of vectors.cases) {
    assert.equal(write(row.items), row.xml, row.id + ": actual Classic writer bytes");
    assert.deepEqual(plain(core.readClassicCloudStorage(row.xml)), row.decoded, row.id + ": actual Classic reader bytes");
    assert.deepEqual(plain(core.readVersionedCloudStorage(row.xml)), row.decoded, row.id + ": current import profile");
    assert.equal(Object.getPrototypeOf(core.readClassicCloudStorage(row.xml)), null);
    cases++;
}
assert.deepEqual(plain(core.readClassicCloudStorage(vectors.legacy.xml)), vectors.legacy.decoded);
assert.equal(core.readVersionedCloudStorage(vectors.legacy.xml), null, "old literal XML remains with its host legacy profile");
for (const row of vectors.invalid) { assert.throws(() => core.readClassicCloudStorage(row.xml), row.id); cases++; }
const malformedStrings = ["&quot;unclosed", "&quot;\\x20&quot;", "&quot;\\u12zz&quot;", "&quot;x&quot;trailing", "&quot;x&quot;&quot;y&quot;", "&quot;trailing\\&quot;"];
for (const malformed of malformedStrings) {
    for (const api of ["readClassicCloudStorage", "readVersionedCloudStorage"]) {
        for (const [key, value] of [["&quot;key&quot;", malformed], [malformed, "&quot;value&quot;"]]) {
            const xml = core.cloudStorageHeader() + '\n<entry key="' + key + '">' + value + '</entry>\n</properties>';
            assert.throws(() => core[api](xml), error => error.name === "Error" && error.message === "Invalid cloud settings document", api + ": malformed JSON uses the cloud failure contract");
        }
    }
}
// Normalize only JSON grammar failures; unrelated native failures must retain their identity.
const nativeFailure = vm.runInContext("new TypeError('native parser failure')", context);
context.nativeFailure = nativeFailure;
vm.runInContext("var originalCloudJsonParse = JSON.parse; JSON.parse = function () { throw nativeFailure; };", context);
try {
    for (const api of ["readClassicCloudStorage", "readVersionedCloudStorage"]) {
        assert.throws(() => core[api](write({ key: "value" })), error => error === nativeFailure);
    }
} finally {
    vm.runInContext("JSON.parse = originalCloudJsonParse; delete nativeFailure; delete originalCloudJsonParse;", context);
}
for (const key of ["__proto__", "constructor", "prototype"]) assert.throws(() => core.cloudStorageEntry(key, "x"));
let touched = 0;
const wrong = new Proxy({}, { get() { touched++; throw "read"; }, ownKeys() { touched++; throw "keys"; } });
for (const value of [undefined, null, 0, true, [], wrong]) {
    assert.throws(() => core.readClassicCloudStorage(value));
    assert.throws(() => core.readVersionedCloudStorage(value));
    assert.throws(() => core.cloudStorageEntry(value, "x"));
    assert.throws(() => core.cloudStorageEntry("x", value));
}
assert.equal(touched, 0, "wrong-kind JS values are not recursively inspected/coerced");
const units = [];
for (let code = 0; code <= 0xffff; code++) units.push(String.fromCharCode(code));
const all = { "\u0000\ud800<&\"\uffff": "\u0001LZ\u0001" + units.join("") };
assert.equal(createHash("sha256").update(write(all)).digest("hex"), vectors.allUtf16WriterSha256, "all65536 units match actual Classic writer bytes");
assert.deepEqual(plain(core.readVersionedCloudStorage(write(all))), all, "all65536 UTF16 units preserve exact raw storage strings");
const entry = key => core.cloudStorageEntry(key, "x");
const tenThousand = core.cloudStorageHeader() + "\n" + Array.from({length:10000},(_,i)=>entry("k"+i)).join("\n") + "\n</properties>";
assert.equal(Object.keys(core.readVersionedCloudStorage(tenThousand)).length, 10000);
assert.throws(() => core.readVersionedCloudStorage(tenThousand.replace("</properties>", entry("overflow") + "</properties>")));
assert.equal(Object.keys(core.readClassicCloudStorage(tenThousand.replace("</properties>", entry("overflow") + "</properties>"))).length, 10001, "classic existing count policy not silently tightened");
assert.equal(core.readVersionedCloudStorage('<properties><comment>OTT-Play Preferences</comment><entry key="ordinary"><!--ottplay-storage-v2--></entry></properties>'), null, "marker-looking data is not version detection");
console.log("Cloud storage framing: " + cases + " actual Classic golden/malformed cases + UTF16, boundary and JS ingress checks passed.");
