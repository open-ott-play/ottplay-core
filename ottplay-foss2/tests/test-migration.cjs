const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const context = vm.createContext({});
context.window = context;
vm.runInContext("Promise=undefined; fetch=undefined; Map=undefined; Set=undefined; URL=undefined; Object.assign=undefined;", context);
require("./load-core.cjs")(context);
for (const file of ["runtime", "security", "state", "providers", "migration"]) {
    const code = fs.readFileSync(path.join(__dirname, "../src/" + file + ".js"), "utf8");
    acorn.parse(code, { ecmaVersion: 5 }); vm.runInContext(code, context);
}
const migration = context.OTT2.require("migration");
const state = context.OTT2.require("state");
const plain = value => JSON.parse(JSON.stringify(value));
function preview(value) { return migration.preview(JSON.stringify(value)); }
test("new settings preview is canonical, detached and does not write storage", () => {
    const current = plain(state.defaults());
    current.settings.language = "ru"; current.settings.fontFamily = "Caveat";
    current.sources = [{ id: "one", name: "One", type: "m3u", url: "https://example.test/list?secret=yes" }];
    const result = preview(current);
    assert.equal(result.format, "ottplay-foss2-v1");
    assert.equal(result.containsSecrets, true);
    assert.equal(result.requiresSourceConfirmation, true);
    assert.equal(result.proposed.settings.language, "ru");
    assert.equal(result.proposed.activeSourceId, "one");
    current.sources[0].name = "Changed";
    assert.equal(result.proposed.sources[0].name, "One");
    assert.equal(state.defaults().sources.length, 0);
    const epgOnly = plain(state.defaults()); epgOnly.settings.epgUrls = ["https://guide.test/epg?token=secret"];
    assert.equal(preview(epgOnly).containsSecrets, true);
});
test("legacy v1 maps the actual font family index and never guesses channel identity or carries plaintext PIN", () => {
    const result = preview({ version: 1, settings: { fontSize: 4, fontShift: 6, parentPin: "987654", localHttpDeviceCode: "device-secret" }, favoritesArray: [10, 20], parentalArray: [99] });
    assert.equal(result.format, "ottplay-foss-v1");
    assert.equal(result.proposed.settings.fontFamily, "Liberation");
    assert.equal(result.proposed.settings.language, "en");
    assert.equal(result.proposed.favorites.default.length, 0);
    assert.equal(result.proposed.security.enabled, false);
    assert.equal(result.requiresParentalReview, true);
    assert(!JSON.stringify(result).includes("987654"));
    assert(!JSON.stringify(result).includes("device-secret"));
    assert(result.warnings.some(value => /provider-specific/.test(value)));
});
test("legacy storage imports exact M3U and Xtream DTO contracts with explicit source confirmation", () => {
    const result = preview({ ottplaylang: "_rus", sFont: "6", ottplayprov: "xtream",
        m3um3uArr: JSON.stringify({ active: 1, M3Us: [{ www: "https://a.test/one", name: "First" }, { www: "https://b.test/two?token=secret", name: "Second" }, { www: "" }] }),
        xtreamxtream_data: JSON.stringify({ server: "https://x.test", username: "user", password: "secret" }), sLocalHttpEnabled: "1", sLocalHttpDeviceCode: "remote-secret" });
    assert.equal(result.proposed.sources.length, 3);
    assert.equal(result.proposed.settings.language, "ru");
    assert.equal(result.proposed.settings.fontFamily, "PTSansNarrow");
    assert.equal(result.proposed.activeSourceId, "legacy-xtream-0");
    assert.equal(result.proposed.sources[2].password, "secret");
    assert.equal(result.requiresSourceConfirmation, true);
    assert(!JSON.stringify(result).includes("remote-secret"));
});
test("legacy XML is parsed without any DOM, DTD or network access", () => {
    const result = migration.preview('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">\n<properties>\n<comment>OTT-Play Preferences</comment>\n<entry key="sFont">1</entry>\n<entry key="ottplaylang">_eng</entry>\n<entry key="m3um3uArr">{&quot;active&quot;:0,&quot;M3Us&quot;:[{&quot;www&quot;:&quot;https://example.test/list?x=1&amp;y=2&quot;,&quot;name&quot;:&quot;A &amp; B&quot;}]}</entry>\n</properties>');
    assert.equal(result.format, "ottplay-properties-xml");
    assert.equal(result.proposed.sources[0].url, "https://example.test/list?x=1&y=2");
    assert.equal(result.proposed.sources[0].name, "A & B");
    assert.equal(result.proposed.settings.fontFamily, "Roboto");
});
test("unknown formats, unsafe nested keys, corrupt exports and XML entities fail before proposing state", () => {
    const invalid = ["{", "null", "[]", "{}", '{"schema":99,"sources":[]}', '{"version":1,"settings":[],"parentalArray":[]}',
        '{"version":1,"settings":{"__proto__":{"polluted":true}}}', '{"ottplaylang":"_eng","constructor":{}}',
        JSON.stringify({ m3um3uArr: '{"M3Us":[],"__proto__":{}}' }),
        '<!DOCTYPE properties [<!ENTITY x SYSTEM "file:///etc/passwd">]><properties><comment>OTT-Play Preferences</comment><entry key="sFont">&x;</entry></properties>',
        '<properties><comment>OTT-Play Preferences</comment><entry key="__proto__">x</entry></properties>',
        '<properties><comment>OTT-Play Preferences</comment><entry key="sFont">1</entry><entry key="sFont">2</entry></properties>',
        '<properties><comment>OTT-Play Preferences</comment><script>bad</script><entry key="sFont">1</entry></properties>',
        '<properties><comment>OTT-Play Preferences</comment><entry key="sFont">&#x110000;</entry></properties>',
        JSON.stringify({ version: 1, settings: {}, parentalArray: "broken" })];
    for (const text of invalid) assert.throws(() => migration.preview(text), text);
    assert.equal({}.polluted, undefined);
});
test("source migration skips unsupported protocols and compressed payloads with review warnings", () => {
    const result = preview({ sFont: 2, m3um3uArr: JSON.stringify({ M3Us: [{ www: "javascript:alert(1)" }, { www: "https://a.test/safe", rechours: 10, medUrl: "https://unsupported.test" }] }), xtreamxtream_data: "\u0001LZ\u0001compressed" });
    assert.equal(result.proposed.sources.length, 1);
    assert(result.warnings.some(value => /invalid URL/.test(value)));
    assert(result.warnings.some(value => /Compressed/.test(value)));
    assert(result.warnings.some(value => /VPortal/.test(value)));
});
