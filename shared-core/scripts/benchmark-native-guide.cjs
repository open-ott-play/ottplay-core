"use strict";
// Offline matcher benchmark. No XMLTV transport, consumer install or timing assertions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

function workload(rows, full) {
    function check(value, expected) {
        if (value !== expected) throw new Error("Unexpected match: " + value + " != " + expected);
    }
    const start = Date.now();
    const guide = new OttPlayCore.NativeGuide(rows, "web", s => s.length, n => n);
    const constructionMs = Date.now() - start;
    const parity = [];
    // Exact, truncated, contained and overlapping-word names from the actual input order.
    for (let i = 0; i < 16; i++) {
        const row = rows[Math.floor(i * rows.length / 16)];
        for (const query of [row[1], row[1].slice(0, 3), "prefix " + row[1], row[1] + " news tv"] ) {
            const match = guide.match(query);
            parity.push(match ? [match.id, match.score] : null);
        }
    }
    const count = full ? 2048 : 40;
    const batchStart = Date.now();
    for (let i = 0; i < count; i++) {
        const synthetic = "ZZZ_OTTPLAY_QUALIFICATION_UNMATCHED_9E703D_" + i;
        const variants = [
            ["18", "", "РЕН ТВ HD"], ["hlsproxy-382", "", "РЕН ТВ HD"],
            ["", "РЕН ТВ HD", "РЕН ТВ HD"], ["", "", "РЕН ТВ HD"]
        ];
        const row = i < 32 ? variants[i % 4] : [synthetic, synthetic + "_ALIAS", synthetic + "_NAME"];
        check(guide.resolve(row[0], row.slice(1)), i < 32 ? "18" : null);
    }
    const batchMs = Date.now() - batchStart;
    const repeatedRows = Array.from({ length: 1024 }, (_, i) => ["miss" + i, "aaa" + i]);
    repeatedRows.push(["first", "a".repeat(256)], ["second", "a".repeat(256)]);
    const repeated = new OttPlayCore.NativeGuide(repeatedRows, "web", s => s.length, n => n);
    const repeatedStart = Date.now();
    const repeatedCount = full ? 128 : 4;
    for (let i = 0; i < repeatedCount; i++) {
        const match = repeated.match("a".repeat(512));
        check(match.id, "first");
        check(match.score, 0.5);
    }
    return { aliases: rows.length, constructionMs, batchCount: count, batchMs,
        repeatedCount, repeatedMs: Date.now() - repeatedStart, parity };
}

function source(bundle, rows, full) {
    return bundle + "\nJSON.stringify((" + workload.toString() + ")(" + JSON.stringify(rows) + "," + full + "));\n";
}
function execute(bundle, rows, full) {
    return JSON.parse(vm.runInNewContext(source(bundle, rows, full), {}, { timeout: 20000 }));
}
function main() {
    const args = process.argv.slice(2);
    assert(args.length <= 2, "Usage: benchmark-native-guide.cjs [aliases.json] [baseline-core.js]");
    const rows = args[0] ? JSON.parse(fs.readFileSync(args[0], "utf8")) :
        [["18", "РЕН ТВ HD"], ...Array.from({ length: 7404 }, (_, i) => ["id" + i, "Channel " + i + " news tv"])];
    assert(rows.length && rows.every(row => Array.isArray(row) && row.length === 2 && row.every(x => typeof x === "string")));
    const file = path.resolve(__dirname, "../dist/ottplay-core.js");
    const bytes = fs.readFileSync(file);
    const current = execute(bytes.toString(), rows, true);
    let baseline;
    if (args[1]) {
        baseline = execute(fs.readFileSync(args[1], "utf8"), rows, false);
        assert.deepEqual(current.parity, baseline.parity, "Compiled old/new match IDs and scores differ");
        delete baseline.parity;
    }
    delete current.parity;
    console.log(JSON.stringify({ engine: process.version, coreSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length, gzipBytes: zlib.gzipSync(bytes, { level: 9 }).length, current, baseline }, null, 2));
}
if (require.main === module) main();
module.exports = { source };
