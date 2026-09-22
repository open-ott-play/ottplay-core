'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),zlib=require('node:zlib');
const {JSDOM}=require('jsdom');
const {fixture,invoke}=require('./epg-fixture.cjs');
const browserContracts=require('./fixtures/xmltv-fields/browser-before-core.json');
const nodeContracts=require('./fixtures/xmltv-fields/node-before-core.json');
const plain=value=>JSON.parse(JSON.stringify(value));
function observeBrowser(input,withoutTextContent=false,denyUnusedText=false){
    const modules={},browser=new JSDOM(''),context=vm.createContext({window:{OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}}});
    let extracted=null;
    try{
        vm.runInContext('Promise = undefined; fetch = undefined; URL = undefined; Map = undefined; Set = undefined; Number.isFinite = undefined; Object.assign = undefined;',context);
        require('./load-core.cjs')(context);
        const core=context.window.OttPlayCore,parse=core.parseBrowserGuide;
        core.parseBrowserGuide=function(...args){const[stations,programmes,fields,source,identity]=args;extracted=plain({stations,programmes,fields,source,identity});return parse.apply(this,args);};
        for(const file of ['providers','epg'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+file+'.js'),'utf8'),context);
        const Parser=withoutTextContent||denyUnusedText?function(){this.parseFromString=function(...args){
            const doc=new browser.window.DOMParser().parseFromString(...args);
            if(withoutTextContent)for(const node of doc.getElementsByTagName('*'))Object.defineProperty(node,'textContent',{value:undefined});
            if(denyUnusedText)for(const node of doc.querySelectorAll('[data-unread]'))Object.defineProperty(node,'textContent',{get(){throw Error('Unused XML field text was read');}});
            return doc;
        };}:browser.window.DOMParser;
        try{
            const guide=modules.epg.parseXML(input.xml,Parser,input.sourceUrl);
            return {extracted,guide:plain(guide),nullPrototypeFields:['byId','byChannel','byName','byAlias'].filter(key=>Object.getPrototypeOf(guide[key])===null)};
        }catch(error){return {extracted,error:{name:error.name,code:error.code||null,message:error.message}};}
    }finally{browser.window.close();}
}
test('DOM XMLTV field interpretation preserves 30 captured raw inputs and public guides',()=>{
    assert.equal(browserContracts.cases.length,30);
    for(const input of browserContracts.cases)assert.deepEqual(observeBrowser(input),input.expected,input.name);
});
test('legacy DOM without textContent preserves nested text and CDATA field extraction',()=>{
    for(const index of [2,5,6,17,23]){const input=browserContracts.cases[index];assert.deepEqual(observeBrowser(input,true),input.expected,input.name);}
});
test('DOM adapter never reads large ignored metadata or already-owned fields',()=>{
    const ignored='x'.repeat(200000);
    const input={sourceUrl:'https://guide.example/xmltv.xml',xml:'<tv><channel id="a"><display-name>News</display-name><unknown data-unread="1">'+ignored+'</unknown></channel><programme channel="a" start="20260914110000 +0000" stop="20260914130000 +0000"><title>First</title><title data-unread="1">'+ignored+'</title><desc/><desc data-unread="1">'+ignored+'</desc><catchup-id/><catchup-id data-unread="1">'+ignored+'</catchup-id><unknown data-unread="1">'+ignored+'</unknown></programme></tv>'};
    const expected=observeBrowser(input);
    assert.equal(expected.guide.programmes[0].title,'First');
    assert.equal(expected.extracted.programmes[0].description,'');
    assert.deepEqual(observeBrowser(input,false,true),expected);
});
test('Node streaming XMLTV field interpretation preserves 30 captured HTTP responses',async()=>{
    assert.equal(nodeContracts.cases.length,30);
    for(const row of nodeContracts.cases){
        let bytes=Buffer.from(row.input.xml);
        if(row.input.transfer==='gzip-byte')bytes=zlib.gzipSync(bytes);
        const route=row.input.transfer==='whole'?{body:bytes}:{chunks:Array.from(bytes,byte=>Buffer.from([byte]))};
        const f=fixture({...row.input.options,now:()=>nodeContracts.provenance.clock},route);
        const result=await invoke(f.epg,{channels:row.input.channels}).result;
        assert.deepEqual({status:result.status,headers:result.headers,body:result.body,upstream:f.calls.map(call=>({url:call.url,destroyed:call.req.destroyed,method:call.configuration.method,rejectUnauthorized:call.configuration.rejectUnauthorized}))},row.expected,row.name);
    }
});
