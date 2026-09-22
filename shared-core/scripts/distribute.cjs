"use strict";
// Distribute compiler outputs, never copies of maintained domain source.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const version = require("../package.json").version;
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = file => fs.readFileSync(path.join(root, file));
function inputs(directory = "src") {
    return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
        const file = directory + "/" + entry.name;
        return entry.isDirectory() ? inputs(file) : [file];
    });
}
function sourceReceipt() {
    const files = [...inputs(), "build.gradle.kts", "settings.gradle.kts", "gradle.properties",
        "gradle/wrapper/gradle-wrapper.properties", "gradle/wrapper/gradle-wrapper.jar", "package.json",
        "scripts/distribute.cjs", "LICENSE", "licenses/kotlin-LICENSE.txt", "licenses/kotlin-NOTICE.txt"].sort();
    const hashes = Object.fromEntries(files.map(file => [file, sha256(read(file))]));
    return { sha256: sha256(JSON.stringify(hashes)), files: hashes };
}
function build() {
    const source = sourceReceipt();
    // A receipt must describe compiled inputs, never just the files on disk.
    execFileSync(path.join(root, "gradlew"), ["--no-daemon", "jvmJar", "jsProductionExecutableCompileSync"], { cwd: root, stdio: "inherit" });
    assert.deepEqual(sourceReceipt(), source, "Source changed during compilation; retry the distribution build");
    fs.mkdirSync(dist, { recursive: true });
    const jsRoot = "build/compileSync/js/main/productionExecutable/kotlin/";
    const script = read(jsRoot + "OttPlayCore.js").toString().replace(/^\/\/# sourceMappingURL=.*$/gm, "");
    // A stable browser name; CommonJS continues to use the compiler's exports.
    const alias = '\n;(function (root) { if (typeof module !== "object" || !module.exports) root.OttPlayCore = root["play.ott:ottplay-shared-core"]; }(typeof self !== "undefined" ? self : this));\n';
    const outputs = {
        "ottplay-core.js": Buffer.from(script + alias),
        "ottplay-core.d.ts": read(jsRoot + "OttPlayCore.d.ts"),
        "ottplay-core.jar": read("build/libs/ottplay-shared-core-jvm-" + version + ".jar"),
        "ottplay-core.LICENSE.txt": Buffer.from(read("LICENSE") + "\nBundled Kotlin runtime:\n\n" + read("licenses/kotlin-NOTICE.txt") + "\n" + read("licenses/kotlin-LICENSE.txt"))
    };
    for (const [file, bytes] of Object.entries(outputs)) fs.writeFileSync(path.join(dist, file), bytes);
    const manifest = { schema: 1, name: "ottplay-shared-core", version, source,
        runtime: { kotlin: "2.4.20", jvm: 17, javascript: "ES5 with core-js 3.50.0 on legacy hosts" },
        artifacts: Object.fromEntries(Object.entries(outputs).map(([file, bytes]) => [file, { sha256: sha256(bytes), bytes: bytes.length }])) };
    fs.writeFileSync(path.join(dist, "ottplay-core.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
}
function check() {
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, "ottplay-core.manifest.json")));
    assert.deepEqual(manifest.source, sourceReceipt(), "Core source changed: rebuild and redistribute every consumer");
    for (const [file, expected] of Object.entries(manifest.artifacts)) {
        assert.equal(sha256(fs.readFileSync(path.join(dist, file))), expected.sha256, "Stale core artifact: " + file);
    }
    return manifest;
}
function consumer(action, platform, target) {
    assert(target, "Supply the consumer directory explicitly");
    check();
    const files = ["ottplay-core.manifest.json", "ottplay-core.LICENSE.txt", ...(platform === "native" ? ["ottplay-core.js", "ottplay-core.jar"] : [platform === "web" ? "ottplay-core.js" : "ottplay-core.jar"])];
    const directory = path.join(path.resolve(target), platform === "jvm" ? "core/vendor" : "vendor");
    if (action === "install") fs.mkdirSync(directory, { recursive: true });
    for (const file of files) {
        const bytes = fs.readFileSync(path.join(dist, file));
        if (action === "install") fs.writeFileSync(path.join(directory, file), bytes);
        // Comparing hashes keeps a stale large bundle from producing an enormous
        // assertion diff (and excessive memory use) during a failed verification.
        else assert.equal(sha256(fs.readFileSync(path.join(directory, file))), sha256(bytes), "Consumer uses a different core revision: " + path.join(directory, file));
    }
}
const [command, target] = process.argv.slice(2);
if (command === "build") build();
else if (command === "check") check();
else if (/^(install|check)-(web|jvm|native)$/.test(command || "")) { const [action, platform] = command.split("-"); consumer(action, platform, target); }
else throw new Error("Usage: distribute.cjs build|check|install-web|check-web|install-jvm|check-jvm|install-native|check-native [consumer-directory]");
console.log("PASS core distribution: " + command);
