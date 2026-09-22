const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modules = {};
const context = vm.createContext({OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}});
context.window=context;
vm.runInContext('Promise=undefined; fetch=undefined; URL=undefined; Map=undefined; Set=undefined; Object.assign=undefined;', context);
require("./load-core.cjs")(context);
for (const name of ['security','state','providers','library','channel-identity']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+name+'.js'),'utf8'),context);
const identity=modules['channel-identity'], library=modules.library, state=modules.state, plain=value=>JSON.parse(JSON.stringify(value));
const source={id:'source',name:'Source',type:'m3u',url:'https://fixture.invalid/list'};
function playlist(rows, owner=source) { return modules.providers.parseM3U('#EXTM3U\n'+rows.map(row=>'#EXTINF:-1 tvg-id="'+(row.tvg||'news')+'" group-title="News",'+row.name+'\nhttps://stream.invalid/'+row.path+'?token='+ (row.token||'secret-old')).join('\n'),owner).channels; }
function stored(channels) {
    const saved=state.defaults(); saved.sources=[source];saved.activeSourceId=source.id;
    const hd=channels.find(ch=>ch.name==='News HD')||channels[0];
    saved.favorites.default=[hd.id];saved.favorites.Family=[hd.id];
    saved.channelOverrides[hd.id]={name:'Custom protected station',group:'My group',hidden:true,order:7};
    saved.security.protectedIds=[hd.id];
    saved.history=[{id:hd.id,name:'Custom protected station',time:100}];saved.bookmarks[hd.id]=42;
    saved.lastChannel=library.channelReference(hd,source.id);saved.previousChannel=library.channelReference(hd,source.id);
    saved.playbackPreferences=[{reference:library.channelReference(hd,source.id),audio:{language:'ru'},subtitle:{off:true},aspect:'4:3'}];
    saved.reminders=[{id:library.reminderId(hd.id,100),channelId:hd.id,title:'Programme',start:100,end:200}];
    identity.remember(saved,channels,source.id);
    return state.validate(saved);
}
function assertTransferred(saved, hd, old) {
    for(const list of Object.values(saved.favorites)) assert.deepEqual(plain(list),[hd.id]);
    assert.equal(saved.channelOverrides[hd.id].name,'Custom protected station');assert.equal(saved.channelOverrides[hd.id].hidden,true);assert.equal(saved.channelOverrides[hd.id].order,7);
    assert.deepEqual(plain(saved.security.protectedIds),[hd.id]);assert.equal(saved.history[0].id,hd.id);assert.equal(saved.bookmarks[hd.id],42);
    assert.equal(saved.lastChannel.id,hd.id);assert.equal(saved.previousChannel.id,hd.id);assert.equal(saved.playbackPreferences[0].reference.id,hd.id);assert.equal(saved.playbackPreferences[0].audio.language,'ru');
    assert.equal(saved.reminders[0].channelId,hd.id);assert.equal(saved.reminders[0].id,library.reminderId(hd.id,100));
    assert.equal(saved.channelReferences[0].id,hd.id);assert.equal(saved.channelReferences[0].name,'News HD');
    if(old!==hd.id) { assert.equal(saved.channelOverrides[old],undefined);assert.equal(saved.bookmarks[old],undefined); }
}

test('unique to variants preserves favorites, hidden rename, PIN and all dependent selections together',()=>{
    const before=playlist([{name:'News HD',path:'hd'}]), after=playlist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]);
    const saved=stored(before), report=identity.reconcile(saved,after,source.id);
    assert.equal(report.changed,true);assert.equal(report.unresolved,0);assertTransferred(state.validate(saved),after[1],before[0].id);
    const gate=modules.security.create({getState:()=>saved,persist:value=>saved.security=value});gate.configure('','1234');gate.lock();
    assert.equal(gate.authorize('playback',identity.permission(report,after[1].id,saved.security.protectedIds)).ok,false);
});

test('variants to unique and signed URL rotation retain the original quality',()=>{
    const before=playlist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]), after=playlist([{name:'News HD',path:'hd',token:'secret-rotated'}]);
    const saved=stored(before);identity.reconcile(saved,after,source.id);assertTransferred(state.validate(saved),after[0],before[1].id);
    const again=playlist([{name:'News SD',path:'sd',token:'new'},{name:'News HD',path:'hd',token:'new'}]);
    identity.reconcile(saved,again,source.id);assertTransferred(state.validate(saved),again[1],after[0].id);
});

test('same-name streams use an unchanged URL fingerprint before ambiguous name matching',()=>{
    const before=playlist([{name:'News HD',path:'hd'}]), after=playlist([{name:'News HD',path:'alternative'},{name:'News HD',path:'hd'}]);
    after[0].group='Other region';const saved=stored(before);
    identity.reconcile(saved,after,source.id);assertTransferred(saved,after[1],before[0].id);
    assert(!JSON.stringify(saved.channelReferences).includes('https://'));assert(!JSON.stringify(saved.channelReferences).includes('secret-old'));
});

test('reordered equivalent mirrors restore the same broadcast after all URLs rotate',()=>{
    const before=playlist([{name:'News SD',path:'sd'},{name:'News HD',path:'mirror-a'},{name:'News HD',path:'mirror-b'}]), saved=stored(before);
    const after=playlist([{name:'News HD',path:'mirror-b',token:'fresh'},{name:'News SD',path:'sd',token:'fresh'},{name:'News HD',path:'mirror-a',token:'fresh'}]);
    const report=identity.reconcile(saved,after,source.id);assert.equal(report.unresolved,0);assertTransferred(saved,after[0],before[1].id);
});

test('legacy shared TVG identity without raw metadata never guesses a favorite and gates every plausible variant',()=>{
    const before=playlist([{name:'News HD',path:'hd'}]), after=playlist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]);
    const saved=stored(before);saved.channelReferences=[];saved.lastChannel=null;saved.previousChannel=null;saved.playbackPreferences=[];saved.history=[];
    const report=identity.reconcile(saved,after,source.id);
    assert.equal(report.unresolved,1);assert.deepEqual(plain(saved.favorites.default),[before[0].id]);assert.equal(saved.channelOverrides[after[0].id],undefined);
    for(const row of after) assert.equal(identity.permission(report,row.id,saved.security.protectedIds),before[0].id);
    saved.security.protectedIds=[after[0].id];
    assert.equal(identity.permission(report,after[0].id,saved.security.protectedIds),after[0].id,'Removing the old protection cannot mask a new direct restriction');
});

test('missing protected variants fail closed without transferring HD selections to remaining SD',()=>{
    const before=playlist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]), after=playlist([{name:'News SD',path:'sd',token:'new'}]), saved=stored(before);
    const report=identity.reconcile(saved,after,source.id);
    assert.equal(report.unresolved,1);assert.deepEqual(plain(saved.favorites.default),[before[1].id]);assert.equal(identity.permission(report,after[0].id,saved.security.protectedIds),before[1].id);
    const absent=playlist([{name:'Unrelated',path:'other',tvg:'other'}]), missing=identity.reconcile(saved,absent,source.id);
    assert.deepEqual(plain(missing.blocked),[before[1].id]);assert.equal(identity.permission(missing,absent[0].id,saved.security.protectedIds),before[1].id);
});

test('legacy history narrows raw names but custom renamed history cannot silently select a variant',()=>{
    const before=playlist([{name:'News HD',path:'hd'}]), after=playlist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]), saved=stored(before);
    saved.channelReferences=[];saved.lastChannel=null;saved.previousChannel=null;saved.playbackPreferences=[];saved.history[0].name='News HD';
    identity.reconcile(saved,after,source.id);assert.equal(saved.favorites.default[0],after[1].id);assert.equal(saved.security.protectedIds[0],after[1].id);
    const ambiguous=stored(before);ambiguous.channelReferences=[];ambiguous.lastChannel=null;ambiguous.previousChannel=null;ambiguous.playbackPreferences=[];
    assert.equal(identity.reconcile(ambiguous,after,source.id).unresolved,1);
});

test('source-qualified references cannot leak preferences or parental decisions to another catalog',()=>{
    const before=playlist([{name:'News HD',path:'hd'}]), saved=stored(before), other={...source,id:'other'};
    saved.sources.push(other);const after=playlist([{name:'News HD',path:'hd'},{name:'News SD',path:'sd'}],other);
    const report=identity.reconcile(saved,after,other.id);
    assert.equal(report.unresolved,0);assert.equal(report.blocked.length,0);assert.equal(identity.permission(report,after[0].id,saved.security.protectedIds),after[0].id);
    assert.deepEqual(plain(saved.favorites.default),[before[0].id]);assert.equal(saved.channelReferences[0].sourceId,source.id);
});

test('VOD URL rotation retains bookmark and favorite descriptor while folders remain exact-only',()=>{
    const before=playlist([{name:'News HD',path:'film',tvg:''}]);before[0].kind='vod';const saved=stored(before);
    const after=playlist([{name:'News HD',path:'film',token:'rotated'}]);after[0].kind='vod';after[0].id+=':rotated';
    identity.reconcile(saved,after,source.id);assert.equal(saved.bookmarks[after[0].id],42);assert.equal(saved.favorites.default[0],after[0].id);
    const folder={...before[0],kind:'folder',id:'source:folder:old'}, folderSaved=stored([folder]);
    const report=identity.reconcile(folderSaved,[{...folder,id:'source:folder:new'}],source.id);assert.equal(report.unresolved,1);assert.equal(folderSaved.favorites.default[0],folder.id);
});

test('removed sources purge only their selections and ordinary exports exclude durable descriptors',()=>{
    const before=playlist([{name:'News HD',path:'hd'}]), saved=stored(before), other={...source,id:'other'};saved.sources.push(other);
    saved.favorites.default.push('other:keep');saved.channelOverrides['other:keep']={name:'Keep'};saved.security.protectedIds.push('other:keep');
    let disk=JSON.stringify(saved);const repo=state.create({getItem(){return disk;},setItem(key,value){disk=value;}});
    assert.deepEqual(JSON.parse(repo.exportJSON(false)).channelReferences,[]);assert.equal(JSON.parse(repo.exportJSON(true)).channelReferences.length,1);
    repo.update(value=>{value.sources=value.sources.filter(row=>row.id!==source.id);});const checked=repo.snapshot();
    assert.equal(checked.channelReferences.length,0);assert.deepEqual(plain(checked.favorites.default),['other:keep']);assert.deepEqual(plain(checked.security.protectedIds),['other:keep']);
    assert.equal(Object.keys(checked.bookmarks).length,0);assert.equal(checked.history.length,0);assert.equal(checked.reminders.length,0);assert.equal(checked.playbackPreferences.length,0);
    assert.equal(checked.channelOverrides['other:keep'].name,'Keep');
});

test('descriptor validation excludes URLs, invalid fingerprints, unknown sources and duplicate IDs',()=>{
    const saved=stored(playlist([{name:'News HD',path:'hd'}]));const ref=plain(saved.channelReferences[0]);
    saved.channelReferences=[{...ref,stream:'https://secret.invalid/token',url:'secret-url',token:'secret-token',kind:'arbitrary'},ref,{...ref,sourceId:'missing',id:'missing:1'}];
    const checked=state.validate(saved);assert.equal(checked.channelReferences.length,1);assert.equal(checked.channelReferences[0].stream,undefined);assert.equal(checked.channelReferences[0].kind,undefined);
    assert(!JSON.stringify(checked.channelReferences).includes('secret'));
});

test('a renumbered protected variant stays gated when its old TVG siblings still exist',()=>{
    const before=playlist([{name:'News SD',path:'sd'},{name:'News HD',path:'hd'}]), saved=stored(before);
    const after=playlist([{name:'News SD',path:'sd',token:'new'},{name:'News HD',path:'hd',tvg:'renumbered',token:'new'}]);
    const report=identity.reconcile(saved,after,source.id);
    assert.equal(report.unresolved,1);for(const row of after) assert.equal(identity.permission(report,row.id,saved.security.protectedIds),before[1].id);
});

test('namespaced descriptors reject a conflicting known source owner during validation',()=>{
    const saved=stored(playlist([{name:'News HD',path:'hd'}]));saved.sources.push({...source,id:'other'});
    saved.channelReferences.push({...saved.channelReferences[0],id:'other:m3u:tvg:news',sourceId:source.id});
    saved.lastChannel={id:'other:m3u:tvg:news',sourceId:source.id,name:'News HD'};
    const checked=state.validate(saved);assert.equal(checked.channelReferences.length,1);assert.equal(checked.lastChannel,null);
});
