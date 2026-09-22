const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const modules = {};
const sandbox = vm.createContext({window: { OTT2: {define(name, factory) { modules[name] = factory(id => modules[id]); }}}});
vm.runInContext('Promise=undefined; fetch=undefined; URL=undefined; Map=undefined; Set=undefined; Object.assign=undefined;', sandbox);
require('./load-core.cjs')(sandbox);
for (const name of ['providers', 'epg']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/' + name + '.js'), 'utf8'), sandbox);
const p = modules.providers;
const plain = v => JSON.parse(JSON.stringify(v));
const xc = {id:'xc',type:'xtream',url:'https://xc.test',username:'a/b',password:'x?&'};
const portal = {id:'portal',type:'stalker',url:'https://portal.test/stalker_portal/c/',mac:'00:1A:79:01:02:03'};
function network() {
    const pending=[];
    return {pending, request(url, callback, options) { const req={url, callback, options, cancels:0};pending.push(req);return ()=>{req.cancels++;}; }};
}
function syncCatalog(extra={}) {
    const calls=[];
    const svc = p.create({request(url, cb) {
        const action=new URL(url).searchParams.get('action'); calls.push(action);
        cb(null, action ? (extra[action] || []) : {user_info:{auth:1,status:'Active'}});
    }});
    let result;svc.load(xc,(err,value)=>{assert.equal(err,null);result=value;});
    return {svc,result,calls};
}
function loadedPortal(net, relay=()=>true) {
    const svc=p.create({request:net.request,portalTransport:relay});
    let catalog;
    svc.load(portal,(error,value)=>{assert.equal(error,null);catalog=value;});
    net.pending[0].callback(null,{js:{token:'test-token'}});
    net.pending[1].callback(null,{js:{id:12,status:0}});
    net.pending[2].callback(null,{js:[{id:'7',title:'News'}]});
    net.pending[3].callback(null,{js:{data:[{id:'42',name:'News live',tv_genre_id:'7',cmd:'ffmpeg http://localhost/ch/42_',xmltv_id:'news'}],total_items:2,max_page_items:1}});
    net.pending[4].callback(null,{js:{data:[{id:'43',name:'World live',tv_genre_id:'7',cmd:'/media/43.mpg'}],total_items:2,max_page_items:1}});
    return {svc,catalog};
}

test('relative M3U references, entry EPG, fractional shifts and explicit zero archive retain intent',()=>{
    const text='#EXTM3U x-tvg-url="../guide.xml" catchup="shift" catchup-days="7"\n#EXTINF:-1 tvg-id="a" tvg-logo="/logo/a.png" tvg-shift="5.5" catchup-days="0" url-tvg="guide-extra.xml",A\n../stream/a.m3u8\n#EXTINF:-1,B\n//cdn.test/live.m3u8\n#EXTINF:-1,Unsafe\njavascript:alert(1)';
    const result=p.parseM3U(text,{id:'p',url:'https://playlist.test/folder/list.m3u'});
    assert.equal(result.channels[0].url,'https://playlist.test/stream/a.m3u8');
    assert.equal(result.channels[0].logo,'https://playlist.test/logo/a.png');
    assert.equal(result.channels[0].tvgShift,5.5);
    assert.equal(result.channels[0].catchup.days,0);
    assert.equal(result.channels[1].url,'https://cdn.test/live.m3u8');
    assert.deepEqual(plain(result.epgUrls),['https://playlist.test/guide.xml','https://playlist.test/folder/guide-extra.xml']);
    assert.equal(result.channels.length,2);
    assert.equal(p.relativeUrl('../a','https://p.test/list.m3u'),'https://p.test/a');
});

test('Xtream empty live, VOD and series catalogs are valid',()=>{
    const {result,calls}=syncCatalog();
    assert.equal(result.channels.length,0);
    assert.equal(calls.length,7);
});

test('Xtream series browse has stable season and episode identities with source isolation',()=>{
    const net=network();const svc=p.create({request:net.request});let catalog;
    svc.load(xc,(error,result)=>{assert.equal(error,null);catalog=result;});
    const data=[{user_info:{auth:1}},[],[],[],[],[{category_id:'7',category_name:'Drama'}],[{series_id:9,name:'Story',category_id:'7',cover:'https://cdn.test/cover.jpg',is_adult:1}]];
    data.forEach((value,index)=>net.pending[index].callback(null,value));
    const series=catalog.channels[0];assert.equal(series.kind,'folder');assert.equal(series.group,'Drama');
    let seasons;svc.browse(xc,series,(error,value)=>{assert.equal(error,null);seasons=value;});
    assert.match(net.pending[7].url,/action=get_series_info&series_id=9$/);
    net.pending[7].callback(null,{seasons:[{season_number:2,name:'Second season'}],episodes:{2:[{id:'12',title:'Finale',season:2,episode_num:2,container_extension:'mp4',info:{plot:'<img> text'}},{id:11,title:'First',season:2,episode_num:1,container_extension:'mkv'}],1:[{id:10,title:'Pilot',episode_num:1,container_extension:'mp4'},{id:'bad',container_extension:'mp4'}]}});
    assert.deepEqual(plain(seasons.items.map(s=>s.seasonNumber)),['1','2']);assert.equal(seasons.warnings.length,1);
    assert.equal(seasons.items[1].name,'Second season');assert.equal(seasons.items[1].adult,true);
    let episodes;svc.browse(xc,seasons.items[1],(error,value)=>{assert.equal(error,null);episodes=value;});
    assert.equal(net.pending.length,8,'season browse uses bounded details cache');
    assert.deepEqual(plain(episodes.items.map(s=>s.episodeNumber)),[1,2]);
    assert.equal(episodes.items[1].url,'https://xc.test/series/a%2Fb/x%3F%26/12.mp4');
    assert.equal(episodes.items[1].description,'<img> text');assert.equal(episodes.items[1].adult,true);
    svc.resolve(series,(error)=>assert.equal(error.code,'FOLDER_REQUIRED'));
    svc.browse({...xc,id:'other'},series,(error)=>assert.equal(error.code,'SOURCE_MISMATCH'));
});

test('Xtream cancelling series details suppresses late success and malformed data',()=>{
    const net=network();const svc=p.create({request:net.request});let completions=0;
    const stop=svc.browse(xc,{id:'series',sourceId:'xc',kind:'folder',folderType:'series',seriesId:'9'},()=>{completions++;});
    stop();net.pending[0].callback(null,{episodes:{}});net.pending[0].callback(null,'invalid');
    assert.equal(net.pending[0].cancels,1);assert.equal(completions,0);
});

test('Xtream cancellation at every catalog stage prevents late replies from advancing the session',()=>{
    const replies=[{user_info:{auth:1}},[],[],[],[],[],[]];
    for(let stage=0;stage<replies.length;stage++) {
        const net=network(), svc=p.create({request:net.request});let completions=0;
        const stop=svc.load(xc,()=>{completions++;});
        for(let index=0;index<stage;index++) net.pending[index].callback(null,replies[index]);
        assert.equal(net.pending.length,stage+1);
        stop();stop();
        net.pending[stage].callback(null,replies[stage]);
        net.pending[stage].callback(null,'invalid JSON');
        assert.equal(net.pending.length,stage+1,'cancelled session issues no next request');
        assert.equal(net.pending[stage].cancels,1);
        assert.equal(completions,0);
    }
});

test('Stalker handshake, profile and paginated catalog carry scoped credentials but return no token/commands',()=>{
    const net=network();const {catalog,svc}=loadedPortal(net);
    assert.equal(catalog.channels.length,3);assert.equal(catalog.channels[0].group,'News');
    assert.match(net.pending[0].url,/\/stalker_portal\/server\/load.php\?type=stb&action=handshake/);
    assert.equal(net.pending[0].options.headers.Cookie,'mac=00%3A1A%3A79%3A01%3A02%3A03; stb_lang=en; timezone=UTC');
    assert.equal(net.pending[0].options.headers.Authorization,undefined);
    assert.equal(net.pending[1].options.headers.Authorization,'Bearer test-token');
    assert.match(net.pending[3].url,/p=1/);assert.match(net.pending[4].url,/p=2/);
    assert(!JSON.stringify(catalog).includes('test-token'));assert(!JSON.stringify(catalog).includes('localhost/ch/42'));
    let resolved;svc.resolve(catalog.channels[0],(err,val)=>{assert.equal(err,null);resolved=val;});
    assert.equal(new URL(net.pending[5].url).searchParams.get('cmd'),'ffmpeg http://localhost/ch/42_');
    net.pending[5].callback(null,{js:{cmd:'ffmpeg https://cdn.test/live.m3u8?token=signed'}});
    assert.equal(resolved.url,'https://cdn.test/live.m3u8?token=signed');
});

test('Stalker browse supports VOD categories, movie files and create_link',()=>{
    const net=network();const {catalog,svc}=loadedPortal(net);let categories,films,files,resolved;
    svc.browse(portal,catalog.channels[2],(error,value)=>{assert.equal(error,null);categories=value;});
    assert.match(net.pending[5].url,/type=vod&action=get_categories/);
    net.pending[5].callback(null,{js:[{id:'8',title:'Cinema',censored:1}]});
    svc.browse(portal,categories.items[0],(error,value)=>{assert.equal(error,null);films=value;});
    net.pending[6].callback(null,{js:{data:[{id:90,name:'Film',cmd:'/media/90.mpg',has_files:2}],total_items:1}});
    assert.equal(films.items[0].kind,'folder');assert.equal(films.items[0].folderType,'portal-movie');
    svc.browse(portal,films.items[0],(error,value)=>{assert.equal(error,null);files=value;});
    assert.equal(new URL(net.pending[7].url).searchParams.get('movie_id'),'90');
    net.pending[7].callback(null,{js:{data:[{id:123,name:'English / HD',is_file:1,cmd:'/media/file_123.mpg'}],total_items:1}});
    assert.equal(files.items[0].kind,'vod');assert.equal(files.items[0].adult,true);
    svc.resolve(files.items[0],(error,value)=>{assert.equal(error,null);resolved=value;});
    assert.equal(new URL(net.pending[8].url).searchParams.get('cmd'),'/media/file_123.mpg');
    net.pending[8].callback(null,{js:{cmd:'https://cdn.test/movie.mp4'}});
    assert.equal(resolved.url,'https://cdn.test/movie.mp4');
});

test('Stalker series follow movie, season, episode and media-file requests',()=>{
    const net=network();const {svc}=loadedPortal(net);let item={id:'c',sourceId:'portal',kind:'folder',folderType:'portal-category',categoryId:'*',portalGeneration:1};
    const payloads=[{id:90,name:'Series',is_series:1},{id:5,name:'Season 1',is_season:1},{id:7,name:'Episode 1',is_episode:1},{id:111,name:'HD',is_file:1,cmd:'/media/file_111.mpg'}];
    payloads.forEach((row,index)=>{
        svc.browse(portal,item,(error,value)=>{assert.equal(error,null);item=value.items[0];});
        const args=new URL(net.pending[index+5].url).searchParams;
        if(index>0)assert.equal(args.get('movie_id'),'90');
        if(index>1)assert.equal(args.get('season_id'),'5');
        if(index>2)assert.equal(args.get('episode_id'),'7');
        net.pending[index+5].callback(null,{js:{data:[row],total_items:1}});
    });
    assert.equal(item.kind,'vod');
});

test('Stalker wrong credentials, disabled relay and unsafe playback do not leak source responses',()=>{
    const net=network();let relay=true;const {svc,catalog}=loadedPortal(net,()=>relay);
    svc.resolve(catalog.channels[0],error=>{assert.equal(error.code,'AUTHENTICATION');assert(!error.message.includes('secret'));});
    net.pending[5].callback(null,{js:{error:'access_denied secret=password'}});
    svc.resolve(catalog.channels[0],error=>assert.equal(error.code,'STREAM_URL'));
    net.pending[6].callback(null,{js:{cmd:'ffmpeg javascript:alert(1)'}});
    relay=false;svc.resolve(catalog.channels[0],error=>assert.equal(error.code,'PORTAL_TRANSPORT'));assert.equal(net.pending.length,7);
    relay=true;svc.close(portal.id);svc.resolve(catalog.channels[0],error=>assert.equal(error.code,'PORTAL_SESSION'));assert.equal(net.pending.length,7);
    let error;
    p.create({request(){throw Error('must not request');},portalTransport:true}).load({...portal,mac:'bad'},value=>error=value);
    assert.equal(error.code,'SOURCE_MAC');
});

test('Stalker repeated pages cannot report complete catalog even when raw count reaches total',()=>{
    const net=network();const svc=p.create({request:net.request,portalTransport:true});let result;
    svc.load(portal,error=>result=error);
    net.pending[0].callback(null,{js:{token:'t'}});net.pending[1].callback(null,{js:{status:0}});net.pending[2].callback(null,{js:[]});
    const page={js:{data:[{id:'42',cmd:'/media/42'}],total_items:2,max_page_items:1}};
    net.pending[3].callback(null,page);net.pending[4].callback(null,page);
    assert.equal(result.code,'PORTAL_PAGINATION');assert.equal(net.pending.length,5);
});

test('Stalker cancel during paginated load aborts its current page and ignores late callbacks',()=>{
    const net=network();let completions=0;const svc=p.create({request:net.request,portalTransport:true});
    const cancel=svc.load(portal,()=>completions++);
    net.pending[0].callback(null,{js:{token:'t'}});net.pending[1].callback(null,{js:{status:0}});net.pending[2].callback(null,{js:[]});
    cancel();net.pending[3].callback(null,{js:{data:[{id:4,cmd:'/media/4'}],total_items:2}});
    assert.equal(net.pending.length,4);assert.equal(net.pending[3].cancels,1);assert.equal(completions,0);
});

test('Stalker cancellation at every load stage prevents late replies and session commits',()=>{
    const replies=[{js:{token:'t'}},{js:{id:1}},{js:[]},{js:{data:[{id:1,cmd:'/opaque'}],total_items:1}}];
    for(let stage=0;stage<replies.length;stage++) {
        const net=network(),svc=p.create({request:net.request,portalTransport:true});let completions=0;
        const stop=svc.load(portal,()=>completions++);
        for(let index=0;index<stage;index++)net.pending[index].callback(null,replies[index]);
        stop();stop();net.pending[stage].callback(null,replies[stage]);net.pending[stage].callback(null,'invalid');
        assert.equal(completions,0);assert.equal(net.pending.length,stage+1);assert.equal(net.pending[stage].cancels,1);
        svc.resolve({sourceId:portal.id,kind:'live',provider:'stalker',id:'portal:stalker:live:1',portalGeneration:1},error=>assert.equal(error.code,'PORTAL_SESSION'));
    }
});

test('Stalker reloaded sessions reject stale and string generations without requesting playback',()=>{
    const net=network(),{svc,catalog}=loadedPortal(net);let fresh;
    svc.load(portal,(error,value)=>{assert.equal(error,null);fresh=value;});
    [{js:{token:'new'}},{js:{id:1}},{js:[]},{js:{data:[{id:42,cmd:'/new'}],total_items:1}}].forEach((reply,index)=>net.pending[index+5].callback(null,reply));
    svc.resolve(catalog.channels[0],error=>assert.equal(error.code,'PORTAL_SESSION'));
    svc.browse(portal,{...fresh.channels[1],portalGeneration:String(fresh.channels[1].portalGeneration)},error=>assert.equal(error.code,'PORTAL_SESSION'));
    assert.equal(net.pending.length,9);
});

test('Xtream archive dates, minute granularity, correction and exact retention boundaries',()=>{
    const start=Date.UTC(2026,0,1,0,0,30)/1000;const ch={catchup:{type:'xtream',days:2,base:'https://xc.test',username:'a/b',password:'x?&',streamId:'42',extension:'m3u8',correction:0}};
    const programme={start,end:start+61};
    assert.equal(modules.epg.archiveUrl(ch,programme,start+3600),'https://xc.test/timeshift/a%2Fb/x%3F%26/2/2026-01-01:00-00/42.m3u8');
    assert.equal(modules.epg.archiveUrl(ch,programme,start+86400*2+1),null);
    assert.equal(modules.epg.archiveUrl(ch,programme,start+30),null);
    ch.catchup.correction=-1;
    assert.match(modules.epg.archiveUrl(ch,programme,start+3600),/2025-12-31:23-00/);
});

test('M3U handles 10000 channels without collisions or dependence on ordering',()=>{
    const lines=['#EXTM3U'];
    for(let i=0;i<10000;i++)lines.push('#EXTINF:-1 tvg-id="id-'+i+'",Channel '+i,'https://video.test/live/'+i+'.m3u8');
    const result=p.parseM3U(lines.join('\n'),{id:'large'});
    assert.equal(result.channels.length,10000);
    assert.equal(new Set(result.channels.map(ch=>ch.id)).size,10000);
    assert.equal(result.warnings.length,0);
});

test('Transport authentication and timeout codes remain classified without exposing URLs',()=>{
    for(const [input,expected] of [[{status:401,message:'secret'},'AUTHENTICATION'],[{status:403},'AUTHENTICATION'],[{code:'TIMEOUT'},'TIMEOUT'],[{code:'RESPONSE_SIZE'},'RESPONSE_SIZE']]){
        let error;p.create({request(url,cb){cb(input);}}).load(xc,err=>error=err);
        assert.equal(error.code,expected);assert(!error.message.includes('secret'));
    }
});

test('Stalker premature empty page fails explicitly instead of losing channels',()=>{
    const net=network();let failure;
    p.create({request:net.request,portalTransport:true}).load(portal,error=>failure=error);
    net.pending[0].callback(null,{js:{token:'t'}});net.pending[1].callback(null,{js:{status:0}});net.pending[2].callback(null,{js:[]});
    net.pending[3].callback(null,{js:{data:[],total_items:2}});
    assert.equal(failure.code,'PORTAL_PAGINATION');
});
