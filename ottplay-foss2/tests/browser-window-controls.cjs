/* Desktop overlay CSS layout simulation and ordinary-browser regression checks.
 * Native installed-app title bars and window dragging require a separate UI check.
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const mediaPath = process.env.OTT2_TEST_MEDIA;
assert.ok(mediaPath && fs.existsSync(mediaPath), "Set OTT2_TEST_MEDIA to a local synthetic MP4; decoded playback is required");
const media = fs.readFileSync(mediaPath);
const css = fs.readFileSync(path.resolve(__dirname, "../ui/window-controls.css"), "utf8");
const reportPath = path.resolve(__dirname, "../test-results/browser-window-controls-report.json");
const fixtureOrigin = "https://window-controls-fixture.invalid";

function simulatedCSS(rect) {
    // DevTools' overlay paints a preview but does not supply titlebar env values
    // or activate display-mode in headless Chromium. Substitute only these
    // browser inputs; selectors, declarations and fullscreen rules stay intact.
    const values = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    assert.match(css, /@media\s*\(display-mode:\s*window-controls-overlay\)/);
    return css.replace(/@media\s*\(display-mode:\s*window-controls-overlay\)/g, "@media all")
        .replace(/env\(titlebar-area-(x|y|width|height),\s*0px\)/g, (match, name) => values[name] + "px");
}
function playlist() {
    let result = "#EXTM3U\n";
    for (let i = 1; i <= 29; i++) result += '#EXTINF:-1 tvg-id="overlay-' + i + '" group-title="Fixture",Overlay Channel ' + i + "\n" + fixtureOrigin + "/live.mp4\n";
    return result;
}

(async () => {
    const checks = [], pageErrors = [], unexpectedRequests = [];
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = "http://127.0.0.1:" + server.address().port;
    let browser, page;
    const report = { passed: false, status: "running", evidence: "Actual Chromium DOM, CSS, input, Fullscreen API and decoded synthetic MP4. WCO media mode and titlebar env inputs are explicitly simulated; native window controls and dragging are not covered.", checks, pageErrors, unexpectedRequests };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    async function geometry() {
        return page.evaluate(() => {
            function rect(id) { const node = document.getElementById(id), r = node && node.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } : null; }
            const drag = document.getElementById("window-drag-region"), style = getComputedStyle(drag);
            return { viewport: { width: innerWidth, height: innerHeight }, home: rect("foss2-home"), stage: rect("player-stage"), drag: rect("window-drag-region"),
                dragDisplay: style.display, dragRegion: style.getPropertyValue("app-region") || style.getPropertyValue("-webkit-app-region"),
                dialog: rect("f2-dialog"), keyboard: document.querySelector(".f2-keyboard-layer") ? document.querySelector(".f2-keyboard-layer").getBoundingClientRect().toJSON() : null,
                osd: rect("player-osd"), fullscreen: !!document.fullscreenElement };
        });
    }
    async function preservedPlayback(label) {
        const before = await page.locator("#player-video").evaluate(video => video.currentTime);
        await page.waitForFunction(before => document.getElementById("player-video").currentTime > before + 0.12, before);
        const value = await page.evaluate(() => { const video = document.getElementById("player-video"); return { sameElement: video === window.__overlayVideo, source: video.currentSrc, paused: video.paused, width: video.videoWidth, position: video.currentTime, reloadEvents: window.__overlayReloads.slice() }; });
        assert.equal(value.sameElement, true); assert.equal(value.source, fixtureOrigin + "/live.mp4"); assert.equal(value.paused, false); assert.ok(value.width > 0); assert.deepEqual(value.reloadEvents, []);
        checks.push({ label, playback: value });
    }
    async function simulate(rect, viewport) {
        await page.evaluate(text => { let node = document.getElementById("overlay-test-css"); if (!node) { node = document.createElement("style"); node.id = "overlay-test-css"; document.head.appendChild(node); } node.textContent = text; }, rect ? simulatedCSS(rect) : "");
        // An actual viewport resize exercises the existing player layout path.
        await page.setViewportSize(viewport);
    }
    async function previewAligned(label) {
        await page.waitForFunction(() => { const slot = document.getElementById("f2-preview-slot"), stage = document.getElementById("player-stage"); if (!slot || !stage) return false; const a = slot.getBoundingClientRect(), b = stage.getBoundingClientRect(); return a.width > 0 && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2; });
        const value = await geometry();
        checks.push({ label, geometry: value });
    }
    try {
        browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await context.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && url.pathname === "/api/epg") { await route.fulfill({ contentType: "application/xml", body: "<tv></tv>" }); return; }
            if (url.origin === origin) { await route.continue(); return; }
            if (url.href === fixtureOrigin + "/live.mp4") { await route.fulfill({ contentType: "video/mp4", body: media, headers: { "Access-Control-Allow-Origin": "*" } }); return; }
            unexpectedRequests.push(url.origin + url.pathname); await route.abort();
        });
        page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", error => pageErrors.push(error.message));
        await page.goto(origin + "/"); await page.locator("#connect").waitFor();
        let value = await geometry();
        assert.equal(value.dragDisplay, "none"); assert.equal(value.home.y, 0); assert.equal(value.home.height, 720);
        assert.equal(await page.locator("#window-drag-region").getAttribute("aria-hidden"), "true");
        assert.equal(await page.locator("#window-drag-region").evaluate(node => node.tabIndex), -1);
        checks.push({ label: "Ordinary browser keeps its original full-height layout and no draggable or focusable strip", geometry: value });
        await page.click("#connect"); await page.fill("#source-name", "Overlay fixture"); await page.fill("#source-text", playlist()); await page.click("#save-source"); await page.locator("#channel-0").waitFor();
        await page.click("#channel-0"); await page.waitForFunction(() => { const video = document.getElementById("player-video"); return video.videoWidth > 0 && video.currentTime > 0.2; });
        await page.evaluate(() => { window.__overlayVideo = document.getElementById("player-video"); window.__overlayReloads = []; for (const name of ["loadstart", "emptied"]) window.__overlayVideo.addEventListener(name, () => window.__overlayReloads.push(name)); });

        for (const fixture of [
            { name: "macOS left-side controls", viewport: { width: 1300, height: 720 }, rect: { x: 78, y: 0, width: 1172, height: 28 } },
            { name: "Windows right-side controls", viewport: { width: 1280, height: 720 }, rect: { x: 0, y: 0, width: 1142, height: 33 } }
        ]) {
            await simulate(fixture.rect, fixture.viewport);
            value = await geometry();
            assert.equal(value.dragDisplay, "block"); assert.equal(value.dragRegion, "drag");
            for (const key of ["x", "y", "width", "height"]) assert.equal(value.drag[key], fixture.rect[key]);
            assert.equal(value.stage.y, 0); assert.equal(value.stage.x, 0); assert.equal(value.stage.height, fixture.viewport.height); assert.equal(value.stage.width, fixture.viewport.width);
            checks.push({ label: fixture.name + " simulation reserves only the supplied drag rectangle and leaves video edge-to-edge", geometry: value });
            await page.locator("#player-video").click({ position: { x: 100, y: 100 } });
            await page.locator("#channel-0").waitFor(); value = await geometry();
            assert.equal(value.home.y, fixture.rect.y + fixture.rect.height); assert.equal(value.home.bottom, fixture.viewport.height);
            const menu = await page.locator("#menu-toggle").boundingBox(); assert.ok(menu.y >= value.home.y);
            await previewAligned(fixture.name + " browsing preview remains aligned after a real viewport resize");
            await page.locator("#channel-0").focus(); await page.keyboard.press("ArrowDown");
            assert.equal(await page.evaluate(() => document.activeElement.id), "channel-1");
            await page.click("#menu-toggle"); assert.equal(await page.locator("#f2-sidebar").getAttribute("aria-hidden"), "false"); await page.click("#menu-toggle");
            await page.click("#search"); value = await geometry(); assert.equal(value.dialog.y, fixture.rect.height);
            await page.locator(".f2-keyboard-open").first().click(); value = await geometry(); assert.equal(value.keyboard.y, fixture.rect.height);
            const key = await page.locator(".f2-kb-key").first().boundingBox(); assert.ok(key.y >= fixture.rect.height);
            await page.locator(".f2-kb-key").first().click();
            await page.locator('[data-action="keyboardCommand"][data-value="done"]').click();
            assert.ok((await page.inputValue("#search-query")).length > 0);
            await page.click("#dialog-close");
            checks.push({ label: fixture.name + " mouse menu, numeric remote navigation, modal and on-screen keyboard remain usable below the title bar" });
            await page.click("#resume-playback");
            await preservedPlayback(fixture.name + " browsing, input and overlays preserve the playing channel and decoder");
        }

        await page.keyboard.press("l"); await page.waitForFunction(() => !!document.fullscreenElement);
        value = await geometry(); assert.equal(value.dragDisplay, "none"); assert.equal(value.stage.y, 0); assert.equal(value.stage.height, value.viewport.height);
        checks.push({ label: "Actual video fullscreen hides the simulated drag strip and leaves the whole viewport available", geometry: value });
        await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.fullscreenElement);
        await page.locator("#player-video").click({ position: { x: 100, y: 100 } }); await page.locator("#channel-0").waitFor();
        await page.keyboard.press("l"); await page.waitForFunction(() => !!document.fullscreenElement);
        value = await geometry(); assert.equal(value.home.y, 0);
        await previewAligned("Actual fullscreen removes the simulated title bar inset and realigns the preview");
        await page.click("#search"); value = await geometry(); assert.equal(value.dialog.y, 0); await page.click("#dialog-close");
        await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.fullscreenElement);
        value = await geometry(); assert.equal(value.dragDisplay, "block"); assert.equal(value.home.y, 33);
        await previewAligned("Exiting actual fullscreen restores the simulated title bar inset and preview alignment");
        await page.click("#resume-playback"); await preservedPlayback("Entering and leaving fullscreen preserve decoded playback");

        await simulate({ x: 0, y: 0, width: 502, height: 33 }, { width: 640, height: 240 });
        await page.keyboard.press("i"); await page.locator("#player-osd").waitFor({ state: "visible" });
        value = await geometry(); assert.ok(value.osd.y >= 33); assert.ok(value.osd.bottom <= 240);
        const scrolled = await page.locator("#player-osd").evaluate(node => { node.scrollTop = node.scrollHeight; return { client: node.clientHeight, total: node.scrollHeight, scrollTop: node.scrollTop, overflow: getComputedStyle(node).overflowY }; });
        assert.equal(scrolled.overflow, "auto"); if (scrolled.total > scrolled.client) assert.ok(scrolled.scrollTop > 0);
        checks.push({ label: "A short overlay window keeps footer controls below system buttons with scrollable overflow", geometry: value, scroll: scrolled });

        await simulate(null, { width: 1280, height: 720 });
        value = await geometry(); assert.equal(value.dragDisplay, "none"); assert.equal(value.stage.y, 0);
        await page.locator("#player-video").click({ position: { x: 100, y: 100 } }); await page.locator("#channel-0").waitFor(); value = await geometry(); assert.equal(value.home.y, 0);
        await previewAligned("Returning to ordinary browser styling restores the original preview layout");
        await page.click("#resume-playback"); await preservedPlayback("Overlay fallback preserves the same media session");
        assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedRequests, []);
        Object.assign(report, { passed: true, status: "complete", browser: browser.version(), timestamp: new Date().toISOString() });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
        process.stdout.write(JSON.stringify({ passed: true, checks: checks.length, pageErrors, unexpectedRequests, report: reportPath }) + "\n");
    } catch (error) {
        Object.assign(report, { status: "failed", error: String(error.stack || error), timestamp: new Date().toISOString() });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
        throw error;
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; });
