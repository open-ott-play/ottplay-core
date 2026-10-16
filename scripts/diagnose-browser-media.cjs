'use strict';
// Diagnostic only: playback failures are observations, never release acceptance.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const playwright = require(path.resolve(process.env.DIAGNOSTIC_PLAYWRIGHT));
const media = fs.readFileSync(process.env.DIAGNOSTIC_MEDIA || 'ottplay-foss2/tests/fixtures/browser-media/probe.mp4');
const output = path.resolve('media-diagnostics', process.env.DIAGNOSTIC_LABEL || 'default');
fs.mkdirSync(output, { recursive: true });
const requests = [], observations = [];
const server = http.createServer((req, res) => {
    requests.push({ url: req.url, method: req.method, range: req.headers.range || null });
    if (req.url.endsWith('.mp4')) {
        let start = 0, end = media.length - 1;
        if (req.headers.range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
            if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${media.length}` }); res.end(); return; }
            start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
            if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${media.length}` }); res.end(); return; }
        }
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Access-Control-Allow-Origin': '*' };
        if (req.headers.range) headers['Content-Range'] = `bytes ${start}-${end}/${media.length}`;
        res.writeHead(req.headers.range ? 206 : 200, headers); res.end(media.subarray(start, end + 1)); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><video id="video" muted playsinline controls width="320" height="180"></video>');
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await playwright.webkit.launch({ headless: process.env.DIAGNOSTIC_HEADED !== 'true' });
        const context = await browser.newContext();
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        const cases = process.env.DIAGNOSTIC_CASES ? process.env.DIAGNOSTIC_CASES.split(',') : ['real-loopback-http', 'routed-invalid-https', 'routed-loopback-http', 'blob'];
        for (const kind of cases) {
            const page = await context.newPage(), network = [];
            page.on('request', req => network.push({ event: 'request', url: req.url(), type: req.resourceType() }));
            page.on('response', res => network.push({ event: 'response', url: res.url(), status: res.status() }));
            page.on('requestfailed', req => network.push({ event: 'failed', url: req.url(), failure: req.failure() }));
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (kind === 'routed-invalid-https' && url.origin === 'https://provider-fixture.invalid' || kind === 'routed-loopback-http' && url.pathname.endsWith('.mp4')) {
                    await route.fulfill({ status: 200, contentType: 'video/mp4', headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': String(media.length) }, body: media }); return;
                }
                if (url.origin === origin) { await route.continue(); return; }
                await route.abort();
            });
            await page.goto(origin);
            await page.evaluate(({ kind, origin, base64 }) => {
                const video = document.getElementById('video');
                window.events = [];
                for (const event of ['loadstart','loadedmetadata','loadeddata','canplay','playing','timeupdate','error','stalled','waiting','ended']) video.addEventListener(event, () => window.events.push(event));
                video.muted = true;
                video.src = kind === 'blob' ? URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'video/mp4' })) : (kind === 'routed-invalid-https' ? 'https://provider-fixture.invalid' : origin) + '/probe.mp4';
                video.play().catch(error => { window.playError = { name: error.name, message: error.message }; });
            }, { kind, origin, base64: media.toString('base64') });
            let timeout = null;
            try { await page.waitForFunction(() => { const v = document.getElementById('video'); return v.currentTime > 0.1 && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0; }, null, { timeout: 8000 }); }
            catch (error) { timeout = error.message; }
            const observation = await page.evaluate(() => {
                const v = document.getElementById('video');
                return { currentTime: v.currentTime, readyState: v.readyState, networkState: v.networkState, videoWidth: v.videoWidth, videoHeight: v.videoHeight, paused: v.paused, ended: v.ended, src: v.src, currentSrc: v.currentSrc, error: v.error && { code: v.error.code, message: v.error.message }, playError: window.playError || null, events: window.events, canPlayType: { mp4: v.canPlayType('video/mp4'), h264aac: v.canPlayType('video/mp4; codecs="avc1.42c01e, mp4a.40.2"'), webm: v.canPlayType('video/webm; codecs="vp8, vorbis"') } };
            });
            observations.push({ kind, decoded: timeout === null, timeout, observation, network });
            await page.screenshot({ path: path.join(output, kind + '.png') });
            await page.close();
        }
        await context.tracing.stop({ path: path.join(output, 'trace.zip') });
        const report = { diagnosticOnly: true, releaseAcceptance: false, label: process.env.DIAGNOSTIC_LABEL || 'default', headed: process.env.DIAGNOSTIC_HEADED === 'true', sourceSha: process.env.GITHUB_SHA || null, playwrightVersion: require(path.resolve(process.env.DIAGNOSTIC_PLAYWRIGHT, 'package.json')).version, browserVersion: browser.version(), platform: process.platform, mediaSha256: crypto.createHash('sha256').update(media).digest('hex'), observations, requests };
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
        assert.equal(observations.length, cases.length);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
