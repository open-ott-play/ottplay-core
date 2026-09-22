const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),cp=require('node:child_process');
exports.run=function(input, baseline){
 const modules={},context=vm.createContext({window:{OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}}});
 require('./load-core.cjs')(context);vm.runInContext(baseline?cp.execFileSync('git',['show','HEAD:ottplay-foss2/src/providers.js'],{encoding:'utf8'}):fs.readFileSync(path.join(__dirname,'../src/providers.js'),'utf8'),context);
 const events=[];const service=modules.providers.create({request(url,callback){events.push(['request',url]);return function(){};}});
 function done(error,result){events.push(['done',error?{code:error.code,message:error.message}:null,result||null]);}
 try {if(input.mode==='browse')service.browse(input.source,input.item,done);else if(input.mode==='resolve')service.resolve(input.item,done);else service.load(input.source,done);}
 catch(error){events.push(['throw',{name:error.name,message:error.message}]);}
 return JSON.parse(JSON.stringify(events));
};
