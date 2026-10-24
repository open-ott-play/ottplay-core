/* Synthetic, deterministic 10k-item comparison; not a device/playback benchmark. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const modules = {}, context = vm.createContext({OTT2:{define(name,factory){modules[name]=factory();}}});
require('../tests/load-core.cjs')(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/library.js'),'utf8'),context);
const rows = Array.from({length:10000},(_,i)=>({id:'c'+i,name:'Channel '+i,kind:'live',group:'News'}));
const guide={}, now=100, rounds=100;
let lookups=0;
function lookup() { lookups++;return {entries:[{start:0,end:200}],current:{start:0,end:200}}; }
let start=performance.now();
const decorated = modules.library.decorate(rows,{},false);
for(let page=0;page<rounds;page++) { decorated.forEach(lookup); decorated.filter(c=>c.kind==='live' && c.group==='News').slice(page*12,page*12+12); }
const baseline={ms:performance.now()-start,epgLookups:lookups};
lookups=0; start=performance.now();
const index=modules.library.createIndex(), snapshot=modules.library.createGuideSnapshot(lookup);
index.update(rows,{},1);
for(let page=0;page<rounds;page++) { snapshot(index.all(false),guide,now);index.select('tv','News','',[]).slice(page*12,page*12+12); }
console.log(JSON.stringify({scenario:'10,000 channels, 100 pages, unchanged catalog/EPG',baseline, indexed:{ms:performance.now()-start,epgLookups:lookups},note:'Includes cold index build; synthetic timings only, not player startup speed.'},null,2));
