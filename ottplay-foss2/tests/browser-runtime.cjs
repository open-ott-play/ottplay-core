'use strict';
const path = require('node:path');
const modulePath = process.env.CI_PLAYWRIGHT_MODULE || 'playwright';
if (process.env.CI_PLAYWRIGHT_MODULE && !path.isAbsolute(modulePath)) throw Error('Browser toolchain must be absolute');
const playwright = require(modulePath);
const engine = process.env.CI_BROWSER_ENGINE || 'chromium';
const channel = process.env.CI_BROWSER_CHANNEL || '';
if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw Error('Unsupported browser engine');
if (channel && (engine !== 'chromium' || !['chrome', 'chrome-beta', 'msedge', 'msedge-beta'].includes(channel))) throw Error('Unsupported browser channel');
exports.browserType = playwright[engine];
exports.launchOptions = { headless: true, ...(channel ? { channel } : {}) };
exports.identity = browser => ({
    browser: browser.version(), browserVersion: browser.version(), engine: browser.browserType().name(), channel,
    playwrightVersion: require(modulePath === 'playwright' ? 'playwright/package.json' : path.join(modulePath, 'package.json')).version
});
