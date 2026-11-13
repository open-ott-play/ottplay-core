"use strict";
// Frozen pre-extraction classic oracle; no sibling checkout, TypeScript package or network required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const bundle = process.argv[2] || path.join(__dirname, "../dist/ottplay-core.js");
const sourceCommit = "9336a40ccd4e8e0e84571b037c2d2b49e8b0aaaa";
const legacyCreate = require("./fixtures/classic-channel-references-9336a40.js");
const shared = vm.createContext({ console });
vm.runInContext(fs.readFileSync(bundle, "utf8"), shared, { timeout: 10000 });
const core = shared["play.ott:ottplay-shared-core"];
assert.equal(typeof core.createClassicChannelReferences, "function");
let seed = 0x6b88e352;
const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
const pick = values => values[next() % values.length];
const ids = ["0", "-0", "-00", "1", "01", "2", "3", "4", "5", "6", "-1", "9007199254740993", "9007199254740992", "1000000000000000128", "1000000000000000000000", "1e3", "", "+1", " 1", "__proto__", "constructor"];
const values = [...ids, ...ids.map(Number), null, undefined, true, false, Infinity, NaN, "9".repeat(310), {}, []];
const itemValues = ["first", "same", "__proto__", "constructor", "", 0, false, true, 12, null, undefined, { toString: () => "opaque-item" }];
let resolutions = 0, projections = 0;
for (let sample = 0; sample < 1200; sample++) {
    const channels = Object.create(null), aliases = Object.create(null);
    for (let i = next() % 15; i > 0; i--) {
        const row = next() % 10 === 0 ? pick([null, 0, false, "row"]) : { itemId: pick(itemValues) };
        if (row && typeof row === "object" && next() % 3) row.legacyChannelId = pick(values);
        channels[pick(ids)] = row;
    }
    for (let i = next() % 12; i > 0; i--) aliases[pick(ids)] = pick(values);
    const old = legacyCreate(channels, aliases);
    const current = core.createClassicChannelReferences(channels, aliases);
    for (const raw of values) {
        for (const origin of ["raw", "canonical", undefined, "other"]) {
            const expected = old.resolve(raw, origin), actual = current.resolve(raw, origin);
            assert.deepEqual(Object.keys(actual), Object.keys(expected), "Reference property presence/order changed");
            for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key], `sample ${sample}: ${key}`);
            assert.equal(current.project(actual), old.project(expected), "Projection changed");
            resolutions++; projections++;
        }
    }
    for (const itemId of itemValues) {
        assert.equal(current.project({ itemId }), old.project({ itemId }));
        projections++;
    }
}
console.log(JSON.stringify({ status: "passed", sourceCommit, samples: 1200, resolutions, projections }));
