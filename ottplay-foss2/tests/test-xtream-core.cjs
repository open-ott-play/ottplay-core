const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const context = vm.createContext({ window: { OTT2: { define(name, factory) { context.providers = factory(); } } } });
require('./load-core.cjs')(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/providers.js'), 'utf8'), context);
const fixture = require('./fixtures/xtream-before-core.json');
const plain = value => JSON.parse(JSON.stringify(value));
for (const [index, row] of fixture.cases.entries()) {
    const input = row.input, calls = []; let catalog, error, folders; const episodes = [];
    const source = input.source || fixture.source;
    const service = context.providers.create({ request(url, callback) {
        const action = new URL(url).searchParams.get('action'); calls.push(url);
        callback(null, action === 'get_series_info' ? input.series : action ? input.actions[action] : input.account);
        return () => {};
    } });
    service.load(source, (failure, result) => { if (failure) error = { code: failure.code, message: failure.message }; else catalog = result; });
    if (catalog && Object.hasOwn(input, 'series')) {
        service.browse(source, catalog.channels.find(item => item.folderType === 'series'), (failure, result) => {
            if (failure) error = { code: failure.code, message: failure.message }; else folders = result;
        });
        if (folders) for (const node of folders.items) service.browse(source, node, (failure, result) => {
            if (failure) error = { code: failure.code, message: failure.message }; else episodes.push(result);
        });
    }
    assert.deepEqual(plain({ calls, error, catalog, folders, episodes }), row.expected, 'Captured Xtream contract ' + index);
}
console.log('PASS ' + fixture.cases.length + ' captured Xtream catalog/account/series contracts with the common core');
