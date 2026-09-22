/* Real media-engine selection and bounded extensionless-stream detection. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");


async function navigate(page, selector) {
    if (!(await page.locator(selector).isVisible())) await page.locator("#menu-toggle").click();
    await page.locator(selector).click();
}

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ott2-engines-"));
    const server = http.createServer(handler);
    let browser;
    try {
        const ffmpeg = process.env.FFMPEG || "ffmpeg";
        const common = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "48", "-c:a", "aac"];
        execFileSync(ffmpeg, common.concat(["-f", "hls", "-hls_time", "2", "-hls_list_size", "0", path.join(directory, "manifest.m3u8")]));
        execFileSync(ffmpeg, common.concat(["-f", "mpegts", path.join(directory, "transport.ts")]));
        execFileSync(ffmpeg, common.concat(["-f", "flv", path.join(directory, "transport.flv")]));
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.route("**/api/epg", route => route.fulfill({ contentType: "application/xml", body: "<tv/>" }));
        const vendorRequests = [];
        page.on("request", request => { if (/\/vendor\/(hls|shaka|mpegts)\.min\.js$/.test(request.url())) vendorRequests.push(new URL(request.url()).pathname); });
        const pageErrors = [];
        page.on("pageerror", error => pageErrors.push(error.message));
        await page.route("https://stream.example/**", async route => {
            const name = new URL(route.request().url()).pathname.slice(1);
            const mapped = { "hls-header": "manifest.m3u8", "hls-body": "manifest.m3u8", "ts-body": "transport.ts", "flv-body": "transport.flv" }[name] || name;
            if (!/^[\w.-]+$/.test(mapped)) return route.abort();
            const file = path.join(directory, mapped);
            if (!fs.existsSync(file)) return route.abort();
            const mime = name === "hls-header" ? "application/vnd.apple.mpegurl" : "application/octet-stream";
            await route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { "Content-Type": mime, "Access-Control-Allow-Origin": "*" } });
        });
        await page.goto("http://127.0.0.1:" + server.address().port + "/");
        await page.waitForFunction(() => window.OTT2 && window.OTT2VendorLoader && document.getElementById("nav-settings"), null, { timeout: 15000 });
        assert.deepEqual(vendorRequests, [], "Opening the catalog must not download media engines");
        const report = await page.evaluate(async () => {
            const video = document.createElement("video");
            video.muted = true; video.width = 320; video.height = 180; document.body.appendChild(video);
            const events = [];
            const player = OTT2.require("media").create({ video, environment: window, onEvent: event => { if (event.type === "error") events.push(event.error.code); } });
            async function until(predicate) {
                for (let i = 0; i < 150; i++) {
                    if (predicate()) return;
                    if (player.getState().state === "error") throw new Error(JSON.stringify(player.getState().lastError));
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                throw new Error("Engine test timed out: " + JSON.stringify({ state: player.getState().state, backend: player.getState().backend, format: player.getState().format, reason: player.getState().detectReason, ready: player.getState().ready, position: video.currentTime, duration: video.duration, range: player.getState().seekRange }));
            }
            const results = [];
            for (const name of ["hls-header", "hls-body", "ts-body", "flv-body"]) {
                player.load({ id: name, kind: "live", url: "https://stream.example/" + name }, { engine: "auto" });
                await until(() => video.currentTime > 0.2 && player.getState().state === "playing");
                const state = player.getState();
                results.push({ name, backend: state.backend, format: state.format, detectReason: state.detectReason, position: video.currentTime, dimensions: [video.videoWidth, video.videoHeight] });
                player.stop();
            }
            player.load({ id: "manual", kind: "vod", url: "https://stream.example/hls-header" }, { engine: "hls.js", format: "hls" });
            await until(() => video.currentTime > 0.2);
            player.pause(); if (!player.seek(2)) throw new Error("Initial paused seek was unavailable");
            if (video.currentTime < 1.8) throw new Error("Initial paused seek did not set position: " + video.currentTime);
            player.setEngine("shaka");
            await until(() => player.getState().ready && video.currentTime > 1.8);
            const switched = { backend: player.getState().backend, paused: player.getState().paused, nativePaused: video.paused, position: video.currentTime };
            player.stop(); player.setEngine("native");
            const stopped = player.getState().state;
            player.destroy(); video.remove();
            const startupVideo = document.createElement("video"); startupVideo.muted = true; document.body.appendChild(startupVideo);
            const realPlay = startupVideo.play, startupEvents = [];
            startupVideo.play = function () {};
            const startup = OTT2.require("media").create({ video: startupVideo, environment: window,
                options: { device: "lg/webos", stallTimeout: 300, maxRetries: 0 },
                onEvent: event => { if (event.type === "enginefallback") startupEvents.push(event.error.code); } });
            startup.load({ id: "silent-native", kind: "vod", url: "https://stream.example/manifest.m3u8" });
            for (let attempt = 0; attempt < 100 && !startupEvents.length; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
            const timeoutBackend = startup.getState().backend;
            startupVideo.play = realPlay; startup.play();
            for (let attempt = 0; attempt < 100 && startupVideo.currentTime < 0.2; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
            const timeoutRecovery = { reasons: startupEvents.slice(), backend: timeoutBackend, decoded: startupVideo.videoWidth === 320 && startupVideo.currentTime > 0.2 };
            startup.stop(); startupVideo.play = function () {};
            startup.load({ id: "manual-native", kind: "vod", url: "https://stream.example/manifest.m3u8" }, { engine: "native" });
            for (let attempt = 0; attempt < 100 && startup.getState().state !== "error"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
            timeoutRecovery.manual = { backend: startup.getState().backend, state: startup.getState().state, fallbackCount: startup.getState().fallbackCount };
            startup.destroy(); startupVideo.remove();
            return { results, switched, stopped, timeoutRecovery, errors: events };
        });
        report.vendorRequests = vendorRequests.slice();
        assert.deepEqual(report.vendorRequests.slice().sort(), ["/vendor/hls.min.js", "/vendor/mpegts.min.js", "/vendor/shaka.min.js"], "Each requested backend loads exactly once");
        await navigate(page, "#nav-settings");
        await page.locator("#engines").click();
        await page.locator('#f2-dialog [data-action="selectEngine"][data-value="hls.js"]').click();
        await page.locator('#f2-dialog [data-action="selectFormat"][data-value="hls"]').click();
        await page.reload();
        await navigate(page, "#nav-settings");
        await page.locator("#engines").click();
        assert.match(await page.locator('#f2-dialog [data-action="selectEngine"][data-value="hls.js"]').textContent(), /✓/);
        assert.match(await page.locator('#f2-dialog [data-action="selectFormat"][data-value="hls"]').textContent(), /✓/);
        report.uiPreferences = await page.evaluate(() => {
            const settings = JSON.parse(localStorage.getItem("ottplay2:state:v1")).settings;
            return { engine: settings.playerEngine, format: settings.streamFormat, font: settings.fontFamily };
        });
        assert.deepEqual(report.uiPreferences, { engine: "hls.js", format: "hls", font: "RobotoCondensed" });
        // A synthetic saved source exercises the real app/controller and engine picker.
        await page.evaluate(() => {
            const data = OTT2.require("state").defaults();
            data.sources = [{ id: "qa-hls", name: "Engine QA", type: "m3u", url: "", text: "#EXTM3U\n#EXTINF:-1,Engine QA channel\nhttps://stream.example/hls-header" }];
            data.activeSourceId = "qa-hls"; data.settings.muted = true;
            localStorage.setItem("ottplay2:state:v1", JSON.stringify(data));
        });
        await page.reload();
        await page.locator('.f2-channel[data-action="play"]').first().click();
        assert.equal(await page.locator("#f2-dialog").count(), 0, "The selected live channel starts without opening its details");
        await page.waitForFunction(() => document.getElementById("player-video").currentTime > 0.2 && document.getElementById("player-status").textContent === "Playing");
        await page.locator("#player-engines").click();
        await page.locator('#f2-dialog [data-action="selectEngine"][data-value="shaka"]').click();
        await page.waitForFunction(() => /Shaka/.test(document.getElementById("engine-active-status").textContent) && document.getElementById("player-video").currentTime > 0.2 && document.getElementById("player-status").textContent === "Playing");
        report.uiEngineSwitch = await page.evaluate(async () => {
            // Keep real destruction but make its asynchronous boundary deterministic.
            const originalDestroy = shaka.Player.prototype.destroy;
            shaka.Player.prototype.destroy = function () {
                return Promise.resolve(originalDestroy.call(this)).then(() => new Promise(resolve => setTimeout(resolve, 250)));
            };
            document.querySelector('#f2-dialog [data-action="selectEngine"][data-value="auto"]').click();
            const dialog = document.getElementById("f2-dialog");
            const focused = dialog.querySelector('[data-action="selectFormat"][data-value="flv"]');
            focused.focus();
            const whileDisposing = document.getElementById("engine-active-status").textContent;
            for (let i = 0; i < 150; i++) {
                const label = document.getElementById("engine-active-status");
                if (label && /Hls\.js/.test(label.textContent) && document.getElementById("player-status").textContent === "Playing") {
                    return { whileDisposing, active: label.textContent, dialogRetained: dialog === document.getElementById("f2-dialog"), focusPreserved: document.activeElement === focused, focusedId: focused.id };
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            throw new Error("Engine picker did not reflect async Shaka to Auto transition: " + document.getElementById("engine-active-status").textContent);
        });
        assert.match(report.uiEngineSwitch.active, /Hls\.js/);
        assert.equal(report.uiEngineSwitch.dialogRetained, true);
        assert.equal(report.uiEngineSwitch.focusPreserved, true);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(report.errors, []);
        assert.deepEqual(report.results.map(value => value.backend), ["hls.js", "hls.js", "mpegts", "mpegts"]);
        assert.deepEqual(report.results.map(value => value.detectReason), ["response_header", "body_signature", "body_signature", "body_signature"]);
        assert.ok(report.results.every(value => value.position > 0.2 && value.dimensions[0] === 320));
        assert.equal(report.switched.backend, "shaka");
        assert.equal(report.switched.paused, true);
        assert.equal(report.switched.nativePaused, true);
        assert.ok(Math.abs(report.switched.position - 2) < 0.2);
        assert.equal(report.stopped, "stopped");
        assert.deepEqual(report.timeoutRecovery.reasons, ["playback_timeout"]);
        assert.equal(report.timeoutRecovery.backend, "hls.js"); assert.equal(report.timeoutRecovery.decoded, true);
        assert.deepEqual(report.timeoutRecovery.manual, { backend: "native", state: "error", fallbackCount: 0 });
        const output = { ...report, pageErrors };
        const reportDirectory = path.join(__dirname, "../test-results");
        fs.mkdirSync(reportDirectory, { recursive: true });
        fs.writeFileSync(path.join(reportDirectory, "browser-engines-report.json"), JSON.stringify(output, null, 2) + "\n");
        console.log(JSON.stringify(output, null, 2));
    } finally {
        if (browser) await browser.close();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
