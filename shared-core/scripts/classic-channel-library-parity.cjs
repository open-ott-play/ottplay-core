"use strict";

// Differential characterization of the frozen classic consumer and its reviewed
// delegation seam. Default mode uses digest-bound fixture ports without external
// dependencies. --foss-root additionally verifies the immutable Git source and
// patch preimages, and transpiles them in memory; no consumer files are written.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "classic-channel-library-vectors.json"), "utf8"));
const args = process.argv.slice(2);
function option(name, fallback) {
    const at = args.indexOf(name);
    return at < 0 ? fallback : args[at + 1];
}
const corePath = option("--core");
if (!corePath) throw new Error("Usage: node classic-channel-library-parity.cjs --core QUALIFIED_JS [--foss-root CHECKOUT] [--typescript MODULE]");
function hash(text) { return createHash("sha256").update(text).digest("hex"); }
const core = fs.readFileSync(path.resolve(corePath), "utf8");
const programs = vectors.fixtures.map(fixture => {
    const file = path.resolve(__dirname, fixture.path);
    assert(file.startsWith(path.join(__dirname, "fixtures") + path.sep), "Fixture path escapes fixtures");
    const program = fs.readFileSync(file, "utf8");
    assert.equal(Buffer.byteLength(program), fixture.bytes, "Characterization fixture size differs");
    assert.equal(hash(program), fixture.sha256, "Characterization fixture digest differs");
    return program;
});
const fossRoot = option("--foss-root");
if (fossRoot) {
    const foss = path.resolve(fossRoot);
    const typescriptPath = option("--typescript");
    const ts = require(typescriptPath || require.resolve("typescript", { paths: [foss] }));
    assert.equal(ts.version, vectors.baseline.typescript, "Characterization compiler changed");
    const baseline = execFileSync("git", ["-C", foss, "show", vectors.baseline.commit + ":" + vectors.baseline.path], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.equal(hash(baseline), vectors.baseline.sha256, "Frozen consumer differs");
    const lines = baseline.match(/[^\n]*\n|[^\n]+$/g) || [];
    for (const edit of vectors.consumer_edits.slice().reverse()) {
        assert.equal(hash(lines.slice(edit.line, edit.line + edit.remove).join("")), edit.before_sha256, "Consumer seam preimage differs");
        lines.splice(edit.line, edit.remove, ...edit.insert);
    }
    const candidate = lines.join("");
    assert.equal(hash(candidate), vectors.candidate_sha256, "Consumer seam differs from reviewed patch");
    for (const [index, source] of [baseline, candidate].entries()) {
        const output = ts.transpileModule(source, { compilerOptions: vectors.compiler.options, reportDiagnostics: true });
        assert(!output.diagnostics.some(item => item.category === ts.DiagnosticCategory.Error), "Consumer fixture syntax");
        assert.equal(vectors.fixtures[index].banner + output.outputText, programs[index], "Frozen fixture differs from immutable source transpilation");
    }
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function value(value) {
    if (value === undefined) return { type: "undefined" };
    if (typeof value === "function") return { type: "function", name: value.name };
    return copy(value);
}
function run(program, test) {
    const store = Object.assign(Object.create(null), copy(test.store || {}));
    const persisted = Object.assign(Object.create(null), store);
    const events = []; let current = true, persistWrites = true, draws = 0;
    const realm = { console, Math: Object.create(Math) };
    realm.window = realm; realm.self = realm;
    realm.Math.random = () => { const sample = (test.random || [])[draws++] ?? 0.5; events.push(["random", sample]); return sample; };
    const context = vm.createContext(realm);
    vm.runInContext(core, context, { timeout: 10000 });
    assert.equal(realm.OttPlayCore.classicChannelLibraryApiVersion(), 1);
    vm.runInContext(program, context, { timeout: 10000 });
    const ports = {
        sourceId: "source", legacySelection: copy(test.legacySelection || null),
        current() { events.push(["current", current]); return current; },
        get(key) { events.push(["get", key]); if (test.throwReads) throw new Error("read unavailable"); return Object.hasOwn(store, key) ? store[key] : null; },
        getPersisted(key) { events.push(["persisted", key]); return Object.hasOwn(persisted, key) ? persisted[key] : null; },
        set(key, text) { events.push(["set", key, text]); store[key] = text; if (persistWrites) persisted[key] = text; },
    };
    let model = realm.__ottChannelLibrary.create(ports, copy(test.catalog));
    function capture() {
        let document;
        try { document = value(model.document()); } catch (_) { document = { refused: true }; }
        return { document, snapshot: value(model.snapshot()), store: copy(store), persisted: copy(persisted), draws, events: copy(events) };
    }
    const output = [capture()];
    for (const step of test.steps) {
        let result;
        if (Object.hasOwn(step, "current")) current = step.current;
        else if (Object.hasOwn(step, "persistWrites")) persistWrites = step.persistWrites;
        else if (step.reload) model = realm.__ottChannelLibrary.create(ports, copy(step.reload));
        else {
            try { result = value(model[step.method](...copy(step.args))); }
            catch (error) { result = { thrown: String(error && error.message) }; }
        }
        output.push({ result: result ?? { control: true }, ...capture() });
    }
    return output;
}
let snapshots = 0;
for (const test of vectors.cases) {
    const original = run(programs[0], test);
    const delegated = run(programs[1], test);
    assert.deepEqual(delegated, original, "Classic library characterization: " + test.name);
    snapshots += original.length;
}
console.log(JSON.stringify({ status: "PASS", scenarios: vectors.cases.length, snapshots, source: vectors.baseline.commit,
    compiled_core_sha256: hash(core), consumer_candidate_sha256: vectors.candidate_sha256,
    source_verification: fossRoot ? "Immutable Git source, patch preimages and frozen fixture bytes verified" : "Digest-bound offline characterization fixtures",
    scope: "Actual compiled core versus frozen classic consumer; exact method outcomes, model/store bytes, I/O order and random draws. No consumer files or services changed." }));
