#!/usr/bin/env node
/* Reproduce committed browser dependencies from npm-locked, unmodified assets. */
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const root = path.resolve(__dirname, "..");
const records = [
    { package: "core-js-bundle", provenance: "core-js", files: { "minified.js": "core-js.min.js", "LICENSE": "core-js.LICENSE.txt" } },
    { package: "hls.js", provenance: "hls", files: { "dist/hls.min.js": "hls.min.js", "dist/hls.worker.js": "hls.worker.js", "LICENSE": "hls.LICENSE.txt" } },
    { package: "shaka-player", provenance: "shaka", files: { "dist/shaka-player.compiled.js": "shaka.min.js", "LICENSE": "shaka.LICENSE.txt" } },
    { package: "mpegts.js", provenance: "mpegts", files: { "dist/mpegts.js": "mpegts.min.js", "dist/mpegts.js.LICENSE.txt": "mpegts.js.LICENSE.txt", "LICENSE": "mpegts.LICENSE.txt" } }
];
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function contents(inputRoot = root) {
    const read = name => fs.readFileSync(path.join(inputRoot, name));
    const json = name => JSON.parse(read(name));
    const lock = json("package-lock.json"), pkg = json("package.json");
    const packages = {}, assets = {}, outputs = {};
    function dependency(name, direct) {
        const installed = json("node_modules/" + name + "/package.json");
        const pinned = lock.packages["node_modules/" + name];
        assert(pinned && pinned.integrity && pinned.resolved, "Missing npm lock entry: " + name);
        assert.equal(installed.version, pinned.version, "Installed package differs from npm lock: " + name);
        if (direct) assert.equal(pkg.devDependencies[name], pinned.version, "Vendor dependency must use an exact version: " + name);
        packages[name] = { version: pinned.version, integrity: pinned.integrity, resolved: pinned.resolved };
        return installed;
    }
    for (const record of records) {
        const installed = dependency(record.package, true);
        const provenance = json("vendor/" + record.provenance + ".provenance.json");
        assert.equal(provenance.package, record.package, "Unexpected provenance package");
        assert.equal(provenance.version, installed.version, "Update provenance explicitly before changing vendor versions: " + record.package);
        if (provenance.registryIntegrity) assert.equal(provenance.registryIntegrity, packages[record.package].integrity, "Provenance integrity differs from lock: " + record.package);
        for (const [source, destination] of Object.entries(record.files)) {
            const bytes = read("node_modules/" + record.package + "/" + source);
            if (destination.endsWith(".js")) acorn.parse(bytes.toString(), { ecmaVersion: 5, sourceType: "script" });
            if (source === provenance.file) assert.equal(hash(bytes), provenance.sha256, "Vendor bytes differ from reviewed provenance: " + destination);
            if (record.package === "hls.js" && source === provenance.worker.file) assert.equal(hash(bytes), provenance.worker.sha256, "HLS main bundle and worker must come from the reviewed package");
            outputs["vendor/" + destination] = bytes;
        }
    }
    const mpegts = json("vendor/mpegts.provenance.json");
    let notices = "Bundled dependency license texts for mpegts.js " + mpegts.version + "\n\n";
    for (const item of mpegts.bundledDependencies) {
        const installed = dependency(item.package, false);
        assert.equal(installed.version, item.version, "Bundled license dependency changed: " + item.package);
        assert.equal(packages[item.package].integrity, item.registryIntegrity, "Bundled license integrity changed: " + item.package);
        notices += item.package + " " + item.version + " (" + item.license + ")\nSource: " + item.registry + "\n\n";
        notices += read("node_modules/" + item.package + "/LICENSE").toString() + "\n\n";
    }
    outputs["vendor/mpegts.dependencies.LICENSE.txt"] = Buffer.from(notices);
    for (const [name, bytes] of Object.entries(outputs)) assets[name] = hash(bytes);
    const bootstrap = {};
    for (const name of ["src/compat.js", "src/compat-ready.js", "src/hls-worker.js"]) bootstrap[name] = hash(read(name));
    const provenance = {};
    for (const record of records) {
        const name = "vendor/" + record.provenance + ".provenance.json";
        provenance[name] = hash(read(name));
    }
    const manifest = {
        schema: 1,
        builderSha256: hash(read("scripts/vendors.cjs")),
        lockfileSha256: hash(read("package-lock.json")),
        packages, bootstrap, provenance, assets
    };
    outputs["vendor/runtime-manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    return { outputs, manifest };
}
function buildVendors(outputRoot = root, inputRoot = root) {
    const result = contents(inputRoot);
    fs.mkdirSync(path.join(outputRoot, "vendor"), { recursive: true });
    for (const [name, bytes] of Object.entries(result.outputs)) fs.writeFileSync(path.join(outputRoot, name), bytes);
    return result.manifest;
}
function checkVendors(outputRoot = root, inputRoot = root) {
    const expected = contents(inputRoot);
    for (const [name, bytes] of Object.entries(expected.outputs)) {
        const destination = path.join(outputRoot, name);
        assert(fs.existsSync(destination), "Missing generated vendor asset: " + name);
        assert(fs.readFileSync(destination).equals(bytes), "Stale or modified vendor asset: " + name);
    }
    return expected.manifest;
}
module.exports = { buildVendors, checkVendors };
if (require.main === module) {
    try {
        const command = process.argv[2];
        assert(command === "build" || command === "check", "Usage: node scripts/vendors.cjs build|check");
        const manifest = command === "build" ? buildVendors() : checkVendors();
        console.log("PASS: " + command + " " + Object.keys(manifest.assets).length + " unchanged upstream vendor/license assets; npm lock, ES5, provenance and page/Worker bootstrap verified");
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
