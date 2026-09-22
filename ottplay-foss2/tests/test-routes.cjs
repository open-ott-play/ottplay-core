'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), http=require('node:http');
const {handler}=require('../scripts/serve.cjs');
test('Device HTML routes share the detector allowlist and reject invalid document paths', async t=>{
    const server=http.createServer(handler); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    function request(route) {return new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:server.address().port,path:route},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});}
    for(const route of ['/f/lg/webos','/f/lg/webos/','/f/lg/webos/index.html','/f/android/index.html','/f/mag/nested/player.htm','/f/samsung/tizen/index.html']) assert.equal(await request(route),200,route);
    for(const route of ['/f/unknown','/f/lg/webos/config.json','/f/lg/webos/script.js','/f/pc/%2e%2e/index.html','/f/pc/%00']) assert.ok([400,404].includes(await request(route)),route);
});
