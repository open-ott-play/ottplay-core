#!/usr/bin/env node
/* Run release acceptance serially and fingerprint the exact tested inputs. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'), {files}=require('./release.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint=()=>Object.fromEntries(files().map(entry=>[entry.name,hash(entry.data)]));
const version=require('../package.json').version,output=path.join(root,'test-results','release-'+version);
fs.mkdirSync(output,{recursive:true});
const fixturePath=path.join(output,'test-pattern.mp4');
const fixture=spawnSync(process.env.FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','180','-c:v','libx264','-preset','ultrafast','-crf','35','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',fixturePath],{encoding:'utf8',timeout:60000});
if(fixture.status!==0) throw new Error('FFmpeg could not create the synthetic release media fixture');
const childEnvironment=Object.assign({},process.env,{OTT2_TEST_MEDIA:fixturePath});
const report={version,mediaFixture:{generated:true,sha256:hash(fs.readFileSync(fixturePath))},startedAt:new Date().toISOString(),node:process.version,platform:process.platform,architecture:process.arch,sourceHashes:fingerprint(),checks:[],passed:false};
const browserNames=['browser','browser-providers','browser-engines','browser-media','browser-epg','browser-browse','browser-compat','browser-scroll','browser-controls','browser-startup','browser-window-controls'];
const checks=[{name:'unit-es5-resources-vendors',command:'npm',args:['test']}].concat(browserNames.map(name=>({name,command:process.execPath,args:['tests/'+name+'.cjs']})));
for(const check of checks) {
    console.log('RUN '+check.name);
    const started=Date.now(),result=spawnSync(check.command,check.args,{cwd:root,env:childEnvironment,encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024});
    const log=String(result.stdout||'')+String(result.stderr||'')+(result.error?'\n'+result.error.message:'');
    fs.writeFileSync(path.join(output,check.name+'.log'),log);
    const row={name:check.name,command:check.command===process.execPath?'node '+check.args.join(' '):check.command+' '+check.args.join(' '),exitCode:result.status,signal:result.signal,elapsedMs:Date.now()-started,log:check.name+'.log',logSha256:hash(log)};
    const reportFile=path.join(root,'test-results',check.name+'-report.json');
    if(check.name.startsWith('browser')&&fs.existsSync(reportFile)) {row.report=path.basename(reportFile);row.reportSha256=hash(fs.readFileSync(reportFile));fs.copyFileSync(reportFile,path.join(output,row.report));}
    report.checks.push(row);fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log((result.status===0?'PASS ':'FAIL ')+check.name+' ('+row.elapsedMs+' ms)');
    if(result.status!==0) {process.exitCode=1;break;}
}
report.completedAt=new Date().toISOString();
report.inputsUnchanged=JSON.stringify(report.sourceHashes)===JSON.stringify(fingerprint());
report.passed=report.checks.length===checks.length&&report.checks.every(check=>check.exitCode===0)&&report.inputsUnchanged;
fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(report.passed?'PASS: all release gates; source fingerprints unchanged':'FAIL: incomplete gates or changed release inputs');
if(!report.passed)process.exitCode=1;
