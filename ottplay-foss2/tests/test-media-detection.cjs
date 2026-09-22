const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),cp=require('node:child_process'),test=require('node:test');
const baseline='f429f537497ec95c2bf92781e1ecee86c18bbfe8';
const filename=path.join(__dirname,'test-media.cjs');
const adapter=process.argv.includes('--capture')?cp.execFileSync('git',['show',baseline+':ottplay-foss2/src/media.js'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'}):fs.readFileSync(path.join(__dirname,'../src/media.js'),'utf8');
const observed=adapter.replace('load: function (next, selection)','__policy: { declared: declaredFormat, body: bodyFormat }, load: function (next, selection)');
const harness=fs.readFileSync(filename,'utf8').split('const live = ')[0].replace('const source = fs.readFileSync(path.join(__dirname, "../src/media.js"), "utf8");','const source = '+JSON.stringify(observed)+';');
const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(harness+'\nmodule.exports=fixture;',filename);
function capture(){
 const f=m.exports(),output=[];
 for(const url of ['https://a.test/x.m3u8','https://a.test/?file=x.mpd','https://a.test/x.TS','blob:x','https://a.test/x?format=video%2Fmp4','https://a.test/x?TYPE=%zz','https://a.test/x.m3u8?type=FLV','https://a.test/no-ext'])for(const mime of ['', 'audio/ogg','application/dash+xml'])for(const format of ['', 'ts'])output.push({url,mime,format,result:f.player.__policy.declared({url,mime,format})});
 for(const value of ['', '#EXTM3U', '\uFEFF \t#EXTM3U', 'FLV123', ' FLV123', '<MPD>', '<MPD/>','<MPD','<MPD\u00a0x>', '<ns:MPD >', '<bad.prefix:MPD >', '<?XML hi> <!-- comment --> <DASH:mpd >','<!--1--><!--2--><MPD>', 'xxxxftyp', 'xxxxmoov', 'xxxxmoof', '\u0147'+'.'.repeat(187)+'G'+'.'.repeat(187)+'G'])output.push({value,result:f.player.__policy.body(value)});
 f.player.destroy();return output;
}
const target=path.join(__dirname,'fixtures/playback-policy/detection-before-core.json');
if(process.argv.includes('--capture')){assert(!fs.existsSync(target));fs.writeFileSync(target,JSON.stringify({baseline,observed:capture()},null,2)+'\n');}
else test('media detection retains captured MIME, URL and binary signature outcomes',()=>assert.deepEqual(capture(),JSON.parse(fs.readFileSync(target,'utf8')).observed));
