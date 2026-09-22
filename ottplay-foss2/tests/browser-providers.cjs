/* Actual Chromium controller journeys; all provider responses are synthetic. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { handler } = require('../scripts/serve.cjs');
const output = path.resolve(__dirname, '../test-results');
fs.mkdirSync(output, { recursive: true });


async function navigate(page, selector) {
    if (!(await page.locator(selector).isVisible())) await page.locator("#menu-toggle").click();
    await page.locator(selector).click();
}

(async () => {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const providerOrigin = 'https://provider-fixture.invalid';
    const username = 'fixture/user';
    const password = 'fixture&password';
    const media = process.env.OTT2_TEST_MEDIA ? fs.readFileSync(process.env.OTT2_TEST_MEDIA) : null;
    const errors = [], requests = [], unexpected = [];
    fs.writeFileSync(path.join(output, 'browser-providers-report.json'), JSON.stringify({passed:false,status:'running'}));
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        page.setDefaultTimeout(12000);
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && url.pathname === '/api/epg') {
                await route.fulfill({ contentType: 'application/xml', body: '<tv/>' });
                return;
            }
            if (url.origin === origin && url.pathname === '/api/relay') {
                const payload = route.request().postDataJSON();
                const upstream = new URL(payload.url);
                assert.equal(upstream.origin, 'https://portal-fixture.invalid');
                assert.equal(upstream.pathname, '/stalker_portal/server/load.php');
                assert.equal(payload.headers.Cookie, 'mac=00%3A1A%3A79%3A01%3A02%3A03; stb_lang=en; timezone=UTC');
                const action = upstream.searchParams.get('action'), type = upstream.searchParams.get('type');
                requests.push({ pathname: '/api/relay', action: 'portal:' + action });
                if (action !== 'handshake') assert.equal(payload.headers.Authorization, 'Bearer synthetic-session');
                let value;
                if (action === 'handshake') value = { token: 'synthetic-session' };
                else if (action === 'get_profile') value = { id: 12, status: 0 };
                else if (action === 'get_genres') value = [{ id: 7, title: 'Portal channels' }];
                else if (action === 'get_categories') value = [{ id: 9, title: 'Portal Cinema' }];
                else if (action === 'get_ordered_list' && type === 'itv') {
                    const second = upstream.searchParams.get('p') === '2';
                    value = { data: [{ id: second ? 81 : 80, name: second ? 'Portal World' : 'Portal Live', tv_genre_id: 7, cmd: '/media/live.mpg' }], total_items: 2, max_page_items: 1 };
                } else if (action === 'get_ordered_list' && type === 'vod') value = { data: [{ id: 90, name: 'Portal Movie', cmd: '/media/90.mpg' }], total_items: 1 };
                else if (action === 'create_link') { assert.equal(upstream.searchParams.get('cmd'), '/media/90.mpg'); value = { cmd: 'ffmpeg ' + providerOrigin + '/portal-movie.mp4' }; }
                else assert.fail('Unexpected portal fixture action: ' + action);
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ js: value }) });
                return;
            }
            if (url.origin === origin) { await route.continue(); return; }
            if (url.origin !== providerOrigin) { unexpected.push(url.origin + url.pathname); await route.abort(); return; }
            requests.push({ pathname: url.pathname, action: url.searchParams.get('action') });
            const headers = { 'Access-Control-Allow-Origin': '*' };
            if (url.pathname === '/player_api.php') {
                assert.equal(url.searchParams.get('username'), username);
                assert.equal(url.searchParams.get('password'), password);
                const action = url.searchParams.get('action');
                const fixture = {
                    get_live_categories: [{ category_id: '1', category_name: 'Live fixture' }],
                    get_live_streams: [{ stream_id: 40, name: 'Fixture Live', category_id: '1', direct_source: providerOrigin + '/live.mp4' }],
                    get_vod_categories: [{ category_id: '1', category_name: 'Movies' }],
                    get_vod_streams: [{ stream_id: 50, name: 'Fixture Movie', category_id: '1', container_extension: 'mp4' }],
                    get_series_categories: [{ category_id: '1', category_name: 'Series' }],
                    get_series: [{ series_id: 60, name: 'Fixture Series', category_id: '1', plot: 'A synthetic show' }],
                    get_series_info: { seasons: [{ season_number: 1, name: 'Season One' }], episodes: { 1: [{ id: 70, title: 'Fixture Episode', season: 1, episode_num: 1, container_extension: 'mp4', info: { plot: '<img src=x onerror=alert(1)> literal description' } }] } }
                };
                if (action === 'get_series_info') assert.equal(url.searchParams.get('series_id'), '60');
                assert(action === null || Object.prototype.hasOwnProperty.call(fixture, action), 'Unexpected fixture action: ' + action);
                await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(action ? fixture[action] : { user_info: { auth: 1, status: 'Active' } }) });
            } else if (url.pathname === '/xmltv.php') {
                await route.fulfill({ status: 200, contentType: 'text/xml', headers, body: '<tv/>' });
            } else if (/\.mp4$/.test(url.pathname)) {
                await route.fulfill({ status: 200, contentType: 'video/mp4', headers, body: media || Buffer.alloc(0) });
            } else { unexpected.push(url.pathname); await route.fulfill({ status: 404, body: 'No fixture' }); }
        });
        await page.goto(origin);
        await page.click('#connect');
        await page.fill('#source-name', 'Synthetic Xtream');
        await page.selectOption('#source-type', 'xtream');
        await page.fill('#source-url', providerOrigin);
        await page.fill('#source-user', username);
        await page.fill('#source-password', password);
        await page.click('#save-source');
        await page.getByRole('button', { name: /Fixture Live/ }).waitFor();
        await navigate(page, "#nav-vod");
        await page.getByRole('button', { name: /Fixture Series/ }).click();
        await page.getByRole('button', { name: /Season One/ }).waitFor();
        assert.equal(await page.locator('#watch').count(), 0, 'A series folder must not open the playback dialog');
        await page.screenshot({ path: path.join(output, 'xtream-seasons.png') });
        await page.getByRole('button', { name: /Season One/ }).click();
        await page.getByRole('button', { name: /Fixture Episode/ }).waitFor();
        assert.equal(requests.filter(req => req.action === 'get_series_info').length, 1, 'Season browsing uses the normalized details cache');
        await page.screenshot({ path: path.join(output, 'xtream-episodes.png') });
        await page.click('#browse-back');
        await page.getByRole('button', { name: /Season One/ }).click();
        await page.getByRole('button', { name: /Fixture Episode/ }).click();
        await page.locator('#watch').waitFor();
        assert.match(await page.locator('#f2-dialog').innerText(), /Fixture Episode/);
        await page.click('#favorite');
        await page.click('#dialog-close');
        await navigate(page, "#nav-favorites");
        await page.getByRole('button', { name: /Fixture Episode/ }).waitFor();
        await page.reload();
        await page.getByRole('button', { name: /Fixture Live/ }).waitFor();
        await navigate(page, "#nav-favorites");
        await page.getByRole('button', { name: /Fixture Episode/ }).waitFor();
        await page.getByRole('button', { name: /Fixture Episode/ }).click();
        await page.click('#watch');
        const episodeURL = providerOrigin + '/series/' + encodeURIComponent(username) + '/' + encodeURIComponent(password) + '/70.mp4';
        await page.waitForFunction(expected => document.getElementById('player-video').src === expected, episodeURL);
        await page.waitForFunction(() => document.getElementById('foss2-home').style.display === 'none');
        if (media) await page.waitForFunction(() => document.getElementById('player-video').currentTime > 0.1);
        await page.click('#player-home');
        await page.getByRole('button', { name: /Fixture Episode/ }).waitFor();
        await navigate(page, "#nav-sources");
        await page.click('#remove-0');
        await page.click('#confirm-delete');
        await navigate(page, "#nav-vod");
        assert.equal(await page.locator('#f2-channels button').count(), 0, 'Deleted source cannot leave stale discovered episodes in the video library');
        assert.equal(await page.locator('#browse-back').count(), 0, 'Deleted source clears breadcrumbs');
        assert.equal(await page.getByRole('button', { name: /Fixture Episode|Fixture Series|Season One/ }).count(), 0);
        const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('ottplay2:state:v1')));
        assert.equal(persisted.sources.length, 0);
        assert.equal(persisted.activeSourceId, '');
        await page.reload(); await page.locator('#connect').waitFor();
        await navigate(page, "#nav-vod");
        assert.equal(await page.locator('#f2-channels button').count(), 0);
        await navigate(page, "#nav-settings"); await page.click('#preferences');
        await page.check('#pref-relay'); await page.click('#save-preferences');
        await navigate(page, "#nav-sources"); await page.click('#add-source');
        await page.fill('#source-name', 'Synthetic Portal');
        await page.selectOption('#source-type', 'stalker');
        await page.fill('#source-url', 'https://portal-fixture.invalid/stalker_portal/c/');
        await page.fill('#source-mac', '00:1A:79:01:02:03');
        await page.click('#save-source');
        await page.getByRole('button', { name: /Portal Live/ }).waitFor();
        assert.equal(requests.filter(req => req.action === 'portal:get_ordered_list').length, 2);
        await navigate(page, "#nav-vod");
        await page.getByRole('button', { name: /Movies and series/ }).click();
        await page.getByRole('button', { name: /Portal Cinema/ }).click();
        await page.getByRole('button', { name: /Portal Movie/ }).click();
        await page.click('#watch');
        await page.waitForFunction(expected => document.getElementById('player-video').src === expected, providerOrigin + '/portal-movie.mp4');
        if (media) await page.waitForFunction(() => document.getElementById('player-video').currentTime > 0.1);
        const storedPortal = await page.evaluate(() => localStorage.getItem('ottplay2:state:v1'));
        assert.equal(storedPortal.includes('synthetic-session'), false, 'Portal bearer sessions never enter persisted state');
        await page.click('#player-home');
        await page.screenshot({ path: path.join(output, 'stalker-movies.png') });
        await navigate(page, "#nav-sources"); await page.click('#remove-0'); await page.click('#confirm-delete');
        await navigate(page, "#nav-vod");
        assert.equal(await page.locator('#f2-channels button').count(), 0);
        assert.equal(await page.locator('#browse-back').count(), 0);
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, [], 'No test data may contact a real provider');
        const report = { passed: true, browser: 'Chromium', realSyntheticPlayback: !!media, pageErrors: errors, requests: requests.map(req => req.action || req.pathname), scenarios: ['Xtream form and authentication', 'separate live and video catalogs', 'series to seasons to episodes', 'folder Back navigation', 'episode favorites within the active source', 'persisted episode favorite resolves after reload through fresh folders', 'episode URL resolution and playback intent', 'Stalker form, relay handshake and paginated live catalog', 'Stalker VOD folder browse, create_link and actual playback', 'Stalker session token excluded from persistence', 'source deletion clears discovered episodes and breadcrumbs', 'empty library after reload'] };
        fs.writeFileSync(path.join(output, 'browser-providers-report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
