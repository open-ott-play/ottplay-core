"use strict";
// Read-only synthetic qualification. No device acceptance or unstable timing gate.
// node [--expose-gc] qualify-classic-performance.cjs --core FILE --output /outside/repo/report.json
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const hash = value => createHash("sha256").update(value).digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));
const usage = "Usage: node [--expose-gc] qualify-classic-performance.cjs --core FILE --output OUTSIDE_REPO.json [--rounds 15] [--warmup 3]";
const options = Object.create(null);
for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    if (flag === "--help") { console.log(usage); process.exit(0); }
    assert(["--core", "--output", "--rounds", "--warmup"].includes(flag) && process.argv[i + 1], usage);
    assert(!Object.hasOwn(options, flag), "Duplicate option: " + flag);
    options[flag] = process.argv[i + 1];
}
assert(options["--core"] && options["--output"], usage);
const rounds = Number(options["--rounds"] || 15), warmup = Number(options["--warmup"] || 3);
assert(Number.isInteger(rounds) && rounds >= 2 && rounds <= 1000, "rounds must be 2..1000");
assert(Number.isInteger(warmup) && warmup >= 1 && warmup <= 100, "warmup must be 1..100");
const repo = fs.realpathSync(path.join(__dirname, "../.."));
const corePath = fs.realpathSync(path.resolve(options["--core"]));
const output = path.resolve(options["--output"]);
// Resolve parent symlinks too; refuse all writes into the checkout or over inputs.
const outputParent = fs.realpathSync(path.dirname(output));
const outputReal = path.join(outputParent, path.basename(output));
assert(outputReal !== repo && !outputReal.startsWith(repo + path.sep), "Output must be outside repository");
assert(!fs.existsSync(outputReal), "Output already exists; choose a new path");
const runtime = fs.readFileSync(corePath, "utf8");
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "classic-channel-library-vectors.json"), "utf8"));
const fixtureSources = vectors.fixtures.map(fixture => {
    const source = fs.readFileSync(path.join(__dirname, fixture.path), "utf8");
    assert.equal(Buffer.byteLength(source), fixture.bytes);
    assert.equal(hash(source), fixture.sha256, "Library fixture digest");
    return source;
});
const referencePath = path.join(__dirname, "fixtures/classic-channel-references-9336a40.js");
const referenceSource = fs.readFileSync(referencePath, "utf8");
assert.equal(hash(referenceSource), "b78bd9ce31d28c5cac0a1d96dcf65187d01969e378f7a39d02c35a2a9c565605");
const realms = fixtureSources.map(source => {
    const realm = { console, Math: Object.create(Math) };
    realm.window = realm; realm.self = realm;
    vm.createContext(realm);
    vm.runInContext(runtime, realm, { timeout: 10000 });
    vm.runInContext(source, realm, { timeout: 10000 });
    return realm;
});
// Compile the frozen graph in a VM as well; both graphs cross the same host boundary.
vm.runInContext("this.frozenReferenceCreate = (function () { var module = { exports: {} };\n" + referenceSource + "\nreturn module.exports; })();", realms[0]);
const shared = realms[1]["play.ott:ottplay-shared-core"];
assert.equal(typeof shared.createClassicChannelReferences, "function");
const results = [];
function summary(samples) {
    const sorted = samples.slice().sort((a, b) => a - b);
    const quantile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    return { p50: quantile(0.5), p95: quantile(0.95), min: sorted[0], max: sorted[sorted.length - 1] };
}
function qualify(name, make, metadata, retain = false) {
    const elapsed = [[], []], ratios = [], memory = [[], []];
    let parityDigest, outcomeClassification;
    for (let round = -warmup; round < rounds; round++) {
        const outcomes = [], times = [];
        // Reverse order on alternate pairs, including warmup; setup is never timed.
        const order = (round + warmup) % 2 ? [1, 0] : [0, 1];
        for (const side of order) {
            let task = make(side);
            let before;
            if (retain && global.gc && round >= 0) { global.gc(); before = process.memoryUsage().heapUsed; }
            const start = performance.now();
            let value = task.run();
            times[side] = performance.now() - start;
            if (before !== undefined) {
                global.gc();
                memory[side].push(process.memoryUsage().heapUsed - before);
            }
            // Verification and serialization outside measured interval; state is still live.
            outcomes[side] = task.capture(value);
            value = null; task = null;
        }
        assert.deepEqual(outcomes[1], outcomes[0], name + ": exact parity (including callback order and stored bytes)");
        outcomeClassification = outcomes[0]?.classification;
        const digest = hash(JSON.stringify(outcomes[0]));
        if (parityDigest) assert.equal(digest, parityDigest, name + ": nondeterministic outcome");
        parityDigest = digest;
        if (round >= 0) {
            elapsed[0].push(times[0]); elapsed[1].push(times[1]);
            ratios.push(times[1] / times[0]);
        }
    }
    const result = { name, ...metadata, parity: "PASS", paritySha256: parityDigest, outcomeClassification,
        milliseconds: { baseline: summary(elapsed[0]), candidate: summary(elapsed[1]) },
        candidateOverBaselinePairedRatio: summary(ratios), samplesMilliseconds: { baseline: elapsed[0], candidate: elapsed[1] },
        retainedHeapDeltaBytes: memory[0].length ? { baseline: summary(memory[0]), candidate: summary(memory[1]), samples: memory,
            caveat: "Process heap delta after forced GC with result live; noisy, may be negative; excludes input and realm, includes retained result, not peak allocation." } : null };
    results.push(result);
    console.log(JSON.stringify({ name, parity: "PASS", milliseconds: result.milliseconds, ratioP50: result.candidateOverBaselinePairedRatio.p50 }));
}
function libraryTask(side, catalog, action, setup, storedGroups = false) {
    const realm = realms[side], store = Object.create(null), persisted = Object.create(null), events = [];
    let seed = 0x6b88e352, draws = 0;
    realm.Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; draws++; const value = (seed >>> 0) / 0x100000000; events.push(["random", value]); return value; };
    const ports = { sourceId: "synthetic", legacySelection: null,
        current() { events.push(["current", true]); return true; },
        get(key) { events.push(["get", key]); return Object.hasOwn(store, key) ? store[key] : null; },
        getPersisted(key) { events.push(["persisted", key]); return Object.hasOwn(persisted, key) ? persisted[key] : null; },
        set(key, text) { events.push(["set", key, text]); store[key] = text; persisted[key] = text; } };
    if (storedGroups) {
        // Synthetic valid v1 records, not copied from any user's store. Override
        // every provider group plus a custom group to exercise stored-group indexing.
        const ids = [...new Set(catalog.map(row => row.groupId))];
        const groups = ids.map(id => ({ id, label: "", inheritsMembers: true, members: [], known: [] }));
        groups.push({ id: "user:1", label: "Synthetic custom", members: catalog.slice(0, 5).map(row => row.itemId) });
        const document = { groups, hidden: [], locks: [], nextGroup: 2, preferences: {}, selected: null,
            sourceId: ports.sourceId, unlocks: [], version: 1 };
        store["channelLibrary:" + ports.sourceId] = JSON.stringify(document);
        store.channelLibrarySource = ports.sourceId;
        Object.assign(persisted, store);
    }
    let model = action === "create" ? null : realm.__ottChannelLibrary.create(ports, catalog);
    if (setup) setup(model);
    // Exercise preference edits after a durable shuffle has been read back on load.
    if (action === "preference") model = realm.__ottChannelLibrary.create(ports, catalog);
    const setupEventCount = events.length;
    return {
        run() {
            if (action === "create") { model = realm.__ottChannelLibrary.create(ports, catalog); return null; }
            if (action === "snapshot") return model.snapshot();
            if (action === "move") return model.moveGroup("group:0", 1);
            if (action === "resetShuffle") return model.resetShuffle("system:all");
            if (action === "adoptOrder") return model.adoptPlaybackOrder(catalog.map(row => row.id));
            if (action === "preference") return model.setPreference("audio", 1, 3, true);
            throw new Error("Unknown action");
        },
        capture(value) {
            // Capture operation callback events before invoking observation methods.
            const operationEvents = plain(events.slice(setupEventCount));
            return { value: value === undefined ? { undefined: true } : plain(value),
                document: plain(model.document()), snapshot: plain(model.snapshot()), store: plain(store), persisted: plain(persisted),
                draws, setupEventCount, operationEvents };
        }
    };
}
for (const size of [1000, 10000]) {
    const groupCount = size / 5;
    const catalog = Array.from({ length: size }, (_, i) => ({ id: i + 1, itemId: "item:" + (i + 1),
        groupId: "group:" + (i % groupCount), groupLabel: "Group " + (i % groupCount) }));
    for (const action of ["create", "snapshot", "move", "resetShuffle", "preference"]) {
        const shuffled = action === "resetShuffle" || action === "preference";
        qualify("library/" + size + "/" + action,
            side => libraryTask(side, catalog, action, shuffled ? model => assert.equal(model.shuffleGroup("system:all"), true) : null),
            { catalogRows: size, providerGroups: groupCount, storedShuffleMembers: shuffled ? size : 0, reloadedStoredShuffle: action === "preference",
                timedWork: action === "create" ? "Construct model, read synthetic store and migrate empty state; runtime evaluation excluded" : "One host fixture method including admission, reducer, serialization and durable callbacks; setup/observations excluded" }, action === "create");
    }
    for (const action of ["snapshot", "move", "adoptOrder"]) {
        qualify("library/" + size + "/stored-groups/" + action,
            side => libraryTask(side, catalog, action,
                action === "move" ? model => assert.equal(model.moveGroup("group:0", 1), true) : null, true),
            { catalogRows: size, providerGroups: groupCount, storedGroups: groupCount + 1,
                precedingMoves: action === "move" ? 1 : 0,
                timedWork: "One method after loading synthetic stored provider overrides + custom group; load and preceding move excluded" });
    }
    const channels = Object.create(null), aliases = Object.create(null);
    for (let i = 1; i <= size; i++) {
        channels[String(i)] = { itemId: "item:" + i, legacyChannelId: size + i };
        aliases[String(size * 2 + i)] = size + i;
    }
    const create = side => side === 0 ? realms[0].frozenReferenceCreate(channels, aliases) : shared.createClassicChannelReferences(channels, aliases);
    const queries = Array.from({ length: 1000 }, (_, i) => [1 + i % size, String(size + 1 + i % size), String(size * 2 + 1 + i % size), "missing"][i % 4]);
    function lookup(graph) { return queries.map(raw => { const resolved = graph.resolve(raw, "raw"); return { resolved, projected: graph.project(resolved) }; }); }
    function captureLookups(rows) { return rows.map(row => ({ keys: Object.keys(row.resolved), resolved: plain(row.resolved), projected: row.projected })); }
    function observe(graph) { return captureLookups(lookup(graph)); }
    qualify("references/" + size + "/cold-build", side => ({ run: () => create(side), capture: observe }),
        { catalogRows: size, aliases: size, timedWork: "Construct a fresh graph; 1000 verification resolutions excluded. Runtime/module startup excluded." }, true);
    qualify("references/" + size + "/1000-lookups", side => {
        const graph = create(side);
        return { run: () => lookup(graph), capture: captureLookups };
    }, { catalogRows: size, aliases: size, lookups: queries.length,
        timedWork: "1000 warm graph resolutions + projections and identical result-array materialization; serialization, verification and graph construction excluded" });
}
// Bound recursive oracle cases: deep 10k chains can exhaust the baseline stack.
// These are topology diagnostics, separate from the flat catalog-scale workloads.
function graphError(error, phase) {
    const name = String(error && error.name), message = String(error && error.message);
    return { phase, name, message,
        category: name === "RangeError" && /stack|recursion/i.test(message) ? "stack-exhaustion" : "other-error" };
}
for (const topology of ["chain", "shared-tail", "cycle", "fanout"]) {
    const channels = Object.create(null), aliases = Object.create(null);
    let nodes;
    if (topology === "chain") {
        nodes = 256;
        channels[256] = { itemId: "terminal" };
        for (let i = 1; i < 256; i++) aliases[i] = i + 1;
    } else if (topology === "shared-tail") {
        nodes = 256;
        channels[256] = { itemId: "terminal" };
        for (let i = 1; i <= 128; i++) aliases[i] = 129;
        for (let i = 129; i < 256; i++) aliases[i] = i + 1;
    } else if (topology === "cycle") {
        nodes = 128;
        channels[128] = { itemId: "cycle-terminal" };
        for (let i = 1; i <= 128; i++) aliases[i] = i === 128 ? 1 : i + 1;
    } else {
        nodes = 129;
        channels[256] = { itemId: "tail-terminal" };
        for (let i = 2; i <= 128; i++) {
            channels[i] = { itemId: "branch:" + i, legacyChannelId: 1 };
            aliases[i] = 256;
        }
    }
    const queries = Array.from({ length: 128 }, (_, i) => ({
        value: topology === "fanout" && i % 2 === 0 ? 1 : i + 1,
        origin: i % 4 === 3 ? "canonical" : "raw"
    }));
    function construct(side) {
        try {
            return { graph: side === 0 ? realms[0].frozenReferenceCreate(channels, aliases)
                : shared.createClassicChannelReferences(channels, aliases) };
        } catch (error) { return { error: graphError(error, "construction") }; }
    }
    function lookup(built) {
        if (built.error) return { constructionError: built.error };
        return { rows: queries.map(query => {
            let resolved;
            try { resolved = built.graph.resolve(query.value, query.origin); }
            catch (error) { return { error: graphError(error, "resolution") }; }
            try { return { resolved, projected: built.graph.project(resolved) }; }
            catch (error) { return { resolved, error: graphError(error, "projection") }; }
        }) };
    }
    function capture(value) {
        const classification = { constructionErrors: 0, resolutionErrors: 0, projectionErrors: 0,
            resolved: 0, pending: 0, ambiguous: 0 };
        if (value.constructionError) {
            classification.constructionErrors++;
            return { classification, constructionError: value.constructionError };
        }
        const rows = value.rows.map(row => {
            if (row.error) classification[row.error.phase === "resolution" ? "resolutionErrors" : "projectionErrors"]++;
            if (row.resolved) {
                if (Object.hasOwn(row.resolved, "itemId")) classification.resolved++;
                else if (row.resolved.ambiguous) classification.ambiguous++;
                else classification.pending++;
            }
            return { keys: row.resolved ? Object.keys(row.resolved) : null, ...plain(row) };
        });
        return { classification, rows };
    }
    const metadata = { topology, nodes, catalogRows: Object.keys(channels).length,
        aliasEntries: Object.keys(aliases).length, lookups: queries.length,
        bounded: "At most 256 graph nodes and 128 raw/canonical queries; no extrapolation to recursive 10k graphs",
        errorParity: "Construction/resolution/projection errors compared by phase, name, category and exact message; semantic outputs and property order compared exactly" };
    qualify("references/bounded/" + topology + "/cold-build", side => ({
        run: () => construct(side), capture: built => capture(lookup(built))
    }), { ...metadata, timedWork: "Construct graph (including caught construction errors); verification queries and classification excluded" }, true);
    qualify("references/bounded/" + topology + "/128-lookups", side => {
        const built = construct(side);
        return { run: () => lookup(built), capture };
    }, { ...metadata, timedWork: "128 graph resolutions + projections with phase-specific error capture; graph construction, serialization and classification excluded" });
}
const report = { schema: 1, status: "PASS", performanceAcceptance: "Not evaluated; PASS means exact parity and completed measurements only", generatedAt: new Date().toISOString(),
    runtime: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch,
        cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), execArgv: process.execArgv,
        gcExposed: typeof global.gc === "function" },
    provenance: { harnessSha256: hash(fs.readFileSync(__filename)), coreSha256: hash(runtime), coreBytes: Buffer.byteLength(runtime), baseline: vectors.baseline,
        libraryFixtures: vectors.fixtures, referenceFixtureSha256: hash(referenceSource) },
    methodology: { warmupPairs: warmup, measuredPairs: rounds, pairOrder: "Alternating baseline/candidate then candidate/baseline", percentile: "nearest rank",
        scope: "Synthetic data only, no user settings, no network, no persistent callbacks. One process, isolated fixture realms; both load identical runtime. Exact parity asserted for every warmup and measured pair.",
        exclusions: ["Runtime loading/startup", "Library setup and pre-existing shuffle creation", "Library result observation and parity verification", "Real device, browser rendering, media, storage latency and host callback failures"],
        xml: "Not benchmarked: repository has XML golden vectors but no frozen classic reader adapter. Do not invent a baseline or infer classic-relative performance from an unpaired core timing.",
        interpretation: "Timing is diagnostic, not a pass/fail threshold. Ratios include boundary/host costs; small intervals are noisy. With 15 rounds p95 is the maximum sample; increase rounds for tail analysis.",
        retainedMemory: "Only cold model/graph builds measured when --expose-gc is enabled; forced GC is outside timing. Shared inputs and runtime excluded. Not peak RSS or allocation volume." }, results };
fs.writeFileSync(outputReal, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", scenarios: results.length, output: outputReal }));
