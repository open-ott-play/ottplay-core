"use strict";
// Read-only comparison of already shipped exports. No timing acceptance gate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const hash = value => createHash("sha256").update(value).digest("hex");
const usage = "Usage: node qualify-classic-existing.cjs --baseline SHIPPED_JS --core CANDIDATE_JS --output OUTSIDE_REPO.json [--rounds 40] [--warmup 5]";
const options = Object.create(null);
for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    if (flag === "--help") { console.log(usage); process.exit(0); }
    assert(["--baseline", "--core", "--output", "--rounds", "--warmup"].includes(flag) && process.argv[i + 1], usage);
    assert(!Object.hasOwn(options, flag), "Duplicate option: " + flag);
    options[flag] = process.argv[i + 1];
}
assert(options["--baseline"] && options["--core"] && options["--output"], usage);
const rounds = Number(options["--rounds"] || 40), warmup = Number(options["--warmup"] || 5);
assert(Number.isInteger(rounds) && rounds >= 2 && rounds <= 1000, "rounds must be 2..1000");
assert(Number.isInteger(warmup) && warmup >= 1 && warmup <= 100, "warmup must be 1..100");
const repo = fs.realpathSync(path.join(__dirname, "../.."));
const requestedOutput = path.resolve(options["--output"]);
const output = path.join(fs.realpathSync(path.dirname(requestedOutput)), path.basename(requestedOutput));
assert(output !== repo && !output.startsWith(repo + path.sep), "Output must be outside repository");
assert(!fs.existsSync(output), "Output already exists; choose a new path");
const provenance = {};
const realms = ["--baseline", "--core"].map(flag => {
    const source = fs.readFileSync(fs.realpathSync(path.resolve(options[flag])), "utf8");
    provenance[flag === "--baseline" ? "baseline" : "candidate"] = { sha256: hash(source), bytes: Buffer.byteLength(source) };
    const realm = vm.createContext({});
    vm.runInContext(source, realm, { timeout: 10000 });
    const api = realm["play.ott:ottplay-shared-core"];
    for (const name of ["classicPortableSnapshot", "classicInstallationState"]) assert.equal(typeof api?.[name], "function", flag + ": " + name);
    // Inspect in the value's own realm so ordinary/null/custom prototypes remain distinguishable.
    realm.inspect = vm.runInContext(`(function(value) {
        const prototype = Object.getPrototypeOf(value);
        return JSON.stringify({
            prototype: prototype === null ? "null" : prototype === Object.prototype ? "Object.prototype" : "custom",
            customPrototype: prototype && prototype !== Object.prototype ? JSON.stringify(prototype) : null,
            properties: Reflect.ownKeys(value).map(key => {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                return { key: typeof key === "symbol" ? ["symbol", key.description] : ["string", key],
                    enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable,
                    value: descriptor.value };
            }), json: JSON.stringify(value)
        });
    })`, realm);
    return { realm, api };
});
function summary(values) {
    const ordered = values.slice().sort((a, b) => a - b);
    const rank = fraction => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
    return { p50: rank(0.5), p95: rank(0.95), min: ordered[0], max: ordered[ordered.length - 1] };
}
const fixtures = [];
function fixture(name, entries, extra = {}) {
    const bag = Object.create(null);
    for (const [key, value] of entries) bag[key] = value;
    fixtures.push({ name, json: JSON.stringify(bag), keys: Object.keys(bag).length, ...extra });
}
const sensitive = [
    ["commandServerAddress", "synthetic.invalid"], ["commandServerToken", "synthetic-token"], ["commandServerEnabled", "1"],
    ["sLocalHttpEnabled", "1"], ["sLocalHttpDeviceCode", "synthetic-storage-code"], ["stb_settings_backup", "synthetic-backup"],
    ["localHttpEnabled", 1], ["localHttpDeviceCode", "synthetic-object-code"]
];
fixture("key-filter-and-order", [["z", "first"], ["10", "ten"], ["2", "two"], ["a", "last"],
    ["__proto__", "prototype-looking-key"], ["constructor", "constructor-looking-key"], ["prototype", "ordinary-key"],
    ["", "empty-key"], ["я", "unicode-key"], ...sensitive]);
fixture("object-values-and-prototype", [["before", { nested: [1, null, false] }], ["__proto__", { inheritedSynthetic: "value" }],
    ["commandServerAddress", false], ["commandServerToken", 0], ["localHttpEnabled", "1"], ["sLocalHttpEnabled", 1],
    ["localHttpDeviceCode", null], ["sLocalHttpDeviceCode", ""], ["after", true]]);
fixture("empty", []);
const shuffle = JSON.stringify({ version: 1, sourceId: "synthetic", groups: [{ id: "system:all", label: "",
    members: Array.from({ length: 10000 }, (_, i) => "item:" + (10000 - i)),
    shuffleBefore: Array.from({ length: 10000 }, (_, i) => "item:" + (i + 1)) }] });
for (const size of [1000, 10000]) {
    fixture("settings-" + size, [...Array.from({ length: size - sensitive.length - 1 }, (_, i) => ["setting:" + i, "synthetic:" + i]),
        ...sensitive, ["channelLibrary:synthetic", shuffle]], { persistedShuffleMembers: 10000, persistedShuffleUtf8Bytes: Buffer.byteLength(shuffle) });
}
const results = [];
for (const test of fixtures) {
    for (const storage of [false, true]) {
        for (const name of ["classicPortableSnapshot", "classicInstallationState"]) {
            const inputs = realms.map(({ realm }) => vm.runInContext("JSON.parse(" + JSON.stringify(test.json) + ")", realm));
            const before = inputs.map((input, side) => realms[side].realm.inspect(input));
            assert.equal(before[0], before[1], "Input fixture differs between realms");
            const elapsed = [[], []], ratios = [];
            let parityDigest;
            for (let round = -warmup; round < rounds; round++) {
                const order = (round + warmup) % 2 ? [1, 0] : [0, 1];
                const outcomes = [], times = [];
                for (const side of order) {
                    const { realm, api } = realms[side];
                    // Fresh output each call; immutable synthetic input reused. No baseline subtraction.
                    const start = performance.now();
                    const value = api[name](inputs[side], storage);
                    times[side] = performance.now() - start;
                    outcomes[side] = realm.inspect(value);
                    assert.equal(realm.inspect(inputs[side]), before[side], name + ": input mutated");
                }
                assert.equal(outcomes[1], outcomes[0], test.name + "/" + name + "/" + storage + ": exact value/prototype/property order parity");
                const digest = hash(outcomes[0]);
                if (parityDigest) assert.equal(digest, parityDigest, "Non-deterministic result");
                parityDigest = digest;
                if (round >= 0) {
                    assert(times.every(value => value >= 0), "Monotonic clock went backwards");
                    elapsed[0].push(times[0]); elapsed[1].push(times[1]);
                    if (times[0] > 0) ratios.push(times[1] / times[0]);
                }
            }
            const result = { fixture: test.name, api: name, storage, inputKeys: test.keys,
                inputUtf8Bytes: Buffer.byteLength(test.json), persistedShuffleMembers: test.persistedShuffleMembers || 0,
                persistedShuffleUtf8Bytes: test.persistedShuffleUtf8Bytes || 0,
                inputSha256: hash(test.json), parity: "PASS", outputSha256: parityDigest,
                milliseconds: { baseline: summary(elapsed[0]), candidate: summary(elapsed[1]) },
                candidateOverBaselinePairedRatio: ratios.length ? summary(ratios) : null,
                samplesMilliseconds: { baseline: elapsed[0], candidate: elapsed[1] } };
            results.push(result);
            console.log(JSON.stringify({ fixture: test.name, api: name, storage, parity: "PASS", milliseconds: result.milliseconds }));
        }
    }
}
const report = { schema: 1, status: "PASS", performanceAcceptance: "Not evaluated; PASS means exact parity and completed measurements only",
    generatedAt: new Date().toISOString(), provenance: { ...provenance, harnessSha256: hash(fs.readFileSync(__filename)) },
    runtime: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch,
        cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), execArgv: process.execArgv },
    methodology: { warmupPairs: warmup, measuredPairs: rounds, percentile: "nearest rank", pairOrder: "Alternating baseline/candidate and candidate/baseline",
        baseline: "Caller-supplied already-shipped runtime; exact file hash recorded, release provenance verified by caller",
        timedWork: "One existing exported function call across the host/VM boundary; includes runtime conversion and result allocation",
        verification: "Every pair compares exact JSON bytes, own property order/descriptors, output prototype and unchanged input; all data synthetic",
        exclusions: ["Runtime startup", "Input preparation", "Output inspection/parity checks", "Browser rendering, real storage and device behavior"],
        memory: "Not measured: no noisy retained-heap deltas or negative baseline-subtracted timings reported",
        caveat: "Same-process Node diagnostic; tiny-call ratios are noisy. No inferred device acceptance or timing thresholds." }, results };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", scenarios: results.length, output }));
