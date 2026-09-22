"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildVendors, checkVendors } = require("../scripts/vendors.cjs");
const root = path.resolve(__dirname, "..");

function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ott2-vendors-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test("locked vendor generation reproduces all committed JS and license bytes", t => {
    const directory = temporary(t), first = buildVendors(directory);
    const bytes = fs.readFileSync(path.join(directory, "vendor/runtime-manifest.json"));
    assert.equal(first.packages["hls.js"].version, "1.7.3");
    assert.equal(first.packages["core-js-bundle"].version, "3.50.0");
    assert.equal(first.packages["shaka-player"].version, "5.2.10");
    assert.equal(first.packages["mpegts.js"].version, "1.8.2");
    for (const name of Object.keys(first.assets)) assert.deepEqual(fs.readFileSync(path.join(directory, name)), fs.readFileSync(path.join(root, name)), name);
    assert.deepEqual(checkVendors(directory), first);
    buildVendors(directory);
    assert.deepEqual(fs.readFileSync(path.join(directory, "vendor/runtime-manifest.json")), bytes, "No timestamps or nondeterministic generation inputs");
});

test("vendor audit rejects modified Worker, missing license and mismatched metadata", t => {
    const directory = temporary(t);
    buildVendors(directory);
    fs.appendFileSync(path.join(directory, "vendor/hls.worker.js"), "\n/* stale worker */\n");
    assert.throws(() => checkVendors(directory), /Stale or modified vendor asset: vendor\/hls\.worker\.js/);
    buildVendors(directory);
    fs.unlinkSync(path.join(directory, "vendor/shaka.LICENSE.txt"));
    assert.throws(() => checkVendors(directory), /Missing generated vendor asset: vendor\/shaka\.LICENSE\.txt/);
    buildVendors(directory);
    const file = path.join(directory, "vendor/runtime-manifest.json"), manifest = JSON.parse(fs.readFileSync(file));
    manifest.packages["hls.js"].version = "0.0.0";
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => checkVendors(directory), /Stale or modified vendor asset: vendor\/runtime-manifest\.json/);
});

test("vendor generation refuses ranges or an installed version different from the lock", t => {
    const directory = temporary(t);
    for (const name of ["package.json", "package-lock.json", "scripts/vendors.cjs", "src/compat.js", "src/compat-ready.js", "src/hls-worker.js"])
    {
        const destination = path.join(directory, name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, name), destination);
    }
    fs.mkdirSync(path.join(directory, "vendor"));
    for (const name of ["core-js", "hls", "shaka", "mpegts"])
        fs.copyFileSync(path.join(root, "vendor", name + ".provenance.json"), path.join(directory, "vendor", name + ".provenance.json"));
    // Package bytes remain read-only; only the isolated lock/manifest is varied.
    fs.symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
    pkg.devDependencies["hls.js"] = "^1.7.3";
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(pkg));
    assert.throws(() => buildVendors(directory, directory), /Vendor dependency must use an exact version: hls\.js/);
    pkg.devDependencies["hls.js"] = "1.7.3";
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(pkg));
    const lock = JSON.parse(fs.readFileSync(path.join(directory, "package-lock.json")));
    lock.packages["node_modules/hls.js"].version = "0.0.0";
    fs.writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify(lock));
    assert.throws(() => buildVendors(directory, directory), /Installed package differs from npm lock: hls\.js/);
});
