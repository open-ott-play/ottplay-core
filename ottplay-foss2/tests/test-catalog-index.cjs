const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function library() {
    const modules = {}, context = vm.createContext({OTT2:{define(name, factory){modules[name] = factory();}}});
    require('./load-core.cjs')(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/library.js'), 'utf8'), context);
    return modules.library;
}
const rows = Array.from({length:10000}, (_, i) => ({id:'c'+i, name:'Channel '+i, kind:i%3 ? 'live':'vod', group:'Group '+i%10}));
test('10k catalog reuses filtered selections across visible pages and invalidates edits, hidden rows and replacement', () => {
    const lib = library(), index = lib.createIndex();
    index.update(rows, {}, 1);
    const selected = index.select('tv', 'Group 2', '', []);
    assert.equal(selected.length, 667);
    assert.strictEqual(index.select('tv', 'Group 2', '', []), selected);
    assert.equal(selected.slice(12,24).length,12);
    assert.equal(index.get('c2').name,'Channel 2');
    index.update(rows, {c2:{name:'Renamed', group:'New', hidden:true}}, 2);
    assert.equal(index.get('c2').name,'Renamed');
    assert.equal(index.select('tv', 'Group 2', '', []).length,666);
    assert.equal(index.select('tv', 'New', 'renamed', []).length,0);
    index.update(rows.slice(0,10), {}, 3);
    assert.equal(index.get('c9999'),null);
    assert.deepEqual(Array.from(index.select('favorites','','',['c8','c2']), x=>x.id), ['c8','c2']);
});
test('EPG reuses 10k channel snapshot and refreshes only channels crossing programme boundaries', () => {
    const lib = library(); let calls=0;
    const lookup=(row, now)=>{ calls++; const end=row.id==='c2'?120:200; return {entries:[{start:100,end}], current:now<end?{title:row.name,start:100,end}:null}; };
    const get=lib.createGuideSnapshot(lookup), guide={version:1};
    const first=get(rows,guide,110); assert.equal(calls,10000); assert.equal(first.current,10000);
    assert.strictEqual(get(rows,guide,119), first); assert.equal(calls,10000);
    assert.equal(get(rows,guide,120).current,9999); assert.equal(calls,10001);
    guide.version++; get(rows,guide,121); assert.equal(calls,20001);
    get(rows,guide,109); assert.equal(calls,30001,'backward clock change invalidates results');
    get(rows,{},110); assert.equal(calls,40001,'new guide invalidates results');
});
test('EPG catalog edit refreshes matching/logo identity without touching other channels',()=>{
    const lib=library(); let calls=0;
    const get=lib.createGuideSnapshot(row=>{calls++;return {entries:[],metadata:{logo:row.name}};});
    const guide={}; get(rows,guide,100);
    const changed=rows.slice();changed[2]={...changed[2],name:'Changed'};
    assert.equal(get(changed,guide,101).logos.c2,'Changed'); assert.equal(calls,10001);
});
