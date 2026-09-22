/* Last-channel startup restoration with a single browser and synthetic media. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const stateKey = "ottplay2:state:v1";
const mediaPath = process.env.OTT2_TEST_MEDIA;
assert.ok(mediaPath && fs.existsSync(mediaPath), "Set OTT2_TEST_MEDIA to a local synthetic MP4; decoded playback is required");
const mediaBody = fs.readFileSync(mediaPath);
const output = path.resolve(__dirname, "../test-results");
const fixtureOrigin = "https://startup-fixture.invalid";
const playlistA = '#EXTM3U\n#EXTINF:-1 tvg-id="one",Startup Channel One\n' + fixtureOrigin + '/one.mp4\n#EXTINF:-1 tvg-id="two",Startup Channel Two\n' + fixtureOrigin + '/two.mp4\n';
const playlistB = '#EXTM3U\n#EXTINF:-1 tvg-id="other",Other Source Channel\n' + fixtureOrigin + '/other.mp4\n';
fs.mkdirSync(output, { recursive: true });
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function tokenPlaylist(token, variant) {
    if (variant === "quality") return '#EXTM3U\n#EXTINF:-1 tvg-id="shared" tvg-name="Shared Guide" group-title="News",Startup Channel SD\n' + fixtureOrigin + '/one.mp4?quality=sd&token=' + token + '\n#EXTINF:-1 tvg-id="shared" tvg-name="Shared Guide" group-title="News",Startup Channel HD\n' + fixtureOrigin + '/two.mp4?quality=hd&token=' + token + '\n';
    return '#EXTM3U\n#EXTINF:-1 group-title="News",Startup Channel One\n' + fixtureOrigin + '/one.mp4?token=' + token + '\n#EXTINF:-1 group-title="News",' + (variant === "ambiguous" ? "Shared Channel" : "Startup Channel Two") + '\n' + fixtureOrigin + '/two.mp4?token=' + token + '\n' + (variant === "ambiguous" ? '#EXTINF:-1 group-title="News",Shared Channel\n' + fixtureOrigin + '/other.mp4?token=' + token + '\n' : '');
}
function equivalentCopyPlaylist(token, reordered) {
    const rows = [
        { name: "Startup Shared HD", group: "HD", file: "two", quality: "hd", copy: "primary" },
        { name: "Startup Shared UHD", group: "News", file: "other", quality: "uhd", copy: "primary" },
        { name: "Startup Shared SD", group: "Other", file: "one", quality: "sd", copy: "primary" },
        { name: "Startup Shared HD", group: "HD", file: "two", quality: "hd", copy: "backup" }
    ];
    return "#EXTM3U\n" + (reordered ? [rows[1], rows[3], rows[2], rows[0]] : rows).map(row =>
        '#EXTINF:-1 tvg-id="four-row-guide" tvg-name="Shared Guide" group-title="' + row.group + '",' + row.name + '\n' +
        fixtureOrigin + '/' + row.file + '.mp4?quality=' + row.quality + '&copy=' + row.copy + '&q=' + token + '&token=' + token + '\n'
    ).join("");
}
async function remote(page, code) {
    await page.evaluate(code => {
        for (const type of ["keydown", "keyup"]) {
            const event = new KeyboardEvent(type, { keyCode: code, bubbles: true, cancelable: true });
            Object.defineProperty(event, "which", { value: code });
            window.dispatchEvent(event);
        }
    }, code);
}
async function navigate(page, screen) {
    if (!await page.locator("#nav-" + screen).isVisible()) await page.click("#menu-toggle");
    await page.click("#nav-" + screen);
    if (await page.locator("#f2-sidebar").isVisible()) await page.click("#menu-toggle");
}

(async () => {
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = "http://127.0.0.1:" + server.address().port;
    const reportPath = path.join(output, "browser-startup-report.json");
    const checks = [], pageErrors = [], unexpectedRequests = [], mediaRequests = [];
    let browser, context, page, failedSourceRequests = 0;
    fs.writeFileSync(reportPath, JSON.stringify({ passed: false, status: "running" }));
    async function state() { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), stateKey); }
    async function loadState(value) {
        await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: stateKey, value });
        await page.reload();
    }
    async function playing(name, file, label) {
        await page.locator("#foss2-home").waitFor({ state: "hidden" });
        await page.waitForFunction(({ name, url }) => {
            const video = document.getElementById("player-video");
            return document.getElementById("player-title").textContent === name && video.currentSrc === url && video.videoWidth > 0 && video.currentTime > 0.1 && !video.paused;
        }, { name, url: fixtureOrigin + "/" + file + (file.indexOf(".mp4") === -1 ? ".mp4" : "") });
        const before = await page.locator("#player-video").evaluate(video => video.currentTime);
        await page.waitForFunction(time => document.getElementById("player-video").currentTime > time + 0.15, before);
        const snapshot = await page.locator("#player-video").evaluate(video => ({ source: video.currentSrc, width: video.videoWidth, height: video.videoHeight, paused: video.paused, muted: video.muted, volume: video.volume }));
        assert.equal(snapshot.muted, false, "Startup must preserve the user's unmuted preference");
        assert.equal(snapshot.volume, 0.8);
        checks.push({ label, playback: snapshot });
    }
    async function usableList(name) {
        await page.locator("#foss2-home").waitFor({ state: "visible" });
        await page.locator("#channel-0").filter({ hasText: name }).waitFor();
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused), true);
        assert.equal(await page.locator("#f2-dialog").count(), 0);
    }
    try {
        // This flag makes decoded autoplay deterministic in CI. A separate
        // rejection scenario below exercises the browser-policy recovery path.
        browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
        context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        context.on("page", opened => { opened.setDefaultTimeout(12000); opened.on("pageerror", error => pageErrors.push(error.message)); });
        await context.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && url.pathname === "/api/epg") { await route.fulfill({ contentType: "application/xml", body: '<tv></tv>' }); return; }
            if (url.origin === origin) { await route.continue(); return; }
            if (url.origin === fixtureOrigin && /\/(one|two|other)\.mp4$/.test(url.pathname)) {
                mediaRequests.push(url.pathname + url.search);
                await route.fulfill({ contentType: "video/mp4", body: mediaBody, headers: { "Access-Control-Allow-Origin": "*" } }); return;
            }
            if (url.href === fixtureOrigin + "/unavailable.m3u") {
                failedSourceRequests++;
                await route.fulfill({ status: 404, contentType: "text/plain", body: "Synthetic unavailable playlist", headers: { "Access-Control-Allow-Origin": "*" } }); return;
            }
            unexpectedRequests.push(url.origin + url.pathname); await route.abort();
        });
        await context.addInitScript(() => {
            if (!/^https?:$/.test(location.protocol)) return;
            if (localStorage.getItem("ottplay2:test:block-autoplay") !== "true") return;
            const nativePlay = HTMLMediaElement.prototype.play;
            window.__startupBlockedCalls = 0;
            window.__startupAllowPlay = false;
            HTMLMediaElement.prototype.play = function () {
                if (!window.__startupAllowPlay) {
                    window.__startupBlockedCalls++;
                    return Promise.reject(new DOMException("Synthetic autoplay policy", "NotAllowedError"));
                }
                return nativePlay.apply(this, arguments);
            };
            document.addEventListener("click", event => {
                if (event.target.id === "player-pause") window.__startupAllowPlay = true;
            }, true);
        });
        page = await context.newPage();
        await page.goto(origin + "/");
        await page.click("#connect"); await page.fill("#source-name", "Startup Source A");
        await page.fill("#source-text", playlistA); await page.click("#save-source");
        await page.locator("#channel-1").waitFor();
        const firstState = await state();
        assert.equal(firstState.settings.restore, true, "Startup restoration is enabled by default");
        assert.equal(firstState.settings.startupVersion, 1);
        assert.equal(firstState.lastChannel, null, "Loading a source cannot invent a last played channel");
        await page.click("#channel-1");
        await playing("Startup Channel Two", "two", "A channel click records the successfully decoded channel");
        const saved = await state(), remembered = clone(saved.lastChannel);
        assert.equal(remembered.sourceId, saved.sources[0].id);
        assert.equal(remembered.id, saved.history[0].id);
        assert.equal(remembered.name, "Startup Channel Two", "The raw channel name is saved independently of its URL-derived ID");
        assert.equal(remembered.tvgId, "two");
        assert.equal(Object.prototype.hasOwnProperty.call(remembered, "url"), false, "Startup metadata does not persist a stream URL");

        await remote(page, 8); await page.locator("#channel-0").focus();
        assert.match(await page.locator("#f2-selected-channel").innerText(), /Startup Channel One/);
        assert.deepEqual((await state()).lastChannel, remembered, "Highlighting a different channel does not replace the playing channel");
        await page.reload();
        await playing("Startup Channel Two", "two", "Reload immediately restores the playing channel into the video view rather than the highlighted row");

        await page.close(); page = await context.newPage(); await page.goto(origin + "/");
        await playing("Startup Channel Two", "two", "A fresh page in the same browser storage restores the last channel without a channel click");
        await page.evaluate(() => { window.__startupCloseCalls = 0; window.close = function () { window.__startupCloseCalls++; }; });
        await remote(page, 81);
        await page.locator("#player-exited").waitFor();
        assert.equal(await page.locator("#quit-yes").count(), 0, "The profile quit action exits without a confirmation dialog");
        assert.equal(await page.evaluate(() => window.__startupCloseCalls), 1);
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused && !video.getAttribute("src")), true);
        assert.deepEqual((await state()).lastChannel, remembered, "Direct exit preserves last-channel identity");
        await page.click("#restart-player");
        await playing("Startup Channel Two", "two", "Open player after direct exit reloads directly into the remembered video");

        await remote(page, 8); await navigate(page, "sources"); await page.click("#add-source");
        await page.fill("#source-name", "Startup Source B"); await page.fill("#source-text", playlistB); await page.click("#save-source");
        await usableList("Other Source Channel");
        const browsed = await state();
        assert.notEqual(browsed.activeSourceId, remembered.sourceId, "A second source has actually loaded");
        assert.deepEqual(browsed.lastChannel, remembered, "Loading another source without playback preserves the last channel");
        await page.reload();
        await playing("Startup Channel Two", "two", "Startup loads the remembered channel's source even when a different source was last browsed");
        assert.equal((await state()).activeSourceId, remembered.sourceId);
        const baseline = await state();

        await remote(page, 8); await navigate(page, "settings"); await page.click("#preferences");
        assert.equal(await page.locator("#pref-restore").isChecked(), true);
        await page.uncheck("#pref-restore"); await page.click("#save-preferences");
        await page.reload(); await usableList("Startup Channel One");
        assert.equal((await state()).settings.restore, false, "An explicit current preference remains disabled after reload");
        assert.deepEqual((await state()).lastChannel, remembered);
        checks.push({ label: "The startup preference can be explicitly disabled and remains disabled after reload" });

        const legacy = clone(baseline); delete legacy.settings.startupVersion; legacy.settings.restore = false; delete legacy.lastChannel;
        await loadState(legacy);
        await playing("Startup Channel Two", "two", "Legacy settings migrate once and restore the previously successful history channel");
        assert.equal((await state()).settings.startupVersion, 1);
        assert.equal((await state()).settings.restore, true);

        const deletedHistorySource = clone(baseline);
        deletedHistorySource.lastChannel = null;
        deletedHistorySource.history = [{ id: "deleted-source:m3u:tvg:two", name: "Startup Channel Two", time: Date.now() }];
        await loadState(deletedHistorySource); await usableList("Startup Channel One");
        assert.equal((await state()).lastChannel, null, "History from a deleted source cannot create a new source-bound startup identity");
        assert.equal(await page.locator("#player-video").evaluate(video => !video.getAttribute("src")), true);
        checks.push({ label: "History alone from a deleted source cannot autoplay a same-name channel in a surviving source" });

        const vodHistory = clone(baseline);
        vodHistory.lastChannel = null;
        vodHistory.history = [{ id: encodeURIComponent(remembered.sourceId) + ":xtream:vod:42", name: "Startup Channel Two", time: Date.now() }];
        await loadState(vodHistory); await usableList("Startup Channel One");
        assert.equal((await state()).lastChannel, null, "An old VOD history entry cannot create a live-channel startup identity");
        assert.equal(await page.locator("#player-video").evaluate(video => !video.getAttribute("src")), true);
        checks.push({ label: "History alone from a removed VOD item cannot autoplay a same-name live channel" });

        const missing = clone(baseline);
        missing.sources.find(source => source.id === remembered.sourceId).text = '#EXTM3U\n#EXTINF:-1 tvg-id="one",Startup Channel One\n' + fixtureOrigin + '/one.mp4\n';
        await loadState(missing); await usableList("Startup Channel One");
        assert.deepEqual((await state()).lastChannel, missing.lastChannel);
        await page.click("#channel-0");
        await playing("Startup Channel One", "one", "A removed remembered channel leaves a usable list where another channel can start normally");

        const unsigned = clone(baseline);
        unsigned.lastChannel = null; unsigned.history = [];
        unsigned.sources.find(source => source.id === remembered.sourceId).text = tokenPlaylist("old");
        await loadState(unsigned); await usableList("Startup Channel One"); await page.click("#channel-1");
        await playing("Startup Channel Two", "two.mp4?token=old", "An M3U channel without a TVG ID can be remembered after decoded playback");
        const rotated = await state(), oldId = rotated.lastChannel.id;
        rotated.lastChannel = { id: oldId, sourceId: remembered.sourceId };
        rotated.history.unshift({ id: "unrelated-history-entry", name: "Startup Channel One", time: Date.now() });
        rotated.sources.find(source => source.id === remembered.sourceId).text = tokenPlaylist("rotated");
        await loadState(rotated);
        await playing("Startup Channel Two", "two.mp4?token=rotated", "An old two-field record uses its matching history entry to restore the non-first channel after stream token rotation");
        const repaired = await state();
        assert.notEqual(repaired.lastChannel.id, oldId, "The reparsed M3U has a genuinely different URL-derived channel ID");
        assert.equal(repaired.lastChannel.name, "Startup Channel Two", "Successful restoration upgrades the saved identity metadata");
        assert.equal(repaired.lastChannel.sourceId, remembered.sourceId);

        repaired.history = [];
        repaired.sources.find(source => source.id === remembered.sourceId).text = tokenPlaylist("rotated-again");
        await loadState(repaired);
        await playing("Startup Channel Two", "two.mp4?token=rotated-again", "Persisted identity metadata restores a newly tokenized channel even after playback history is cleared");

        const quality = clone(unsigned);
        quality.sources.find(source => source.id === remembered.sourceId).text = tokenPlaylist("old", "quality");
        await loadState(quality); await usableList("Startup Channel SD"); await page.click("#channel-1");
        await playing("Startup Channel HD", "two.mp4?quality=hd&token=old", "An HD channel can share its EPG ID and guide name with the SD channel");
        const qualityRotated = await state(), oldQualityId = qualityRotated.lastChannel.id;
        qualityRotated.sources.find(source => source.id === remembered.sourceId).text = tokenPlaylist("rotated", "quality");
        await loadState(qualityRotated);
        await playing("Startup Channel HD", "two.mp4?quality=hd&token=rotated", "Repeated TVG IDs are disambiguated by raw channel metadata so HD does not silently switch to SD");
        assert.notEqual((await state()).lastChannel.id, oldQualityId);
        const qualityRestored = await state();

        const copies = clone(unsigned);
        copies.sources.find(source => source.id === remembered.sourceId).text = equivalentCopyPlaylist("old", false);
        await loadState(copies); await usableList("Startup Shared HD"); await page.click("#channel-3");
        await playing("Startup Shared HD", "two.mp4?quality=hd&copy=backup&q=old&token=old", "A four-row shared-TVG playlist can play its second equivalent HD copy alongside UHD and SD variants");
        let copiesSaved = await state();
        copiesSaved.lastChannel = { id: copiesSaved.lastChannel.id, sourceId: remembered.sourceId };
        copiesSaved.history.unshift({ id: "unrelated-shared-guide-history", name: "Startup Shared UHD", time: Date.now() });
        for (let restart = 1; restart <= 5; restart++) {
            const priorId = copiesSaved.lastChannel.id, token = "restart-" + restart, reordered = restart === 5;
            copiesSaved.sources.find(source => source.id === remembered.sourceId).text = equivalentCopyPlaylist(token, reordered);
            await loadState(copiesSaved);
            await playing("Startup Shared HD", "two.mp4?quality=hd&copy=" + (reordered ? "backup" : "primary") + "&q=" + token + "&token=" + token,
                "Shared-TVG HD restoration survives token rotation on restart " + restart + (reordered ? " after reordering all four playlist rows" : " without a channel click"));
            copiesSaved = await state();
            assert.notEqual(copiesSaved.lastChannel.id, priorId, "Every restart reparses a changed URL-derived channel ID");
            assert.equal(copiesSaved.lastChannel.sourceId, remembered.sourceId);
            assert.equal(copiesSaved.lastChannel.tvgId, "four-row-guide");
            assert.equal(copiesSaved.lastChannel.tvgName, "Shared Guide");
            assert.equal(copiesSaved.lastChannel.name, "Startup Shared HD", "An equivalent HD copy must never select UHD or SD from the shared TVG ID");
            assert.equal(copiesSaved.lastChannel.group, "HD");
            assert.equal(Object.prototype.hasOwnProperty.call(copiesSaved.lastChannel, "url"), false);
            copiesSaved.history = [];
        }

        const removedQuality = clone(qualityRestored), qualityReference = clone(qualityRestored.lastChannel);
        removedQuality.sources.find(source => source.id === remembered.sourceId).text = '#EXTM3U\n#EXTINF:-1 tvg-id="replacement-guide" tvg-name="Shared Guide" group-title="News",Startup Channel SD\n' + fixtureOrigin + '/one.mp4?quality=sd&token=latest\n';
        await loadState(removedQuality); await usableList("Startup Channel SD");
        assert.deepEqual((await state()).lastChannel, qualityReference);
        assert.equal(await page.locator("#player-video").evaluate(video => !video.getAttribute("src")), true);
        checks.push({ label: "A removed HD variant cannot silently restore the remaining SD channel through a shared guide name after TVG renumbering" });

        const unnamedQuality = clone(removedQuality);
        unnamedQuality.lastChannel = { id: qualityReference.id, sourceId: remembered.sourceId }; unnamedQuality.history = [];
        unnamedQuality.sources.find(source => source.id === remembered.sourceId).text = '#EXTM3U\n#EXTINF:-1 tvg-id="shared" tvg-name="Shared Guide" group-title="News",Startup Channel SD\n' + fixtureOrigin + '/one.mp4?quality=sd&token=latest\n';
        await loadState(unnamedQuality); await usableList("Startup Channel SD");
        assert.deepEqual((await state()).lastChannel, unnamedQuality.lastChannel);
        assert.equal(await page.locator("#player-video").evaluate(video => !video.getAttribute("src")), true);
        checks.push({ label: "An old duplicate-TVG reference without a retained name cannot choose the sole remaining quality arbitrarily" });

        const ambiguous = clone(unsigned);
        ambiguous.sources.find(source => source.id === remembered.sourceId).text = tokenPlaylist("old", "ambiguous");
        await loadState(ambiguous); await usableList("Startup Channel One"); await page.click("#channel-1");
        await playing("Shared Channel", "two.mp4?token=old", "A channel with an ambiguous display identity still plays when explicitly selected");
        const ambiguousRotated = await state(), ambiguousReference = clone(ambiguousRotated.lastChannel);
        ambiguousRotated.sources.find(source => source.id === remembered.sourceId).text = tokenPlaylist("rotated", "ambiguous");
        await loadState(ambiguousRotated); await usableList("Startup Channel One");
        assert.deepEqual((await state()).lastChannel, ambiguousReference, "Ambiguous metadata cannot overwrite the remembered channel with an arbitrary match");
        assert.equal(await page.locator("#player-video").evaluate(video => !video.getAttribute("src")), true);
        checks.push({ label: "Two equally matching channels leave the list available instead of automatically playing the wrong stream" });

        const failed = clone(baseline), failedSource = failed.sources.find(source => source.id === remembered.sourceId);
        failedSource.url = fixtureOrigin + "/unavailable.m3u"; failedSource.text = "";
        await loadState(failed);
        await page.locator("#foss2-home").waitFor({ state: "visible" });
        await page.locator("#f2-toast").filter({ hasText: "Source unavailable" }).waitFor();
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused), true);
        assert.deepEqual((await state()).lastChannel, remembered);
        await navigate(page, "sources");
        await page.locator("#source-0").waitFor();
        await page.click("#source-1"); await usableList("Other Source Channel");
        assert.equal(failedSourceRequests, 1, "A failed startup source does not produce an automatic restart loop");
        checks.push({ label: "An unavailable startup source preserves identity and leaves another source selectable", failedSourceRequests });

        await page.evaluate(() => localStorage.setItem("ottplay2:test:block-autoplay", "true"));
        await loadState(baseline);
        await page.locator("#foss2-home").waitFor({ state: "hidden" });
        await page.locator("#player-status").filter({ hasText: /Press Play/i }).waitFor();
        await page.locator("#player-pause").filter({ hasText: /Play/ }).waitFor();
        assert.equal(await page.locator("#player-title").innerText(), "Startup Channel Two");
        assert.equal(await page.evaluate(() => window.__startupBlockedCalls), 1);
        assert.equal(await page.locator("#player-video").evaluate(video => video.paused && !video.muted), true);
        const blockedAt = Date.now();
        await page.waitForTimeout(6500);
        assert.equal(await page.locator("#player-osd").isVisible(), true, "An autoplay-blocked footer remains visible beyond the normal six-second timeout");
        assert.equal(await page.locator("#player-pause").isVisible(), true);
        assert.deepEqual((await state()).lastChannel, remembered, "Blocked autoplay keeps the saved channel identity");
        await page.screenshot({ path: path.join(output, "startup-autoplay-blocked.png") });
        checks.push({ label: "A simulated NotAllowedError keeps the unmuted video view and a persistent visible Play action", visibleMilliseconds: Date.now() - blockedAt });
        await page.click("#player-pause");
        await playing("Startup Channel Two", "two", "The visible Play action resumes decoded playback after a browser autoplay rejection");
        const resumedAt = Date.now();
        await page.locator("#player-osd").waitFor({ state: "hidden", timeout: 8500 });
        const hiddenAfter = Date.now() - resumedAt;
        assert.ok(hiddenAfter >= 4500 && hiddenAfter < 8500, "After actual playback the footer returns to its six-second auto-hide interval: " + hiddenAfter);
        checks.push({ label: "After blocked autoplay is resumed, the ordinary footer timeout returns", milliseconds: hiddenAfter });

        assert.deepEqual(pageErrors, [], "No browser runtime errors");
        assert.deepEqual(unexpectedRequests, [], "Only the local app and synthetic fixtures were requested");
        const report = { passed: true, at: new Date().toISOString(), browser: browser.version(), browserArgs: ["--autoplay-policy=no-user-gesture-required"], autoplayRejection: "HTMLMediaElement.play rejects with a synthetic NotAllowedError until the visible Play action is clicked", viewport: { width: 1280, height: 720 }, checks, pageErrors, unexpectedRequests, mediaRequests };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "startup-failed.png") }).catch(() => {});
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, at: new Date().toISOString(), error: String(error.stack || error), checks, pageErrors, unexpectedRequests, mediaRequests }, null, 2) + "\n");
        throw error;
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
