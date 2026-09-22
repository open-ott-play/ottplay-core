const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({}),modules={};context.OTT2={define(name,factory){modules[name]=factory(id=>modules[id])}};context.window=context;
require('./load-core.cjs')(context);
for(const name of ['security','state','providers','library','channel-identity','migration'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+name+'.js'),'utf8'),context);
const plain=x=>JSON.parse(JSON.stringify(x)),fixtures=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/state/'+name+'-before-core.json'),'utf8')).cases;
test('shipping source-bound identity contracts retain complete state and original row selection',()=>{for(const row of fixtures('identity')){if(row.operation==='restore'){const items=plain(row.items),selected=modules.library.restoreChannel(items,row.reference);assert.equal(items.indexOf(selected),row.index)}else{const state=plain(row.before),result=modules['channel-identity'][row.operation](state,plain(row.items),row.source);assert.deepEqual(plain(state),row.after);assert.deepEqual(result===undefined?null:plain(result),row.result)}}});
test('shipping import previews retain exact warnings, format, secrets and failures',()=>{for(const row of fixtures('import')){let actual;try{actual={result:plain(modules.migration.preview(row.input))}}catch(e){actual={error:{name:e.name,message:e.message}}}assert.deepEqual(actual,row.error?{error:row.error}:{result:row.result})}});

test("shipping parental configuration and session traces preserve writes and outcomes",()=>{
const s=modules.security,plain=x=>JSON.parse(JSON.stringify(x));let cases=[];
function capture(name,fn){try{cases.push({name,value:plain(fn())})}catch(e){cases.push({name,error:{name:e.name,message:e.message}})}}
const base={schema:1,enabled:true,salt:'public-test-salt-1234',hash:'A'.repeat(64),iterations:1024};
for(const [name,change] of Object.entries({default:()=>null,disabled:()=>({schema:1,enabled:false}),enabled:()=>base,schema:()=>({...base,schema:2}),salt:()=>({...base,salt:'x'}),hash:()=>({...base,hash:'f'.repeat(63)}),work:()=>({...base,iterations:1024.5}),ids:()=>({...base,protectedIds:['a','a','__proto__']}),badIds:()=>({...base,protectedIds:[null]}),scopes:()=>({...base,scopes:{settings:false,remote:0}}),badScopes:()=>({...base,scopes:[]}),bounds:()=>({...base,sessionMinutes:1.9,failures:99,blockedUntil:-1})}))capture(name,()=>s.validate(change()));
for(const mode of ['success','failures','source','clock-back','clock-invalid','future-block','scopes','disable'])capture(mode,()=>{
 let now=1e6,state={security:s.defaults(),activeSourceId:'a'},writes=[];const gate=s.create({getState:()=>state,persist(v){state.security=plain(v);writes.push(plain(v))},now:()=>now,randomBytes:()=>Array.from({length:16},(_,i)=>i)}),out=[];
 out.push(gate.configure('', '1234'));
 if(mode==='failures'){for(let i=0;i<11;i++){out.push(gate.verify('9999'));now+=i<4?0:300000}out.push(gate.verify('1234'))}
 else if(mode==='future-block'){state.security.blockedUntil=1e15;out.push(gate.status());out.push(gate.verify('1234'))}
 else{out.push(gate.setProtected('a:adult',true,'1234'));out.push(gate.verify('1234'));if(mode==='source')state.activeSourceId='b';if(mode==='clock-back')now-=1;if(mode==='clock-invalid')now=NaN;if(mode==='scopes')out.push(gate.setScopes({settings:false},'1234'));if(mode==='disable')out.push(gate.disable('1234'));out.push(gate.status());out.push(gate.authorize('settings'));out.push(gate.authorize('play','a:adult'));out.push(gate.authorize('play','a:free'))}
 return {out,writes,state};
});
assert.deepEqual(cases, fixtures("security"));
});
test('shipping parental JS numeric and line terminator boundaries remain exact',()=>{for(const row of fixtures('security-edges')){const config={schema:1,enabled:true,salt:'public-test-salt-1234',hash:'a'.repeat(64),iterations:1024};let actual;try{if(row.count!==undefined)config.iterations=Number(row.count);else if(row.field!=='pin')config[row.field]+=row.suffix;actual={value:plain(row.field==='pin'?modules.security.create().configure('','1234'+row.suffix):modules.security.validate(config))}}catch(e){actual={error:{name:e.name,message:e.message}}}assert.deepEqual(actual,row.error?{error:row.error}:{value:row.value})}});
test('shipping reference source IDs retain dynamic types and own undefined fields',()=>{for(const row of fixtures('reference-types')){const result=modules.library.channelReference(row.channel,row.sourceType==='undefined'?undefined:row.source);assert.deepEqual(plain(result),row.result);assert.equal(typeof result.sourceId,row.resultSourceType);assert.equal(Object.prototype.hasOwnProperty.call(result,'sourceId'),row.hasOwn)}});
