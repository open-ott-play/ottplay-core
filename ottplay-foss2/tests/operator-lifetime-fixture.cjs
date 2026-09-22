const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
exports.run=function(input){
 const modules={},context=vm.createContext({window:{OTT2:{define(name,factory){modules[name]=factory(id=>modules[id]);}}}});
 require('./load-core.cjs')(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/providers.js'),'utf8'),context);
 const events=[],pending=[];let stop;
 const source={id:'feed',type:'m3u',url:'https://feed.test/list.m3u'},text='#EXTM3U\n#EXTINF:-1,Live\nhttps://feed.test/live\n#EXTINF:-1 type="movie",Movie\nhttps://feed.test/movie';
 const svc=modules.providers.create({request(url,callback){const index=pending.length;pending.push(callback);events.push(['request',url]);if(input.sync){callback(null,text);if(input.twice)callback(null,text);}if(input.cancelSetup)stop();return ()=>events.push(['abort',index]);}});
 function done(error,result){events.push(['done',error&&error.code||null,result||null]);}
 if(input.mode==='cache'){
  const xc={id:'xc',type:'xtream',url:'https://xc.test',username:'u',password:'p'},node={id:'series',sourceId:'xc',kind:'folder',folderType:'series',seriesId:'9'};
  svc.browse(xc,node,done);pending[0](null,{episodes:{1:[{id:'12',title:'Pilot',container_extension:'mp4'}]}});
  svc.browse(xc,node,done);
  if(input.close)svc.close('xc');
  svc.browse(xc,input.other?Object.assign({},node,{seriesId:'10'}):node,done);
  if(pending.length>1)pending[1](null,{episodes:{2:[{id:'13',title:'Next',container_extension:'mp4'}]}});
  svc.browse(xc,node,done);
 }else if(input.cancelSetup){
  let first=true;const custom=modules.providers.create({request(url,cb){events.push(['request',url]);if(first){first=false;pending.push(cb);return()=>events.push(['abort',0]);}stop();return()=>events.push(['abort',1]);}});
  const xc={id:'xc',type:'xtream',url:'https://xc.test',username:'u',password:'p'};
  stop=custom.load(xc,done);pending[0](null,{user_info:{auth:1}});
 }else{
  stop=svc.load(source,done);
  if(input.cancel){stop();stop();}
  if(!input.sync){pending[0](input.error?{status:input.error}:null,input.malformed?{}:text);if(input.twice)pending[0](null,text);}
  if(input.close)svc.close('feed');
  if(input.browse)svc.browse(source,null,done);
  if(input.stopAfter)stop();
 }
 return JSON.parse(JSON.stringify(events));
};
