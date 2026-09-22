"use strict";
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {JSDOM}=require('jsdom');
const browser=new JSDOM('');
exports.run=function(input, sourceFile=path.join(__dirname,'../src/epg.js')) {
    const modules={},context=vm.createContext({window:{OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}}});
    require('./load-core.cjs')(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/providers.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(sourceFile,'utf8'),context);
    const epg=modules.epg, feeds=input.feeds.map(feed=>epg.parseXML(feed.xml,browser.window.DOMParser,feed.url));
    const guide=input.merge ? epg.mergeGuides(input.merge.map(index=>index===null?null:feeds[index])) : feeds[0];
    const queries=(input.queries||[]).map(channel=>({metadata:epg.matchMetadata(channel,guide),entries:epg.matchChannel(channel,guide)}));
    const lookup=epg.createLookup(input.cache||{});
    const cached=(input.lookups||[]).map(row=>lookup.lookup(row.channel,guide,row.now));
    return JSON.parse(JSON.stringify({guide,queries,cached}));
};
