"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const bundleFile = process.argv[2] || path.join(root, "dist/ottplay-core.js");
const bundle = fs.readFileSync(bundleFile, "utf8");
const vectors = JSON.parse(fs.readFileSync(path.join(root, "vectors/classic-global-favorites.json"), "utf8"));
const context = vm.createContext({ console });
vm.runInContext(bundle, context, { timeout: 10000 });
const core = context["play.ott:ottplay-shared-core"];
assert.equal(typeof core.createClassicGlobalFavoritesPortableCodec, "function");
const codec = core.createClassicGlobalFavoritesPortableCodec();
let checks = 0;
function same(actual, expected, label) {
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
    checks++;
}
function equal(actual, expected, label) { assert.equal(actual, expected, label); checks++; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function entry(id = "one", title = "News") {
    return { title, origin: { provider: "m3u", profile: "Home", subprofile: null, sourceAlias: "Main" }, locator: { kind: "channel", channelId: id } };
}
function doc(entries = [entry()]) { return { version: 1, entries }; }
function status(value, candidates, verify = () => true, current = () => true) {
    return codec.match(value, candidates, verify, current).status;
}

for (const vector of vectors.cases) {
    same(codec.normalize(vector.input), vector.normalized, vector.id + ": baseline normalization");
    equal(codec.identity(vector.input), vector.identity, vector.id + ": baseline identity");
    if (vector.normalized) same(codec.normalize(vector.normalized), vector.normalized, vector.id + ": idempotence");
}
same(codec.document(vectors.document.input), vectors.document.normalized, "baseline portable document");
same(codec.requiredLocatorKinds(vectors.document.input), vectors.document.required, "baseline sorted kinds");
equal(codec.identity(entry("one", "Renamed")), codec.identity(entry()), "title is not portable identity");
equal(codec.document(doc([entry(), entry("one", "Renamed")])), null, "renamed duplicate rejected");
equal(codec.document({ version: "1", entries: [] }), null, "version is numeric");
equal(codec.document(doc(Array.from({ length: 1001 }, (_, i) => entry("id" + i)))), null, "entry count bounded");
same(codec.document(doc([])), { entries: [], version: 1 }, "empty document retained");

// Object property descriptors form part of the v1 wire contract. No getter may run.
let getterCalls = 0;
for (const owner of ["entry", "origin", "locator"]) {
    for (const boundary of ["accessor", "hidden", "symbol"]) {
        const value = entry();
        const target = owner === "entry" ? value : value[owner];
        if (boundary === "accessor") {
            const field = Object.keys(target)[0];
            Object.defineProperty(target, field, { enumerable: true, get() { getterCalls++; throw Error("getter invoked"); } });
        } else if (boundary === "hidden") {
            Object.defineProperty(target, "hidden", { value: 1, enumerable: false });
        } else {
            target[Symbol("hidden")] = 1;
        }
        equal(codec.normalize(value), null, owner + ": reject " + boundary);
    }
}
const maliciousDocument = doc();
Object.defineProperty(maliciousDocument, "entries", { enumerable: true, get() { getterCalls++; return []; } });
equal(codec.document(maliciousDocument), null, "document accessor rejected");
const indexedEntries = [entry()];
Object.defineProperty(indexedEntries, "0", { enumerable: true, get() { getterCalls++; return entry(); } });
equal(codec.document(doc(indexedEntries)), null, "entry array accessor rejected");
const kindsWithGetter = ["channel"];
Object.defineProperty(kindsWithGetter, "0", { enumerable: true, get() { getterCalls++; return "channel"; } });
equal(codec.supports(doc(), kindsWithGetter), false, "advertised kind accessor rejected");
for (const [label, value, check, expected] of [
    ["entry", entry(), values => codec.document(doc(values)), codec.document(doc())],
    ["advertised kind", "channel", values => codec.supports(doc(), values), true]
]) {
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "0", { value, enumerable: false });
    const values = new Array(1);
    Object.setPrototypeOf(values, prototype);
    same(check(values), expected, label + ": inherited data slot retained");
    Object.defineProperty(values, "0", { value: label === "entry" ? entry("override") : "other" });
    assert.notEqual(JSON.stringify(check(values)), JSON.stringify(expected), label + ": own slot overrides inherited data"); checks++;
    const accessorPrototype = Object.create(Array.prototype);
    Object.defineProperty(accessorPrototype, "0", { get() { getterCalls++; return value; } });
    const accessorValues = new Array(1);
    Object.setPrototypeOf(accessorValues, accessorPrototype);
    equal(check(accessorValues), label === "entry" ? null : false, label + ": inherited accessor rejected");
}
// A small shared graph must not expand into a billion copies before schema rejection.
let copiedSlots = 0;
const leaf = new Proxy(Array(1000).fill("x"), {
    getOwnPropertyDescriptor(target, key) {
        if (key !== "length") copiedSlots++;
        return Reflect.getOwnPropertyDescriptor(target, key);
    }
});
const expandedTitle = Array(1000).fill(Array(1000).fill(leaf));
context.favoritesCodec = codec;
context.expandedFavorite = entry("oversized", expandedTitle);
equal(vm.runInContext("favoritesCodec.normalize(expandedFavorite)", context, { timeout: 2000 }), null, "recursive snapshot work bounded");
equal(copiedSlots, 0, "invalid scalar container rejected before array traversal");
// Invalid structural fields can still form a DAG; the global budget bounds it.
context.expandedFavorite = { entries: Array(1000).fill({ entries: Array(1000).fill(leaf) }) };
equal(vm.runInContext("favoritesCodec.normalize(expandedFavorite)", context, { timeout: 2000 }), null, "structural DAG snapshot work bounded");
assert(copiedSlots > 0 && copiedSlots <= 16384, "request-local node budget stops repeated subtree expansion"); checks++;
assert.notEqual(codec.normalize(entry()), null, "snapshot budget does not leak between calls"); checks++;
delete context.favoritesCodec;
delete context.expandedFavorite;
const candidatesWithGetter = [{}];
Object.defineProperty(candidatesWithGetter, "0", { enumerable: true, get() { getterCalls++; return { origin: entry().origin }; } });
equal(status(entry(), candidatesWithGetter), "unresolved", "candidate accessor rejected");
const candidateWithGetter = {};
Object.defineProperty(candidateWithGetter, "origin", { get() { getterCalls++; return entry().origin; } });
equal(status(entry(), [candidateWithGetter]), "unresolved", "candidate origin accessor rejected");
equal(getterCalls, 0, "hostile accessors are never invoked");
const inherited = Object.create({ unrelated: "ignored" });
Object.assign(inherited, entry());
same(codec.normalize(inherited), codec.normalize(entry()), "entry prototypes do not change own data shape");
const extraArrayProperties = [entry()];
Object.defineProperty(extraArrayProperties, "ignored", { get() { getterCalls++; return 1; } });
extraArrayProperties[Symbol("ignored")] = true;
same(codec.document(doc(extraArrayProperties)), codec.document(doc()), "array metadata remains ignored");
equal(getterCalls, 0, "ignored array metadata not read");

for (const [value, expected] of [[0, "0"], [-0, "0"], [9007199254740991, "9007199254740991"], ["item:1", "item:1"], ["__proto__", null], [-1, null], [1.5, null], [9007199254740992, null], [NaN, null], [Infinity, null], [null, null], [{}, null], ["x/y", null]]) {
    equal(codec.providerId(value), expected, "provider item ID " + String(value));
}
equal(codec.supports(doc(), ["channel", "plugin-future"]), true, "unknown advertised kinds remain additive");
equal(codec.supports(doc(), ["channel", ""]), true, "legacy advertised kind accepts empty unknown string");
equal(codec.supports(doc(), ["channel", "channel"]), false, "duplicate advertised kinds rejected");
equal(codec.supports(doc(), ["channel-name"]), false, "missing required kind rejected");
equal(codec.supports(doc(), ["channel", "x".repeat(65)]), false, "advertised kind length bounded");
equal(codec.supports(doc(), Array.from({ length: 33 }, (_, i) => "kind" + i)), false, "advertised kind count bounded");
equal(codec.supports(doc(), ["channel", 1]), false, "advertised kinds are strings");

const row = entry();
const candidate = { origin: clone(row.origin), opaque: { session: "retained" } };
let verifies = 0;
const result = codec.match(row, [candidate], (selected, locator) => {
    verifies++;
    equal(selected, candidate, "opaque candidate identity retained");
    same(locator, codec.normalize(row).locator, "verify sees normalized locator");
    return true;
}, () => true);
equal(result.status, "matched", "unique candidate matches");
equal(result.candidate, candidate, "returned candidate identity retained");
equal(verifies, 1, "only one verification");
same(result.entry, codec.normalize(row), "matched entry canonicalized");
equal(status(null, []), "invalid", "invalid entry");
equal(status(row, {}), "invalid", "candidate collection must be array");
equal(status(row, []), "missing", "missing profile never activated");
equal(status(row, [candidate, { origin: clone(row.origin) }]), "ambiguous", "ambiguous profile not guessed");
equal(status(row, [candidate], () => true, () => false), "stale", "stale before matching");
equal(status(row, [candidate], () => false), "unresolved", "failed verification");
equal(status(row, [candidate], () => 1), "unresolved", "verification requires exact true");
equal(status(row, [candidate], () => { throw Error("failed"); }), "unresolved", "verification failure isolated");
equal(status(row, [candidate], () => true, () => { throw Error("failed"); }), "unresolved", "freshness failure isolated");
for (const failure of ["not-an-Error", null, 7, Symbol("failure"), new Error("host-realm error")]) {
    equal(status(row, [candidate], () => { throw failure; }), "unresolved", "arbitrary callback throw isolated");
    equal(status(row, [candidate], () => true, () => { throw failure; }), "unresolved", "arbitrary freshness throw isolated");
    const trap = new Proxy(entry(), { ownKeys() { throw failure; } });
    equal(codec.normalize(trap), null, "arbitrary descriptor trap fails closed");
    equal(codec.identity(trap), "", "identity trap fails closed");
    equal(codec.document(new Proxy(doc(), { ownKeys() { throw failure; } })), null, "document trap fails closed");
    equal(status(trap, [candidate]), "invalid", "invalid proxied entry retains match status");
}
let freshness = 0;
equal(status(row, [candidate], () => false, () => ++freshness === 1), "stale", "second stale result takes precedence");
equal(freshness, 2, "freshness checked before and after verify");
equal(status(row, [candidate], () => true, () => "truthy"), "matched", "classic current callback uses truthiness");
const malformedOrigin = clone(row.origin);
Object.defineProperty(malformedOrigin, "profile", { enumerable: true, get() { getterCalls++; return "Home"; } });
equal(status(row, [{ origin: malformedOrigin }, candidate]), "matched", "malformed origin excluded without masking valid profile");
const inheritedCandidate = Object.create({ origin: clone(row.origin) });
equal(status(row, [inheritedCandidate]), "matched", "inherited candidate data origin retained");
const sparseCandidates = new Array(2);
sparseCandidates[1] = candidate;
equal(status(row, sparseCandidates), "matched", "sparse candidate slots skipped");
const inheritedSlots = new Array(1);
Object.setPrototypeOf(inheritedSlots, Object.assign(Object.create(Array.prototype), { 0: candidate }));
equal(status(row, inheritedSlots), "matched", "inherited data array slot retained");
equal(status(row, [null]), "unresolved", "malformed candidate fails closed");
equal(getterCalls, 0, "all callback boundary checks avoid getters");

// Generate an exact UTF-8 boundary fixture without storing a megabyte in Git.
const limitRows = Array.from({ length: 1000 }, (_, i) => entry("id" + i, "x"));
let remaining = 1048576 - Buffer.byteLength(JSON.stringify(codec.document(doc(limitRows))), "utf8");
assert(remaining > 0 && remaining < 1000 * 1023, "boundary fixture fits title capacities");
for (const value of limitRows) {
    const add = Math.min(remaining, 1023);
    value.title += "x".repeat(add);
    remaining -= add;
}
equal(remaining, 0, "exact byte boundary constructed");
const exactDocument = codec.document(doc(limitRows));
assert(exactDocument, "exact 1 MiB document accepted"); checks++;
equal(Buffer.byteLength(JSON.stringify(exactDocument), "utf8"), 1048576, "1 MiB normalized serialized size");
limitRows.find(value => value.title.length < 1024).title += "x";
equal(codec.document(doc(limitRows)), null, "1 MiB plus one byte rejected");

console.log("Classic global favorites: " + checks + " checks passed (" + vectors.cases.length + " frozen baseline vectors).");
