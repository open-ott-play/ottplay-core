"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { upstreamCiphers } = require("../scripts/tls-policy.cjs");
const { certificates } = require("./tls-cert-fixture.cjs");
test("upstream TLS keeps cipher selection and never lowers an explicit stronger level", () => {
    for (const [input, level] of [["DEFAULT", 2], ["DEFAULT:@SECLEVEL=0", 2], ["DEFAULT:@SECLEVEL=2", 2],
        ["DEFAULT:@SECLEVEL=3", 3], ["DEFAULT:@SECLEVEL=4:@SECLEVEL=1", 4], ["DEFAULT @SECLEVEL=3", 3], ["DEFAULT;@SECLEVEL=3", 3]]) {
        assert.equal(upstreamCiphers(input), input + ":@SECLEVEL=" + level);
    }
});
test("real relay and EPG reject weak certificate chains despite a primed TLS session cache", { timeout: 120000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay TLS policy "));
    try {
        for (const weak of ["none", "leaf", "intermediate", "root"]) {
            const fixture = path.join(directory, weak); fs.mkdirSync(fixture);
            const ca = certificates(fixture, weak);
            for (const version of ["TLSv1.2", "TLSv1.3"]) {
                await t.test(weak + " / " + version, () => {
                    const output = execFileSync(process.execPath, [path.join(__dirname, "tls-transport-probe.cjs"), fixture, version], {
                        env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: ca }, timeout: 15000, encoding: "utf8"
                    });
                    const result = JSON.parse(output);
                    assert.equal(result.primed, true);
                    assert.deepEqual(result.statuses, Array(4).fill(weak === "none" ? 200 : 502));
                    assert.equal(result.requests.length, weak === "none" ? 4 : 0, "weak chains must fail before any HTTP or authorization");
                    for (const request of result.requests) assert.equal(request.reused, false, "agent:false must perform a fresh verification");
                });
            }
            if (weak === "none") {
                await t.test("explicit semicolon-delimited level 3 rejects RSA2048", () => {
                    const output = execFileSync(process.execPath, [path.join(__dirname, "tls-transport-probe.cjs"), fixture, "TLSv1.2", "DEFAULT;@SECLEVEL=3"], {
                        env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: ca }, timeout: 15000, encoding: "utf8"
                    });
                    const result = JSON.parse(output);
                    assert.deepEqual(result.statuses, [502, 502, 502, 502]);
                    assert.deepEqual(result.requests, []);
                });
            }
        }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
