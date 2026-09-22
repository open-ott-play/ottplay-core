/* Real HLS decode after legacy API removal, including an independent Worker realm. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const root = path.resolve(__dirname, "..");

/* Leave native binary storage intact: JavaScript arrays cannot replace MSE buffers. */
const removeLegacyGlobals = `(function (g) {
    g.__compatBefore = { Promise: typeof g.Promise, Map: typeof g.Map, URL: typeof g.URL };
    g.webkitURL = g.URL;
    var names = ["Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "URL", "URLSearchParams", "fetch", "ReadableStream", "Headers", "Request", "Response", "AbortController", "TextEncoder", "TextDecoder"];
    var i;
    for (i = 0; i < names.length; i++) { try { g[names[i]] = undefined; } catch (ignore) {} }
    /* Missing legacy methods are absent properties, not present undefined methods. */
    ["assign", "entries", "values", "is", "getOwnPropertyDescriptors"].forEach(function (key) { delete Object[key]; });
    ["from", "of"].forEach(function (key) { delete Array[key]; });
    ["includes", "find", "findIndex"].forEach(function (key) { delete Array.prototype[key]; });
    ["includes", "startsWith", "endsWith", "repeat"].forEach(function (key) { delete String.prototype[key]; });
    ["isFinite", "isNaN", "isInteger", "isSafeInteger"].forEach(function (key) { delete Number[key]; });
    var typed = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"];
    for (i = 0; i < typed.length; i++) {
        if (!g[typed[i]]) continue;
        delete g[typed[i]].from; delete g[typed[i]].of; delete g[typed[i]].prototype.slice;
    }
    delete Object.getPrototypeOf(Uint8Array).from;
    delete Object.getPrototypeOf(Uint8Array).of;
    delete Object.getPrototypeOf(Uint8Array.prototype).slice;
    g.__compatRemoved = { Promise: typeof g.Promise, Map: typeof g.Map, URL: typeof g.URL };
})(typeof self !== "undefined" ? self : this);\n`;
const vendorSnapshot = `(function () {
    window.__compatVendorSnapshots.push({
        Promise: typeof Promise, Map: typeof Map, WeakSet: typeof WeakSet,
        includes: typeof Array.prototype.includes, from: typeof Uint8Array.from,
        entries: typeof Object.entries, objectURL: typeof URL.createObjectURL,
        nativeBinary: !!(window.OTT2Compat && window.OTT2Compat.nativeBinary)
    });
})();\n`;
const observeWorkers = `(function () {
    var NativeWorker = window.Worker;
    window.__compatWorkerMessages = [];
    window.__compatWorkerErrors = [];
    if (!NativeWorker) return;
    window.Worker = function (url, options) {
        var worker = new NativeWorker(url, options);
        worker.addEventListener("message", function (event) {
            if (event.data && event.data.event) window.__compatWorkerMessages.push(event.data.event);
        });
        worker.addEventListener("error", function (event) {
            window.__compatWorkerErrors.push(event.message || "Worker startup failed");
        });
        return worker;
    };
    window.Worker.prototype = NativeWorker.prototype;
})();\n`;

async function waitForPageValue(page, predicate, message, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await page.evaluate(predicate)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(message);
}

(async () => {
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ott2-compat-"));
    let browser, activeScenario;
    const report = { passed: false, browser: "Chromium", fixtures: "synthetic H.264/AAC HLS", scenarios: [] };
    const reportPath = path.join(root, "test-results/browser-compat-report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (activeScenario) activeScenario.requests.push(pathname);
        if (pathname.startsWith("/compat-media/")) {
            const name = pathname.slice("/compat-media/".length);
            if (!/^[\w.-]+$/.test(name) || !fs.existsSync(path.join(fixtureDirectory, name))) { response.writeHead(404); response.end(); return; }
            response.writeHead(200, { "Content-Type": name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t", "Cache-Control": "no-store" });
            response.end(fs.readFileSync(path.join(fixtureDirectory, name))); return;
        }
        if (pathname === "/src/hls-worker.js") {
            if (activeScenario.failWorker) { response.writeHead(503); response.end("Worker unavailable in this fixture"); return; }
            const prefix = activeScenario.legacy ? removeLegacyGlobals : "";
            response.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
            response.end(prefix + fs.readFileSync(path.join(root, pathname), "utf8")); return;
        }
        if (pathname === "/vendor/hls.min.js") {
            response.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
            response.end(vendorSnapshot + fs.readFileSync(path.join(root, pathname), "utf8")); return;
        }
        if (pathname === "/api/epg") { response.writeHead(200, { "Content-Type": "application/xml" }); response.end("<tv/>"); return; }
        handler(request, response);
    });
    try {
        execFileSync(process.env.FFMPEG || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-threads", "1", "-filter_threads", "1", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=8", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "6", "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "16", "-c:a", "aac", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", path.join(fixtureDirectory, "manifest.m3u8")], { stdio: "pipe" });
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        const origin = "http://127.0.0.1:" + server.address().port;
        browser = await chromium.launch({ headless: true });
        for (const scenario of [
            { name: "missing globals in window and worker", legacy: true, expectWorker: true },
            { name: "worker startup failure falls back to main thread", legacy: true, failWorker: true },
            { name: "missing Worker uses main thread", legacy: true, noWorker: true },
            { name: "missing MSE boots UI without media libraries", legacy: true, noMSE: true, noLibraries: true },
            { name: "missing native binary APIs does not unlock MSE with emulated arrays", legacy: true, noBinary: true, noLibraries: true }
        ]) {
            activeScenario = { ...scenario, requests: [] };
            const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
            try {
                const page = await context.newPage();
                const errors = [];
                page.on("pageerror", error => errors.push(error.stack || error.message));
                await page.addInitScript({ content: "window.__compatVendorSnapshots = [];\n" + (scenario.legacy ? removeLegacyGlobals : "") +
                    (scenario.noWorker ? "window.Worker = undefined;\n" : "") +
                    (scenario.noMSE ? "window.MediaSource = window.ManagedMediaSource = window.WebKitMediaSource = undefined;\n" : "") +
                    (scenario.noBinary ? "window.DataView = undefined;\n" : "") + observeWorkers });
                await page.goto(origin + "/");
                /* Playwright's modern selector helpers cannot consume emulated ES5 Symbol iterators. */
                await waitForPageValue(page, () => !!document.getElementById("connect"), scenario.name + ": UI did not boot");
                assert.deepEqual(errors, [], scenario.name + ": bootstrap must not raise page errors");
                const bootstrap = await page.evaluate(() => ({
                    removed: window.__compatRemoved,
                    restored: { Promise: typeof Promise, Map: typeof Map, URL: typeof URL, objectURL: typeof URL.createObjectURL, includes: typeof Array.prototype.includes, from: typeof Uint8Array.from, entries: typeof Object.entries },
                    snapshots: window.__compatVendorSnapshots,
                    libraries: { hls: typeof Hls, shaka: typeof shaka, mpegts: typeof mpegts }
                }));
                assert.deepEqual(bootstrap.removed, { Promise: "undefined", Map: "undefined", URL: "undefined" }, scenario.name + ": fixture removed globals before bootstrap");
                assert.ok(Object.values(bootstrap.restored).every(value => value === "function"), scenario.name + ": required helpers are restored");
                assert.deepEqual(bootstrap.libraries, { hls: "undefined", shaka: "undefined", mpegts: "undefined" }, "The UI starts before any optional playback library is requested");
                assert.deepEqual(activeScenario.requests.filter(name => /^\/vendor\/(hls|shaka|mpegts)/.test(name)), []);
                assert.equal(bootstrap.snapshots.length, 0);
                if (scenario.noLibraries) {
                    assert.equal(page.workers().length, 0);
                    assert.deepEqual(errors, []);
                    report.scenarios.push({ name: scenario.name, uiBooted: true, bootstrap, pageErrors: errors });
                    continue;
                }
                const loadResult = await page.evaluate(() => new Promise(resolve => {
                    OTT2VendorLoader.load("Hls", function (error, value) { resolve({ error: error && error.code, accepted: value === OTT2Vendors.Hls }); });
                }));
                assert.deepEqual(loadResult, { error: null, accepted: true });
                const requested = await page.evaluate(() => ({
                    snapshots: window.__compatVendorSnapshots,
                    libraries: { hls: typeof OTT2Vendors.Hls, shaka: typeof shaka, mpegts: typeof mpegts }
                }));
                assert.equal(requested.snapshots.length, 1);
                assert.ok(Object.entries(requested.snapshots[0]).every(([name, value]) => name === "nativeBinary" ? value === true : value === "function"), "Media vendor evaluates only after all required helpers exist");
                assert.deepEqual(requested.libraries, { hls: "function", shaka: "undefined", mpegts: "undefined" }, "An HLS request does not load unrelated engines");
                await page.evaluate(url => {
                    const Hls = OTT2Vendors.Hls, trigger = Hls.prototype.trigger;
                    window.__compatHlsWorkerErrors = [];
                    Hls.prototype.trigger = function (event, data) {
                        window.__compatHlsInstance = this;
                        if (event === Hls.Events.ERROR && data && data.event === "demuxerWorker") {
                            window.__compatHlsWorkerErrors.push({ details: data.details, fatal: !!data.fatal });
                        }
                        return trigger.apply(this, arguments);
                    };
                    const video = document.createElement("video");
                    video.muted = true; video.width = 320; video.height = 180; document.body.appendChild(video);
                    window.__compatVideo = video; window.__compatMediaErrors = [];
                    window.__compatPlayer = OTT2.require("media").create({ video, environment: window, onEvent: event => { if (event.type === "error") window.__compatMediaErrors.push(event.error); } });
                    window.__compatPlayer.load({ id: "compat-hls", kind: "vod", url }, { engine: "hls.js", format: "hls" });
                }, origin + "/compat-media/manifest.m3u8");
                await waitForPageValue(page, () => window.__compatVideo.currentTime > 0.3 && window.__compatVideo.videoWidth === 320, scenario.name + ": HLS video did not decode");
                const playback = await page.evaluate(() => ({ backend: window.__compatPlayer.getState().backend, position: window.__compatVideo.currentTime, dimensions: [window.__compatVideo.videoWidth, window.__compatVideo.videoHeight], errors: window.__compatMediaErrors }));
                assert.equal(playback.backend, "hls.js"); assert.deepEqual(playback.errors, []);
                const workerRequests = activeScenario.requests.filter(name => /(?:hls-worker|hls\.worker)/.test(name));
                const workerActivity = await page.evaluate(() => ({
                    messages: window.__compatWorkerMessages,
                    errors: window.__compatWorkerErrors,
                    hlsErrors: window.__compatHlsWorkerErrors,
                    enabled: window.__compatHlsInstance.config.enableWorker
                }));
                let workerRealm = null;
                if (scenario.expectWorker) {
                    assert.ok(workerActivity.messages.includes("init"), "The Worker completes its initialization handshake");
                    assert.ok(workerActivity.messages.includes("transmuxComplete"), "The Worker actually transmuxes the fixture instead of silently falling back");
                    assert.deepEqual(workerActivity.errors, [], "The healthy Worker has no hidden startup failures");
                    assert.deepEqual(workerActivity.hlsErrors, [], "HLS did not invoke its main-thread Worker fallback");
                    assert.equal(workerActivity.enabled, true);
                    const worker = page.workers().find(value => value.url() === origin + "/src/hls-worker.js");
                    assert.ok(worker, "The application creates the same-origin HLS worker");
                    workerRealm = await worker.evaluate(() => ({ removed: self.__compatRemoved, Promise: typeof Promise, Map: typeof Map, from: typeof Uint8Array.from, entries: typeof Object.entries, nativeBinary: !!(self.OTT2Compat && self.OTT2Compat.nativeBinary) }));
                    assert.deepEqual(workerRealm.removed, { Promise: "undefined", Map: "undefined", URL: "undefined" }, "Worker globals were independently removed before importScripts");
                    assert.equal(workerRealm.Promise, "function"); assert.equal(workerRealm.Map, "function"); assert.equal(workerRealm.from, "function"); assert.equal(workerRealm.entries, "function"); assert.equal(workerRealm.nativeBinary, true);
                    assert.ok(workerRequests.includes("/vendor/hls.worker.js"));
                    const workerStart = activeScenario.requests.indexOf("/src/hls-worker.js");
                    const workerBootstrap = activeScenario.requests.slice(workerStart).filter(name => ["/src/hls-worker.js", "/src/compat.js", "/vendor/core-js.min.js", "/src/compat-ready.js", "/vendor/hls.worker.js"].includes(name));
                    assert.deepEqual(workerBootstrap, ["/src/hls-worker.js", "/src/compat.js", "/vendor/core-js.min.js", "/src/compat-ready.js", "/vendor/hls.worker.js"], "Worker imports helpers and verifies them before evaluating its HLS payload");
                    workerRealm.bootstrapRequests = workerBootstrap;
                }
                if (scenario.noWorker) {
                    assert.deepEqual(workerRequests, [], "A missing Worker never causes a worker request");
                    assert.deepEqual(workerActivity.messages, []);
                    assert.equal(workerActivity.enabled, false);
                }
                if (scenario.failWorker) {
                    assert.ok(workerRequests.includes("/src/hls-worker.js"), "The fallback fixture actually attempted the failing worker");
                    assert.ok(workerActivity.errors.length > 0, "The browser observed the intended Worker startup failure");
                    assert.ok(workerActivity.hlsErrors.some(error => !error.fatal), "HLS handled the Worker failure without stopping playback");
                    assert.equal(workerActivity.enabled, false, "The recovered stream is running with the main-thread fallback");
                }
                assert.deepEqual(errors, [], scenario.name + ": no uncaught browser errors");
                await page.evaluate(() => { window.__compatPlayer.destroy(); window.__compatVideo.remove(); });
                report.scenarios.push({ name: scenario.name, uiBooted: true, bootstrap, requested, playback, workerRealm, workerRequests, workerActivity, pageErrors: errors });
            } finally { await context.close(); }
        }
        report.passed = true;
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify(report, null, 2));
    } finally {
        if (browser) await browser.close();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
