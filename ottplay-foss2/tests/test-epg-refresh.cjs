'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), test = require('node:test');
const {createRequire} = require('node:module');
const repo = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(repo, 'package.json'));
const {JSDOM} = localRequire('jsdom');
const dom = new JSDOM('');
const appPath = path.join(repo, 'src/app.js'), fixturePath = path.join(repo, 'tests/test-app.cjs');
const appSource = fs.readFileSync(appPath, 'utf8');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixturePrefix = fixtureSource.slice(0, fixtureSource.indexOf('\ntest('));
assert(fixturePrefix.includes('function fixture(options = {})'));
const marker = 'return { destroy: destroy, snapshot: buildModel };';
assert.equal(appSource.split(marker).length, 2);
// Observe state only. Every branch and state transition remains the shipping method.
const observedApp = appSource.replace(marker, 'return { destroy: destroy, snapshot: buildModel, __captureRefresh: function () { var refresh = guideRefresh.snapshot(); return { guide: guide, feeds: guideFeeds, info: guideInfo, due: refresh.due, failures: refresh.failures, urls: refresh.urls, guideEpoch: refresh.generation, sourceEpoch: sourceEpoch, destroyed: destroyed }; } };');
const observingFs = Object.create(fs);
observingFs.readFileSync = function (file, ...args) { return path.resolve(String(file)) === appPath ? observedApp : fs.readFileSync(file, ...args); };
function fixtureFactory(Clock) {
    const module = {exports:{}};
    const requireFixture = function(name) { return name === 'node:fs' ? observingFs : createRequire(fixturePath)(name); };
    vm.runInNewContext(fixturePrefix + '\nmodule.exports = fixture;\n', {require:requireFixture, module, exports:module.exports, __dirname:path.dirname(fixturePath), __filename:fixturePath, Date:Clock, console}, {filename:fixturePath});
    return module.exports;
}
function realEpg() {
    const modules = {}, context = vm.createContext({window:{OTT2:{define(name, factory) { modules[name] = factory(id => modules[id]); }}}});
    localRequire('./tests/load-core.cjs')(context);
    for (const file of ['providers', 'epg']) vm.runInContext(fs.readFileSync(path.join(repo, 'src', file + '.js'), 'utf8'), context);
    return modules.epg;
}
const A='https://guide.example/a.xml', B='https://guide.example/b.xml', C='https://guide.example/c.xml';
const NOW=Date.parse('2026-09-22T12:00:00Z');
function xml(title, name='Live') { return '<tv><channel id="live"><display-name>'+name+'</display-name><icon src="https://img.example/'+title+'.png"/></channel><programme channel="live" start="20260922110000 +0000" stop="20260922130000 +0000"><title>'+title+'</title><desc>Description '+title+'</desc></programme></tv>'; }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function setup(urls=[A,B]) {
    let now=NOW;
    class Clock extends Date { static now() { return now; } }
    const fixture=fixtureFactory(Clock);
    const f=fixture({epg:realEpg(), settings:{epgUrls:urls}, environment:{Date:Clock,DOMParser:dom.window.DOMParser}});
    const trace=[];
    return {f, trace,
        snap(label) { trace.push({label, now, state:plain(f.controller.__captureRefresh()), requests:f.guideCalls.map(call=>({url:call.url,cancelled:call.cancelled,options:plain(call.options)})), epgStatus:f.model.epgStatus, nowById:plain(f.model.nowById||{}), nextById:plain(f.model.nextById||{}), toasts:f.toasts.slice()}); },
        ok(index, value) { f.guideCalls[index].callback(null,value); },
        fail(index, code='NETWORK') { f.guideCalls[index].callback(Object.assign(new Error('fixture failure'),{code})); },
        refresh() { f.action('refreshEPG'); },
        urls(values) { f.action('saveEPG','',{'epg-url-value':values.join('\n')}); },
        advance(ms) { now+=ms; },
        tick() { f.runDelay(30000); },
        seed() { this.ok(0,xml('A-old')); this.ok(1,xml('B-old')); },
        finish() { f.controller.destroy(); }
    };
}
const results=[];
function capture(name, action, urls) { const h=setup(urls); h.snap('initial'); action(h); h.finish(); results.push({name,trace:h.trace}); }
capture('progressive completion B then A preserves configured source order', h=>{h.ok(1,xml('B'));h.snap('B complete');h.ok(0,xml('A'));h.snap('A complete');});
capture('progressive completion A then B preserves configured source order', h=>{h.ok(0,xml('A'));h.snap('A complete');h.ok(1,xml('B'));h.snap('B complete');});
capture('failed A retains its stale per-URL feed while B succeeds', h=>{h.seed();h.refresh();h.ok(3,xml('B-new'));h.snap('B refreshed with stale A');h.fail(2);h.snap('A failed');});
capture('failed B retains stale data while A updates progressively', h=>{h.seed();h.refresh();h.ok(2,xml('A-new'));h.snap('A refreshed with stale B');h.fail(3,'TIMEOUT');h.snap('B failed');});
capture('all failures keep cached merged guide but report error', h=>{h.seed();h.refresh();h.fail(2);h.snap('first failed');h.fail(3,'TIMEOUT');h.snap('all failed');});
capture('all failures without cache leave no guide', h=>{h.fail(1,'TIMEOUT');h.snap('B failed');h.fail(0);h.snap('A failed');});
capture('successful empty A replaces its own stale feed before B fails', h=>{h.seed();h.refresh();h.ok(2,'<tv/>');h.snap('A empty success');h.fail(3);h.snap('B failed');});
capture('all empty responses are successful and schedule normal refresh', h=>{h.ok(0,'<tv/>');h.snap('A empty success');h.ok(1,'<tv/>');h.snap('B empty success');});
capture('XML parsing failure retains prior feed and preserves error code', h=>{h.seed();h.refresh();h.ok(2,'<tv><channel');h.snap('A invalid XML');h.ok(3,xml('B-new'));h.snap('B success');});
capture('removing A discards its cached data before B completes', h=>{h.seed();h.urls([B]);h.snap('A removed');h.fail(2);h.snap('B failed with only B retained');});
capture('source order change immediately remerges retained feeds', h=>{h.seed();h.urls([B,A]);h.snap('order reversed');h.fail(2);h.fail(3);h.snap('both failed after order change');});
capture('new C replaces removed A while pending and retains only B', h=>{h.seed();h.urls([C,B]);h.snap('C added A removed');h.ok(2,xml('C-new'));h.snap('C ready B stale');h.fail(3);h.snap('B failed');});
capture('superseded refresh cancels requests and ignores late callbacks', h=>{h.ok(0,xml('A-first'));h.refresh();h.snap('superseded initial');h.ok(1,xml('B-late'));h.snap('old B ignored');h.ok(2,xml('A-current'));h.ok(3,xml('B-current'));h.snap('current complete');});
capture('playlist source change clears cached feeds and rejects old callbacks', h=>{h.seed();h.refresh();h.f.action('loadSource','source');h.snap('source loading');h.ok(2,xml('A-late'));h.fail(3);h.snap('late old callbacks ignored');h.f.sourceCalls[1].callback(null,{channels:[h.f.live],epgUrls:[]});h.snap('new source starts empty refresh');});
capture('destroy cancels pending requests and ignores their results', h=>{h.ok(0,xml('A'));h.f.controller.destroy();h.snap('destroyed');h.ok(1,xml('B-late'));h.snap('late callback ignored');});
capture('failure backoff doubles and caps at thirty minutes then resets on success', h=>{for(let round=0;round<7;round++){if(round)h.refresh();h.fail(round*2);h.fail(round*2+1);h.snap('failed round '+(round+1));}h.refresh();h.ok(14,xml('A-restored'));h.ok(15,xml('B-restored'));h.snap('success resets backoff');});
capture('automatic failures with stale guide suppress toast and refresh only when due', h=>{h.seed();h.advance(1799999);h.tick();h.snap('not due');h.advance(1);h.tick();h.snap('due automatic starts');h.tick();h.snap('no overlapping automatic request');h.fail(2);h.fail(3);h.snap('automatic failure is quiet with stale guide');h.advance(59999);h.tick();h.snap('backoff not due');h.advance(1);h.tick();h.snap('retry begins at due');});
capture('hidden document defers automatic refresh until foreground event', h=>{h.seed();h.f.document.hidden=true;h.advance(1800000);h.tick();h.snap('hidden overdue');h.f.document.hidden=false;h.f.document.fire('visibilitychange');h.snap('foreground starts refresh');});
// These checks qualify that the captured scenarios reached their intended states.
// They assert outcomes; they do not implement any refresh decisions.
const last=index=>results[index].trace.at(-1);
assert.deepEqual(last(0).state.guide,last(1).state.guide);
assert.deepEqual(last(0).state.guide.channels.map(row=>row.sourceUrl),[A,B]);
assert.deepEqual(results[10].trace[1].state.guide.channels.map(row=>row.sourceUrl),[B,A]);
assert.equal(last(2).state.info.phase,'ready');
assert.equal(last(2).state.failures,1);
assert.equal(last(2).state.feeds[A].programmes[0].title,'A-old');
assert.equal(last(2).state.feeds[B].programmes[0].title,'B-new');
assert.equal(last(4).state.info.phase,'error');assert(last(4).state.guide);
assert.equal(last(5).state.guide,null);
assert.equal(results[6].trace[1].state.feeds[A].channels.length,0);
assert.equal(last(7).state.info.phase,'ready');assert.equal(last(7).state.failures,0);
assert.equal(results[8].trace[1].state.info.errors[0],'XML_FORMAT');
assert.deepEqual(Object.keys(results[9].trace[1].state.feeds),[B]);
for (const index of [12,13,14]) assert.deepEqual(results[index].trace[1].state,results[index].trace[2].state);
assert.deepEqual(results[15].trace.slice(1,8).map(step=>step.state.due-step.now),[60000,120000,240000,480000,960000,1800000,1800000]);
assert.equal(last(15).state.failures,0);
assert.equal(results[16].trace[4].toasts.length,0);
assert.deepEqual(results[16].trace.map(step=>step.requests.length),[2,2,4,4,4,4,6]);
assert.deepEqual(results[17].trace.map(step=>step.requests.length),[2,2,4]);
test('browser EPG refresh matches 18 pre-core scenarios and 67 state snapshots', () => {
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/epg-refresh/before-core.json'), 'utf8'));
    assert.equal(expected.cases.length, 18);
    assert.equal(expected.cases.reduce((total, item) => total + item.trace.length, 0), 67);
    assert.deepEqual(plain(results), expected.cases);
});
dom.window.close();
