/* Real Local playback through the application UI; no simulated media events. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const { rangeOf } = require("./browser-media-fixture.cjs");

const mediaPath = process.env.OTT2_TEST_MEDIA;
assert(mediaPath && fs.statSync(mediaPath).isFile(), "OTT2_TEST_MEDIA must name a synthetic MP4; actual decoding is mandatory");
const bytes = fs.readFileSync(mediaPath);
const output = path.resolve(__dirname, "../test-results");
const reportPath = path.join(output, "browser-local-media-report.json");
const prefix = "/offline-media/" + "a".repeat(64); // Public synthetic capability, never a real helper credential.
const rootId = "1".repeat(32);
const ids = ["2", "3", "4", "5"].map(value => value.repeat(32));
const names = ["First Local clip", "Second Local clip", "Third Local clip", "Cancelled Local clip"];
const checks = [], pageErrors = [], unexpectedRequests = [], requests = [];
let visible = [0], complete = false, holdNext = false, held = null, catalogReplies = 0;
let browser, context, page, origin;
const sockets = new Set();

function catalog() {
    return { available: true, scanning: !complete, scanned: visible.length,
        sources: [{ id: rootId, name: "Synthetic Local folder", kind: "folder", available: true }],
        sourceScans: [{ sourceId: rootId, generation: 1, state: complete ? "complete" : "scanning" }],
        items: visible.map(index => ({ id: ids[index], sourceId: rootId, name: names[index], mime: "video/mp4",
            available: true, url: prefix + "/" + ids[index] })) };
}
function json(response, value) {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
}
function replyCatalog(response) { catalogReplies++; json(response, catalog()); }
function releaseCatalog() {
    assert(held, "A real catalog request must be waiting at the helper");
    const response = held; held = null;
    assert(!response.destroyed, "This scenario must deliver its late response, not discard it at the transport");
    replyCatalog(response);
}
const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === prefix + "/sources") {
        requests.push({ kind: "inventory" }); json(response, { sources: catalog().sources }); return;
    }
    if (url.pathname === prefix) {
        requests.push({ kind: "catalog", sourceId: url.searchParams.get("sourceId"), complete });
        if (url.searchParams.get("sourceId") !== rootId) { response.writeHead(400); response.end(); return; }
        if (holdNext) { holdNext = false; assert.equal(held, null); held = response; return; }
        replyCatalog(response); return;
    }
    const index = ids.findIndex(id => url.pathname === prefix + "/" + id);
    if (index >= 0 || url.pathname === "/synthetic-local.mp4") {
        requests.push({ kind: index >= 0 ? "media" : "fixture", index, range: request.headers.range || null });
        const range = rangeOf(request.headers.range, bytes.length);
        const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
        if (range === false) { response.writeHead(416, { ...headers, "Content-Range": "bytes */" + bytes.length }); response.end(); return; }
        const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
        headers["Content-Length"] = body.length;
        if (range) headers["Content-Range"] = "bytes " + range.start + "-" + range.end + "/" + bytes.length;
        response.writeHead(range ? 206 : 200, headers); response.end(request.method === "HEAD" ? undefined : body); return;
    }
    if (url.pathname === "/api/epg") { response.writeHead(200, { "Content-Type": "application/xml" }); response.end("<tv></tv>"); return; }
    if (url.pathname === "/api/relay") { unexpectedRequests.push("unexpected relay request"); response.writeHead(403); response.end(); return; }
    handler(request, response);
});
server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });

async function until(condition, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (!condition()) { assert(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 25)); }
}
async function navigate(screen) {
    if (!await page.locator("#nav-" + screen).isVisible()) await page.click("#menu-toggle");
    await page.click("#nav-" + screen);
    if (await page.locator("#f2-sidebar").isVisible()) await page.click("#menu-toggle");
}
async function decoded(index, label) {
    const expected = index === "blob" ? "blob:" : origin + prefix + "/" + ids[index];
    await page.waitForFunction(expected => {
        const video = document.getElementById("player-video");
        return (expected === "blob:" ? video.currentSrc.startsWith(expected) : video.currentSrc === expected) &&
            video.videoWidth > 0 && video.currentTime > 0.1 && !video.paused && video.getVideoPlaybackQuality().totalVideoFrames > 0;
    }, expected);
    const before = await page.locator("#player-video").evaluate(video => video.currentTime);
    await page.waitForFunction(before => document.getElementById("player-video").currentTime > before + 0.15, before);
    const state = await page.locator("#player-video").evaluate(video => ({
        position: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight,
        frames: video.getVideoPlaybackQuality().totalVideoFrames, paused: video.paused
    }));
    assert(Number.isFinite(state.duration) && state.duration > 3, "Fixture must contain at least three seconds of real video");
    checks.push({ label, playback: state }); return state;
}
async function seekToNativeEnd(index) {
    const url = origin + prefix + "/" + ids[index];
    await page.locator("#player-video").evaluate(video => { video.currentTime = video.duration - 0.3; });
    await page.waitForFunction(url => window.__localEvents.some(event => event.type === "ended" && event.source === url && event.trusted), url);
}
async function markDecoder() {
    return page.evaluate(() => {
        window.__localVideo = document.getElementById("player-video"); window.__localEventMark = window.__localEvents.length;
        return { position: window.__localVideo.currentTime, frames: window.__localVideo.getVideoPlaybackQuality().totalVideoFrames };
    });
}
async function sameDecoder(before, label) {
    await page.waitForFunction(before => document.getElementById("player-video").currentTime > before.position + 0.15, before);
    const state = await page.evaluate(() => {
        const video = document.getElementById("player-video");
        return { sameElement: video === window.__localVideo, source: video.currentSrc, position: video.currentTime,
            frames: video.getVideoPlaybackQuality().totalVideoFrames,
            reloads: window.__localEvents.slice(window.__localEventMark).filter(event => ["loadstart", "emptied"].includes(event.type)) };
    });
    assert(state.sameElement); assert.equal(state.source, origin + prefix + "/" + ids[0]);
    assert(state.frames > before.frames); assert.deepEqual(state.reloads, []);
    checks.push({ label, position: state.position, frames: state.frames, sameElement: true, reloads: [] });
}

(async () => {
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify({ passed: false, status: "running" }));
    try {
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        origin = "http://127.0.0.1:" + server.address().port;
        browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
        context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await context.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin) return route.continue();
            unexpectedRequests.push(url.origin + url.pathname); return route.abort();
        });
        await context.addInitScript(() => {
            window.__localEvents = [];
            for (const type of ["loadstart", "emptied", "playing", "ended", "error"]) document.addEventListener(type, event => {
                if (event.target.id === "player-video") window.__localEvents.push({ type, source: event.target.currentSrc,
                    position: event.target.currentTime, trusted: event.isTrusted });
            }, true);
        });
        page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => pageErrors.push(error.message));
        await page.goto(origin); await page.locator("#nav-sources").waitFor({ state: "attached" });
        await navigate("sources"); await page.click("#local-helper"); await page.fill("#local-endpoint", origin + prefix);
        await page.click("#local-connect"); await page.locator("#local-play-0").waitFor();
        assert.equal(requests.filter(request => request.kind === "catalog").length, 0, "Source inventory does not start a full catalog scan");
        await page.click("#local-play-0"); await decoded(0, "First helper file decodes while scan remains incomplete");
        assert.equal(complete, false); assert.equal(visible.length, 1);
        assert(requests.some(request => request.kind === "media" && request.index === 0));
        const before = await markDecoder(), replied = catalogReplies;
        visible = [0, 1];
        await until(() => catalogReplies > replied, "Background catalog poll must discover the second item", 20000);
        await sameDecoder(before, "Appending the second file preserves active decoder and advances frames");
        assert(!requests.some(request => request.kind === "media" && request.index === 1), "No speculative second-file media read");
        await seekToNativeEnd(0); await decoded(1, "Trusted native EOF advances to the appended second file");
        assert.equal(complete, false);

        holdNext = true;
        await seekToNativeEnd(1); await until(() => held !== null, "EOF wakes a real catalog request");
        await page.waitForTimeout(350);
        assert.equal(await page.locator("#player-video").evaluate(video => video.ended), true, "Queue end waits while helper response is held");
        assert(!requests.some(request => request.kind === "media" && request.index === 2));
        visible = [0, 1, 2]; releaseCatalog();
        await decoded(2, "A later catalog result resumes playback after real EOF waiting");

        holdNext = true;
        await seekToNativeEnd(2); await until(() => held !== null, "Cancellation scenario has an actual pending catalog request");
        // Invoke the application's actual Stop button even when its timed OSD is hidden.
        await page.locator("#player-stop").evaluate(button => button.click());
        await page.locator("#foss2-home").waitFor({ state: "visible" });
        const stopped = await page.evaluate(() => { window.__localEventMark = window.__localEvents.length; return document.getElementById("player-video").paused; });
        assert(stopped);
        visible = [0, 1, 2, 3]; complete = true; releaseCatalog();
        await page.locator("#channel-3").waitFor(); // Confirms the late response was consumed, not merely dropped.
        await page.waitForTimeout(500);
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused), true);
        assert.deepEqual(await page.evaluate(() => window.__localEvents.slice(window.__localEventMark).filter(event => event.type === "playing")), []);
        assert(!requests.some(request => request.kind === "media" && request.index === 3));
        checks.push({ label: "Stop cancels pending EOF continuation; a consumed late catalog cannot restart playback" });

        // Exercise the browser File branch with actual fixture bytes and a controlled
        // picker handle. Only directory enumeration is synthetic; decoding is native.
        await navigate("sources");
        await page.evaluate(async () => {
            const response = await fetch("/synthetic-local.mp4"), file = new File([await response.arrayBuffer()], "Browser Local clip.mp4", { type: "video/mp4" });
            let release, next = 0; window.__localDirectoryReleased = false; window.__localDirectoryBlocked = false;
            const blocked = new Promise(resolve => { release = resolve; });
            window.__releaseLocalDirectory = () => { window.__localDirectoryReleased = true; release({ done: true }); };
            const handle = { kind: "file", name: file.name, getFile: () => Promise.resolve(file) };
            window.showDirectoryPicker = () => Promise.resolve({ kind: "directory", name: "Synthetic browser folder",
                queryPermission: () => Promise.resolve("granted"), values: () => ({ next: () => {
                    if (next++ === 0) return Promise.resolve({ done: false, value: handle });
                    window.__localDirectoryBlocked = true; return blocked;
                }, return: () => Promise.resolve({ done: true }) }) });
        });
        // Re-render the source screen after installing the controlled picker capability.
        await navigate("settings"); await navigate("sources");
        await page.click("#local-folder"); await decoded("blob", "A real browser File decodes before the directory iterator finishes");
        assert.deepEqual(await page.evaluate(() => ({ blocked: window.__localDirectoryBlocked, released: window.__localDirectoryReleased })), { blocked: true, released: false });
        await page.evaluate(() => window.__releaseLocalDirectory());
        await page.locator("#player-stop").evaluate(button => button.click());
        assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedRequests, []);
        const report = { passed: true, browser: browser.version(), realSyntheticPlayback: true,
            fixture: { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") },
            limitations: "Synthetic helper/picker; native Chromium decoder. No physical device, OS picker or NAS throughput claim.",
            checks, pageErrors, unexpectedRequests, requests };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "local-media-failed.png") }).catch(() => {});
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: String(error.stack || error), checks, pageErrors, unexpectedRequests, requests }, null, 2) + "\n");
        throw error;
    } finally {
        if (browser) await browser.close();
        for (const socket of sockets) socket.destroy();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
