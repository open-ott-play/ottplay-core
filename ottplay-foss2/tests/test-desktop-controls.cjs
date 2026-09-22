"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function loadDevices() {
    const modules = {};
    const window = { OTT2: { define(name, factory) { modules[name] = factory(); } } };
    const context = vm.createContext({ window, Promise: undefined, Map: undefined, Set: undefined });
    vm.runInContext("Array.prototype.indexOf = undefined;", context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/devices.js"), "utf8"), context);
    return modules.devices;
}
const devices = loadDevices();

// These fixtures specify the intended input contract independently of profile tables.
const desktop = ["pc", "pc2", "nodejs", "edem"];
const desktopActions = [[81, "quit"], [76, "fullscreen"], [73, "info"], [27, "exit"],
    [8, "back"], [9, "tab"], [33, "pageUp"], [34, "pageDown"], [36, "home"], [35, "end"], [32, "playPause"], [93, "menu"]];

test("Desktop controls use numeric codes within each desktop profile", () => {
    for (const profile of desktop) {
        for (const [code, command] of desktopActions) {
            assert.equal(devices.normalize({ keyCode: code }, profile), command, profile + " keyCode " + code);
            assert.equal(devices.normalize({ which: code }, profile), command, profile + " which " + code);
            assert.equal(devices.normalize({ keyCode: code, key: "Unrelated", code: "Unrelated" }, profile), command);
        }
    }
    assert.equal(devices.shortcut, undefined, "Every input path uses one profile-based normalizer");
});

test("Desktop numeric keypad and multimedia aliases share existing semantic actions", () => {
    const commands = [["playPause", [80, 32, 179]], ["stop", [83, 178]],
        ["next", [190, 176]], ["previous", [188, 177]], ["previousChannel", [191]],
        ["volumeUp", [175]], ["volumeDown", [174]], ["mute", [77, 173]],
        ["menu", [192, 84, 93]]];
    for (const profile of desktop) {
        for (let digit = 0; digit < 10; digit += 1) {
            for (const code of [48 + digit, 96 + digit]) {
                assert.equal(devices.normalize({ keyCode: code }, profile), "digit" + digit, profile + " numeric digit " + code);
                assert.equal(devices.normalize({ which: code, key: "i", code: "KeyI" }, profile), "digit" + digit);
            }
        }
        for (const [action, codes] of commands) {
            for (const code of codes) {
                assert.equal(devices.normalize({ keyCode: code }, profile), action, profile + " numeric alias " + code);
                assert.equal(devices.normalize({ which: code }, profile), action, profile + " legacy alias " + code);
            }
        }
    }
    for (const profile of Object.keys(devices.profiles)) {
        if (desktop.includes(profile)) continue;
        for (const code of [179, 178, 176, 177, 175, 174, 173]) {
            assert.equal(devices.normalize({ keyCode: code, key: "MediaPlayPause" }, profile), null,
                profile + " cannot inherit desktop multimedia code " + code);
        }
        for (let code = 96; code <= 105; code += 1) {
            const expected = profile === "samsung/maple" && code === 99 ? "info" : null;
            assert.equal(devices.normalize({ keyCode: code, key: String(code - 96) }, profile), expected,
                profile + " cannot inherit desktop keypad code " + code);
        }
    }
});

test("Profiles explicitly choose strict or bounded key-release recovery", () => {
    for (const [id, profile] of Object.entries(devices.profiles)) {
        assert.equal(profile.keyReleaseTimeout, desktop.includes(id) ? 0 : 350,
            id + " owns its input-release policy independently of modern event fields");
    }
});

test("Remote Info, Exit, Return and Power resolve to distinct semantic actions", () => {
    const remote = [
        ["lg/webos", [[457, "info"], [27, "exit"], [461, "back"]]],
        ["samsung/tizen", [[457, "info"], [10182, "exit"], [10009, "back"], [10005, "quit"]]],
        ["samsung/maple", [[99, "info"], [45, "exit"], [88, "back"]]],
        ["android", [[165, "info"], [4, "back"], [26, "quit"]]],
        ["mag", [[73, "info"], [27, "exit"], [8, "back"]]],
        ["dune", [[73, "info"], [27, "exit"], [8, "back"]]],
        ["panasonic", [[457, "info"], [27, "exit"], [8, "back"]]]
    ];
    for (const profile of ["e2", "inext", "spark"]) {
        remote.push([profile, [[73, "info"], [27, "exit"], [8, "back"]]]);
    }
    for (const profile of ["hbbtv", "hisense", "lg/netcast", "philips", "sharp", "skyworth", "sony", "tcl", "toshiba", "vewd"]) {
        remote.push([profile, [[457, "info"], [27, "exit"], [8, "back"]]]);
    }
    assert.equal(remote.length + desktop.length, 24, "Control fixtures cover every desktop and remote profile");
    for (const [profile, commands] of remote) {
        for (const [code, command] of commands) {
            assert.equal(devices.normalize({ keyCode: code }, profile), command, profile + " " + code);
            assert.equal(devices.normalize({ which: code }, profile), command, profile + " legacy " + code);
        }
    }
});

test("Desktop aliases cannot steal existing remote codes or add implicit PC fallback", () => {
    for (const profile of Object.keys(devices.profiles)) {
        if (desktop.includes(profile)) continue;
        assert.equal(devices.normalize({ keyCode: 81, key: "q", code: "KeyQ" }, profile), null, profile + " has no Q alias");
        assert.equal(devices.normalize({ keyCode: 76, key: "l", code: "KeyL" }, profile), null, profile + " has no L alias");
    }
    for (const profile of ["lg/webos", "samsung/tizen", "android", "panasonic"]) {
        assert.equal(devices.normalize({ keyCode: 73, key: "i", code: "KeyI" }, profile), null, profile + " has no I alias");
    }
    const collisions = [["samsung/maple", 73, "stop"], ["samsung/maple", 8, "up"],
        ["samsung/maple", 32, "yellow"], ["samsung/maple", 33, "blue"],
        ["android", 8, "digit1"], ["android", 9, "digit2"], ["android", 19, "up"],
        ["dune", 33, "channelUp"], ["mag", 34, "channelDown"]];
    for (const [profile, code, command] of collisions) {
        assert.equal(devices.normalize({ keyCode: code, key: "i", code: "KeyI" }, profile), command, profile + " " + code);
    }
    assert.equal(devices.normalize({ keyCode: 38, key: "ArrowUp" }, "android"), null);
    assert.equal(devices.normalize({ keyCode: 13, key: "Enter" }, "android"), "digit6");
    assert.equal(devices.normalize({ keyCode: 27, key: "Escape" }, "samsung/maple"), null);
});

test("Keyboard identity fields never override numeric profile meaning or create commands", () => {
    for (const profile of Object.keys(devices.profiles)) {
        for (const identity of ["q", "l", "i", "Q", "Escape", "Esc", "ArrowUp", "Enter", "0", "MediaPlayPause", " "]) {
            assert.equal(devices.normalize({ key: identity }, profile), null, profile + " key-only " + identity);
        }
        for (const identity of ["KeyQ", "KeyL", "KeyI", "Escape", "ArrowLeft", "Space"]) {
            assert.equal(devices.normalize({ code: identity }, profile), null, profile + " code-only " + identity);
        }
        assert.equal(devices.normalize({ keyCode: 999999, key: "MediaPlayPause", code: "KeyQ" }, profile), null);
        assert.equal(devices.normalize({ keyCode: 0, key: "Enter" }, profile), null);
    }
    assert.equal(devices.normalize({ keyCode: 415, key: "MediaPlayPause" }, "samsung/tizen"), "play");
    assert.equal(devices.normalize({ keyCode: 73, key: "MediaPlayPause" }, "samsung/maple"), "stop");
    assert.equal(devices.normalize({ keyCode: 81, key: "й", code: "KeyA" }, "pc"), "quit");
    assert.equal(devices.normalize({ keyCode: 76, key: "д", code: "KeyA" }, "pc"), "fullscreen");
});

test("Validated keyCode takes precedence over which without cross-code fallback", () => {
    for (const invalid of [undefined, null, 0, -1, 1.5, NaN, Infinity, "81", {}, true]) {
        assert.equal(devices.keyCode({ keyCode: invalid }), 0);
        assert.equal(devices.normalize({ keyCode: invalid }, "pc"), null);
        assert.equal(devices.keyCode({ keyCode: invalid, which: 73 }), 73);
        assert.equal(devices.normalize({ keyCode: invalid, which: 73 }, "pc"), "info");
        assert.equal(devices.keyCode({ which: invalid }), 0);
    }
    assert.equal(devices.keyCode({ keyCode: 76, which: 81 }), 76);
    assert.equal(devices.normalize({ keyCode: 76, which: 81 }, "pc"), "fullscreen");
    assert.equal(devices.keyCode({ keyCode: 999999, which: 81 }), 999999);
    assert.equal(devices.normalize({ keyCode: 999999, which: 81 }, "pc"), null);
});

test("Unavailable host event properties are tolerated without reading modern identity fields", () => {
    assert.equal(devices.normalize({}, "pc"), null);
    assert.equal(devices.normalize(null, "pc"), null);
    assert.equal(devices.keyCode(null), 0);
    let identityReads = 0;
    const event = { keyCode: 73 };
    for (const name of ["key", "code"]) Object.defineProperty(event, name, { get() { identityReads += 1; throw new Error("Modern identity unavailable"); } });
    assert.equal(devices.normalize(event, "pc"), "info");
    assert.equal(identityReads, 0);
    const legacy = { which: 81 };
    Object.defineProperty(legacy, "keyCode", { get() { throw new Error("Host property unavailable"); } });
    assert.equal(devices.normalize(legacy, "pc"), "quit");
    const unavailable = {};
    for (const name of ["keyCode", "which"]) Object.defineProperty(unavailable, name, { get() { throw new Error("Host property unavailable"); } });
    assert.equal(devices.normalize(unavailable, "pc"), null);
    assert.equal(devices.keyCode(unavailable), 0);
});
