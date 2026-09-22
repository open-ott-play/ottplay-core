"use strict";
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
exports.run = function (input, sourceFile = path.join(__dirname, '../src/providers.js')) {
    const ctx = vm.createContext({window:{OTT2:{define(name,factory){ctx.providers=factory();}}}});
    require('./load-core.cjs')(ctx);
    vm.runInContext(fs.readFileSync(sourceFile,'utf8'),ctx);
    const calls=[], results=[];
    const source=input.source || {id:'portal 🎬',type:'stalker',url:'https://portal.test/stalker_portal/c/',mac:'00:1a:79:01:02:03'};
    const service=ctx.providers.create({portalTransport: input.relay !== false, request(url,callback,options){
        if(calls.length>=50)throw new Error('Fixture request overflow');
        const response=input.responses[calls.length];calls.push({url,options});
        if(!response)throw new Error('Unexpected fixture request');
        callback(response.error || null,response.body);return ()=>{};
    }});
    for(const operation of input.operations || [{method:'load'}]) {
        const config=operation.source || source;
        if(operation.method==='close'){service.close(config.id);results.push({closed:true});continue;}
        const node=operation.ref ? operation.ref.reduce((value,key)=>value[key],results) : operation.node;
        const done=(error,value)=>results.push(error ? {error:{code:error.code,message:error.message}} : value);
        if(operation.method==='load')service.load(config,done);
        else if(operation.method==='browse')service.browse(config,node,done);
        else service.resolve(node,done);
    }
    return JSON.parse(JSON.stringify({calls,results}));
};
