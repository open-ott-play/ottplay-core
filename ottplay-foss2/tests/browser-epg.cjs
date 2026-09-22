/* Real Chromium EPG journeys. Every guide, logo and stream reference is synthetic. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { handler } = require("../scripts/serve.cjs");
const output = path.resolve(__dirname, "../test-results");
fs.mkdirSync(output, { recursive: true });
const channelCount = 48;

function timestamp(value) { return new Date(value).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000"; }
function guide(label) {
    const now = Date.now();
    let xml = '<?xml version="1.0" encoding="UTF-8"?><tv>';
    for (let i = 1; i <= channelCount; i++) {
        xml += '<channel id="epg-' + i + '"><display-name>Fixture Channel ' + i + '</display-name><icon src="https://epg-fixture.invalid/icons/' + i + '.svg"/></channel>';
        xml += '<programme channel="epg-' + i + '" start="' + timestamp(now - 600000) + '" stop="' + timestamp(now + 1800000) + '"><title>' + label + ' bulletin ' + i + '</title><desc>Programme details ' + i + '</desc></programme>';
        xml += '<programme channel="epg-' + i + '" start="' + timestamp(now + 1800000) + '" stop="' + timestamp(now + 3600000) + '"><title>' + label + ' next ' + i + '</title></programme>';
    }
    return xml + '</tv>';
}
function playlist(header) {
    let text = '#EXTM3U' + (header ? ' x-tvg-url="https://epg-fixture.invalid/playlist.xml"' : '') + '\n';
    for (let i = 1; i <= channelCount; i++) {
        text += '#EXTINF:-1 tvg-id="hlsproxy-' + i + '" tvg-name="Fixture Channel ' + i + ' ' + (i % 2 ? 'HD' : 'FHD') + '" group-title="Fixture",Fixture Channel ' + i + ' ' + (i % 2 ? 'HD' : 'FHD') + '\n';
        text += 'https://stream-fixture.invalid/live/synthetic-user/secret-credential/' + i + '.m3u8?auth=playlist-token\n';
    }
    return text;
}


async function navigate(page, selector) {
    if (!(await page.locator(selector).isVisible())) await page.locator("#menu-toggle").click();
    await page.locator(selector).click();
}

(async () => {
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = "http://127.0.0.1:" + server.address().port;
    const customURL = "https://epg-fixture.invalid/custom.xml?format=xml&key=guide-only";
    const pageErrors = [], unexpected = [], builtinRequests = [], customRequests = [], layoutChecks = [];
    let browser, pendingBuiltin, releaseBuiltin, customMode = "Custom", playlistRequests = 0;
    const builtinRequested = new Promise(resolve => { pendingBuiltin = resolve; });
    const builtinReleased = new Promise(resolve => { releaseBuiltin = resolve; });
    fs.writeFileSync(path.join(output, "browser-epg-report.json"), JSON.stringify({ passed: false, status: "running" }));
    async function checkLayout(page, label) {
        const metrics = await page.evaluate(() => {
            const main = document.querySelector(".f2-main"), home = document.getElementById("foss2-home"), rows = document.querySelectorAll(".f2-channel");
            const logo = rows[0].querySelector(".f2-channel-logo img").getBoundingClientRect();
            return { rows: rows.length, mainClient: main.clientHeight, mainScroll: main.scrollHeight, lastBottom: rows[rows.length - 1].getBoundingClientRect().bottom,
                mainBottom: main.getBoundingClientRect().bottom, footerTop: document.querySelector(".f2-footer").getBoundingClientRect().top,
                horizontalOverflow: home.scrollWidth > home.clientWidth + 1, logoWidth: logo.width, logoHeight: logo.height };
        });
        assert.equal(metrics.horizontalOverflow, false, label + ": no horizontal overflow");
        assert.ok(metrics.mainScroll <= metrics.mainClient + 1, label + ": rows fit without scrolling " + JSON.stringify(metrics));
        assert.ok(metrics.lastBottom < metrics.mainBottom && metrics.lastBottom < metrics.footerTop, label + ": rows remain above the footer");
        assert.ok(metrics.logoWidth > 0 && metrics.logoHeight > 0, label + ": actual image is visible");
        assert.ok(Math.abs(metrics.logoWidth / metrics.logoHeight - 16 / 9) < 0.03, label + ": source image aspect ratio is preserved");
        layoutChecks.push({ label, ...metrics });
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
                assert.match(request.headers()["content-type"], /^application\/json/);
                const payload = request.postDataJSON();
                assert.deepEqual(Object.keys(payload), ["channels"]);
                assert.equal(payload.channels.length, channelCount);
                for (const channel of payload.channels) {
                    assert.deepEqual(Object.keys(channel).sort(), ["archiveDays", "name", "tvgId", "tvgName"]);
                    assert.equal(channel.archiveDays, 0, "Live-only request has no archive history beyond the default window");
                    assert.match(channel.tvgId, /^hlsproxy-\d+$/);
                }
                assert.equal(/https?:|secret-credential|synthetic-user|playlist-token|"url"|"headers"|"id"/.test(JSON.stringify(payload)), false, "Built-in guide receives only channel identity metadata");
                builtinRequests.push({ method: request.method(), count: payload.channels.length, fields: Object.keys(payload.channels[0]).sort() });
                pendingBuiltin();
                await builtinReleased;
                await route.fulfill({ status: 200, contentType: "application/xml", body: guide("Built-in") });
                return;
            }
            if (url.origin === origin) { await route.continue(); return; }
            if (url.origin === "https://epg-fixture.invalid" && /^\/icons\/\d+\.svg$/.test(url.pathname)) {
                await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#277ead"/><text x="80" y="64" text-anchor="middle" fill="white" font-size="54">TV</text></svg>' });
                return;
            }
            if (request.url() === customURL) {
                assert.equal(request.method(), "GET");
                customRequests.push(request.url());
                if (customMode === "error") await route.fulfill({ status: 503, contentType: "text/plain", body: "Synthetic unavailable", headers: { "Access-Control-Allow-Origin": "*" } });
                else await route.fulfill({ contentType: "application/xml", body: guide(customMode), headers: { "Access-Control-Allow-Origin": "*" } });
                return;
            }
            if (url.origin === "https://epg-fixture.invalid" && url.pathname === "/playlist.xml") {
                playlistRequests++;
                await route.fulfill({ contentType: "application/xml", body: guide("Playlist"), headers: { "Access-Control-Allow-Origin": "*" } });
                return;
            }
            unexpected.push(url.origin + url.pathname);
            await route.abort();
        });
        await page.goto(origin + "/f/lg/webos/");
        await page.click("#connect");
        await page.fill("#source-name", "EPG fixture");
        await page.fill("#source-text", playlist(false));
        await page.click("#save-source");
        await builtinRequested;
        await page.locator("#channel-0").waitFor();
        assert.match(await page.locator("#f2-epg-status").innerText(), /loading/);
        await page.locator("#channel-0").focus();
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 457, which: 457, bubbles: true })));
        await page.locator("#watch").focus();
        const focused = await page.evaluate(() => document.activeElement.id);
        releaseBuiltin();
        await page.locator("#channel-0 .f2-program-title").filter({ hasText: "Built-in bulletin 1" }).waitFor();
        assert.equal(await page.locator("#f2-dialog").count(), 1, "Asynchronous EPG refresh leaves the open dialog intact");
        assert.equal(await page.evaluate(() => document.activeElement.id), focused, "EPG completion does not steal remote focus");
        await page.click("#dialog-close");
        const defaultPageSize = await page.locator(".f2-channel").count();
        assert.ok(defaultPageSize >= 20 && defaultPageSize <= 30, "720p displays at least twenty rows with EPG logos");
        assert.equal(await page.locator(".f2-pages").count(), 0, "EPG-enabled TV pages omit the bottom paging row");
        await page.waitForFunction(expected => Array.from(document.querySelectorAll("#f2-channels .f2-channel-logo img")).length === expected && Array.from(document.querySelectorAll("#f2-channels .f2-channel-logo img")).every(img => img.complete && img.naturalWidth > 0), defaultPageSize);
        assert.equal(await page.locator("#f2-epg-status").innerText(), "EPG: " + channelCount + " channels · " + channelCount + " on now");
        assert.match(await page.locator("#channel-0 .f2-next").innerText(), /Built-in next 1/);
        assert.match(await page.locator("#channel-1 .f2-program-title").innerText(), /Built-in bulletin 2/, "FHD quality alias also matches the XMLTV channel");
        assert.equal(await page.locator("#channel-0 img").getAttribute("alt"), "");
        await checkLayout(page, "720p compact rows with logos and status");
        await page.screenshot({ path: path.join(output, "epg-channels-1280.png") });
        await navigate(page, "#nav-settings"); await page.click("#scale-3"); await navigate(page, "#nav-tv");
        assert.ok(await page.locator(".f2-channel").count() < defaultPageSize, "130 percent type reduces row count");
        await checkLayout(page, "720p 130 percent type with logos and status");
        await page.screenshot({ path: path.join(output, "epg-channels-1280-large.png") });
        await navigate(page, "#nav-settings"); await page.click("#scale-1"); await navigate(page, "#nav-guide");
        await page.locator("#guide-0 .f2-channel-logo img").waitFor();
        await page.waitForFunction(() => { const image = document.querySelector("#guide-0 img"); return image && image.complete && image.naturalWidth > 0; });
        assert.equal(await page.locator(".f2-guide-row").count(), 30);
        assert.match(await page.locator("#guide-0").innerText(), /Built-in bulletin 1/);
        await page.click("#guide-0");
        assert.match(await page.locator("#f2-dialog").innerText(), /Programme details 1/);
        await page.click("#dialog-close");
        assert.deepEqual(await page.locator("#guide-0").evaluate(node => ({ time: getComputedStyle(node.querySelector(".f2-guide-time")).color, channel: getComputedStyle(node.querySelector("small")).color })), { time: "rgb(27, 38, 49)", channel: "rgb(27, 38, 49)" }, "All guide row metadata remains legible under remote focus");
        await page.screenshot({ path: path.join(output, "epg-guide-1280.png") });
        await page.click("#guide-source");
        await page.fill("#epg-url-value", customURL); await page.click("#epg-save");
        await page.locator("#guide-0").filter({ hasText: "Custom bulletin 1" }).waitFor();
        assert.equal(builtinRequests.length, 1, "Explicit XMLTV replaces built-in EPG");
        assert.equal(customRequests[0], customURL, "Custom URL is requested verbatim");
        customMode = "error";
        await page.click("#guide-refresh");
        await page.locator("#f2-epg-status").filter({ hasText: "network, access or CORS error" }).waitFor();
        assert.match(await page.locator("#guide-0").innerText(), /Custom bulletin 1/, "A failed refresh keeps the last usable guide");
        customMode = "Recovered";
        await page.click("#guide-refresh");
        await page.locator("#guide-0").filter({ hasText: "Recovered bulletin 1" }).waitFor();
        assert.equal(await page.locator("#f2-epg-status").innerText(), "EPG: " + channelCount + " channels · " + channelCount + " on now");
        await navigate(page, "#nav-sources"); await page.click("#edit-0");
        await page.fill("#source-text", playlist(true)); await page.click("#save-source");
        await page.locator("#channel-0 .f2-program-title").filter({ hasText: "Recovered bulletin 1" }).waitFor();
        await page.reload();
        await page.locator("#channel-0 .f2-program-title").filter({ hasText: "Recovered bulletin 1" }).waitFor();
        assert.equal(playlistRequests, 0, "Explicit XMLTV takes precedence over a playlist EPG header after editing and reload");
        assert.equal(builtinRequests.length, 1, "Custom EPG persists across reload without built-in requests");
        assert.ok(customRequests.length >= 5);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpected, [], "No fixture contacts a real guide, icon service or media provider");
        const report = { passed: true, browser: "Chromium", pageErrors, builtinRequests, customRequestCount: customRequests.length, playlistRequests, layoutChecks,
            scenarios: ["built-in EPG fallback for an M3U without an EPG header", "POST identity metadata only; stream URLs and credentials omitted", "HD and FHD aliases match independent XMLTV IDs", "actual current/next programme text and loaded logo pixels", "guide rows show channel logos and programme details", "EPG completion updates the channel list without dismissing a modal or stealing focus", "At least twenty TV rows with logos and EPG status fit at 720p", "enlarged TV type fits with bounded page size", "explicit custom XMLTV URL wins over built-in and playlist guides after reload", "visible failure status retains a usable guide and Refresh recovers"] };
        fs.writeFileSync(path.join(output, "browser-epg-report.json"), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    } finally {
        releaseBuiltin();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
