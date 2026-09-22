const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modules = {};
const context = vm.createContext({OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}});
vm.runInContext('Promise=undefined; fetch=undefined; URL=undefined; Map=undefined; Set=undefined; Object.assign=undefined;',context);
for(const name of ['security','state','library'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+name+'.js'),'utf8'),context);
const library=modules.library, state=modules.state, plain=value=>JSON.parse(JSON.stringify(value));
function storage(){let value='';return {getItem(){return value;},setItem(key,next){value=next;}};}
const channels=[{id:'s1:1',name:'One',group:'News'},{id:'s1:2',name:'Two',group:'Movies'},{id:'s2:1',name:'Other source',group:'News'}];

test('channel edits survive persistence, sorting/hiding preserve source objects and IDs',()=>{
    const disk=storage(),repo=state.create(disk), before=JSON.stringify(channels);
    repo.update(draft=>{
        library.edit(draft,'s1:1',{name:'First',group:'Custom',hidden:true,order:10});
        library.edit(draft,'s1:2',{name:'Second',group:'',order:0});
    });
    const persisted=state.create(disk).snapshot();
    const visible=library.decorate(channels,persisted.channelOverrides,false);
    assert.deepEqual(plain(visible.map(c=>c.id)),['s1:2','s2:1']);
    assert.equal(visible[0].name,'Second');assert.equal(visible[0].group,'');
    const all=library.decorate(channels,persisted.channelOverrides,true);
    assert.equal(all[2].name,'First');assert.equal(all[2].group,'Custom');assert.equal(all[2].hidden,true);
    assert.equal(JSON.stringify(channels),before);
    assert.equal(all[1].name,'Other source','shared outside ID text cannot cross source boundaries');
});

test('favorite ordering affects only active list and bounds do not drop entries',()=>{
    const disk=storage(),repo=state.create(disk);
    repo.update(draft=>{draft.favorites.default=['s1:1'];draft.favorites.Cinema=['s1:2','s2:1','s1:1'];draft.activeFavorites='Cinema';});
    repo.update(draft=>{library.moveFavorite(draft,'s2:1',-1);library.moveFavorite(draft,'s2:1',-1);library.moveFavorite(draft,'missing',1);library.moveFavorite(draft,'s1:1',1);});
    const saved=state.create(disk).snapshot();
    assert.deepEqual(plain(saved.favorites.Cinema),['s2:1','s1:2','s1:1']);assert.deepEqual(plain(saved.favorites.default),['s1:1']);
});

test('rename/remove favorites preserve default sentinel and rollback conflicting rename',()=>{
    const disk=storage(),repo=state.create(disk);
    repo.update(draft=>{draft.favorites.default=['s1:1'];draft.favorites.Existing=['s1:2'];library.renameList(draft,'default','Family');});
    let value=repo.snapshot();assert.equal(value.activeFavorites,'Family');assert.deepEqual(plain(value.favorites.Family),['s1:1']);assert.deepEqual(plain(value.favorites.default),[]);
    assert.throws(()=>repo.update(draft=>library.renameList(draft,'Family','Existing')));
    assert.deepEqual(plain(repo.snapshot()),plain(value));
    repo.update(draft=>library.removeList(draft,'Family'));value=state.create(disk).snapshot();
    assert.equal(value.activeFavorites,'default');assert.equal(value.favorites.Family,undefined);assert.deepEqual(plain(value.favorites.Existing),['s1:2']);
    for(const unsafe of ['__proto__','constructor','prototype',''])assert.throws(()=>library.name(unsafe));
});

test('reminder identity survives title changes and separate sources; toggling persists atomically',()=>{
    const disk=storage(),repo=state.create(disk),programme={start:1000,end:2000,title:'Programme'};
    repo.update(draft=>{library.toggleReminder(draft,channels[0],programme);library.toggleReminder(draft,channels[2],programme);});
    let value=state.create(disk).snapshot();assert.equal(value.reminders.length,2);assert.notEqual(value.reminders[0].id,value.reminders[1].id);
    assert.equal(value.reminders[0].id,library.reminderId('s1:1',1000));
    repo.update(draft=>library.toggleReminder(draft,channels[0],{...programme,title:'Renamed programme'}));
    value=state.create(disk).snapshot();assert.equal(value.reminders.length,1);assert.equal(value.reminders[0].channelId,'s2:1');
    repo.update(draft=>library.toggleReminder(draft,channels[0],programme));assert.equal(repo.snapshot().reminders.length,2);
});

test('reminder cap removes oldest entries without changing the newest identity',()=>{
    const value=state.defaults();
    for(let i=0;i<505;i++)library.toggleReminder(value,channels[0],{start:i*60,end:i*60+59,title:'Program '+i});
    const saved=state.validate(value);assert.equal(saved.reminders.length,500);assert.equal(saved.reminders[0].start,5*60);assert.equal(saved.reminders[499].start,504*60);
});

test('long provider identities retain edits, reminders and bookmarks through validation',()=>{
    const disk=storage(),repo=state.create(disk), id='source:m3u:tvg:'+encodeURIComponent('Канал '.repeat(40));
    assert(id.length>160 && id.length<4096);
    repo.update(draft=>{library.edit(draft,id,{name:'Custom name',group:'My group',order:10});draft.bookmarks[id]=120;library.toggleReminder(draft,{id},{title:'Future',start:100,end:200});});
    const value=state.create(disk).snapshot();assert.equal(value.channelOverrides[id].name,'Custom name');assert.equal(value.bookmarks[id],120);assert.equal(value.reminders[0].channelId,id);
});
