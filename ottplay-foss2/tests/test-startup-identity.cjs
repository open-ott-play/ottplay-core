const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const modules = {};
const context = vm.createContext({OTT2:{define(name, factory) { modules[name] = factory(id => modules[id]); }}});
context.window = context;
vm.runInContext("Promise=undefined; fetch=undefined; URL=undefined; Map=undefined; Set=undefined; Object.assign=undefined;", context);
require("./load-core.cjs")(context);
for (const name of ["library", "providers"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/" + name + ".js"), "utf8"), context);
const library = modules.library, providers = modules.providers;
const source = {id:"source", type:"m3u", url:"https://provider.test/list.m3u"};
const plain = value => JSON.parse(JSON.stringify(value));
function playlist(rows, token, selectedSource = source) {
    return providers.parseM3U("#EXTM3U\n" + rows.map(row => '#EXTINF:-1' + (row.tvgId ? ' tvg-id="' + row.tvgId + '"' : "") + (row.tvgName ? ' tvg-name="' + row.tvgName + '"' : "") + ' group-title="' + (row.group || "News") + '",' + row.name + '\nhttps://video.test/' + row.path + '?token=' + token).join("\n"), selectedSource).channels;
}

test("a token rotation restores a nameless-ID M3U channel using fresh source metadata", () => {
    const rows = [{name:"Other",path:"other"},{name:"News HD",path:"news"}];
    const before = playlist(rows,"old"), after = playlist(rows,"fresh");
    assert.notEqual(before[1].id, after[1].id);
    const reference = library.channelReference(before[1], source.id);
    assert.equal(library.restoreChannel(after, reference), after[1]);
    assert.equal(library.restoreChannel(after, {sourceId:source.id,id:before[1].id,name:"News HD"}), after[1], "Legacy references may be enriched by matching history");
    assert.equal(library.restoreChannel(after, {sourceId:source.id,id:before[1].id}), null, "No name or stable ID cannot be guessed");
    assert(!JSON.stringify(reference).includes("token"));
    assert(after[1].url.endsWith("token=fresh"));
});

test("duplicate TVG variants keep their quality when stream URLs rotate", () => {
    const rows = [{name:"Sport SD",path:"sd",tvgId:"sport",tvgName:"Sport"},{name:"Sport HD",path:"hd",tvgId:"sport",tvgName:"Sport"}];
    const before = playlist(rows,"old"), after = playlist(rows,"fresh");
    assert.notEqual(before[1].id, after[1].id);
    assert.equal(library.restoreChannel(after, library.channelReference(before[1],source.id)), after[1]);
    assert.equal(library.restoreChannel(after, {sourceId:source.id,id:before[1].id,name:before[1].name}), after[1], "The old variant ID supplies TVG identity");
    assert.equal(library.restoreChannel(after, {sourceId:source.id,id:before[1].id}), null, "TVG identity alone cannot choose a quality");
});

test("equivalent M3U broadcast copies restore a legacy HD channel after query rotation", () => {
    const rows = [
        {name:"РЕН ТВ HD",path:"hd-primary",tvgId:"hlsproxy-382",tvgName:"РЕН ТВ",group:"HD"},
        {name:"РЕН ТВ UHD",path:"uhd",tvgId:"hlsproxy-382",tvgName:"РЕН ТВ",group:"Новости"},
        {name:"РЕН ТВ",path:"sd",tvgId:"hlsproxy-382",tvgName:"РЕН ТВ",group:"Другие"},
        {name:"РЕН ТВ HD",path:"hd-secondary",tvgId:"hlsproxy-382",tvgName:"РЕН ТВ",group:"HD"}
    ];
    const before = playlist(rows,"old"), after = playlist(rows,"fresh");
    const legacy = {sourceId:source.id,id:before[3].id,name:before[3].name};
    assert.notEqual(before[3].id,after[3].id,"Rotating query values change the selected URL-derived variant ID");
    assert.equal(library.restoreChannel(after,legacy),after[0],"The first equivalent HD copy restores the broadcast rather than rejecting both copies");
    const reversed = after.slice().reverse();
    assert.equal(library.restoreChannel(reversed,legacy),after[3],"Reordering equivalent copies never selects SD or UHD");
    const upgraded = library.channelReference(after[0],source.id), next = playlist(rows,"newest").reverse();
    assert.equal(library.restoreChannel(next,upgraded),next[0],"The upgraded metadata survives another rotation and reversed provider order");
    assert.equal(library.restoreChannel(after,{sourceId:source.id,id:before[3].id}),null,"A shared TVG ID without the saved broadcast name remains ambiguous");
    assert.equal(library.restoreChannel(after,{...legacy,id:"source:xtream:live:382",tvgId:"hlsproxy-382"}),null,"Equivalent-copy fallback is restricted to recognized M3U references");
    assert.equal(Object.hasOwn(upgraded,"url"),false);
});

test("M3U duplicate fallback rejects any differing broadcast or playback metadata", () => {
    const rows = [
        {name:"News HD",path:"primary",tvgId:"news",tvgName:"News",group:"HD"},
        {name:"News HD",path:"secondary",tvgId:"news",tvgName:"News",group:"HD"}
    ];
    const before = playlist(rows,"old"), available = playlist(rows,"fresh");
    const reference = {sourceId:source.id,id:before[1].id,name:"News HD"};
    const differences = [
        {group:"Regional"}, {tvgName:"Regional News"}, {logo:"https://image.test/other.png"},
        {tvgShift:1}, {adult:true}, {catchup:{type:"shift",days:7}},
        {headers:{"X-Channel":"other"}}, {engine:"native"}, {futurePlaybackFlag:true}
    ];
    for (const difference of differences) {
        const changed = [available[0],{...available[1],...difference}];
        assert.equal(library.restoreChannel(changed,reference),null,"Different " + Object.keys(difference)[0] + " metadata is not an equivalent broadcast copy");
    }
    const sameKeys = available.map(item => ({...item,catchup:{type:"shift",days:7}}));
    sameKeys[1].catchup.days = 3;
    assert.equal(library.restoreChannel(sameKeys,reference),null,"Nested playback values are compared, not just the top-level keys");
    const noTvg = playlist(rows.map(row=>({...row,tvgId:""})),"fresh");
    assert.equal(library.restoreChannel(noTvg,reference),null,"Matching names without the saved TVG ID cannot become equivalent copies");
    const remaining = playlist(rows.map(row=>({...row,name:"News UHD"})),"fresh");
    assert.equal(library.restoreChannel(remaining,reference),null,"Identical copies of another quality do not replace the saved broadcast");
});

test("TVG uniqueness changes and proxy ID renumbering retain the selected station", () => {
    const hd = {name:"Sport HD",path:"hd",tvgId:"sport"}, sd = {name:"Sport SD",path:"sd",tvgId:"sport"};
    const unique = playlist([hd],"old"), duplicate = playlist([sd,hd],"fresh");
    assert.notEqual(unique[0].id,duplicate[1].id);
    assert.equal(library.restoreChannel(duplicate,library.channelReference(unique[0],source.id)),duplicate[1]);
    assert.equal(library.restoreChannel(unique,library.channelReference(duplicate[1],source.id)),unique[0]);
    const renumbered = playlist([{...hd,tvgId:"proxy-900"}],"newest");
    assert.equal(library.restoreChannel(renumbered,library.channelReference(unique[0],source.id)),renumbered[0]);
});

test("a removed TVG variant cannot restore a different quality through its shared ID or group", () => {
    const hd = {name:"Sport HD",path:"hd",tvgId:"sport",tvgName:"Sport"};
    const sd = {name:"Sport SD",path:"sd",tvgId:"sport",tvgName:"Sport"};
    const before = playlist([sd,hd],"old"), remaining = playlist([sd],"fresh");
    const reference = library.channelReference(before[1],source.id);
    assert.equal(library.restoreChannel(remaining,reference),null,"A shared TVG name does not override the missing HD name");
    assert.equal(library.restoreChannel(remaining,{sourceId:source.id,id:before[1].id}),null,"A sole TVG match cannot identify an old unnamed variant");
    assert.equal(library.restoreChannel(remaining,{sourceId:source.id,id:before[1].id,name:"Sport HD",group:"News"}),null,"Legacy history also retains the original variant");
    const otherVariants = playlist([sd,{name:"Sport West",path:"west",tvgId:"sport",group:"Regional"}],"fresh");
    assert.equal(library.restoreChannel(otherVariants,reference),null,"A unique group match does not replace a missing name");
    const sameVariant = playlist([hd],"fresh");
    assert.equal(library.restoreChannel(sameVariant,reference),sameVariant[0]);
    const renumberedSD = playlist([{...sd,tvgId:"proxy-900"}],"fresh");
    assert.equal(library.restoreChannel(renumberedSD,reference),null,"Renumbering cannot replace the raw HD name with a shared TVG name");
    const renumberedHD = playlist([{...hd,tvgId:"proxy-900"}],"fresh");
    assert.equal(library.restoreChannel(renumberedHD,reference),renumberedHD[0]);
    const uniqueBefore = playlist([hd],"old"), renamed = playlist([{...hd,name:"Sport UHD"}],"fresh");
    assert.equal(library.restoreChannel(renamed,library.channelReference(uniqueBefore[0],source.id)),renamed[0],"An originally unique stable TVG ID can survive renaming");
});

test("duplicate exact identities and ambiguous names never select an arbitrary row", () => {
    const available = playlist([{name:"News",path:"east"},{name:"News",path:"west"}],"fresh");
    const reference = {sourceId:source.id,id:"old",name:"News",group:"News"};
    assert.equal(library.restoreChannel(available,reference),null);
    assert.equal(library.restoreChannel([available[0],{...available[0]}],{sourceId:source.id,id:available[0].id}),null);
    const regions = available.map((item,index)=>({...item,group:index ? "West" : "East"}));
    assert.equal(library.restoreChannel(regions,{...reference,group:"West"}),regions[1]);
    assert.equal(library.restoreChannel(available,{...reference,name:"News HD"}),null,"Quality and region suffixes are not removed");
});

test("stable TVG IDs remain case-sensitive and ambiguous TVG matches cannot fall through", () => {
    const items = [{id:"a",sourceId:source.id,kind:"live",tvgId:"NEWS",name:"News"},{id:"b",sourceId:source.id,kind:"live",tvgId:"NEWS",name:"News"},{id:"c",sourceId:source.id,kind:"live",tvgId:"Other",name:"Other"}];
    assert.equal(library.restoreChannel(items,{sourceId:source.id,id:"old",tvgId:"news"}),null);
    assert.equal(library.restoreChannel(items,{sourceId:source.id,id:"old",tvgId:"NEWS",name:"Other"}),null);
    assert.equal(library.restoreChannel(items,{sourceId:source.id,id:"old",tvgId:"Other"}),items[2]);
});

test("provider names and groups are retained independently of display overrides", () => {
    const before = playlist([{name:"Provider News HD",path:"news"}],"old");
    const decorated = library.decorate(before,{[before[0].id]:{name:"My favorite",group:"Custom"}},true);
    assert.equal(decorated[0].name,"My favorite");
    const reference = library.channelReference(before[0],source.id);
    assert.deepEqual(plain(reference),{sourceId:source.id,id:before[0].id,name:"Provider News HD",group:"News"});
    const after = playlist([{name:" provider   NEWS HD ",path:"news"}],"fresh");
    assert.equal(library.restoreChannel(after,reference),after[0]);
    assert.equal(before[0].name,"Provider News HD");
});

test("reference creation bounds metadata and excludes resolved stream or EPG fields", () => {
    const reference = library.channelReference({id:"id",sourceId:"wrong",name:" x ",tvgId:42,tvgName:"n".repeat(600),group:false,url:"https://secret.test/token",programme:{title:"Secret"}},source.id);
    assert.deepEqual(Object.keys(reference).sort(),["id","name","sourceId","tvgName"]);
    assert.equal(reference.sourceId,source.id); assert.equal(reference.name,"x"); assert.equal(reference.tvgName.length,512);
});

test("restoration only accepts live rows in the remembered source", () => {
    const rows = [{id:"old",sourceId:"other",kind:"live",name:"News"},{id:"vod",sourceId:source.id,kind:"vod",name:"News"},{id:"folder",sourceId:source.id,kind:"folder",name:"News"}];
    assert.equal(library.restoreChannel(rows,{sourceId:source.id,id:"old",name:"News"}),null);
    rows.push({id:"fresh",kind:"live",name:"News"});
    assert.equal(library.restoreChannel(rows,{sourceId:source.id,id:"old",name:"News"}),rows[3],"An omitted row source belongs to the passed source catalog");
    assert.equal(library.restoreChannel(rows,null),null);
});

test("legacy M3U IDs decode escaped source and TVG IDs without malformed-ID guesses", () => {
    const selectedSource = {...source,id:"my:source"};
    const rows = [{name:"News HD",path:"hd",tvgId:"station:1/тест"},{name:"News SD",path:"sd",tvgId:"station:1/тест"}];
    const before = playlist(rows,"old",selectedSource), after = playlist(rows,"fresh",selectedSource);
    assert.equal(library.restoreChannel(after,{sourceId:selectedSource.id,id:before[0].id,name:"News HD"}),after[0]);
    const unique = playlist(rows.slice(0,1),"fresh",selectedSource);
    assert.equal(library.restoreChannel(unique,{sourceId:selectedSource.id,id:before[0].id}),null,"A legacy variant hash alone cannot identify the remaining quality");
    assert.equal(library.restoreChannel(unique,{sourceId:selectedSource.id,id:before[0].id,name:"News HD"}),unique[0]);
    for (const id of ["my%3Asource:m3u:tvg:%broken","my%3Asource:m3u:tvg:station:bad-suffix","other:m3u:tvg:station%3A1%2F%D1%82%D0%B5%D1%81%D1%82"]) {
        assert.equal(library.restoreChannel(unique,{sourceId:selectedSource.id,id}),null);
    }
});
