"use strict";
const assert = require("node:assert/strict");
const { parse } = require("acorn");

// Kotlin 2.4.20 emits these empty collection marker interfaces in JVM hash-set
// order. They only add membership flags: none has prototype/default methods.
// Do not reorder arbitrary interfaces, since their default methods can collide.
const markers = new Set(["Collection", "KtList", "KtSet", "MutableIterable", "RandomAccess"]);
function canonicalJavaScript(source) {
    const ast = parse(source, { ecmaVersion: 5, sourceType: "script" });
    const constructors = new Set(), registrations = new Set(), replacements = [];
    function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "FunctionDeclaration" && markers.has(node.id.name)) {
            assert.equal(node.body.body.length, 0, "Marker interface acquired a body");
            constructors.add(node.id.name);
        }
        if (node.type === "MemberExpression" && markers.has(node.object.name)) {
            assert(node.property.type === "Identifier" && node.property.name !== "prototype",
                "Marker interface acquired prototype behavior");
        }
        if (node.type === "CallExpression") {
            const args = node.arguments, name = node.callee.name;
            assert(!(name === "protoOf" && markers.has(args[0]?.name)),
                "Marker interface acquired prototype behavior");
            if (name === "initMetadataForInterface" && markers.has(args[0]?.name)) {
                assert(args.length <= 5 && [2, 3].every(index => !args[index] || args[index].name === "VOID") &&
                    (!args[4] || (args[4].type === "ArrayExpression" && args[4].elements.every(item => markers.has(item?.name)))),
                    "Marker interface acquired behavior outside the marker set");
                registrations.add(args[0].name);
            }
            const interfaces = args[4];
            if (name === "initMetadataForClass" && interfaces?.type === "ArrayExpression" &&
                interfaces.elements.length > 1 && interfaces.elements.every(item => item?.type === "Identifier" && markers.has(item.name))) {
                replacements.push({ start: interfaces.start, end: interfaces.end,
                    text: "[" + interfaces.elements.map(item => item.name).sort().join(", ") + "]" });
            }
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
        }
    }
    visit(ast);
    assert.deepEqual(constructors, markers, "Compiler marker declarations changed");
    assert.deepEqual(registrations, markers, "Compiler marker registrations changed");
    assert(replacements.length > 0, "Compiler metadata shape changed");
    for (const edit of replacements.sort((a, b) => b.start - a.start)) {
        source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    }
    return source;
}
module.exports = { canonicalJavaScript };
