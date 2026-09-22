const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const definitions = {};
const window = { OTT2: { define(name, factory) { definitions[name] = factory(); } } };
const context = vm.createContext({ window, Promise: undefined, fetch: undefined,
    Map: undefined, Set: undefined, URL: undefined });
vm.runInContext("Array.prototype.indexOf = undefined;", context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/devices.js"), "utf8"), context);
const devices = definitions.devices;
assert(devices, "devices registers with the application module registry");

// Explicit expected navigation facts, independent from implementation tables.
// Columns: profile, Up, Down, Left, Right, OK, Back, menu.
const navigation = [
    ["android", 19, 20, 21, 22, 66, 4, 82],
    ["dune", 38, 40, 37, 39, 13, 8, 84],
    ["e2", 38, 40, 37, 39, 13, 8, 84],
    ["edem", 38, 40, 37, 39, 13, 8, 192],
    ["hbbtv", 38, 40, 37, 39, 13, 8, 458],
    ["hisense", 38, 40, 37, 39, 13, 8, 458],
    ["inext", 38, 40, 37, 39, 13, 8, 84],
    ["lg/netcast", 38, 40, 37, 39, 13, 8, 458],
    ["lg/webos", 38, 40, 37, 39, 13, 461, 458],
    ["mag", 38, 40, 37, 39, 13, 8, 122],
    ["nodejs", 38, 40, 37, 39, 13, 8, 192],
    ["panasonic", 38, 40, 37, 39, 13, 8, 458],
    ["pc", 38, 40, 37, 39, 13, 8, 192],
    ["pc2", 38, 40, 37, 39, 13, 8, 192],
    ["philips", 38, 40, 37, 39, 13, 8, 458],
    ["samsung/maple", 8, 5, 4, 6, 12, 88, 31],
    ["samsung/tizen", 38, 40, 37, 39, 13, 10009, 18],
    ["sharp", 38, 40, 37, 39, 13, 8, 458],
    ["skyworth", 38, 40, 37, 39, 13, 8, 458],
    ["sony", 38, 40, 37, 39, 13, 8, 458],
    ["spark", 38, 40, 37, 39, 13, 8, 84],
    ["tcl", 38, 40, 37, 39, 13, 8, 458],
    ["toshiba", 38, 40, 37, 39, 13, 8, 458],
    ["vewd", 38, 40, 37, 39, 13, 8, 458]
];
assert.equal(Object.keys(devices.profiles).length, 24);
const navActions = ["up", "down", "left", "right", "ok", "back", "menu"];
let routes = 0;
let numericChecks = 0;
for (const row of navigation) {
    const profile = devices.profiles[row[0]];
    assert(profile, row[0]);
    for (let i = 1; i < row.length; i += 1) {
        assert.equal(devices.normalize({ keyCode: row[i] }, profile), navActions[i - 1], row[0]);
        assert.equal(devices.normalize({ which: row[i] }, profile), navActions[i - 1], row[0]);
        numericChecks += 2;
    }
    for (let digit = 0; digit <= 9; digit += 1) {
        const code = row[0] === "android" ? digit + 7 : digit + 48;
        assert.equal(devices.normalize({ keyCode: code }, profile), "digit" + digit, row[0]);
        numericChecks += 1;
    }
    assert.equal(devices.normalize({ keyCode: 0 }, profile), null);
    assert.equal(devices.normalize({ keyCode: 999999 }, profile), null);
    for (const suffix of ["", "/", "/index.html", "/nested/index.html"]) {
        for (const userAgent of ["Web0S", "MAG254 Maple2012"]) {
            const env = { location: { pathname: "/f/" + row[0] + suffix }, navigator: { userAgent } };
            Object.defineProperty(env, "gSTB", { get() { throw new Error("must not inspect bridge after explicit route"); } });
            assert.equal(devices.detect(env).id, row[0]);
            routes += 1;
        }
    }
    assert.equal(devices.detect({ location: { search: "?device=" + encodeURIComponent(row[0]) } }).id, row[0]);
}

// Desktop keypad aliases are additional codes, not replacements for top-row
// digits. TV profiles retain only their observed digit codes above.
for (const id of ["pc", "pc2", "nodejs", "edem"]) {
    for (let digit = 0; digit < 10; digit += 1) {
        assert.equal(devices.normalize({ keyCode: 96 + digit }, id), "digit" + digit, id + " keypad keyCode");
        assert.equal(devices.normalize({ which: 96 + digit }, id), "digit" + digit, id + " keypad which");
        numericChecks += 2;
    }
}

const uas = [
    ["Mozilla/5.0 (Web0S; Linux/SmartTV)", "lg/webos"],
    ["LG NetCast.TV-2013", "lg/netcast"],
    ["LG WebOS NetCast compatibility", "lg/webos"],
    ["LG TV", "lg/webos"], ["MAG250", "mag"], ["MAG322w1", "mag"],
    ["mAg420R2", "mag"], ["MAG200 stbapp Maple2012", "mag"],
    ["Infomir STB Maple2012", "mag"], ["ImageMAG254", "pc"],
    ["NotMAG250 Magazine", "pc"], ["MAG254suffix", "pc"],
    ["Tizen Maple2012", "samsung/tizen"], ["Maple2012", "samsung/maple"],
    ["DuneHD", "dune"], ["Android TV Sony", "android"],
    ["HbbTV Philips", "hbbtv"], ["OIPF", "hbbtv"], ["VIERA", "panasonic"],
    ["Philips", "philips"], ["Hisense", "hisense"], ["Sony", "sony"],
    ["TCL", "tcl"], ["Sharp", "sharp"], ["Toshiba", "toshiba"],
    ["Skyworth", "skyworth"], ["Vewd", "vewd"], ["Spark", "spark"],
    ["Electron", "nodejs"], ["NodeJS", "nodejs"], ["", "pc"]
];
for (const [userAgent, expected] of uas) {
    assert.equal(devices.detect({ navigator: { userAgent } }).id, expected, userAgent);
}
for (const method of ["GetDeviceModel", "GetMACAddress", "GetDeviceMacAddress"]) {
    assert.equal(devices.detect({ navigator: { userAgent: "Maple2012" }, gSTB: {
        [method]() { throw new Error("detection must never invoke native methods"); }
    } }).id, "mag");
}
const throwing = {};
Object.defineProperty(throwing, "gSTB", { get() { throw new Error("blocked native getter"); } });
assert.equal(devices.detect(throwing).id, "pc");
assert.equal(devices.detect({ gSTB: {} }).id, "pc");
assert.equal(devices.detect({ gSTB: { GetDeviceModel: true } }).id, "pc");
assert.equal(devices.detect().id, "pc");
assert.equal(devices.detect({ location: { pathname: "/f/pc", search: "?device=mag" } }).id, "pc");
for (const bad of ["__proto__", "constructor", "toString", "%", "../../pc", "mag%00"]) {
    assert.equal(devices.detect({ location: { search: "?device=" + bad } }).id, "pc");
    assert.equal(devices.detect({ location: { pathname: "/f/" + bad } }).id, "pc");
}
assert.equal(devices.detect({ location: { search: "?device=unknown&device=lg%2Fwebos" } }).id, "lg/webos");

assert.equal(devices.normalize({ keyCode: 8, key: "Backspace" }, "samsung/maple"), "up");
assert.equal(devices.normalize({ keyCode: 10252 }, "samsung/tizen"), "playPause");
assert.equal(devices.normalize({ keyCode: 19 }, "samsung/tizen"), "pause");
assert.equal(devices.normalize({ keyCode: 10182 }, "samsung/tizen"), "exit");
assert.equal(devices.normalize({ keyCode: 38, key: "ArrowUp" }, "android"), null);
assert.equal(devices.normalize({ keyCode: 0, key: "Enter" }, "android"), null);
assert.equal(devices.normalize({ keyCode: 0, code: "ArrowLeft" }, "android"), null);
assert.equal(devices.normalize({ keyCode: 0, key: "0" }, "android"), null);
assert.equal(devices.normalize({ keyCode: 0, key: "__proto__" }), null);
assert.equal(devices.normalize({ keyCode: 999 }, "__proto__"), null);
assert.equal(devices.normalize(null), null);

// Independent transport expectations include both shared and separate Play/Pause
// codes. Misleading browser labels must not change a native remote action.
// Columns: profiles, Play, Pause, Stop, Forward, Rewind, optional Play/Pause toggle.
const transports = [
    [["android"], 85, 85, 86, 90, 89],
    [["dune", "e2", "edem", "inext", "nodejs", "pc", "pc2", "spark"], 80, 80, 83, 70, 82],
    [["mag"], 68, 80, 83, 70, 82],
    [["samsung/maple"], 71, 75, 73, 72, 74],
    [["samsung/tizen"], 415, 19, 413, 417, 412, 10252],
    [["lg/netcast"], 415, 19, 413, 70, 82],
    [["hbbtv", "hisense", "lg/webos", "panasonic", "philips", "sharp", "skyworth", "sony", "tcl", "toshiba", "vewd"], 415, 19, 413, 417, 412]
];
let transportProfiles = 0;
for (const [profileIds, play, pause, stop, forward, rewind, toggle] of transports) {
    for (const id of profileIds) {
        const profile = devices.profiles[id];
        transportProfiles += 1;
        const expectations = [[play, play === pause ? "playPause" : "play"],
            [pause, play === pause ? "playPause" : "pause"], [stop, "stop"],
            [forward, "forward"], [rewind, "rewind"]];
        if (toggle) expectations.push([toggle, "playPause"]);
        for (const [keyCode, action] of expectations) {
            for (const repeat of [false, true]) {
                const event = { keyCode, key: "MediaPlayPause", code: "KeyQ", repeat };
                assert.equal(devices.normalize(event, profile), action, id + " numeric transport " + keyCode);
                assert.deepEqual(event, { keyCode, key: "MediaPlayPause", code: "KeyQ", repeat },
                    "Normalization cannot mutate or execute the event");
            }
            assert.equal(devices.normalize({ which: keyCode }, profile), action, id + " which " + keyCode);
            numericChecks += 3;
        }
        if (play === pause) {
            assert.equal(profile.keyMap.play.length, 0);
            assert.equal(profile.keyMap.pause.length, 0);
        }
        for (const key of ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind", " "]) {
            assert.equal(devices.normalize({ key }, profile), null, id + " named input is not a remote code");
        }
        assert.equal(devices.normalize({ code: "Space" }, profile), null);
    }
}
assert.equal(transportProfiles, 24, "Every profile has an explicit transport fixture");
assert.equal(devices.normalize({ keyCode: 10252, repeat: true }, "samsung/tizen"), "playPause");
assert.equal(devices.normalize({ keyCode: 32 }, "pc"), "playPause");
assert.equal(devices.normalize({ keyCode: 32, key: " " }, "samsung/maple"), "yellow",
    "Desktop Space cannot override a device's numeric color key");

const registered = [];
const removed = [];
const nativeInput = {
    registerKey(name) { registered.push(name); if (name === "Menu") throw new Error("unsupported key"); },
    unregisterKey(name) { removed.push(name); }
};
const nativeEnv = { tizen: { tvinputdevice: nativeInput } };
const cleanup1 = devices.init(nativeEnv, devices.profiles["samsung/tizen"]);
const registeredCount = registered.length;
assert.equal(registeredCount, 37);
assert(registered.includes("Guide"), "a failed Menu must not prevent later keys");
assert(!registered.includes("ArrowUp"), "navigation keys arrive automatically");
const cleanup2 = devices.init(nativeEnv, "samsung/tizen");
assert.equal(registered.length, registeredCount, "live initialization is idempotent");
cleanup1(); cleanup1();
assert.equal(removed.length, 0, "one active owner still needs registration");
cleanup2(); cleanup2();
assert.equal(removed.length, registeredCount - 1, "cleanup owns only successful registrations");
assert(!removed.includes("Menu"));
const cleanup3 = devices.init(nativeEnv, "samsung/tizen");
assert.equal(registered.length, registeredCount * 2, "registration can restart after disposal");
cleanup3();

const noUnregister = [];
const persistentEnv = { tizen: { tvinputdevice: { registerKey(name) { noUnregister.push(name); } } } };
devices.init(persistentEnv, "samsung/tizen")();
devices.init(persistentEnv, "samsung/tizen")();
assert.equal(noUnregister.length, 37, "host without unregister does not duplicate existing registrations");
devices.init({}, "samsung/tizen")();
devices.init({}, "pc")();
const brokenTizen = {};
Object.defineProperty(brokenTizen, "tizen", { get() { throw new Error("unavailable"); } });
devices.init(brokenTizen, "samsung/tizen")();
assert.equal(Object.keys(window).length, 1, "devices installs no event handlers or new global state");
console.log("Device contracts: 24 profiles, " + routes + " routes, " + numericChecks +
    " numeric input checks, UA/bridge failures and Tizen lifecycle passed.");

// Dedicated picture/audio keys must survive numeric normalization without
// stealing higher-priority navigation and desktop fullscreen aliases.
for (const [profile, code, action] of [
    ['samsung/tizen', 10195, 'audio'], ['samsung/tizen', 10140, 'aspect'],
    ['samsung/tizen', 10190, 'previousChannel'], ['pc', 76, 'fullscreen'],
    ['samsung/maple', 73, 'stop']
]) assert.equal(devices.normalize({keyCode: code, key: 'Unidentified'}, profile), action);

// Browser Android and explicit native launchers cannot share conflicting codes.
const androidBrowser = devices.detect({navigator:{userAgent:'Mozilla/5.0 (Linux; Android 12; Android TV)'}});
assert.equal(androidBrowser.id, 'android');
assert.equal(androidBrowser.inputTransport, 'dom');
for (const [code, action] of [[38,'up'],[40,'down'],[13,'ok'],[8,'back'],[49,'digit1']]) assert.equal(devices.normalize({keyCode:code}, androidBrowser), action);
for (const location of [{pathname:'/f/android/index.html'}, {search:'?device=android'}]) {
    const profile = devices.detect({location,navigator:{userAgent:'Android'}});
    assert.equal(profile.inputTransport, 'native');
    assert.equal(devices.normalize({keyCode:13}, profile), 'digit6');
    assert.equal(devices.normalize({keyCode:66}, profile), 'ok');
}
for (const route of ['/f/lg/webos/../pc','/f/android/secret.json','/f/unknown/index.html','/f/pc/a.js']) assert.equal(devices.routeProfile(route), '');
