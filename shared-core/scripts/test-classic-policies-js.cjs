"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../dist/ottplay-core.js"), "utf8");
for (const legacy of [false, true]) {
    const host = vm.createContext({});
    if (legacy) {
        vm.runInContext("Array.from=undefined;Object.assign=undefined;", host);
        vm.runInContext(fs.readFileSync(require.resolve("core-js-bundle/minified.js"), "utf8"), host);
    }
    vm.runInContext(script, host, { timeout: 10000 });
    const core = host.OttPlayCore;
    const row = { sourceId: "s", id: "__proto__", channelId: "c", programmeId: "p", title: "", start: 100, end: 200, opaque: { retained: true } };
    assert.equal(core.classicReminderValid(row, "s"), true);
    assert.equal(core.classicReminderValid({ ...row, start: "100" }, "s"), false);
    assert.equal(core.classicReminderValid({ ...row, end: Infinity }, "s"), false);
    assert.equal(core.classicReminderValid(row, "other"), false);
    const cycle = {}; cycle.self = cycle;
    for (const field of ["id", "title", "start", "end", "channelId", "sourceId", "programmeId"])
        assert.equal(core.classicReminderValid({ ...row, [field]: cycle }, "s"), false);
    assert.equal(core.classicReminderValid({ ...row, extension: cycle }, "s"), true);
    const normalized = core.classicReminderNormalize([row, { ...row, title: "duplicate" }, { ...row, id: "other" }], "s");
    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].title, "");
    assert.notEqual(normalized[0], row);
    assert.notEqual(normalized[0].opaque, row.opaque);
    assert.equal(normalized[0].opaque.retained, true);
    assert.equal(core.classicReminderNext(100, 200, 80, 30, false, false), 80);
    assert.equal(core.classicReminderNext(100, 200, NaN, 30, false, false), Infinity);
    assert.equal(core.classicReminderAction(100, 200, 80, 30, false, false), "notify");
    assert.equal(core.classicReminderAction(100, 200, 100, 30, false, false), "prompt");
    assert.equal(core.classicReminderAction(100, 200, 200, 30, false, false), "none");
    assert.equal(core.classicReminderMinutes(100, 80), 1);
    for (let count = 0; count <= 5; count++) assert.equal(core.classicLiveStallLimits(count, 30).attempts, count);
    for (const count of ["3", 1.2, -1, 6, Infinity, NaN]) assert.equal(core.classicLiveStallLimits(count, 30).attempts, 0);
    assert.equal(core.classicLiveStallLimits(3, "30").timeout, 15000);
    assert.equal(core.classicLiveStallProgress(1.04, 1), false);
    assert.equal(core.classicLiveStallProgress(2, null), false);
    assert.equal(core.classicLiveStallProgress(2, 1), true);
    assert.equal(core.classicLiveStallResetWindow(5000, 0, 0, false, false), false);
    assert.equal(core.classicLiveStallResetWindow(5001, 0, 0, false, false), true);
    assert.equal(core.classicLiveStallHealthyAttempts(3, 0, 10000), 0);
    assert.equal(core.classicLiveStallPlan(true, 0, 3000, 3, 15000, false, false).remaining, 12);
    assert.equal(core.classicLiveStallPlan(true, 0, 14999, 3, 15000, false, false).restart, false);
    assert.equal(core.classicLiveStallPlan(true, 0, 15000, 3, 15000, false, false).restart, true);
    assert.equal(core.classicLiveStallPlan(true, 3, 15000, 3, 15000, true, false).phase, "exhausted");
    assert.equal(core.classicLiveStallBlockedPhase(true, true, true, 3, 3, true), "hidden");
}
console.log("PASS classic reminder/live-stall packaged JS contract (modern and legacy globals)");
