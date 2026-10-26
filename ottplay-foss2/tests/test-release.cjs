'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {zip,files,versionChannel,build,requiredChecks,validateReport}=require('../scripts/release.cjs');
test('Release archive has deterministic standard ZIP headers, compressed payload and CRC',()=>{
    const entries=[{name:'example.txt',data:Buffer.from('123456789')}];
    const result=zip(entries,'beta'); assert.deepEqual(result,zip(entries,'beta'));
    assert.equal(result.readUInt32LE(0),0x04034b50);assert.equal(result.readUInt32LE(14),0xcbf43926);
    const length=result.readUInt16LE(26),compressed=result.readUInt32LE(18);
    assert.equal(result.subarray(30,30+length).toString(),'beta/example.txt');
    assert.equal(zlib.inflateRawSync(result.subarray(30+length,30+length+compressed)).toString(),'123456789');
    assert.equal(result.readUInt32LE(result.length-22),0x06054b50);
});
test('Release inputs include runtime, server, fonts and licenses without local results or dependency installations',()=>{
    const names=files().map(entry=>entry.name);
    for(const required of ['src/channel-identity.js','scripts/epg.cjs','scripts/serve.cjs','scripts/check-core.cjs','vendor/ottplay-core.js','vendor/ottplay-core.manifest.json','vendor/ottplay-core.LICENSE.txt','vendor/hls.worker.js','vendor/core-js.min.js','LICENSE','package-lock.json','docs/RELEASE-0.6.0-beta.1.md']) assert.ok(names.includes(required),required);
    assert.ok(names.some(name=>name.startsWith('fonts/')));
    assert.ok(names.every(name=>!/(?:^|\/)(?:node_modules|test-results|releases|\.git|\.env)(?:\/|$)/.test(name)));
});

test('Candidate channels are explicit and stable cannot be rebuilt',()=>{
    assert.equal(versionChannel('0.6.0-beta.5'),'beta');
    assert.equal(versionChannel('0.6.0-rc.1'),'rc');
    for(const version of ['0.6.0','0.6.0-dev.1','0.6.0-rc.0','0.6.0-rc.01','01.6.0-rc.1','0.6.0-rc.1+local']) {
        assert.throws(()=>versionChannel(version),/numbered beta or RC/);
    }
    const current=versionChannel(require('../package.json').version);
    assert.throws(()=>build(undefined,current==='beta'?'rc':'beta'),/does not match/);
});

test('The page and package identify the same candidate version',()=>{
    const fs=require('node:fs'),path=require('node:path');
    const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    const match=/<meta name="application-version" content="([^"]+)">/.exec(html);
    assert.ok(match,'page declares its application version');
    assert.equal(match[1],require('../package.json').version);
});

test('Packaging requires every release check and the exact tested source inventory',()=>{
    const crypto=require('node:crypto');
    const entries=[{name:'index.html',data:Buffer.from('tested page')},{name:'src/app.js',data:Buffer.from('tested script')}];
    const report={version:'0.6.0-rc.1',passed:true,inputsUnchanged:true,
        checks:requiredChecks.map(name=>({name,exitCode:0,signal:null})),
        sourceHashes:Object.fromEntries(entries.map(entry=>[entry.name,crypto.createHash('sha256').update(entry.data).digest('hex')]))};
    assert.doesNotThrow(()=>validateReport(report,entries,report.version));
    assert.throws(()=>validateReport(null,entries,report.version),/validation/);
    for(const change of [
        value=>{value.version='0.6.0-beta.5';},
        value=>{value.passed=false;},
        value=>{value.inputsUnchanged=false;},
        value=>{value.checks.pop();},
        value=>{value.checks[1].name=value.checks[0].name;},
        value=>{value.checks[1].exitCode=1;},
        value=>{value.checks[1].signal='SIGTERM';},
        value=>{delete value.sourceHashes['src/app.js'];},
        value=>{value.sourceHashes['extra.js']='0'.repeat(64);},
        value=>{value.sourceHashes['index.html']='0'.repeat(64);}
    ]) {
        const invalid=structuredClone(report);change(invalid);
        assert.throws(()=>validateReport(invalid,entries,report.version),/validation/);
    }
    assert.throws(()=>validateReport(report,[...entries.slice(0,1),{name:'src/app.js',data:Buffer.from('changed after testing')}],report.version),/validation/);
});
