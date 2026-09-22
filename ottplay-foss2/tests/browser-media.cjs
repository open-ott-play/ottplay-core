/* Actual browser decode/track test. Requires Playwright Chromium and FFmpeg. */
"use strict";
const { chromium } = require('playwright');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { handler } = require('../scripts/serve.cjs');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ott2-browser-media-'));
const server=http.createServer(handler);
let browser;
try {
fs.mkdirSync(path.join(fixtureRoot,'dash')); fs.mkdirSync(path.join(fixtureRoot,'hls'));
const ffmpeg=process.env.FFMPEG || 'ffmpeg';
const inputs=['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000'];
const encode=['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','48','-c:a','aac'];
execFileSync(ffmpeg,inputs.concat(['-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','5','-map','0:v','-map','1:a','-map','2:a'],encode,['-metadata:s:a:0','language=eng','-metadata:s:a:1','language=rus','-f','dash','-seg_duration','2','-adaptation_sets','id=0,streams=0 id=1,streams=1 id=2,streams=2',path.join(fixtureRoot,'dash/manifest.mpd')]),{stdio:'pipe'});
execFileSync(ffmpeg,inputs.concat(['-t','5','-map','0:v','-map','1:a'],encode,['-f','hls','-hls_time','2','-hls_list_size','0',path.join(fixtureRoot,'hls/master.m3u8')]),{stdio:'pipe'});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
await page.route('https://media.example/**',async route=>{const u=new URL(route.request().url());const file=path.join(fixtureRoot,u.pathname);if(!file.startsWith(fixtureRoot+path.sep)||!fs.existsSync(file)) return route.abort();const ext=path.extname(file);await route.fulfill({status:200,body:fs.readFileSync(file),headers:{'Access-Control-Allow-Origin':'*','Content-Type':ext==='.mpd'?'application/dash+xml':ext==='.m3u8'?'application/vnd.apple.mpegurl':ext==='.ts'?'video/mp2t':'video/mp4'}});});
await page.goto('http://127.0.0.1:'+server.address().port+'/');
await page.waitForFunction(()=>window.OTT2 && window.OTT2VendorLoader && document.getElementById("nav-settings"), null,{timeout:15000});
assert.deepEqual(await page.evaluate(()=>[OTT2Vendors.Hls,OTT2Vendors.shaka,OTT2Vendors.mpegts]),[null,null,null],"Catalog startup keeps optional decoders unloaded");
const report=await page.evaluate(async()=>{
const events=[];const video=document.createElement('video');video.muted=true;video.width=320;video.height=180;document.body.appendChild(video);
const media=OTT2.require('media').create({video,environment:window,onEvent:e=>events.push({type:e.type,state:e.state,error:e.error})});
async function until(condition){for(let i=0;i<100;i++){if(condition())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Playback timeout: '+JSON.stringify({events:events.slice(-5),vendors:['Hls','shaka','mpegts'].map(name=>({name,status:OTT2VendorLoader.status(name)})),capabilities:media.capabilities()}));}
media.load({id:'hls',kind:'vod',url:'https://media.example/hls/master.m3u8'}, {engine:'native'});
await until(()=>video.currentTime>.2);
const nativeHls={backend:media.getState().backend,position:video.currentTime,readyState:video.readyState,optionalLibrariesLoaded:!!(OTT2Vendors.Hls||OTT2Vendors.shaka||OTT2Vendors.mpegts)};
const originalCanPlayType=video.canPlayType; video.canPlayType=function(type){return /mpegurl/i.test(type)?'':originalCanPlayType.call(this,type);};
media.load({id:'hls-js',kind:'vod',url:'https://media.example/hls/master.m3u8'}, {engine:'hls.js'});
await until(()=>media.getState().backend==='hls.js'&&video.currentTime>.2);
const hls={backend:media.getState().backend,position:video.currentTime,readyState:video.readyState};
media.load({id:'dash',kind:'vod',url:'https://media.example/dash/manifest.mpd'}, {engine:'auto'});
await until(()=>media.getState().backend==='shaka'&&video.currentTime>.2);
const dash={backend:media.getState().backend,position:video.currentTime,readyState:video.readyState,tracks:media.listTracks(),seekRange:media.getState().seekRange};
if(dash.tracks.audio.length<2)throw new Error('Expected 2 DASH audio tracks');
if(!media.selectAudio('1'))throw new Error('DASH audio selection rejected');
await until(()=>media.listTracks().audio[1].selected);
dash.selectedSecondAudio=media.listTracks().audio[1];
media.pause();media.seek(2);await new Promise(r=>setTimeout(r,200));dash.pausedSeek={position:video.currentTime,paused:video.paused,state:media.getState().state};
const lifecycle=[];
for(const engine of ['native','hls.js','shaka']){
media.load({id:'lifecycle-'+engine,kind:'vod',url:engine==='shaka'?'https://media.example/dash/manifest.mpd':'https://media.example/hls/master.m3u8'},{engine});
await until(()=>video.currentTime>.2&&media.getState().state==='playing');
media.pause();if(!media.seek(2))throw new Error('Lifecycle seek unavailable for '+engine);
media.suspend();const suspended=media.getState();media.resume();
await new Promise(r=>setTimeout(r,150));
const pausedResume={state:media.getState().state,paused:video.paused,ready:media.getState().ready,position:media.getState().position};
media.play();await until(()=>video.currentTime>2.05&&media.getState().state==='playing');
const before=video.currentTime;video.pause();await until(()=>media.getState().paused);
media.suspend({paused:false});const hostPauseOverridden=!media.getState().paused;media.resume();
await until(()=>video.currentTime>=before&&media.getState().state==='playing');
lifecycle.push({engine,suspendedPaused:suspended.paused,suspendedState:suspended.state,pausedResume,hostPauseOverridden,before,after:video.currentTime,dimensions:[video.videoWidth,video.videoHeight]});
}
media.destroy();video.remove();return {nativeHls,hls,dash,lifecycle,errors:events.filter(e=>e.error)};
});
assert.deepEqual(errors, [], 'No uncaught browser errors');
assert.deepEqual(report.errors, [], 'No engine errors');
assert.equal(report.nativeHls.backend, 'native');
assert.equal(report.nativeHls.optionalLibrariesLoaded,false,'Native playback never downloads MSE engines');
assert.equal(report.hls.backend, 'hls.js');
assert.equal(report.dash.backend, 'shaka');
assert.equal(report.dash.pausedSeek.paused, true);
assert.equal(report.dash.pausedSeek.state, 'paused');
assert.ok(Math.abs(report.dash.pausedSeek.position-2)<0.1);
for(const result of report.lifecycle){
assert.equal(result.suspendedState,'suspended');assert.equal(result.suspendedPaused,true);
assert.equal(result.hostPauseOverridden,true);
assert.deepEqual(result.pausedResume,{state:'paused',paused:true,ready:false,position:2});
assert.ok(result.after>=result.before&&result.after<result.before+1,'Foreground preserves the VOD timeline for '+result.engine);
assert.deepEqual(result.dimensions,[320,180]);
}
fs.mkdirSync(path.resolve(__dirname, '../test-results'), {recursive:true});
fs.writeFileSync(path.resolve(__dirname, '../test-results/browser-media-report.json'), JSON.stringify({report,pageErrors:errors},null,2));
console.log(JSON.stringify({report,pageErrors:errors},null,2));
}finally{
if(browser) await browser.close();
if(server.listening) await new Promise(resolve=>server.close(resolve));
fs.rmSync(fixtureRoot,{recursive:true,force:true});
}
})().catch(e=>{console.error(e);process.exitCode=1;});
