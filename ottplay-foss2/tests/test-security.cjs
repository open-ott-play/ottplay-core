const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const code = fs.readFileSync(path.join(__dirname, "../src/security.js"), "utf8");
acorn.parse(code, { ecmaVersion: 5 });
let security;
const context = vm.createContext({ OTT2: { define(name, factory) { security = factory(); } } });
vm.runInContext("Promise=undefined; fetch=undefined; Map=undefined; Set=undefined; Uint8Array=undefined; crypto=undefined;", context);
require("./load-core.cjs")(context);
vm.runInContext(code, context);
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(initialTime = 1000000) {
    let time = initialTime;
    const state = { security: security.defaults(), activeSourceId: "a" };
    const writes = [];
    const options = { getState: () => state, persist(config) { state.security = plain(config); writes.push(JSON.stringify(config)); }, now: () => time };
    const gate = security.create(options);
    return { gate, state, writes, options, tick(ms) { time += ms; } };
}
test("ES5 SHA-256 matches independent standard vectors and Unicode encoding", () => {
    for (const input of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "русский 😀", "\ud800"]) {
        assert.equal(security.sha256(input), crypto.createHash("sha256").update(input).digest("hex"));
    }
    let expected = crypto.createHash("sha256").update("public-salt:876543").digest("hex");
    for (let i = 1; i < 1024; i++) expected = crypto.createHash("sha256").update("public-salt:" + expected).digest("hex");
    assert.equal(security.hashPin("876543", "public-salt", 1024), expected);
});
test("PIN configuration is salted, versioned, detached and never stores plaintext", () => {
    const f = fixture();
    assert.equal(f.gate.setProtected("a:adult", true).code, "PIN_NOT_CONFIGURED");
    assert.equal(f.gate.configure("", "876543").ok, true);
    assert.equal(f.state.security.schema, 1);
    assert.equal(f.state.security.hash.length, 64);
    assert.equal(f.gate.authorize("settings").code, "PIN_REQUIRED");
    assert(!f.writes.some(text => text.includes("876543")));
    const firstSalt = f.state.security.salt;
    assert.equal(f.gate.configure("wrong", "654321").ok, false);
    assert.equal(f.state.security.salt, firstSalt);
    assert.equal(f.gate.configure("876543", "654321").ok, true);
    assert.notEqual(f.state.security.salt, firstSalt, "The deterministic public salt fallback must distinguish configurations");
    assert.equal(f.gate.verify("876543").ok, false);
    assert.equal(f.gate.verify("654321").ok, true);
    assert(!f.writes.some(text => text.includes("654321")));
});
test("PIN changes enforce digit format and callback result without altering valid state", () => {
    const f = fixture();
    for (const pin of ["", "123", "1234567890123", "12a4", "１２３４", 1234]) {
        let callback;
        assert.equal(f.gate.configure("", pin, result => { callback = result; }).code, "PIN_FORMAT");
        assert.equal(callback.ok, false);
        assert.equal(f.state.security.enabled, false);
    }
    assert.equal(f.gate.configure("", "123456789012").ok, true);
});
test("all protected playback routes and sensitive actions use the same bounded grant", () => {
    const f = fixture();
    f.gate.configure("", "1234");
    assert.equal(f.gate.setProtected("a:adult", true).ok, false);
    assert.equal(f.gate.setProtected("a:adult", true, "1234").ok, true);
    f.gate.lock();
    for (const action of ["playback", "play", "archive", "vod", "history", "bookmark", "preview", "pip"]) {
        assert.equal(f.gate.authorize(action, "a:adult").code, "PIN_REQUIRED", action);
        assert.equal(f.gate.authorize(action, "a:news").ok, true, action);
        assert.equal(f.gate.authorize(action, "").ok, false, "Unknown channel cannot bypass a playback gate");
    }
    for (const action of ["settings", "source", "import", "restore", "export", "proxy", "remote", "new-action"]) assert.equal(f.gate.authorize(action, "a:news").ok, false, action);
    assert.equal(f.gate.authorize("play", "a:adult", "1234").ok, true);
    assert.equal(f.gate.authorize("import").ok, true);
    f.tick(300000);
    assert.equal(f.gate.authorize("play", "a:adult").ok, false);
});
test("sessions revoke on source switch, reload, explicit lock and clock rollback", () => {
    const f = fixture(); f.gate.configure("", "1234"); f.gate.verify("1234");
    f.state.activeSourceId = "b";
    assert.equal(f.gate.authorize("settings").ok, false);
    f.gate.verify("1234");
    assert.equal(security.create(f.options).authorize("settings").ok, false, "A persisted hash is not a persisted grant");
    f.gate.lock(); assert.equal(f.gate.authorize("settings").ok, false);
    f.gate.verify("1234"); f.tick(-1000); assert.equal(f.gate.authorize("settings").ok, false);
});
test("persistent failure cooldown cannot be skipped by correct PIN or a new gate", () => {
    const f = fixture(); f.gate.configure("", "1234");
    for (let i = 0; i < 4; i++) assert.equal(f.gate.verify("9999").code, "WRONG_PIN");
    assert.equal(f.gate.verify("9999").code, "RATE_LIMIT");
    assert.equal(f.gate.verify("1234").retryAfter, 30);
    assert.equal(security.create(f.options).verify("1234").code, "RATE_LIMIT");
    f.tick(30000); assert.equal(f.gate.verify("9999").retryAfter, 60);
    f.tick(60000); assert.equal(f.gate.verify("1234").ok, true);
    assert.equal(f.state.security.failures, 0);
    assert.equal(f.state.security.blockedUntil, 0);
});
test("a future imported or rolled-back block is clamped to five minutes", () => {
    const f = fixture(); f.gate.configure("", "1234"); f.state.security.blockedUntil = 1e15;
    assert.equal(f.gate.status().retryAfter, 300);
    f.tick(300000); assert.equal(f.gate.verify("1234").ok, true);
});
test("editing security stays protected even if ordinary settings protection is disabled", () => {
    const f = fixture(); f.gate.configure("", "1234");
    assert.equal(f.gate.setScopes({ settings: false }, "1234").ok, true);
    assert.equal(f.gate.authorize("settings").ok, true);
    assert.equal(f.gate.setProtected("a:adult", true).ok, false);
    assert.equal(f.gate.setScopes({ settings: true }).ok, false);
    assert.equal(f.gate.disable("9999").ok, false);
    assert.equal(f.gate.disable("1234").ok, true);
    assert.equal(f.state.security.enabled, false);
    assert.equal(f.state.security.hash, "");
});
test("security DTO refuses corrupt hashes and unbounded work factors", () => {
    const f = fixture(); f.gate.configure("", "1234");
    for (const change of [config => config.schema = 2, config => config.enabled = "true", config => delete config.enabled, config => config.hash = "plaintext", config => config.salt = "x", config => config.iterations = 1e9, config => config.iterations = 1024.5, config => config.protectedIds = {}, config => config.protectedIds = [null], config => config.scopes = []]) {
        const bad = plain(f.state.security); change(bad);
        assert.throws(() => security.validate(bad));
    }
    const detached = security.validate(f.state.security); detached.protectedIds.push("external");
    assert.equal(f.state.security.protectedIds.length, 0);
});
test("injected random bytes produce a public salt without requiring modern browser APIs", () => {
    const f = fixture();
    const gate = security.create({ ...f.options, randomBytes: count => Array.from({ length: count }, (_, i) => i) });
    assert.equal(gate.configure("", "1234").ok, true);
    assert.equal(f.state.security.salt, "000102030405060708090a0b0c0d0e0f");
});
