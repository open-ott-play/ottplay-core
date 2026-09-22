"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../src/commonMain");
let count = 0;
function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { visit(file); continue; }
        if (!file.endsWith(".kt")) continue;
        const source = fs.readFileSync(file, "utf8");
        assert(!/^import (?:java|javax|platform|kotlinx|play\.ott\.nativeapp)\./m.test(source), "Platform dependency in common core: " + file);
        assert(!/\bRegex\s*\(/.test(source), "Kotlin Regex requires unsupported ES5 flags: " + file);
        assert(!/\.replace(?:First)?\s*\(/.test(source), "Kotlin string replacement requires unsupported ES5 flags: " + file);
        assert(!/System\.currentTimeMillis|Date\.now|\bfetch\s*\(|\.readText\s*\(|stbPlayer|\bOTT2\b/.test(source), "Host effect or legacy runtime in common core: " + file);
        count++;
    }
}
visit(root);
assert(count > 0);
console.log("PASS portable core boundary: " + count + " source files");
