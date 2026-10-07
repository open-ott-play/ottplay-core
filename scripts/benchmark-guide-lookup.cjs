"use strict";
// Offline public-ABI comparison. Inputs are synthetic; no provider or device I/O.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createHash } = require("node:crypto"), { performance } = require("node:perf_hooks"), { gzipSync } = require("node:zlib");
const root = path.resolve(__dirname, "..");
const candidate = path.resolve(process.argv[2] || path.join(root, "shared-core/dist/ottplay-core.js"));
const baseline = process.argv[3] && path.resolve(process.argv[3]);
const polyfill = fs.readFileSync(path.join(root, "ottplay-foss2/vendor/core-js.min.js"), "utf8");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const median = values => values.slice().sort((a, b) => a - b)[values.length >> 1];
function load(file) {
    const source = fs.readFileSync(file), context = vm.createContext({});
    vm.runInContext(polyfill, context);
    const start = performance.now();
    vm.runInContext(source.toString(), context, { filename: file });
    const load = performance.now() - start;
    return { core: context.OttPlayCore, file, sha256: digest(source), bytes: source.length,
        gzip9_bytes: gzipSync(source, { level: 9 }).length, load_ms: load };
}
const versions = baseline ? [load(baseline), load(candidate)] : [load(candidate)];
const byChannel = Object.create(null), byName = Object.create(null), byAlias = Object.create(null);
for (let i = 0; i < 2048; i++) {
    byChannel["id" + i] = [];
    byName["news " + i + " hd"] = ["id" + i];
    byAlias["news " + i] = ["id" + i];
}
byName.ambiguous = ["id0", "id1"];
byName.stale = ["missing"];
const guide = { byChannel, byName, byAlias };
const suites = ["exact-id", "exact-name", "quality-alias", "miss", "mixed-catalogue"].map(kind => ({
    kind, queries: Array.from({ length: 2048 }, (_, i) => {
        const mode = kind === "mixed-catalogue"
            ? i % 100 < 90 ? "exact-id" : i % 100 < 95 ? "exact-name" : i % 100 < 98 ? "quality-alias" : "miss"
            : kind;
        return { tvgId: mode === "exact-id" ? "id" + i : "", name: "Unmatched " + i,
            tvgName: mode === "exact-name" ? "News " + i + " HD" : mode === "quality-alias" ? "News " + i + " UHD" : "Unknown " + i };
    })
}));
const feedKeys = Object.fromEntries(Object.keys(byChannel).map(id => [id, "feed:" + id]));
suites.push({ kind: "feed-affinity", guide: { feeds: [{ sourceUrl: "https://guide.test/a", guide, keys: feedKeys }] },
    queries: suites[0].queries.map(query => ({ ...query, epgUrls: ["https://guide.test/a"] })) });
// Compare ambiguous, stale, empty, quality and Unicode names as well as ordinary hits.
const probes = ["", "News 0 HD", "News 0 UHD", "ambiguous", "stale", "İSTANBUL HD", "ΣΟΣ", "News\u00a00 HD", "Россия-1"];
const differential = [];
for (const name of probes) for (const tvgName of probes) for (const tvgId of ["", "id0", "missing"])
    differential.push({ name, tvgName, tvgId });
const validation = suites.concat({ kind: "edge-cases", queries: differential });
for (const suite of validation) for (const query of suite.queries) {
    const input = suite.guide || guide;
    const expected = versions[0].core.matchedGuideChannel(query, input);
    for (const version of versions) assert.equal(version.core.matchedGuideChannel(query, input), expected);
}
let checksum = 0;
const samples = suites.map(suite => {
    const timings = versions.map(() => []);
    // Alternate order to reduce warmup/thermal bias between the two distributions.
    for (let round = 0; round < 11; round++) {
        const order = versions.map((_, index) => index);
        if (round % 2) order.reverse();
        for (const index of order) {
            const start = performance.now();
            for (const query of suite.queries) checksum += versions[index].core.matchedGuideChannel(query, suite.guide || guide).length;
            if (round >= 2) timings[index].push(performance.now() - start);
        }
    }
    return { kind: suite.kind, queries: suite.queries.length, versions: timings.map((values, index) => ({
        file: versions[index].file, median_ms: median(values), samples_ms: values
    })) };
});
for (const version of versions) assert.equal(digest(fs.readFileSync(version.file)), version.sha256, "Artifact changed during benchmark");
console.log(JSON.stringify({ engine: process.version, host: process.platform + " " + process.arch, physical_device: false,
    differential_queries: validation.reduce((total, suite) => total + suite.queries.length, 0), compared_with_baseline: !!baseline, checksum,
    artifacts: versions.map(({ core, ...metadata }) => metadata), samples }, null, 2));
