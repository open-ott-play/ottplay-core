"use strict";
const assert = require("node:assert/strict");
const { canonicalJavaScript } = require("./canonical-js.cjs");
const declarations = ["Collection", "KtList", "KtSet", "RandomAccess"].map(name =>
    "function " + name + "() {}\ninitMetadataForInterface(" + name + ", '" + name + "');").join("\n");
const fixture = declarations + "\ninitMetadataForClass(List, 'List', VOID, Base, [KtList, Collection, RandomAccess]);\n" +
    "var order = [KtList, Collection];\ninitMetadataForClass(Other, 'Other', VOID, Base, [ZDefaults, ADefaults]);";
const expected = fixture.replace("[KtList, Collection, RandomAccess]", "[Collection, KtList, RandomAccess]");
assert.equal(canonicalJavaScript(fixture), expected);
assert.equal(canonicalJavaScript(expected), expected);
const inherited = fixture.replace("initMetadataForInterface(KtList, 'KtList')", "initMetadataForInterface(KtList, 'KtList', VOID, VOID, [Collection])");
assert.equal(canonicalJavaScript(inherited), expected.replace("initMetadataForInterface(KtList, 'KtList')", "initMetadataForInterface(KtList, 'KtList', VOID, VOID, [Collection])"));
assert.equal(canonicalJavaScript(fixture.replace("[KtList, Collection, RandomAccess]", "[RandomAccess, Collection, KtList]")), expected);
for (const changed of [
    fixture.replace("function KtList() {}", "function KtList() { return 1; }"),
    fixture + "\nKtList.prototype.test = function () {};",
    fixture + "\nprotoOf(Collection).test = function () {};",
    fixture.replace("initMetadataForInterface(KtList, 'KtList')", "initMetadataForInterface(KtList, 'KtList', Parent)")
]) assert.throws(() => canonicalJavaScript(changed));
console.log("PASS compiler metadata canonicalization: order-independent markers, preserved domain/default-method arrays, fail-closed compiler changes");
