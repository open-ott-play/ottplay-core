'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const acorn = require('acorn');
const modules = {};
const context = vm.createContext({ OTT2: { define(name, factory) { modules[name] = factory(id => modules[id]); } } });
for (const name of ['security', 'library', 'state', 'playback-preferences']) {
    const code = fs.readFileSync(path.join(__dirname, '../src/' + name + '.js'), 'utf8');
    acorn.parse(code, { ecmaVersion: 5 }); vm.runInContext(code, context);
}
const preferences = modules['playback-preferences'];
function fixture() {
    let state = modules.state.defaults(), current;
    state.sources = [{ id: 'source', name: 'Fixture', type: 'm3u', url: 'https://fixture.invalid/list', text: '' }];
    state.activeSourceId = 'source';
    const choices = [], media = { backend: 'native', session: 1, audio: [], subtitles: [], subtitlesOff: false,
        getState() { return { channel: current, ready: true, backend: this.backend, session: this.session }; },
        listTracks() { return { audio: this.audio, subtitles: this.subtitles, subtitlesOff: this.subtitlesOff }; },
        selectAudio(id) { choices.push(['audio', id]); this.audio.forEach(track => { track.selected=track.id===id; }); controller.restore(this.getState(), 'tracks'); return true; },
        selectSubtitle(id) { choices.push(['subtitle', id]); this.subtitlesOff=id==='off'; this.subtitles.forEach(track => { track.selected=track.id===id; }); controller.restore(this.getState(), 'tracks'); return true; },
        setAspect() { return true; }, setZoom() { return true; }
    };
    const controller = preferences.create({ media, state: () => state, persist(change) { change(state); state = modules.state.validate(state); } });
    return { controller, media, choices, get state() { return state; },
        begin(channel, items = [channel]) { current = channel; controller.begin(channel, modules.library.channelReference(channel, 'source'), items); },
        restore() { controller.restore(media.getState(), 'tracks'); },
        resetAttempts() { controller.restore(media.getState(), 'loading'); }
    };
}
test('Track matching prioritizes language and label, refuses ambiguity and guards engine-specific numeric IDs', () => {
    const tracks = [{id:'0',language:'ru',label:'Russian commentary'}, {id:'1',language:'eng',label:'English'}, {id:'2',language:'rus',label:'Russian original'}];
    assert.equal(preferences.matchTrack(tracks, {language:'ru',label:'Russian original'}, 'native').id, '2');
    assert.equal(preferences.matchTrack(tracks, {language:'en',label:'Old English label'}, 'native').id, '1');
    assert.equal(preferences.matchTrack(tracks, {language:'ru'}, 'native'), null);
    assert.equal(preferences.matchTrack(tracks, {language:'de',label:'English',id:'1',backend:'native'}, 'native'), null);
    assert.equal(preferences.matchTrack(tracks, {id:'1',backend:'native'}, 'hls.js'), null);
    assert.equal(preferences.matchTrack(tracks, {id:'1',backend:'native'}, 'native').id, '1');
});
test('Rotating channel URLs restore choices only through unambiguous source-bound broadcast identity', () => {
    const f = fixture(), first = {id:'source:old',sourceId:'source',kind:'live',name:'Station HD',tvgId:'station',group:'News'};
    f.media.audio = [{id:'1',language:'ru',label:'Russian',selected:false}];
    f.begin(first); f.controller.select('audio','1');
    const next = Object.assign({},first,{id:'source:new',url:'https://fixture.invalid/token-rotated'});
    f.media.backend = 'hls.js'; f.media.audio = [{id:'0',language:'en',label:'English',selected:true},{id:'2',language:'ru',label:'Russian',selected:false}];
    f.begin(next); f.restore();
    assert.deepEqual(f.choices.at(-1), ['audio','2']);
    const count = f.choices.length; f.restore(); assert.equal(f.choices.length,count,'Synchronous track events cannot recurse or repeatedly reselect');
    f.controller.select('audio','2'); assert.equal(f.state.playbackPreferences.length,1,'Saving a refreshed ID replaces its former preference record');
    assert.equal(f.state.playbackPreferences[0].reference.id,'source:new');
    f.begin({id:'source:unrelated',sourceId:'source',kind:'live',name:'Unrelated',tvgId:'other'}); f.restore();
    assert.equal(f.choices.length,count+1,'Other channels do not inherit choices');
});
test('Late track lists, explicit subtitles-off and backend reloads restore without stealing user selections', () => {
    const f = fixture(), channel = {id:'source:one',sourceId:'source',kind:'live',name:'One'};
    f.begin(channel); f.media.audio=[{id:'0',language:'ru',label:'Russian'}];
    f.controller.select('audio','0'); f.controller.select('subtitle','off');
    f.begin(channel); f.media.audio=[]; f.media.subtitles=[{id:'0',language:'en',label:'English',selected:true}]; f.restore();
    assert.deepEqual(f.choices.at(-1),['subtitle','off']);
    f.media.audio=[{id:'4',language:'ru',label:'Russian'}]; f.restore();
    assert.deepEqual(f.choices.at(-1),['audio','4']);
    f.media.audio[0].selected=false; f.resetAttempts(); f.restore(); assert.deepEqual(f.choices.at(-1),['audio','4']);
    assert.equal(f.media.subtitlesOff,true);
    const count=f.choices.length; f.controller.reset(); f.restore(); assert.equal(f.choices.length,count,'Stopped sessions ignore late track callbacks');
});

test('Saved subtitle Off applies when delayed tracks arrive and remains off after another default track appears', () => {
    const f=fixture(), channel={id:'source:one',sourceId:'source',kind:'live',name:'One'};
    f.begin(channel); f.controller.select('subtitle','off'); f.begin(channel);
    f.media.subtitlesOff=true; f.restore(); const count=f.choices.length;
    f.media.subtitles=[{id:'1',language:'en',label:'English',selected:true}]; f.media.subtitlesOff=false; f.restore();
    assert.equal(f.choices.length,count+1); assert.deepEqual(f.choices.at(-1),['subtitle','off']);
    f.media.subtitlesOff=true; f.restore(); assert.equal(f.choices.length,count+1);
    f.media.subtitles.push({id:'2',language:'ru',label:'Russian',selected:true}); f.media.subtitlesOff=false; f.restore();
    assert.equal(f.choices.length,count+2);
});
test('Paused same-engine reload restores choices for the replacement media session', () => {
    const f=fixture(), channel={id:'source:one',sourceId:'source',kind:'live',name:'One'};
    f.begin(channel); f.media.audio=[{id:'1',language:'ru',label:'Russian'}]; f.controller.select('audio','1');
    const count=f.choices.length;
    f.media.audio=[{id:'0',language:'en',label:'English',selected:true},{id:'3',language:'ru',label:'Russian'}];
    f.media.session++; f.controller.restore(f.media.getState(),'paused'); f.restore();
    assert.equal(f.choices.length,count+1); assert.deepEqual(f.choices.at(-1),['audio','3']);
});
