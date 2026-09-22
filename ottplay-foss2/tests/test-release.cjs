'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {zip,files}=require('../scripts/release.cjs');
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
