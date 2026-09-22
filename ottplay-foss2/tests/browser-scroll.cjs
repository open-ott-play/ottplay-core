/* Mouse and trackpad journeys. One Chromium process and synthetic local data only. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const output = path.resolve(__dirname, "../test-results");
const mediaPath = process.env.OTT2_TEST_MEDIA;
assert.ok(mediaPath && fs.existsSync(mediaPath), "Set OTT2_TEST_MEDIA to a local synthetic MP4; decoded playback is required");
const mediaBody = fs.readFileSync(mediaPath);
const channelCount = 96;
const longDescription = "A complete programme description remains available through scrolling. ".repeat(90);
fs.mkdirSync(output, { recursive: true });

function timestamp(value) { return new Date(value).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000"; }
async function remoteKey(page, code) {
    await page.evaluate(code => {
        for (const type of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(type, { keyCode: code, which: code, bubbles: true, cancelable: true }));
    }, code);
}
function playlist() {
    let text = "#EXTM3U\n";
    for (let i = 1; i <= channelCount; i++) text += '#EXTINF:-1 tvg-id="scroll-' + i + '" group-title="Scroll fixture category ' + i + ' with a descriptive category name",Scroll Channel ' + i + '\nhttps://scroll-fixture.invalid/media/' + i + '.mp4\n';
    return text;
}
function guide() {
    const now = Date.now();
    let xml = '<?xml version="1.0" encoding="UTF-8"?><tv>';
    for (let i = 1; i <= channelCount; i++) {
        xml += '<channel id="scroll-' + i + '"><display-name>Scroll Channel ' + i + '</display-name></channel>';
        for (let programme = 0; programme < 2; programme++) xml += '<programme channel="scroll-' + i + '" start="' + timestamp(now + (programme ? 1800000 : -600000)) + '" stop="' + timestamp(now + (programme ? 3600000 : 1800000)) + '"><title>' + (programme ? 'Next' : 'Current') + ' programme ' + i + '</title><desc>Details for channel ' + i + '. ' + longDescription + '</desc></programme>';
    }
    return xml + "</tv>";
}

(async () => {
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = "http://127.0.0.1:" + server.address().port;
    const pageErrors = [], unexpectedRequests = [], mediaRequests = [], checks = [];
    const reportPath = path.join(output, "browser-scroll-report.json");
    fs.writeFileSync(reportPath, JSON.stringify({ passed: false, status: "running" }));
    let browser;
    async function pointAt(page, selector) {
        // Resize may replace a resolved locator before evaluation. Resolve and
        // measure a connected visible target together, as scrollMetrics does.
        const target = await page.waitForFunction(selector => {
            const node = document.querySelector(selector);
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            const left = Math.max(rect.left, 0), right = Math.min(rect.right, innerWidth);
            const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
            return right > left && bottom > top ? { x: (left + right) / 2, y: (top + bottom) / 2 } : false;
        }, selector);
        const point = await target.jsonValue();
        await target.dispose();
        await page.mouse.move(point.x, point.y);
    }
    async function wheel(page, selector, deltaY, deltaX = 0) {
        await pointAt(page, selector);
        await page.mouse.wheel(deltaX, deltaY);
        await page.waitForTimeout(190);
    }
    async function scrollMetrics(page, selector) {
        // Resize and guide refresh replace the home DOM. Resolve and measure in
        // the same browser task so detached nodes cannot report zero geometry.
        const metrics = await page.waitForFunction(selector => {
            const node = document.querySelector(selector);
            return node && node.clientHeight > 0 ? { top: node.scrollTop, height: node.clientHeight, total: node.scrollHeight } : false;
        }, selector);
        const value = await metrics.jsonValue();
        await metrics.dispose();
        return value;
    }
    async function nativeScroll(page, selector, label) {
        const before = await scrollMetrics(page, selector);
        assert.ok(before.total > before.height + 2, label + ": fixture has real overflow " + JSON.stringify(before));
        await wheel(page, selector, -100000);
        const start = await scrollMetrics(page, selector);
        assert.ok(start.top < 2, label + ": wheel reaches the start");
        await wheel(page, selector, 280);
        const after = await scrollMetrics(page, selector);
        assert.ok(after.top > start.top + 2, label + ": real mouse wheel scrolls the content " + JSON.stringify(after));
        checks.push({ label, before: start, after });
        return after;
    }
    async function navigate(page, screen) {
        if (!(await page.locator("#nav-" + screen).isVisible())) await page.click("#menu-toggle");
        await page.click("#nav-" + screen);
    }
    async function channelPage(page, first, selected, checkFocus = true) {
        await page.waitForFunction(({ first, selected }) => {
            const row = document.getElementById("channel-0");
            const chosen = document.getElementById("f2-selected-channel");
            return row && row.querySelector(".f2-channel-name").textContent.trim() === "Scroll Channel " + first && chosen && chosen.textContent.trim() === "Scroll Channel " + selected;
        }, { first, selected });
        assert.equal(await page.locator("#f2-selected-programme").innerText(), "Current programme " + selected);
        if (checkFocus) assert.equal(await page.evaluate(() => document.activeElement.id), "channel-" + (selected - first), "Wheel pagination preserves the channel cursor row");
    }
    async function preservedPlayback(page, label) {
        const before = await page.locator("#player-video").evaluate(video => video.currentTime);
        await page.waitForFunction(time => document.getElementById("player-video").currentTime > time + 0.1, before);
        const state = await page.evaluate(() => {
            const video = document.getElementById("player-video");
            return { sameElement: video === window.__scrollVideo, source: video.currentSrc, width: video.videoWidth, paused: video.paused, reloads: window.__scrollReloads };
        });
        assert.equal(state.sameElement, true, label + ": decoder element is retained");
        assert.equal(state.source, "https://scroll-fixture.invalid/media/3.mp4", label + ": scrolling never tunes the highlighted channel");
        assert.ok(state.width > 0, label + ": real video frames decoded");
        assert.equal(state.paused, false, label + ": playback keeps advancing");
        assert.deepEqual(state.reloads, [], label + ": no load or clear event");
        checks.push({ label, playback: state });
    }
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        page.setDefaultTimeout(10000);
        page.on("pageerror", error => pageErrors.push(error.message));
        await page.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && url.pathname === "/api/epg") { await route.fulfill({ contentType: "application/xml", body: guide() }); return; }
            if (url.origin === origin) { await route.continue(); return; }
            if (url.origin === "https://scroll-fixture.invalid" && /^\/media\/\d+\.mp4$/.test(url.pathname)) {
                mediaRequests.push(url.pathname);
                await route.fulfill({ contentType: "video/mp4", body: mediaBody, headers: { "Access-Control-Allow-Origin": "*" } }); return;
            }
            unexpectedRequests.push(url.origin + url.pathname); await route.abort();
        });
        await page.goto(origin + "/f/lg/webos/");
        await page.click("#connect"); await page.fill("#source-name", "Local scrolling fixture"); await page.fill("#source-text", playlist());
        await page.locator("#source-text").scrollIntoViewIfNeeded();
        await wheel(page, "#source-text", -100000);
        const fieldBefore = await scrollMetrics(page, "#source-text"), parentBefore = await scrollMetrics(page, "#f2-dialog");
        assert.ok(fieldBefore.total > fieldBefore.height + 2, "Multiline source text has real native overflow");
        await wheel(page, "#source-text", 280);
        const fieldAfter = await scrollMetrics(page, "#source-text");
        assert.ok(fieldAfter.top > fieldBefore.top + 2, "Real mouse wheel scrolls the multiline source field");
        assert.equal((await scrollMetrics(page, "#f2-dialog")).top, parentBefore.top, "Scrolling a multiline field does not move its parent dialog");
        checks.push({ label: "Multiline source text uses its own native scroll port", before: fieldBefore, after: fieldAfter });
        await page.click("#save-source");
        await page.locator("#channel-0 .f2-program-title").filter({ hasText: "Current programme 1" }).waitFor();
        const pageSize = await page.locator(".f2-channel").count();
        assert.ok(pageSize >= 20 && pageSize <= 30, "720p wheel fixture uses at least twenty compact channel rows");
        assert.equal(await page.locator(".f2-pages").count(), 0, "Pointer paging needs no separate bottom controls row");
        const lastPage = Math.floor((channelCount - 1) / pageSize);
        const lastFirst = lastPage * pageSize + 1, lastSelected = Math.min(lastFirst + 2, channelCount);
        await page.click("#channel-2");
        await page.waitForFunction(() => { const video = document.getElementById("player-video"); return video.videoWidth > 0 && video.currentTime > 0.2; });
        await page.locator("#player-video").click({ position: { x: 25, y: 25 } });
        await channelPage(page, 1, 3);
        await page.evaluate(() => {
            const video = document.getElementById("player-video"); window.__scrollVideo = video; window.__scrollReloads = [];
            ["loadstart", "emptied"].forEach(name => video.addEventListener(name, () => window.__scrollReloads.push(name)));
        });
        await wheel(page, "#channel-5", 120); await channelPage(page, pageSize + 1, pageSize + 3);
        await wheel(page, "#channel-5", 120); await channelPage(page, 2 * pageSize + 1, 2 * pageSize + 3);
        await wheel(page, "#channel-5", -120); await channelPage(page, pageSize + 1, pageSize + 3);
        await wheel(page, "#channel-5", -120); await channelPage(page, 1, 3);
        await wheel(page, "#channel-5", -120); await channelPage(page, 1, 3);
        checks.push({ label: "Vertical mouse wheel traverses channel pages both ways and clamps the first page" });
        await wheel(page, "#channel-5", 0, 120); await channelPage(page, pageSize + 1, pageSize + 3);
        await page.keyboard.down("Shift");
        await wheel(page, "#channel-5", 120);
        await page.keyboard.up("Shift");
        await channelPage(page, 2 * pageSize + 1, 2 * pageSize + 3);
        await wheel(page, "#channel-5", 0, -120); await channelPage(page, pageSize + 1, pageSize + 3);
        checks.push({ label: "Horizontal trackpad and Shift-wheel page the channel list" });
        for (const legacy of [{ type: "mousewheel", wheelDelta: -120 }, { type: "DOMMouseScroll", detail: 3 }]) {
            await page.locator("#channel-5").evaluate((node, data) => {
                const event = document.createEvent("Event"); event.initEvent(data.type, true, true);
                for (const key of Object.keys(data)) if (key !== "type") Object.defineProperty(event, key, { value: data[key] });
                node.dispatchEvent(event);
            }, legacy);
            await page.waitForTimeout(190);
        }
        await channelPage(page, 3 * pageSize + 1, 3 * pageSize + 3);
        for (let index = 3; index < lastPage; index++) await wheel(page, "#channel-0", 120);
        await channelPage(page, lastFirst, lastSelected);
        await wheel(page, "#channel-0", 120); await channelPage(page, lastFirst, lastSelected);
        checks.push({ label: "Legacy WebKit and Gecko wheel events page channels; the last page is clamped" });
        await preservedPlayback(page, "All pointer pagination updates selected EPG while the original channel continues playing");
        await nativeScroll(page, "#f2-selected-info", "The complete selected EPG description scrolls inside its panel");
        await wheel(page, "#f2-selected-info", 100000); await wheel(page, "#f2-selected-info", 120);
        await channelPage(page, lastFirst, lastSelected);
        await page.click("#channel-details");
        await nativeScroll(page, "#f2-dialog", "A long channel Info dialog scrolls with the mouse");
        await wheel(page, "#f2-dialog", 100000); await wheel(page, "#f2-dialog", 120);
        assert.equal(await page.locator("#f2-selected-channel").innerText(), "Scroll Channel " + lastSelected, "Dialog wheel does not paginate the channel list underneath");
        await page.keyboard.press("Escape");
        await channelPage(page, lastFirst, lastSelected, false);
        await preservedPlayback(page, "Native EPG and dialog scrolling preserve the media session");

        await navigate(page, "guide");
        assert.equal(await page.locator(".f2-guide-row").count(), 30);
        const firstGuide = await page.locator("#guide-0").innerText();
        await nativeScroll(page, ".f2-main", "A thirty-programme guide page scrolls naturally before pagination");
        assert.equal(await page.locator("#guide-0").innerText(), firstGuide, "Native guide scrolling keeps the current programme page");
        await wheel(page, ".f2-main", 100000);
        assert.equal(await page.locator("#guide-0").innerText(), firstGuide, "Reaching the end first consumes only the current page's overflow");
        await wheel(page, ".f2-main", 120);
        await page.waitForFunction(first => document.getElementById("guide-0").innerText !== first, firstGuide);
        assert.ok((await scrollMetrics(page, ".f2-main")).top < 2, "The next guide page begins at the top");
        await wheel(page, ".f2-main", -120);
        await page.waitForFunction(first => document.getElementById("guide-0").innerText === first, firstGuide);
        checks.push({ label: "Guide wheel changes pages only after reaching a native scroll boundary" });
        await preservedPlayback(page, "Scrolling and paging the programme guide do not retune playback");

        await navigate(page, "settings");
        await page.click("#scale-3"); await page.setViewportSize({ width: 640, height: 240 });
        await nativeScroll(page, ".f2-main", "Settings scroll at a small desktop viewport and enlarged text size");
        await page.click("#menu-toggle");
        const mainBefore = await scrollMetrics(page, ".f2-main");
        await nativeScroll(page, "#f2-sidebar", "The sections menu scrolls when it is taller than the viewport");
        assert.equal((await scrollMetrics(page, ".f2-main")).top, mainBefore.top, "Sidebar scrolling does not move the settings behind it");
        await preservedPlayback(page, "Settings and sidebar wheel journeys preserve playback");

        await remoteKey(page, 461);
        await navigate(page, "tv");
        await page.setViewportSize({ width: 360, height: 640 });
        await page.waitForFunction(() => getComputedStyle(document.getElementById("f2-channel-detail")).position === "relative");
        const portraitSelected = await page.locator("#f2-selected-channel").innerText();
        await page.locator("#f2-selected-description").evaluate(node => node.scrollIntoView(true));
        const portraitBefore = await scrollMetrics(page, "#foss2-home");
        assert.ok(portraitBefore.total > portraitBefore.height + 280, "Portrait EPG has real outer-page overflow");
        await wheel(page, "#f2-selected-description", 280);
        const portraitAfter = await scrollMetrics(page, "#foss2-home");
        assert.ok(portraitAfter.top > portraitBefore.top + 2, "Wheel over flowing portrait EPG scrolls the outer page");
        await wheel(page, "#f2-selected-description", 100000);
        await wheel(page, "#f2-selected-description", 120);
        assert.equal(await page.locator("#f2-selected-channel").innerText(), portraitSelected, "Portrait EPG boundary never pages channels underneath");
        checks.push({ label: "Portrait EPG scrolls its outer page and isolates channel pagination", before: portraitBefore, after: portraitAfter });
        await preservedPlayback(page, "Portrait page scrolling preserves playback");
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpectedRequests, [], "All media and guide resources are local fixtures");
        assert.deepEqual(mediaRequests, ["/media/3.mp4"], "Only the explicit channel click requests media");
        const report = { passed: true, browser: "Chromium", realSyntheticPlayback: true, pageSize, channelCount, programmeCount: channelCount * 2, pageErrors, mediaRequests, checks };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    } catch (error) {
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: error.message, pageErrors, mediaRequests, checks }, null, 2));
        throw error;
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
