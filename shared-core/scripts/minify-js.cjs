"use strict";
const assert = require("node:assert/strict");
const { parse } = require("acorn");
const { minify } = require("terser");

async function minifyJavaScript(source) {
    parse(source, { ecmaVersion: 5, sourceType: "script" });
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
        keep_fnames: true,
        mangle: { eval: false, properties: false, toplevel: false },
        module: false,
        safari10: true,
        toplevel: false
    });
    assert(result.code, "Core minifier produced no JavaScript");
    parse(result.code, { ecmaVersion: 5, sourceType: "script" });
    return "/*! OttPlay shared core with Kotlin runtime; see ottplay-core.LICENSE.txt. */\n" + result.code + "\n";
}

module.exports = { minifyJavaScript };
