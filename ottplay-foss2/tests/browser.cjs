/* Real browser journeys; synthetic fixture media never contacts a provider. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { handler } = require('../scripts/serve.cjs');
const output = path.resolve(__dirname, '../test-results');
fs.mkdirSync(output, { recursive: true });

(async () => {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    const errors = [];
    const layoutChecks = [];
    const headerChecks = [];
    async function checkLayout(page, label) {
        const metrics = await page.evaluate(() => {
            const main = document.querySelector('.f2-main'), home = document.getElementById('foss2-home');
            const rows = document.querySelectorAll('.f2-channel'), footer = document.querySelector('.f2-footer');
            const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
            return { width: innerWidth, height: innerHeight, rows: rows.length, fontSize: home.style.fontSize,
                mainClient: main.clientHeight, mainScroll: main.scrollHeight, mainBottom: main.getBoundingClientRect().bottom,
                rowBottom: last && last.bottom, footerTop: footer.getBoundingClientRect().top,
                sidebarPosition: getComputedStyle(document.querySelector('.f2-sidebar')).position,
                horizontalOverflow: home.scrollWidth > home.clientWidth + 1 };
        });
        assert.equal(metrics.horizontalOverflow, false, label + ': no horizontal overflow');
        if (metrics.width > metrics.height) {
            assert.equal(metrics.sidebarPosition, 'absolute', label + ': landscape keeps the TV sidebar');
            assert.ok(metrics.mainScroll <= metrics.mainClient + 1, label + ': channel page fits without scrolling ' + JSON.stringify(metrics));
            assert.ok(metrics.rowBottom <= metrics.mainBottom && metrics.rowBottom < metrics.footerTop, label + ': last channel stays above the footer');
        }
        layoutChecks.push({ label, ...metrics });
    }
    async function section(page, name) {
        if (!await page.locator("#nav-" + name).isVisible()) await page.click("#menu-toggle");
        await page.click("#nav-" + name);
    }
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await page.route('**/api/epg', route => route.fulfill({ contentType: 'application/xml', body: '<tv/>' }));
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://fixture.test/**', async route => {
            const url = route.request().url();
            if (url.endsWith('.mp4') && process.env.OTT2_TEST_MEDIA) await route.fulfill({ contentType: 'video/mp4', body: fs.readFileSync(process.env.OTT2_TEST_MEDIA), headers: { 'Access-Control-Allow-Origin': '*' } });
            else if (url.endsWith('guide.xml')) {
                const format = n => new Date(n).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
                await route.fulfill({ contentType: 'text/xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<tv><channel id="ch1"><display-name>News</display-name></channel><programme channel="ch1" start="' + format(Date.now() - 600000) + '" stop="' + format(Date.now() + 3600000) + '"><title>Test bulletin</title><desc>&lt;img src=x onerror=alert(1)&gt;</desc></programme><programme channel="ch1" start="' + format(Date.now() + 3600000) + '" stop="' + format(Date.now() + 7200000) + '"><title>Next bulletin</title></programme></tv>' });
            } else await route.fulfill({ status: 404, body: 'Fixture not found' });
        });
        await page.goto(origin);
        await page.locator('#connect').waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), 'en');
        assert.equal(await page.locator('#player-home').innerText(), 'Home');
        assert.match(await page.locator('body').evaluate(node => node.style.fontFamily), /RobotoCondensed/, 'Fresh TV interface uses the condensed font');
        assert.equal(/[А-Яа-я]/.test(await page.locator('#foss2-home').innerText()), false);
        await page.screenshot({ path: path.join(output, 'home-1280.png') });
        await section(page, "settings"); await page.click('#lang-ru');
        assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
        await page.reload(); await page.locator('#connect').waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
        await section(page, "settings"); await page.click('#lang-en'); await section(page, "tv");
        await page.click('#connect');
        await page.locator('.f2-keyboard-open').first().click();
        await page.locator('[data-action="keyboardKey"][data-value="q"]').click();
        await page.screenshot({ path: path.join(output, 'keyboard-1280.png') });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#source-name').inputValue(), 'q');
        assert.equal(await page.locator('.f2-keyboard-panel').count(), 0);
        await page.fill('#source-name', 'My test playlist');
        let playlist = '#EXTM3U x-tvg-url="https://fixture.test/guide.xml"\n';
        for (let i = 1; i <= 48; i++) playlist += '#EXTINF:-1 tvg-id="ch' + i + '" group-title="A long synthetic channel group for testing remote header navigation and clipped controls",' + (i === 2 ? '<img src=x onerror=alert(1)>' : 'Channel ' + i) + '\nhttps://fixture.test/' + i + '.mp4\n';
        await page.fill('#source-text', playlist);
        await page.click('#save-source');
        await page.locator('#channel-0').waitFor();
        const defaultPageSize = await page.locator('#f2-channels button').count();
        assert.ok(defaultPageSize >= 20 && defaultPageSize <= 30, '720p TV layout displays at least twenty usable rows');
        assert.ok(await page.locator('#channel-0').evaluate(node => node.getBoundingClientRect().height) <= 28, 'Default TV rows remain compact');
        assert.equal(await page.locator('.f2-pages').count(), 0, 'TV paging does not consume a separate bottom row');
        assert.ok(await page.locator('.f2-heading').evaluate(node => node.getBoundingClientRect().top) <= 6, 'The TV heading starts near the window edge');
        assert.ok(await page.locator('#channel-0').evaluate(node => node.getBoundingClientRect().top) < 52, 'The first TV channel is raised into the former empty header space');
        assert.equal(await page.locator('#f2-header-page').innerText(), '1 / ' + Math.ceil(48 / defaultPageSize));
        assert.equal(await page.locator('#f2-header-page').evaluate(node => node.tabIndex), -1, 'The header page indicator is not an extra remote focus stop');
        assert.equal(await page.locator('#f2-channels img').count(), 0);
        await page.locator('#f2-selected-next').filter({hasText:'Next bulletin'}).waitFor();
        await checkLayout(page, '720p default');
        await page.locator('#channel-3').focus();
        const focusStyle = await page.locator('#channel-3').evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, text: getComputedStyle(node.querySelector('.f2-channel-name')).color }));
        assert.deepEqual(focusStyle, { fill: 'rgb(244, 197, 121)', text: 'rgb(27, 38, 49)' }, 'Even striped rows retain a high contrast filled focus');
        for (let i = 0; i < defaultPageSize - 3; i += 1) await page.keyboard.press('ArrowDown');
        assert.equal(await page.locator('#channel-0 .f2-channel-name').innerText(), 'Channel ' + (defaultPageSize + 1));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'channel-0', 'Down continues across pages');
        assert.equal(await page.locator('#f2-header-page').innerText(), '2 / ' + Math.ceil(48 / defaultPageSize));
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'channel-' + (defaultPageSize - 1), 'Up returns to the previous page end');
        await page.keyboard.press('ContextMenu'); assert.equal(await page.evaluate(() => document.activeElement.id), 'nav-tv');
        assert.equal(await page.locator('#nav-tv').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(244, 197, 121)', 'Active section keeps the same filled remote focus');
        await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.id), 'channel-' + (defaultPageSize - 1), 'Sidebar returns to the last selected row');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#channel-0 .f2-channel-name').innerText(), 'Channel ' + (defaultPageSize + 1));
        await page.keyboard.press('ArrowLeft');
        await page.locator('#channel-0').focus(); await page.click('#channel-details');
        await page.click('#favorite');
        await page.click('#dialog-close');
        await section(page, "favorites");
        assert.equal(await page.locator('#f2-channels button').count(), 1);
        assert.equal(await page.locator('.f2-pages').count(), 0, 'Favorites also omit the bottom paging row');
        await page.reload();
        await page.locator('#channel-0').waitFor();
        await section(page, "favorites");
        assert.equal(await page.locator('#f2-channels button').count(), 1);
        await page.click('#channel-0');
        assert.equal(await page.locator('#f2-dialog').count(), 0, 'A live channel click starts playback without a channel card');
        await page.waitForFunction(() => document.getElementById('foss2-home').style.display === 'none');
        if (process.env.OTT2_TEST_MEDIA) {
            await page.waitForFunction(() => document.getElementById('player-video').currentTime > 0, null, { timeout: 10000 });
            await page.keyboard.press('p');
            await page.waitForFunction(() => document.getElementById('player-video').paused);
            await page.keyboard.press('p');
            await page.waitForFunction(() => !document.getElementById('player-video').paused);
        }
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'player-pause', 'Remote OK enters the playback control bar');
        await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'player-engines', 'D-pad reaches the engine switch without a mouse');
        await page.keyboard.press('Enter'); await page.locator('#engine-0').waitFor();
        assert.ok(await page.locator('#f2-dialog-title').isVisible());
        await page.keyboard.press('Escape');
        await page.click('#player-options');
        await page.locator('#aspect-2').click(); await page.locator('#zoom-1').click();
        await page.screenshot({path: path.join(output, 'playback-options.png')});
        await page.keyboard.press('Escape');
        await page.keyboard.press('Backspace');
        await page.waitForFunction(() => document.getElementById('foss2-home').style.display === 'block');
        await section(page, "settings");
        await page.click('#font-1');
        assert.match(await page.locator('body').evaluate(node => node.style.fontFamily), /Roboto/);
        for (const family of ['Roboto', 'RobotoCondensed', 'Caveat', 'Liberation', 'Gabriela', 'PTSansNarrow']) assert.equal(await page.evaluate(async family => { await document.fonts.load('20px "' + family + '"'); return document.fonts.check('20px "' + family + '"'); }, family), true);
        await page.click('#history');
        assert.match(await page.locator('#f2-dialog').innerText(), process.env.OTT2_TEST_MEDIA ? /Channel 1/ : /Your history is empty/, 'History records confirmed playback only');
        await page.click('#dialog-close');
        await section(page, "favorites"); await page.click('#lists'); await page.click('#rename-list');
        await page.fill('#collection-name', 'Evening'); await page.click('#collection-rename');
        assert.match(await page.locator('#lists').innerText(), /Evening/);
        await page.locator('#channel-0').focus(); await page.click('#channel-details'); await page.click('#channel-edit');
        await page.fill('#channel-name', 'My News'); await page.click('#save-channel');
        assert.match(await page.locator('#channel-0').innerText(), /My News/);
        await section(page, "settings"); await page.click('#font-2'); await section(page, "tv");
        await page.screenshot({ path: path.join(output, 'channels-1280.png') });
        for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 640, height: 480 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
            await page.setViewportSize(size);
            await page.screenshot({ path: path.join(output, 'channels-' + size.width + 'x' + size.height + '.png') });
            await checkLayout(page, size.width + 'x' + size.height);
        }
        await page.setViewportSize({ width: 360, height: 240 });
        await page.click('#groups'); await page.click('#group-0');
        await page.locator('#channel-0').focus();
        const selectedBeforeHeader = await page.locator('#f2-selected-channel').innerText();
        assert.ok(await page.locator('#f2-heading-tools').evaluate(node => node.scrollWidth > node.clientWidth + 10), 'Long-group fixture overflows the narrow header scrollport');
        async function headerFocus(id) {
            assert.equal(await page.evaluate(() => document.activeElement.id), id);
            const bounds = await page.locator('#' + id).evaluate(node => {
                const r = node.getBoundingClientRect(), tools = document.getElementById('f2-heading-tools');
                const clip = tools.contains(node) ? tools.getBoundingClientRect() : { left: 0, right: innerWidth };
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, clipLeft: clip.left, clipRight: clip.right, scrollLeft: tools.scrollLeft };
            });
            assert.ok(bounds.left >= bounds.clipLeft - 1 && bounds.right <= bounds.clipRight + 1 && bounds.top >= 0 && bounds.bottom < 240, 'Focused header control remains fully visible: ' + id + ' ' + JSON.stringify(bounds));
            headerChecks.push({ id, ...bounds });
        }
        await page.keyboard.press('ContextMenu');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'nav-tv', 'Menu opens the current section from the channel cursor');
        await page.keyboard.press('ArrowUp'); await headerFocus('menu-toggle');
        assert.equal(await page.locator('#f2-sidebar').isVisible(), false, 'Up from the first section returns to the visible header');
        await page.keyboard.press('ArrowRight'); await headerFocus('search');
        await page.keyboard.press('ArrowRight'); await headerFocus('groups');
        await page.keyboard.press('ArrowRight'); await headerFocus('edit-current-group');
        assert.ok(await page.locator('#f2-heading-tools').evaluate(node => node.scrollLeft) > 0, 'Remote header navigation scrolls horizontally to expose clipped controls');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'channel-0', 'Down from the header returns to the channel cursor');
        assert.equal(await page.locator('#f2-selected-channel').innerText(), selectedBeforeHeader, 'Header navigation preserves the selected channel');
        await page.click('#groups'); await page.click('#group-all');
        await page.setViewportSize({width:1280,height:720});
        await section(page, "settings"); await page.click('#scale-3'); await section(page, "tv");
        assert.ok(await page.locator('.f2-channel').count() < defaultPageSize, 'Larger type reduces the page size instead of clipping channels');
        await checkLayout(page, '720p at 130 percent');
        await page.screenshot({ path: path.join(output, 'channels-1280-large.png') });
        await section(page, "settings"); await page.click('#engines');
        const engineTitle = await page.locator('#f2-dialog-title').boundingBox();
        assert.ok(engineTitle && engineTitle.y >= 0 && engineTitle.y + engineTitle.height < 720, 'Large engine picker opens at its heading instead of scrolling to Close');
        assert.notEqual(await page.evaluate(() => document.activeElement.id), 'dialog-close');
        await page.screenshot({path:path.join(output,'compact-engines-large.png')});
        await page.keyboard.press('Escape');
        await page.click('#scale-1'); await section(page, "tv");
        await section(page, "tv"); await page.locator('#channel-0').focus(); await page.click('#channel-details'); await page.click('#channel-protect');
        assert.ok(await page.locator('#pin-channel').inputValue());
        await page.fill('#pin-new', '1234'); await page.fill('#pin-repeat', '1234'); await page.click('#pin-configure');
        await section(page, "settings");
        await page.locator('#access-pin').waitFor(); await page.fill('#access-pin', '1234'); await page.click('#unlock');
        await section(page, "settings"); await page.click('#security'); await page.click('#pin-lock');
        await section(page, "tv"); await page.click('#channel-0');
        await page.locator('#access-pin').waitFor(); await page.fill('#access-pin', '0000'); await page.click('#unlock');
        assert.equal(await page.locator('#access-pin').count(), 1);
        await page.fill('#access-pin', '1234'); await page.click('#unlock');
        await page.waitForFunction(() => document.getElementById('foss2-home').style.display === 'none');
        const security = await page.evaluate(() => JSON.parse(localStorage.getItem('ottplay2:state:v1')).security);
        assert.equal(security.enabled, true); assert.equal(security.protectedIds.length, 1); assert.match(security.hash, /^[a-f0-9]{64}$/); assert.equal('pin' in security, false);
        // A full series season exercises the additional breadcrumb row at both
        // normal and enlarged TV type. This provider is isolated from the main journey.
        const vodPage = await browser.newPage({ viewport: { width:1280, height:720 } });
        await vodPage.route('**/api/epg', route => route.fulfill({ contentType: 'application/xml', body: '<tv/>' }));
        vodPage.on('pageerror', error => errors.push(error.message));
        await vodPage.route('https://layout-fixture.invalid/**', async route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/xmltv.php') { await route.fulfill({contentType:'text/xml',body:'<tv/>',headers:{'Access-Control-Allow-Origin':'*'}}); return; }
            const action = url.searchParams.get('action');
            const fixture = {
                get_live_categories: [], get_live_streams: [], get_vod_categories: [], get_vod_streams: [],
                get_series_categories:[{category_id:'1',category_name:'Series'}],
                get_series:[{series_id:1,name:'Layout Series',category_id:'1'}],
                get_series_info:{seasons:[{season_number:1,name:'Season One'}],episodes:{1:Array.from({length:24},(_,i)=>({id:i+1,title:'Layout Episode '+(i+1),season:1,episode_num:i+1,container_extension:'mp4'}))}}
            };
            assert.ok(action === null || Object.prototype.hasOwnProperty.call(fixture, action));
            await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(action ? fixture[action] : {user_info:{auth:1,status:'Active'}})});
        });
        await vodPage.goto(origin + '/f/lg/webos/'); await vodPage.click('#connect');
        await vodPage.fill('#source-name','Layout fixture'); await vodPage.selectOption('#source-type','xtream');
        await vodPage.fill('#source-url','https://layout-fixture.invalid'); await vodPage.fill('#source-user','fixture'); await vodPage.fill('#source-password','fixture');
        await vodPage.click('#save-source');
        await vodPage.waitForFunction(() => document.querySelector('.f2-subtitle').textContent === 'Layout fixture');
        await section(vodPage, "vod"); await vodPage.getByRole('button',{name:/Layout Series/}).click(); await vodPage.getByRole('button',{name:/Season One/}).click();
        await vodPage.locator('#browse-back').waitFor(); await vodPage.getByRole('button',{name:/Layout Episode 1 /}).waitFor();
        await checkLayout(vodPage, '720p season with breadcrumbs');
        await section(vodPage, "settings"); await vodPage.click('#scale-3'); await section(vodPage, "vod");
        await checkLayout(vodPage, '720p season with breadcrumbs at 130 percent');
        await vodPage.screenshot({path:path.join(output,'vod-1280-large.png')});
        await vodPage.close();
        const legacy = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await legacy.route('**/api/epg', route => route.fulfill({ contentType: 'application/xml', body: '<tv/>' }));
        const legacyErrors = [], loaded = [];
        legacy.on('pageerror', error => legacyErrors.push(error.message));
        legacy.on('request', request => loaded.push(request.url()));
        await legacy.addInitScript(() => { window.Promise = undefined; window.Map = undefined; window.Set = undefined; window.WeakMap = undefined; window.fetch = undefined; window.URL = undefined; window.MediaSource = undefined; window.ManagedMediaSource = undefined; window.WebKitMediaSource = undefined; Object.assign = undefined; Array.from = undefined; });
        await legacy.goto(origin + '/f/samsung/tizen/');
        await legacy.locator('#connect').waitFor();
        assert.equal(loaded.some(url => /\/vendor\/(hls|shaka|mpegts)\.min\.js$/.test(url)), false);
        await legacy.keyboard.press('ArrowRight');
        assert.equal(await legacy.evaluate(() => typeof Promise === 'function' && typeof Map === 'function' && typeof Set === 'function' && typeof WeakMap === 'function' && typeof Object.assign === 'function' && typeof Array.from === 'function'), true, 'Bootstrap restores media-library language prerequisites before application startup');
        assert.deepEqual(legacyErrors, []);
        assert.deepEqual(errors, []);
        const report = { passed: true, browser: 'Chromium', realSyntheticPlayback: !!process.env.OTT2_TEST_MEDIA, layoutChecks, headerChecks, pageErrors: errors, legacyPageErrors: legacyErrors, scenarios: ['English first run and persisted English/Russian switch', 'collections and channel editing', 'history', 'PIN-protected playback', 'picture sizing', 'empty start', 'remote keyboard and Back', 'M3U paste', 'pagination', 'XSS text', 'favorite persistence', 'live channel click starts playback without a channel card', 'Info retains channel actions', 'playback, pause toggle and Back', 'D-pad opens engine picker from the playback control bar', 'six font aliases', 'six viewport sizes', 'remote header focus scrolls clipped long-group controls into view and returns to the selected channel', 'TV rows fit without scrolling including 640 landscape and 130 percent type', 'breadcrumb rows reserve room in VOD', 'filled remote focus and arrow navigation across pages', 'legacy API polyfills and native-only gate without MediaSource'] };
        fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
