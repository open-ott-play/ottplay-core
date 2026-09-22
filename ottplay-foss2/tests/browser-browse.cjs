/* LG channel browsing journeys. One Chromium process; all guide/media data is synthetic. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const output = path.resolve(__dirname, "../test-results");
const mediaPath = process.env.OTT2_TEST_MEDIA;
assert.ok(mediaPath && fs.existsSync(mediaPath), "Set OTT2_TEST_MEDIA to a local synthetic MP4; actual playback is required for this test");
const mediaBody = fs.readFileSync(mediaPath);
fs.mkdirSync(output, { recursive: true });
const channelCount = 65;
let missingGuideChannel = 26;

function timestamp(value) { return new Date(value).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000"; }
async function remoteKey(page, code) {
    await page.evaluate(code => {
        for (const type of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(type, { keyCode: code, which: code, bubbles: true, cancelable: true }));
    }, code);
}
function guide() {
    const now = Date.now();
    let xml = '<?xml version="1.0" encoding="UTF-8"?><tv>';
    for (let i = 1; i <= channelCount; i++) {
        xml += '<channel id="browse-' + i + '"><display-name>Browse Channel ' + i + '</display-name><icon src="https://browse-fixture.invalid/icons/' + i + '.svg"/></channel>';
        if (i === missingGuideChannel) continue;
        xml += '<programme channel="browse-' + i + '" start="' + timestamp(now - 600000) + '" stop="' + timestamp(now + 1800000) + '"><title>Current bulletin ' + i + (i === 1 ? ': World news and the latest local headlines' : '') + '</title><desc>Details for selected channel ' + i + '. A local synthetic programme description. ' + ('Long programme descriptions stay inside the details panel. '.repeat(48)) + '</desc></programme>';
        xml += '<programme channel="browse-' + i + '" start="' + timestamp(now + 1800000) + '" stop="' + timestamp(now + 3600000) + '"><title>Next bulletin ' + i + '</title></programme>';
    }
    return xml + '</tv>';
}
function playlist() {
    let text = '#EXTM3U\n';
    for (let i = 1; i <= channelCount; i++) text += '#EXTINF:-1 tvg-id="browse-' + i + '" group-title="Local fixture",Browse Channel ' + i + '\nhttps://browse-fixture.invalid/media/' + i + '.mp4\n';
    return text;
}

(async () => {
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = "http://127.0.0.1:" + server.address().port;
    const pageErrors = [], unexpectedRequests = [], layoutChecks = [], playbackChecks = [], mediaRequests = [], autoScrollChecks = [], previewChecks = [];
    let playingChannel;
    let browser, releaseGuide, guideRequested;
    const requested = new Promise(resolve => { guideRequested = resolve; });
    const released = new Promise(resolve => { releaseGuide = resolve; });
    const reportPath = path.join(output, "browser-browse-report.json");
    fs.writeFileSync(reportPath, JSON.stringify({ passed: false, status: "running" }));
    async function focusedChannel(page) {
        return page.evaluate(() => {
            const row = document.activeElement;
            return { id: row.id, name: row.querySelector(".f2-channel-name") ? row.querySelector(".f2-channel-name").textContent.trim() : "" };
        });
    }
    async function expectFocus(page, channel, row) {
        await page.waitForFunction(({ channel, row }) => {
            const active = document.activeElement;
            return active.id === "channel-" + row && active.querySelector(".f2-channel-name") && active.querySelector(".f2-channel-name").textContent.trim() === "Browse Channel " + channel;
        }, { channel, row });
        assert.deepEqual(await focusedChannel(page), { id: "channel-" + row, name: "Browse Channel " + channel });
        assert.equal(await page.locator("#f2-selected-channel").innerText(), "Browse Channel " + channel);
    }
    async function unchangedPlayback(page, label) {
        const before = await page.locator("#player-video").evaluate(video => video.currentTime);
        await page.waitForFunction(time => document.getElementById("player-video").currentTime > time + 0.3, before, { timeout: 10000 });
        const metrics = await page.evaluate(() => {
            const video = document.getElementById("player-video");
            return { sameElement: video === window.__browseVideo, videoCount: document.querySelectorAll("video").length, source: video.currentSrc,
                position: video.currentTime, paused: video.paused, videoWidth: video.videoWidth, reloadEvents: window.__browseReloadEvents.slice() };
        });
        assert.equal(metrics.sameElement, true, label + ": the original decoder element remains attached");
        assert.equal(metrics.videoCount, 1, label + ": preview uses one video element");
        assert.equal(metrics.source, "https://browse-fixture.invalid/media/" + playingChannel + ".mp4", label + ": browsing does not tune another channel");
        assert.equal(metrics.paused, false, label + ": playback continues");
        assert.ok(metrics.videoWidth > 0, label + ": video pixels have decoded");
        assert.deepEqual(metrics.reloadEvents, [], label + ": no media load or clear during browsing");
        playbackChecks.push({ label, ...metrics });
    }
    async function expandedPlayback(page, label) {
        await page.waitForFunction(() => document.getElementById("foss2-home").style.display === "none");
        const metrics = await page.evaluate(() => {
            const stage = document.getElementById("player-stage").getBoundingClientRect(), video = document.getElementById("player-video");
            return { left: stage.left, top: stage.top, width: stage.width, height: stage.height, windowWidth: innerWidth, windowHeight: innerHeight,
                nativeFullscreen: !!document.fullscreenElement, sameElement: video === window.__browseVideo, source: video.currentSrc, paused: video.paused, reloadEvents: window.__browseReloadEvents.slice() };
        });
        assert.equal(metrics.nativeFullscreen, false, label + ": preview expansion does not request native fullscreen");
        assert.ok(Math.abs(metrics.left) < 1 && Math.abs(metrics.top) < 1 && Math.abs(metrics.width - metrics.windowWidth) < 1 && Math.abs(metrics.height - metrics.windowHeight) < 1, label + ": video stage fills the application window");
        assert.equal(metrics.sameElement, true, label + ": the same decoder remains attached");
        assert.equal(metrics.source, "https://browse-fixture.invalid/media/" + playingChannel + ".mp4", label + ": the playing stream is retained");
        assert.deepEqual(metrics.reloadEvents, [], label + ": expanding the preview does not reload media");
        previewChecks.push({ label, ...metrics });
    }
    async function checkLayout(page, label) {
        await page.waitForFunction(() => {
            const slot = document.getElementById("f2-preview-slot"), stage = document.getElementById("player-stage");
            if (!slot || !stage) return false;
            const a = slot.getBoundingClientRect(), b = stage.getBoundingClientRect();
            return a.width > 0 && b.width > 0 && Math.abs(a.left - b.left) < 3 && Math.abs(a.top - b.top) < 3 && Math.abs(a.width - b.width) < 3 && Math.abs(a.height - b.height) < 3;
        });
        const metrics = await page.evaluate(() => {
            function rect(node) { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }
            const root = document.getElementById("foss2-home"), main = document.querySelector(".f2-main"), rows = document.querySelectorAll(".f2-channel");
            const detail = document.getElementById("f2-channel-detail"), description = document.getElementById("f2-selected-description"), info = document.getElementById("f2-selected-info");
            return { width: innerWidth, height: innerHeight, rows: rows.length, fontSize: root.style.fontSize,
                mainClient: main.clientHeight, mainScroll: main.scrollHeight, rootOverflow: root.scrollWidth > root.clientWidth + 1,
                main: rect(main), lastRow: rect(rows[rows.length - 1]), footer: rect(document.querySelector(".f2-footer")),
                preview: rect(document.getElementById("f2-preview-slot")), stage: rect(document.getElementById("player-stage")), video: rect(document.getElementById("player-video")),
                detail: rect(detail), info: rect(info), infoOverflow: getComputedStyle(info).overflowY, infoHeight: info.clientHeight, infoScrollHeight: info.scrollHeight,
                description: rect(description), descriptionLineHeight: parseFloat(getComputedStyle(description).lineHeight), descriptionOverflow: getComputedStyle(description).overflowY };
        });
        assert.equal(metrics.rootOverflow, false, label + ": no horizontal overflow");
        assert.ok(metrics.mainScroll <= metrics.mainClient + 1, label + ": TV page fits without scrolling " + JSON.stringify(metrics));
        assert.ok(metrics.lastRow.bottom <= metrics.main.bottom + 1 && metrics.lastRow.bottom < metrics.footer.top, label + ": channel rows stay above the footer");
        assert.ok(metrics.preview.width > 100 && metrics.preview.height > 60, label + ": visible video preview");
        for (const edge of ["left", "top", "right", "bottom"]) assert.ok(Math.abs(metrics.video[edge] - metrics.stage[edge]) < 3, label + ": full video frame fits the preview rather than clipping a fullscreen-sized decoder surface " + JSON.stringify({ video: metrics.video, stage: metrics.stage }));
        assert.ok(metrics.detail.right <= metrics.main.right + 1 && metrics.detail.bottom <= metrics.main.bottom + 1 && metrics.detail.bottom < metrics.footer.top, label + ": EPG panel fits the TV viewport");
        assert.ok(metrics.info.bottom <= metrics.detail.bottom + 1, label + ": the EPG scrollport stays inside the details panel");
        assert.equal(metrics.infoOverflow, "auto", label + ": the complete programme text is scrollable");
        assert.ok(metrics.infoScrollHeight > metrics.infoHeight, label + ": long description content is retained beyond the viewport");
        assert.ok(Math.min(metrics.info.bottom, metrics.description.bottom) - Math.max(metrics.info.top, metrics.description.top) >= metrics.descriptionLineHeight * 2 - 1, label + ": at least two description lines are initially visible");
        assert.ok(metrics.lastRow.right <= metrics.detail.left + 1, label + ": details do not cover channel names");
        layoutChecks.push({ label, ...metrics });
    }
    async function section(page, name) {
        if (!await page.locator("#nav-" + name).isVisible()) await page.click("#menu-toggle");
        await page.click("#nav-" + name);
    }
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        page.setDefaultTimeout(15000);
        page.on("pageerror", error => pageErrors.push(error.message));
        await page.route("**/*", async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin === origin && url.pathname === "/api/epg") {
                assert.equal(request.method(), "POST");
                assert.equal(request.postDataJSON().channels.length, channelCount);
                guideRequested(); await released;
                await route.fulfill({ contentType: "application/xml", body: guide() }); return;
            }
            if (url.origin === origin) { await route.continue(); return; }
            if (url.origin === "https://browse-fixture.invalid" && /^\/media\/\d+\.mp4$/.test(url.pathname)) {
                mediaRequests.push(url.pathname);
                await route.fulfill({ contentType: "video/mp4", body: mediaBody, headers: { "Access-Control-Allow-Origin": "*" } }); return;
            }
            if (url.origin === "https://browse-fixture.invalid" && /^\/icons\/\d+\.svg$/.test(url.pathname)) {
                await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#277ead"/><text x="80" y="64" text-anchor="middle" fill="white" font-size="54">TV</text></svg>' }); return;
            }
            unexpectedRequests.push(url.origin + url.pathname); await route.abort();
        });
        await page.goto(origin + "/f/lg/webos/");
        await page.click("#connect"); await page.fill("#source-name", "Local browsing fixture"); await page.fill("#source-text", playlist()); await page.click("#save-source");
        await requested;
        await page.locator("#channel-0").waitFor();
        const pageSize = await page.locator(".f2-channel").count();
        assert.ok(pageSize >= 20 && pageSize <= 30, "720p displays at least twenty compact channel rows");
        assert.ok(await page.locator("#channel-0").evaluate(node => node.getBoundingClientRect().height) <= 28, "Default channel rows are no taller than 28 pixels");
        assert.equal(await page.locator(".f2-pages").count(), 0, "TV pages have no bottom paging row");
        assert.ok(await page.locator(".f2-heading").evaluate(node => node.getBoundingClientRect().top) <= 6, "The channel heading uses the top of the TV viewport");
        assert.ok(await page.locator("#channel-0").evaluate(node => node.getBoundingClientRect().top) < 52, "The first row is raised into the former header gap");
        assert.equal(await page.locator("#f2-header-page").innerText(), "1 / " + Math.ceil(channelCount / pageSize));
        const firstPlayed = 2 * pageSize;
        playingChannel = firstPlayed + 1;
        missingGuideChannel = playingChannel + 1;
        const finalPage = Math.floor((channelCount - 1) / pageSize), finalFirst = finalPage * pageSize + 1;
        const finalRowCount = channelCount - finalFirst + 1;
        assert.equal(await page.locator("#f2-sidebar").isVisible(), false, "Sections start collapsed");
        assert.equal(await page.locator("#menu-toggle").isVisible(), true, "Menu has a visible pointer and remote target");
        await page.locator("#channel-0").focus(); await page.keyboard.press("ArrowRight"); await page.click("#channel-" + (pageSize - 1));
        assert.equal(await page.locator("#f2-dialog").count(), 0, "A live channel click starts playback without an extra confirmation");
        await page.waitForFunction(channel => { const video = document.getElementById("player-video"); return video.currentSrc.endsWith("/" + channel + ".mp4") && video.currentTime > 0.3 && video.videoWidth > 0; }, firstPlayed);
        await page.locator("#player-video").click({ position: { x: 30, y: 30 } }); await expectFocus(page, firstPlayed, pageSize - 1);
        assert.equal(await page.locator("#f2-sidebar").isVisible(), false, "Video click reveals the channel list with sections collapsed");
        await remoteKey(page, 457); await page.locator("#watch").focus();
        const dialogFocus = await page.evaluate(() => document.activeElement.id);
        releaseGuide();
        await page.locator("#channel-" + (pageSize - 1) + " .f2-program-title").filter({ hasText: "Current bulletin " + firstPlayed }).waitFor();
        assert.equal(await page.locator("#f2-dialog").count(), 1, "EPG completion retains the explicitly opened Info dialog");
        assert.equal(await page.evaluate(() => document.activeElement.id), dialogFocus, "EPG completion preserves dialog remote focus");
        await page.keyboard.press("Escape"); await expectFocus(page, firstPlayed, pageSize - 1);
        await page.keyboard.press("ArrowDown"); await expectFocus(page, playingChannel, 0);
        assert.equal(await page.locator("#player-video").evaluate(video => video.currentSrc), "https://browse-fixture.invalid/media/" + firstPlayed + ".mp4", "Highlighting another row retains the current stream until OK");
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("#f2-dialog").count(), 0, "Remote OK immediately plays the highlighted channel without a channel card");
        await page.waitForFunction(channel => { const video = document.getElementById("player-video"); return video.currentSrc.endsWith("/" + channel + ".mp4") && video.currentTime > 0.3 && video.videoWidth > 0; }, playingChannel);
        await page.evaluate(() => {
            const video = document.getElementById("player-video"); window.__browseVideo = video; window.__browseReloadEvents = [];
            ["loadstart", "emptied"].forEach(name => video.addEventListener(name, () => window.__browseReloadEvents.push(name)));
        });
        await remoteKey(page, 461);
        await page.waitForFunction(() => document.getElementById("foss2-home").style.display !== "none");
        await expectFocus(page, playingChannel, 0);
        assert.equal(await page.locator("#f2-selected-programme").innerText(), "Current bulletin " + playingChannel);
        assert.ok((await page.locator("#f2-selected-description").innerText()).startsWith("Details for selected channel " + playingChannel + "."));
        assert.ok((await page.locator("#f2-selected-next").innerText()).includes("Next bulletin " + playingChannel));
        assert.match(await page.locator("#f2-selected-time").innerText(), /\d\d:\d\d.*\d\d:\d\d/);
        assert.ok((await page.locator("#f2-now-playing").innerText()).includes("Browse Channel " + playingChannel));
        await unchangedPlayback(page, "Back after selecting a different channel restores the correct page and cursor");

        const beforeAutoScroll = await page.locator("#f2-selected-info").evaluate(node => ({ top: node.scrollTop, total: node.scrollHeight, height: node.clientHeight }));
        assert.ok(beforeAutoScroll.total > beforeAutoScroll.height + 30, "Long selected EPG has actual overflowing content");
        await page.waitForFunction(start => document.getElementById("f2-selected-info").scrollTop > start + 8, beforeAutoScroll.top, { timeout: 8000 });
        const automaticallyScrolled = await page.locator("#f2-selected-info").evaluate(node => node.scrollTop);
        await expectFocus(page, playingChannel, 0);
        await unchangedPlayback(page, "Idle EPG auto-scroll keeps the selected channel and original decoder playing");
        autoScrollChecks.push({ label: "Long EPG moves without input and preserves channel focus and playback", before: beforeAutoScroll.top, after: automaticallyScrolled });
        await page.evaluate(() => {
            let previous = document.getElementById("f2-selected-info");
            window.__browseEpgNodes = [previous, document.activeElement, document.getElementById("f2-preview-slot"), document.querySelector("#channel-0 img")];
            window.__browseEpgRefresh = { started: Date.now(), before: previous.scrollTop, replacements: [], progressUpdates: 0 };
            window.__browseEpgObserver = new MutationObserver(records => {
                const current = document.getElementById("f2-selected-info");
                for (const record of records) if (record.type === "attributes" && record.target.parentNode && record.target.parentNode.classList.contains("f2-progress")) window.__browseEpgRefresh.progressUpdates++;
                if (current && current !== previous) {
                    window.__browseEpgRefresh.replacements.push({ elapsed: Date.now() - window.__browseEpgRefresh.started, top: current.scrollTop });
                    previous = current;
                }
            });
            window.__browseEpgObserver.observe(document.getElementById("foss2-home"), { childList: true, attributes: true, attributeFilter: ["style"], subtree: true });
        });
        // Use the real scheduled update and require visible progress to advance
        // while the selected row, image, preview and scrollport stay attached.
        await page.waitForTimeout(31000);
        const periodicRefresh = await page.evaluate(() => {
            window.__browseEpgObserver.disconnect();
            const currentNodes = [document.getElementById("f2-selected-info"), document.activeElement, document.getElementById("f2-preview-slot"), document.querySelector("#channel-0 img")];
            return { ...window.__browseEpgRefresh, elapsed: Date.now() - window.__browseEpgRefresh.started, after: document.getElementById("f2-selected-info").scrollTop,
                retainedNodes: currentNodes.every((node, index) => node === window.__browseEpgNodes[index]) };
        });
        assert.ok(periodicRefresh.elapsed >= 30000 && periodicRefresh.progressUpdates > 0, "The idle test observes a real scheduled programme progress update after at least thirty seconds");
        assert.equal(periodicRefresh.replacements.length, 0, "A scheduled guide refresh does not replace the EPG scrollport");
        assert.equal(periodicRefresh.retainedNodes, true, "A scheduled guide refresh retains focused row, image, preview and scrollport");
        assert.ok(periodicRefresh.after > periodicRefresh.before + 20, "The idle EPG continues advancing across normal clock refreshes");
        await page.waitForFunction(start => document.getElementById("f2-selected-info").scrollTop > start + 8, periodicRefresh.after, { timeout: 4000 });
        await expectFocus(page, playingChannel, 0);
        assert.equal(await page.locator("#f2-selected-programme").innerText(), "Current bulletin " + playingChannel);
        await unchangedPlayback(page, "Scheduled thirty-second DOM refresh preserves EPG position, channel cursor and active decoder");
        autoScrollChecks.push({ label: "Long EPG retains its DOM, focus and scroll progress across a real scheduled update", ...periodicRefresh });
        await remoteKey(page, 457); await page.locator("#watch").focus();
        const modalTop = await page.locator("#f2-selected-info").evaluate(node => node.scrollTop);
        await page.waitForTimeout(1300);
        assert.equal(await page.locator("#f2-selected-info").evaluate(node => node.scrollTop), modalTop, "Opening a modal pauses background EPG auto-scroll");
        assert.equal(await page.evaluate(() => document.activeElement.id), "watch", "Paused EPG does not steal dialog focus");
        autoScrollChecks.push({ label: "Dialog pauses auto-scroll without moving remote focus", scrollTop: modalTop });
        await page.keyboard.press("Escape"); await expectFocus(page, playingChannel, 0);
        await page.waitForFunction(start => document.getElementById("f2-selected-info").scrollTop > start + 8, modalTop, { timeout: 8000 });
        autoScrollChecks.push({ label: "Closing the dialog resumes after a reading delay", after: await page.locator("#f2-selected-info").evaluate(node => node.scrollTop) });

        await page.keyboard.press("ArrowUp"); await expectFocus(page, firstPlayed, pageSize - 1);
        const replacementDescription = await page.locator("#f2-selected-info").evaluate(node => ({ top: node.scrollTop, total: node.scrollHeight, height: node.clientHeight }));
        assert.equal(replacementDescription.top, 0, "Selecting another long programme resets its description to the beginning");
        assert.ok(replacementDescription.total > replacementDescription.height + 30, "The replacement guide also overflows, so reset is not browser clamping of short content");
        assert.ok((await page.locator("#f2-selected-description").innerText()).startsWith("Details for selected channel " + firstPlayed + "."));
        await page.waitForFunction(() => document.getElementById("f2-selected-info").scrollTop > 8, null, { timeout: 8000 });
        await expectFocus(page, firstPlayed, pageSize - 1);
        await unchangedPlayback(page, "Auto-scroll restarts for another long programme without tuning its channel");
        autoScrollChecks.push({ label: "Another overflowing programme resets to zero and starts a fresh reading cycle", before: replacementDescription.top, after: await page.locator("#f2-selected-info").evaluate(node => node.scrollTop) });
        await page.keyboard.press("ArrowDown"); await expectFocus(page, playingChannel, 0);
        assert.equal(await page.locator("#f2-selected-info").evaluate(node => node.scrollTop), 0, "Returning to the previous programme also starts at the beginning");
        await page.keyboard.press("ArrowDown"); await expectFocus(page, missingGuideChannel, 1);
        assert.equal(await page.locator("#f2-selected-info").evaluate(node => node.scrollTop), 0, "Changing the selected channel resets EPG to its beginning");
        assert.equal(await page.locator("#f2-selected-programme").innerText(), "No programme information");
        assert.equal(await page.locator("#f2-selected-description").innerText(), "The programme guide for this channel is not available yet.");
        await page.waitForTimeout(3400);
        assert.equal(await page.locator("#f2-selected-info").evaluate(node => node.scrollTop), 0, "A short missing-guide message never scrolls");
        autoScrollChecks.push({ label: "Selection resets to the beginning; short content remains stationary", scrollTop: 0 });
        assert.ok((await page.locator("#f2-now-playing").innerText()).includes("Browse Channel " + playingChannel));
        await unchangedPlayback(page, "Highlighting a channel with no EPG does not retune playback");
        await page.locator("#player-video").click();
        await expandedPlayback(page, "Clicking the preview expands the playing video into the application window");
        await unchangedPlayback(page, "Expanded window playback keeps advancing without tuning the highlighted channel");
        await page.locator("#player-video").click({ position: { x: 30, y: 30 } });
        await expectFocus(page, playingChannel, 0);
        assert.equal(await page.locator("#foss2-home").isVisible(), true, "Clicking expanded video returns to the channel list");
        await page.keyboard.press("ArrowDown"); await expectFocus(page, missingGuideChannel, 1);
        await page.click("#menu-toggle");
        assert.equal(await page.locator("#f2-sidebar").isVisible(), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), "nav-tv");
        await unchangedPlayback(page, "Opening sections only resizes the active preview");
        await remoteKey(page, 461);
        assert.equal(await page.locator("#f2-sidebar").isVisible(), false);
        await expectFocus(page, missingGuideChannel, 1);
        await remoteKey(page, 458);
        assert.equal(await page.locator("#f2-sidebar").isVisible(), true, "LG Menu key opens sections");
        await remoteKey(page, 458);
        assert.equal(await page.locator("#f2-sidebar").isVisible(), false, "LG Menu key closes sections");
        await expectFocus(page, missingGuideChannel, 1);
        await remoteKey(page, 19);
        await page.waitForFunction(() => document.getElementById("player-video").paused);
        assert.match(await page.locator("#f2-preview-state").innerText(), /Paused/);
        await expectFocus(page, missingGuideChannel, 1);
        assert.equal(await page.locator("#foss2-home").isVisible(), true, "Pause keeps the channel browser open");
        const pausedTime = await page.locator("#player-video").evaluate(video => video.currentTime);
        await page.waitForTimeout(300);
        assert.ok(Math.abs(await page.locator("#player-video").evaluate(video => video.currentTime) - pausedTime) < 0.05, "Paused preview stops advancing");
        await page.locator("#player-video").click();
        await expandedPlayback(page, "Clicking a paused preview expands it without resuming playback");
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused), true);
        assert.ok(Math.abs(await page.locator("#player-video").evaluate(video => video.currentTime) - pausedTime) < 0.05);
        await page.locator("#player-video").click({ position: { x: 30, y: 30 } });
        await expectFocus(page, playingChannel, 0);
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused), true, "Returning to channels preserves the paused state");
        assert.ok(Math.abs(await page.locator("#player-video").evaluate(video => video.currentTime) - pausedTime) < 0.05);
        await page.keyboard.press("ArrowDown"); await expectFocus(page, missingGuideChannel, 1);
        await remoteKey(page, 415);
        await page.waitForFunction(() => !document.getElementById("player-video").paused);
        await expectFocus(page, missingGuideChannel, 1);
        await unchangedPlayback(page, "Pause and resume work while retaining channel-list focus");
        await page.keyboard.press("ArrowUp"); await expectFocus(page, playingChannel, 0);
        await page.keyboard.press("ArrowLeft"); await expectFocus(page, pageSize + 1, 0);
        await page.keyboard.press("ArrowUp"); await expectFocus(page, pageSize, pageSize - 1);
        await page.keyboard.press("ArrowDown"); await expectFocus(page, pageSize + 1, 0);
        const desiredRow = Math.min(pageSize - 1, finalRowCount + 2);
        for (let i = 0; i < desiredRow; i++) await page.keyboard.press("ArrowDown");
        await expectFocus(page, pageSize + 1 + desiredRow, desiredRow);
        for (let index = 1; index < finalPage; index++) await page.keyboard.press("ArrowRight");
        const finalRow = Math.min(desiredRow, finalRowCount - 1);
        await expectFocus(page, finalFirst + finalRow, finalRow);
        await page.keyboard.press("ArrowRight"); await expectFocus(page, finalFirst + finalRow, finalRow);
        for (let i = finalRow; i < finalRowCount - 1; i++) await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown"); await expectFocus(page, 1, 0);
        assert.match(await page.locator("#f2-selected-programme").innerText(), /^Current bulletin 1:/, "Wrapping to the first channel updates its EPG");
        assert.equal(await page.locator("#f2-sidebar").isVisible(), false, "Wrapping remains in the channel list");
        await page.keyboard.press("ArrowUp"); await expectFocus(page, channelCount, finalRowCount - 1);
        assert.equal(await page.locator("#f2-selected-programme").innerText(), "Current bulletin " + channelCount, "Wrapping reaches the real final channel on its shorter page");
        assert.ok((await page.locator("#f2-selected-description").innerText()).startsWith("Details for selected channel " + channelCount + "."));
        await unchangedPlayback(page, "Up/down wrap between collection endpoints, update EPG and retain the preview decoder");
        for (let index = finalPage; index > 0; index--) await page.keyboard.press("ArrowLeft");
        await expectFocus(page, finalRowCount, finalRowCount - 1);
        await page.keyboard.press("ArrowLeft"); await expectFocus(page, finalRowCount, finalRowCount - 1);
        for (let i = 0; i < finalRowCount - 1; i++) await page.keyboard.press("ArrowUp");
        await expectFocus(page, 1, 0);
        await unchangedPlayback(page, "Left/right page changes preserve or clamp the row without wrapping or retuning");
        await page.click("#search"); await page.fill("#search-query", "Channel 6"); await page.click("#search-apply");
        const filteredCount = await page.locator(".f2-channel").count();
        assert.equal(filteredCount, 7, "The filtered collection fits on one page");
        await page.locator("#channel-0").focus(); await expectFocus(page, 6, 0);
        await page.keyboard.press("ArrowUp"); await expectFocus(page, 65, filteredCount - 1);
        assert.equal(await page.locator("#f2-selected-programme").innerText(), "Current bulletin 65");
        await page.keyboard.press("ArrowDown"); await expectFocus(page, 6, 0);
        assert.equal(await page.locator("#f2-selected-programme").innerText(), "Current bulletin 6");
        await page.click("#search"); await page.fill("#search-query", "Channel 65"); await page.click("#search-apply");
        await page.locator("#channel-0").focus(); await expectFocus(page, 65, 0);
        await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowDown"); await expectFocus(page, 65, 0);
        assert.equal(await page.locator(".f2-channel").count(), 1, "A singleton collection retains its only row when wrapping");
        await unchangedPlayback(page, "Filtered single-page and singleton navigation preserves the original playing channel");
        await page.click("#search"); await page.fill("#search-query", ""); await page.click("#search-apply");
        await page.click("#resume-playback");
        await page.waitForFunction(() => document.getElementById("foss2-home").style.display === "none");
        await unchangedPlayback(page, "Returning to fullscreen does not restart the stream");
        await remoteKey(page, 461); await expectFocus(page, playingChannel, 0);
        await page.keyboard.press("ArrowLeft"); await expectFocus(page, pageSize + 1, 0);
        await page.screenshot({ path: path.join(output, "browse-preview-1280.png") });
        await checkLayout(page, "720p compact channel rows, live preview and selected EPG");
        for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
            await page.setViewportSize(viewport);
            await section(page, "settings"); await page.click("#scale-1"); await section(page, "tv");
            const regularRows = await page.locator(".f2-channel").count();
            assert.ok(regularRows >= 20, "Normal TV type keeps at least twenty rows at " + viewport.width);
            await section(page, "settings"); await page.click("#scale-3"); await section(page, "tv");
            await page.locator("#channel-0").focus();
            const enlargedRows = await page.locator(".f2-channel").count();
            assert.ok(enlargedRows >= 10 && enlargedRows < regularRows, "130 percent fonts reduce density while preserving a useful complete page");
            assert.ok(await page.locator("#f2-selected-programme").evaluate(node => node.getBoundingClientRect().height >= parseFloat(getComputedStyle(node).lineHeight) * 1.9), "Large-font layout includes a two-line programme title and long description");
            await page.screenshot({ path: path.join(output, "browse-preview-" + viewport.width + "-large.png") });
            await checkLayout(page, viewport.width + "x" + viewport.height + " at 130 percent");
            await unchangedPlayback(page, "Playback survives " + viewport.width + "x" + viewport.height + " font and layout changes");
        }
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpectedRequests, [], "No fixture requests a real EPG, media provider or logo service");
        assert.deepEqual(mediaRequests, ["/media/" + firstPlayed + ".mp4", "/media/" + playingChannel + ".mp4"], "Only explicit channel click and remote OK request media");
        const report = { passed: true, browser: "Chromium", realSyntheticPlayback: true, pageErrors, mediaRequests, pageSize, layoutChecks, playbackChecks, autoScrollChecks, previewChecks,
            scenarios: ["a live channel click starts decoded playback without a channel card", "video click opens channels and preserves the playing stream", "preview click expands the playing video into the application window and a second click returns to channels", "paused preview expansion and return retain pause, position and stream without native fullscreen", "sections are collapsed by default and toggle with visible Menu and the LG remote key", "Back closes sections and restores the channel cursor without leaving the list", "remote OK starts the highlighted live channel without a channel card", "EPG completion does not dismiss the explicitly opened Info dialog or steal focus", "Back restores the playing channel and its page after remote OK", "the same video element and stream continue in a visible preview", "up/down highlight channels and update current programme details without playing them", "missing EPG is explicit rather than stale programme details", "pause and resume work in preview without leaving the channel list", "left/right page changes preserve row position and clamp the final page without wrapping", "up/down wrap across the filtered collection endpoints, including a short final page, a single page and a singleton, while preserving playback and updating EPG", "returning to fullscreen keeps the existing playback session", "At least twenty compact rows, preview and long descriptions fit at 720p", "idle long EPG auto-scroll preserves focus and playback, pauses for a dialog and resets for another channel", "130 percent fonts fit at 720p and 1080p without stopping video"] };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    } catch (error) {
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: error.message, pageErrors, mediaRequests, layoutChecks, playbackChecks, autoScrollChecks, previewChecks }, null, 2));
        throw error;
    } finally {
        releaseGuide();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
