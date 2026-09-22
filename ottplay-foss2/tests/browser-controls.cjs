/* Keyboard and pointer playback controls, with one browser and synthetic media. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const mediaPath = process.env.OTT2_TEST_MEDIA;
assert.ok(mediaPath && fs.existsSync(mediaPath), "Set OTT2_TEST_MEDIA to a local synthetic MP4; decoded playback is required");
const mediaBody = fs.readFileSync(mediaPath);
const output = path.resolve(__dirname, "../test-results");
const programmeTitle = "Current controls programme";
const description = "The complete description belongs to the currently playing channel. " + "Programme details remain readable and scrollable on a television. ".repeat(45);
fs.mkdirSync(output, { recursive: true });

function timestamp(value) { return new Date(value).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000"; }
async function dispatchCode(page, code, identity = {}, types = ["keydown", "keyup"]) {
    return page.evaluate(({ code, identity, types }) => {
        const options = Object.assign({ keyCode: code, which: code, bubbles: true, cancelable: true }, identity);
        function legacyEvent(type) {
            const event = new KeyboardEvent(type, options);
            // Chromium derives which from keyCode instead of accepting which
            // in KeyboardEventInit. Define the legacy host field explicitly.
            Object.defineProperty(event, "which", { value: options.which });
            return event;
        }
        let prevented = false;
        for (const type of types) {
            const event = legacyEvent(type);
            window.dispatchEvent(event);
            prevented = prevented || event.defaultPrevented;
        }
        return prevented;
    }, { code, identity, types });
}
async function pressCode(page, code, identity = {}) { return dispatchCode(page, code, identity); }
function guide() {
    const now = Date.now();
    return '<?xml version="1.0" encoding="UTF-8"?><tv><channel id="controls"><display-name>Controls Channel</display-name></channel>' +
        '<programme channel="controls" start="' + timestamp(now - 600000) + '" stop="' + timestamp(now + 1800000) + '"><title>' + programmeTitle + '</title><desc>' + description + '</desc></programme>' +
        '<programme channel="controls" start="' + timestamp(now + 1800000) + '" stop="' + timestamp(now + 3600000) + '"><title>Next controls programme</title></programme></tv>';
}

(async () => {
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = "http://127.0.0.1:" + server.address().port;
    const reportPath = path.join(output, "browser-controls-report.json");
    const pageErrors = [], unexpectedRequests = [], checks = [];
    let browser, page;
    fs.writeFileSync(reportPath, JSON.stringify({ passed: false, status: "running" }));
    async function playing(page, label) {
        const before = await page.locator("#player-video").evaluate(video => video.currentTime);
        await page.waitForFunction(time => document.getElementById("player-video").currentTime > time + 0.1, before);
        const state = await page.evaluate(() => {
            const video = document.getElementById("player-video");
            return { sameElement: video === window.__controlsVideo, source: video.currentSrc, width: video.videoWidth, paused: video.paused, reloads: window.__controlsReloads.slice() };
        });
        assert.equal(state.sameElement, true, label + ": the original video element is retained");
        assert.equal(state.source, "https://controls-fixture.invalid/live.mp4", label + ": the current channel is unchanged");
        assert.ok(state.width > 0, label + ": actual frames have decoded");
        assert.equal(state.paused, false, label + ": playback continues");
        assert.deepEqual(state.reloads, [], label + ": no reload or clear event");
        checks.push({ label, playback: state });
    }
    async function footer(page, expanded) {
        await page.locator("#player-osd").waitFor({ state: "visible" });
        assert.equal(await page.locator("#player-osd").getAttribute("data-expanded"), String(expanded));
        assert.equal(await page.locator("#player-title").innerText(), "Controls Channel");
        assert.equal(await page.locator("#player-programme-title").innerText(), programmeTitle);
        assert.equal(await page.locator("#player-programme-details").isVisible(), expanded);
        assert.equal(await page.locator("#f2-dialog").count(), 0, "Information uses the footer without opening playback options");
        if (expanded) assert.equal(await page.locator("#player-description").textContent(), description.trim());
    }
    async function fullscreen(page, value) {
        await page.waitForFunction(value => Boolean(document.fullscreenElement) === value, value);
        if (value) assert.equal(await page.evaluate(() => document.fullscreenElement.tagName), "HTML", "Fullscreen includes the player and its confirmation dialogs");
    }
    async function quitDialog(page) {
        await page.locator("#f2-dialog").waitFor({ state: "visible" });
        assert.match(await page.locator("#f2-dialog").innerText(), /Exit.*player/i);
        assert.equal(await page.getByRole("button", { name: "Yes", exact: true }).count(), 1);
        assert.equal(await page.getByRole("button", { name: "No", exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "No", "Exit confirmation defaults to No");
    }
    async function startProfile(profile) {
        // Each profile journey deliberately starts in the channel list. Startup
        // restoration is covered independently by browser-startup.cjs.
        await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem("ottplay2:state:v1"));
            state.settings.restore = false; state.settings.startupVersion = 1;
            localStorage.setItem("ottplay2:state:v1", JSON.stringify(state));
        });
        await page.goto(origin + "/f/" + profile + "/");
        await page.locator("#channel-0 .f2-program-title").filter({ hasText: programmeTitle }).waitFor();
        await page.click("#channel-0");
        await page.waitForFunction(() => { const video = document.getElementById("player-video"); return video.videoWidth > 0 && video.currentTime > 0.2; });
        await page.evaluate(() => {
            window.__controlsVideo = document.getElementById("player-video"); window.__controlsReloads = [];
            for (const name of ["loadstart", "emptied"]) window.__controlsVideo.addEventListener(name, () => window.__controlsReloads.push(name));
        });
        await footer(page, false);
    }
    try {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        page.setDefaultTimeout(12000);
        page.on("pageerror", error => pageErrors.push(error.message));
        await page.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && url.pathname === "/api/epg") { await route.fulfill({ contentType: "application/xml", body: guide() }); return; }
            if (url.origin === origin) { await route.continue(); return; }
            if (url.href === "https://controls-fixture.invalid/live.mp4") {
                await route.fulfill({ contentType: "video/mp4", body: mediaBody, headers: { "Access-Control-Allow-Origin": "*" } }); return;
            }
            unexpectedRequests.push(url.origin + url.pathname); await route.abort();
        });
        await page.goto(origin + "/");
        await page.click("#connect");
        await page.fill("#source-name", "Local playback controls fixture");
        await page.fill("#source-text", '#EXTM3U\n#EXTINF:-1 tvg-id="controls" group-title="Local fixture",Controls Channel\nhttps://controls-fixture.invalid/live.mp4\n');
        await page.click("#save-source");
        await page.locator("#channel-0 .f2-program-title").filter({ hasText: programmeTitle }).waitFor();
        await page.click("#channel-0");
        await page.waitForFunction(() => { const video = document.getElementById("player-video"); return video.videoWidth > 0 && video.currentTime > 0.2; });
        await page.evaluate(() => {
            window.__controlsVideo = document.getElementById("player-video"); window.__controlsReloads = [];
            for (const name of ["loadstart", "emptied"]) window.__controlsVideo.addEventListener(name, () => window.__controlsReloads.push(name));
        });
        await footer(page, false);
        const startShown = Date.now();
        await page.locator("#player-osd").waitFor({ state: "hidden", timeout: 8500 });
        const startupHide = Date.now() - startShown;
        assert.ok(startupHide >= 4800 && startupHide < 8500, "Startup information hides after the six-second interval: " + startupHide);
        checks.push({ label: "Startup channel and EPG footer hides after six seconds", milliseconds: startupHide });

        await page.keyboard.press("Control+i");
        assert.equal(await page.locator("#player-osd").isVisible(), false, "Ctrl+I remains a browser shortcut and cannot open information");

        await pressCode(page, 73); await footer(page, false);
        await page.waitForTimeout(3200);
        await pressCode(page, 73, { key: "ш", code: "Unidentified" }); const expandedAt = Date.now(); await footer(page, true);
        await page.waitForTimeout(3100);
        assert.equal(await page.locator("#player-osd").isVisible(), true, "Second I resets the timer beyond the first I deadline");
        await page.locator("#player-osd").waitFor({ state: "hidden", timeout: 4500 });
        const expandedHide = Date.now() - expandedAt;
        assert.ok(expandedHide >= 5500 && expandedHide < 8000, "Expanded keyboard information has the same six-second interval: " + expandedHide);
        checks.push({ label: "I shows compact information; second I expands EPG and restarts the same timer", milliseconds: expandedHide });
        await playing(page, "Keyboard information preserves playback");

        const bottomPoint = { x: 1268, y: 708 };
        await page.mouse.click(bottomPoint.x, bottomPoint.y); await footer(page, false);
        await page.mouse.click(bottomPoint.x, bottomPoint.y); await footer(page, true);
        await page.screenshot({ path: path.join(output, "playback-controls-expanded.png") });
        const scroll = await page.locator("#player-description").evaluate(node => ({ height: node.clientHeight, total: node.scrollHeight }));
        assert.ok(scroll.total > scroll.height + 2, "The long EPG description retains scrollable content");
        await page.locator("#player-description").hover(); await page.mouse.wheel(0, 280);
        await page.waitForFunction(() => document.getElementById("player-description").scrollTop > 0);
        await page.locator("#player-description").focus();
        const descriptionPosition = await page.locator("#player-description").evaluate(node => node.scrollTop);
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction(position => document.getElementById("player-description").scrollTop > position, descriptionPosition);
        await page.locator("#player-osd").waitFor({ state: "hidden", timeout: 8500 });
        checks.push({ label: "Bottom pointer area opens and expands the same auto-hiding footer; description scrolls", description: scroll });
        await playing(page, "Pointer information preserves playback");

        await pressCode(page, 73, { keyCode: 0 });
        await footer(page, false);
        checks.push({ label: "Desktop Info uses numeric 73 with keyCode or which, regardless of keyboard layout" });

        await page.keyboard.press("l"); await fullscreen(page, true);
        await page.keyboard.press("l"); await fullscreen(page, false);
        await page.keyboard.press("l"); await fullscreen(page, true);
        await page.keyboard.press("Escape"); await fullscreen(page, false);
        await page.waitForTimeout(700);
        assert.equal(await page.locator("#f2-dialog").count(), 0, "Escape exiting fullscreen does not also open exit confirmation");
        assert.equal(await page.locator("#foss2-home").isVisible(), false, "Fullscreen Escape retains the playback view");
        checks.push({ label: "L toggles actual DOM fullscreen; Escape exits fullscreen only" });
        await playing(page, "Fullscreen changes preserve playback");

        await page.keyboard.press("Escape"); await quitDialog(page);
        await page.getByRole("button", { name: "No", exact: true }).click();
        assert.equal(await page.locator("#f2-dialog").count(), 0);
        await playing(page, "Declining windowed Escape exit keeps the current channel playing");
        await pressCode(page, 27, { key: "Unidentified", code: "Unidentified" }); await quitDialog(page);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#f2-dialog").count(), 0, "Escape cancels an open exit confirmation");
        await playing(page, "Cancelling numeric Exit keeps the current channel playing");
        await page.keyboard.press("l"); await fullscreen(page, true);
        await page.keyboard.press("Escape"); await fullscreen(page, false);
        await page.waitForTimeout(700);
        await pressCode(page, 27); await quitDialog(page);
        await page.getByRole("button", { name: "No", exact: true }).click();
        await playing(page, "Windowed Escape confirmation remains accessible after leaving fullscreen");
        await page.keyboard.press("l"); await fullscreen(page, true);

        await page.mouse.click(640, 260);
        await page.locator("#channel-0").waitFor({ state: "visible" });
        await page.click("#search");
        await page.locator("#search-query").fill("");
        await page.locator("#search-query").pressSequentially("qli");
        assert.equal(await page.locator("#search-query").inputValue(), "qli", "Shortcuts remain text while editing a search field");
        assert.match(await page.locator("#f2-dialog").innerText(), /Search channels/);
        assert.equal(await page.locator("#quit-yes").count(), 0);
        await fullscreen(page, false);
        await page.keyboard.press("Escape");
        await page.click("#resume-playback");
        await playing(page, "Search editing preserves playback and ignores global letter shortcuts");

        await page.evaluate(() => {
            window.__controlsDesktopKeys = [];
            window.addEventListener("keydown", event => window.__controlsDesktopKeys.push({ code: event.code, keyCode: event.keyCode, which: event.which, location: event.location }));
        });
        await page.keyboard.press("MediaPlayPause");
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused), true, "The desktop media key pauses the current channel");
        await page.keyboard.press("MediaPlayPause");
        await playing(page, "Desktop numeric media-key pause and resume preserve playback");
        // Playwright requests the number-enabled keypad form, but some Chromium
        // hosts still emit navigation codes. Record that limitation and supply
        // the explicit legacy numeric code instead of trusting the key name.
        await page.keyboard.press("Shift+Numpad1");
        const nativeKeypadOne = await page.evaluate(() => window.__controlsDesktopKeys.filter(event => event.code === "Numpad1").pop());
        if (nativeKeypadOne.keyCode !== 97) {
            assert.equal(nativeKeypadOne.keyCode, 35, "This Chromium host emits keypad End instead of numeric 1");
            assert.notEqual(await page.locator("#f2-toast").innerText(), "1", "A Numpad1 name must not override numeric End 35");
            await pressCode(page, 97, { key: "1", code: "Numpad1", location: 3 });
        }
        assert.equal(await page.locator("#f2-toast").innerText(), "1", "Numeric keypad 1 enters a channel digit");
        await page.keyboard.press("Shift+Numpad0");
        const nativeKeypadZero = await page.evaluate(() => window.__controlsDesktopKeys.filter(event => event.code === "Numpad0").pop());
        if (nativeKeypadZero.keyCode !== 96) {
            assert.equal(nativeKeypadZero.keyCode, 45, "This Chromium host emits keypad Insert instead of numeric 0");
            assert.equal(await page.locator("#f2-toast").innerText(), "1", "A Numpad0 name must not override numeric Insert 45");
            await pressCode(page, 96, { key: "0", code: "Numpad0", location: 3 });
        }
        assert.equal(await page.locator("#f2-toast").innerText(), "10", "The second keypad digit extends the channel number");
        const desktopKeys = await page.evaluate(() => window.__controlsDesktopKeys);
        assert.deepEqual(desktopKeys.filter(event => event.code === "MediaPlayPause").map(event => event.keyCode), [179, 179], "Trusted media-key events use numeric 179");
        assert.deepEqual(desktopKeys.filter(event => event.location === 3 && [96, 97].includes(event.keyCode)).map(event => event.keyCode), [97, 96], "Numeric keypad events use 97 and 96");
        await page.waitForTimeout(1300);
        await playing(page, "A non-existing keypad channel number keeps the current stream playing");
        checks.push({ label: "Desktop hardware media key 179 and keypad codes 97/96 are recognized through numeric profiles", events: desktopKeys,
            nativeKeypadCodes: [nativeKeypadOne.keyCode, nativeKeypadZero.keyCode], syntheticNumericKeypadFallback: nativeKeypadOne.keyCode !== 97 || nativeKeypadZero.keyCode !== 96 });

        // A normal user-opened browser tab cannot close itself. Simulate that
        // browser restriction while retaining the real application exit flow.
        await page.evaluate(() => {
            window.__controlsCloseCalls = 0; window.close = function () { window.__controlsCloseCalls++; };
            window.__controlsBeforeExit = JSON.parse(localStorage.getItem("ottplay2:state:v1")).lastChannel;
            window.__controlsExitDialogs = [];
            window.__controlsExitObserver = new MutationObserver(records => {
                for (const record of records) for (const node of record.addedNodes) {
                    if (node.nodeType === 1 && (node.id === "f2-dialog" || node.querySelector("#f2-dialog"))) window.__controlsExitDialogs.push(node.textContent);
                }
            });
            window.__controlsExitObserver.observe(document.body, {childList:true,subtree:true});
        });
        await page.keyboard.press("l"); await fullscreen(page, true);
        await pressCode(page, 81, { key: "й", code: "Unidentified" });
        await page.locator("#player-exited").waitFor({ state: "visible" });
        await fullscreen(page, false);
        const exited = await page.evaluate(() => {
            const video = document.getElementById("player-video");
            return { closeCalls: window.__controlsCloseCalls, paused: video.paused, source: video.getAttribute("src"), fullscreen: Boolean(document.fullscreenElement), dialogs: window.__controlsExitDialogs, before: window.__controlsBeforeExit, after: JSON.parse(localStorage.getItem("ottplay2:state:v1")).lastChannel };
        });
        assert.equal(exited.closeCalls, 1, "Direct Q exit attempts the browser close bridge once");
        assert.equal(exited.paused, true, "Direct Q exit stops playback");
        assert.equal(exited.source, null, "Direct Q exit releases the media URL");
        assert.equal(exited.fullscreen, false);
        assert.deepEqual(exited.dialogs, [], "Q does not create an exit confirmation");
        assert.deepEqual(exited.after, exited.before, "Q preserves the last played channel for startup");
        assert.equal(await page.locator("#quit-yes").count(), 0);
        await pressCode(page, 81);
        assert.equal(await page.evaluate(() => window.__controlsCloseCalls), 1, "A repeated Q cannot tear down twice");
        checks.push({ label: "Numeric Q directly exits fullscreen, releases playback and preserves startup without confirmation", state: exited });

        // Each platform reloads the same saved synthetic source in the same page.
        // Remote events contain numeric codes and may carry misleading desktop names.
        await startProfile("lg/webos");
        await pressCode(page, 457, { key: "q", code: "KeyQ" }); await footer(page, true);
        await page.locator("#player-osd").waitFor({ state: "hidden", timeout: 8500 });
        await dispatchCode(page, 457, { keyCode: 0 }, ["keydown"]); await footer(page, false);
        for (let burst = 0; burst < 4; burst++) {
            await page.waitForTimeout(100);
            await dispatchCode(page, 457, {}, ["keydown"]);
            await footer(page, false);
        }
        await page.waitForTimeout(380);
        await dispatchCode(page, 457, {}, ["keydown"]); await footer(page, true);
        await page.locator("#player-osd").waitFor({ state: "hidden", timeout: 8500 });
        await dispatchCode(page, 457, {}, ["keydown"]); await footer(page, false);
        await dispatchCode(page, 457, {}, ["keyup"]);
        await dispatchCode(page, 457, {}, ["keydown"]); await footer(page, true);
        await dispatchCode(page, 457, {}, ["keyup"]);
        checks.push({ label: "LG Info keydown-only bursts stay compact; a 350 ms quiet gap recovers release; keyup releases immediately and Info reopens after auto-hide" });
        assert.equal(await pressCode(page, 81, { key: "q", code: "KeyQ" }), false, "Unmapped LG code 81 cannot become a desktop quit shortcut");
        assert.equal(await page.locator("#f2-dialog").count(), 0);
        await pressCode(page, 461, { key: "Escape", code: "Escape" });
        await page.locator("#channel-0").waitFor({ state: "visible" });
        assert.equal(await page.locator("#f2-dialog").count(), 0, "LG Return opens the channel list without requesting exit");
        await pressCode(page, 27); await quitDialog(page);
        await pressCode(page, 461);
        assert.equal(await page.locator("#f2-dialog").count(), 0, "LG Return cancels the exit confirmation");
        await playing(page, "LG numeric Info, Return and Exit retain their profile meanings");

        await startProfile("samsung/maple");
        await pressCode(page, 99, { key: "q", code: "KeyQ" }); await footer(page, true);
        await pressCode(page, 73, { key: "i", code: "KeyI" });
        await page.locator("#channel-0").waitFor({ state: "visible" });
        const mapleStopped = await page.locator("#player-video").evaluate(video => ({ paused: video.paused, source: video.getAttribute("src") }));
        assert.equal(mapleStopped.paused, true, "Maple numeric 73 stops playback even when the event claims KeyI");
        assert.equal(mapleStopped.source, null, "Maple Stop releases the current stream");
        assert.equal(await page.locator("#f2-dialog").count(), 0);
        checks.push({ label: "Samsung Maple code 99 is Info and 73 is Stop regardless of desktop key names", state: mapleStopped });

        await startProfile("android");
        await pressCode(page, 165, { key: "q", code: "KeyQ" }); await footer(page, true);
        await page.locator("#player-description").focus();
        await page.locator("#player-description").evaluate(node => { node.scrollTop = 80; });
        const androidStart = await page.locator("#player-description").evaluate(node => node.scrollTop);
        await pressCode(page, 20, { key: "ArrowUp", code: "ArrowUp" });
        const androidDown = await page.locator("#player-description").evaluate(node => node.scrollTop);
        assert.ok(androidDown > androidStart, "Android numeric Down 20 scrolls the focused description despite a contradictory ArrowUp name");
        await pressCode(page, 19, { key: "ArrowDown", code: "ArrowDown" });
        const androidUp = await page.locator("#player-description").evaluate(node => node.scrollTop);
        assert.ok(androidUp < androidDown, "Android numeric Up 19 scrolls the description upward");
        const beforeHorizontal = await page.locator("#player-video").evaluate(video => video.currentTime);
        await pressCode(page, 21, { key: "ArrowRight", code: "ArrowRight" });
        const afterLeft = await page.locator("#player-video").evaluate(video => video.currentTime);
        await pressCode(page, 22, { key: "ArrowLeft", code: "ArrowLeft" });
        const afterRight = await page.locator("#player-video").evaluate(video => video.currentTime);
        assert.ok(Math.abs(afterLeft - beforeHorizontal) < 2 && Math.abs(afterRight - afterLeft) < 2, "Android Left and Right inside EPG do not seek the channel underneath");
        await pressCode(page, 4, { key: "Escape", code: "Escape" });
        await page.locator("#channel-0").waitFor({ state: "visible" });
        assert.equal(await page.locator("#f2-dialog").count(), 0, "Android shared Return/Exit code 4 retains the Back path");
        await playing(page, "Android numeric description navigation and Back preserve playback");
        checks.push({ label: "Android Info 165, arrows 19–22 and shared Back 4 follow the selected profile", scroll: { before: androidStart, down: androidDown, up: androidUp } });
        assert.deepEqual(pageErrors, [], "No browser runtime errors");
        assert.deepEqual(unexpectedRequests, [], "Only the temporary origin and synthetic fixture were requested");
        const report = { passed: true, at: new Date().toISOString(), browser: browser.version(), viewport: { width: 1280, height: 720 }, checks, pageErrors, unexpectedRequests };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "playback-controls-failed.png") }).catch(() => {});
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, at: new Date().toISOString(), error: String(error.stack || error), checks, pageErrors, unexpectedRequests }, null, 2) + "\n");
        throw error;
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
