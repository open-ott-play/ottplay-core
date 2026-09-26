"use strict";
const assert = require("node:assert/strict");
const { parse } = require("acorn");
const { minify } = require("terser");

// Only shorten local declarations whose function object never escapes a direct
// call. Constructors, callbacks, exports and metadata registrations keep their
// names. A spelling with any shadowing is kept because keep_fnames matches text,
// not lexical bindings. Known dynamic reflection disables this optimization.
function privateFunctionNames(ast) {
    const declarations = [], bindings = new Map(), references = new Map();
    let dynamic = false;
    function bind(node) {
        if (node?.type === "Identifier") bindings.set(node.name, (bindings.get(node.name) || 0) + 1);
    }
    function visit(node, parent, depth) {
        if (!node || typeof node !== "object" || !node.type) return;
        const callable = node.type === "FunctionDeclaration" || node.type === "FunctionExpression";
        if (node.type === "Identifier") {
            if (!references.has(node.name)) references.set(node.name, []);
            references.get(node.name).push({ node, parent });
            if (node.name === "eval" || node.name === "Function") dynamic = true;
        }
        if (node.type === "WithStatement" ||
            (node.type === "Literal" && (node.value === "caller" || node.value === "callee"))) dynamic = true;
        if (node.type === "MemberExpression") {
            if (!node.computed && ["caller", "callee"].includes(node.property.name)) dynamic = true;
            if (node.object.type === "Identifier" && node.object.name === "arguments" && node.computed &&
                !(node.property.type === "Literal" && typeof node.property.value === "number")) dynamic = true;
        }
        if (node.type === "VariableDeclarator") bind(node.id);
        if (node.type === "CatchClause") bind(node.param);
        if (callable) {
            bind(node.id);
            node.params.forEach(bind);
            if (depth > 0 && node.type === "FunctionDeclaration" && node.id) declarations.push(node);
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(child => visit(child, node, depth + (callable ? 1 : 0)));
            else if (value && typeof value === "object") visit(value, node, depth + (callable ? 1 : 0));
        }
    }
    visit(ast, null, 0);
    if (dynamic) return [];
    return declarations.filter(declaration => bindings.get(declaration.id.name) === 1 &&
        references.get(declaration.id.name).every(({ node, parent }) => node === declaration.id ||
            (parent.type === "CallExpression" && parent.callee === node)))
        .map(declaration => declaration.id.name).sort();
}

async function minifyJavaScript(source) {
    const ast = parse(source, { ecmaVersion: 5, sourceType: "script" });
    const privateNames = privateFunctionNames(ast);
    const keepFunctionNames = privateNames.length
        ? new RegExp("^(?!(?:" + privateNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")$)")
        : true;
    // Kotlin exception names use constructor.name. Exported callbacks retain
    // their names and arity; property names form the browser/native public ABI.
    const result = await minify(source, {
        compress: {
            arguments: false,
            booleans_as_integers: false,
            drop_console: false,
            drop_debugger: false,
            keep_fargs: true,
            passes: 3,
            pure_getters: false,
            toplevel: false,
            typeofs: false,
            unsafe: false
        },
        ecma: 5,
        format: { comments: false, webkit: true },
        ie8: true,
        keep_classnames: true,
        keep_fnames: keepFunctionNames,
        mangle: { eval: false, properties: false, toplevel: false },
        module: false,
        safari10: true,
        toplevel: false
    });
    assert(result.code, "Core minifier produced no JavaScript");
    parse(result.code, { ecmaVersion: 5, sourceType: "script" });
    return "/*! OttPlay shared core with Kotlin runtime; see ottplay-core.LICENSE.txt. */\n" + result.code + "\n";
}

module.exports = { minifyJavaScript, privateFunctionNames };
