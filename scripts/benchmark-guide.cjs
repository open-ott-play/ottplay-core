"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{performance}=require('node:perf_hooks'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),client=path.resolve(root,'ottplay-foss2');
const {JSDOM}=createRequire(path.join(client,'package.json'))('jsdom');
const browser=new JSDOM(''),modules={};
const context=vm.createContext({window:{OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}}});
require(path.join(client,'tests/load-core.cjs'))(context);
for(const name of ['providers','epg'])vm.runInContext(fs.readFileSync(path.join(client,'src',name+'.js'),'utf8'),context);
const samples=[];
for(const count of [1000,10000,50000]) {
    const channels=Math.ceil(count/20),xml=['<tv>'];
    for(let id=0;id<channels;id++) {
        xml.push('<channel id="'+id+'"><display-name>Channel '+id+'</display-name></channel>');
        for(let index=0;index<20 && id*20+index<count;index++) {
            const start='20260101'+String(index).padStart(2,'0')+'0000',end='20260101'+String(index+1).padStart(2,'0')+'0000';
            xml.push('<programme channel="'+id+'" start="'+start+'" stop="'+end+'"><title>Show '+index+'</title></programme>');
        }
    }
    xml.push('</tv>');const text=xml.join('');
    let start=performance.now();
    const guide=modules.epg.parseXML(text,browser.window.DOMParser,'https://synthetic.invalid/guide.xml');
    const parseMs=Math.round(performance.now()-start);
    start=performance.now();const merged=modules.epg.mergeGuides([guide,guide]);const mergeMs=Math.round(performance.now()-start);
    assert.equal(merged.programmes.length,count);assert.equal(merged.channels.length,channels);
    const cache=modules.epg.createLookup({limit:1024});start=performance.now();
    for(let round=0;round<2;round++)for(let id=0;id<channels;id++)assert(cache.lookup({tvgId:String(id),tvgShift:1},merged,1767232800+round).current);
    samples.push({programmes:count,channels,xml_bytes:Buffer.byteLength(text),parse_ms:parseMs,merge_ms:mergeMs,lookup_two_scans_ms:Math.round(performance.now()-start)});
}
const manifest=JSON.parse(fs.readFileSync(path.join(client,'vendor/ottplay-core.manifest.json'))),bundle=fs.readFileSync(path.join(client,'vendor/ottplay-core.js'));
console.log(JSON.stringify({host:process.platform+' '+process.arch,engine:process.version,physical_device:false,source_sha256:manifest.source.sha256,
    js_bytes:bundle.length,gzip_bytes:zlib.gzipSync(bundle).length,samples},null,2));
