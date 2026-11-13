"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const args = process.argv.slice(2), at = args.indexOf("--core");
assert(args.length === 0 || args.length === 2 && at === 0 && args[1], "Usage: check-local-source-scans.cjs [--core COMPILED_JS]");
const compiled = fs.readFileSync(at < 0 ? path.join(__dirname, "../dist/ottplay-core.js") : path.resolve(args[at + 1]), "utf8");
const context = vm.createContext({});
vm.runInContext(compiled, context, {timeout: 10000});
const core = context.OttPlayCore;
assert.equal(typeof core.localSourceScanStatus, "function");
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "local-source-scans-vectors.json"), "utf8"));
function input(value) {
    if (value && typeof value === "object" && value.special) {
        if (value.special === "undefined") return undefined;
        if (value.special === "NaN") return NaN;
        if (value.special === "Infinity") return Infinity;
        if (value.special === "-Infinity") return -Infinity;
        throw new Error("Unknown scalar test literal");
    }
    return value;
}
for (const vector of vectors.cases) assert.equal(core.localSourceScanStatus(vector.advertised, vector.array,
    input(vector.matches), input(vector.generation), input(vector.state)), vector.expected, vector.name);
console.log(JSON.stringify({status: "PASS", contract: "local-source-scan scalar ABI", cases: vectors.cases.length,
    compiled_core_sha256: createHash("sha256").update(compiled).digest("hex")}));
