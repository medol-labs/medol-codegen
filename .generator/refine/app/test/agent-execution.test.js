const test = require('node:test');
const assert = require('node:assert/strict');
const {createAgentExecution} = require('../templates/root/src/ai/execution.ts');
const {prepareCommand} = require('../templates/root/src/platform/composition/command-execution.ts');
const {resolveCapabilities} = require('../ai-capability-model');

function fixture() {
 const manifest=resolveCapabilities({agentAssistance:{assistants:[{name:'Operator',mode:'operator',bindings:[{kind:'command',context:'Orders',element:'Create',confirmation:'required'}]}]},slices:[{context:'Orders',commands:[{name:'Create',fields:[]}]}]});
 const id=manifest.capabilities[0].id;
 const configuration={enabled:true,profiles:[{id:'Operator',mode:'operator',capabilities:[id]}]};
 const scope={user:'user',tenant:'tenant',policyRevision:'1',instance:'form-1',revision:0};
 let permitted=true, clock=0;
 const runtime=createAgentExecution({policy:()=>({manifest,configuration}),scope:()=>scope,authorize:async()=>permitted,now:()=>clock});
 return {runtime,id,scope,configuration,manifest,revoke:()=>{permitted=false},expire:()=>{clock=120001}};
}
test('approval shows final mapped payload and shared extensions execute exactly once',async()=>{
 const f=fixture(),calls=[];
 f.runtime.register(f.id,{prepare:input=>prepareCommand(input,{
  validate:()=>{calls.push('validate')},
  beforeSubmit:v=>({...v,name:v.name.trim()}),
  mapCommandPayload:v=>({...v,reference:'resolved'}),
  afterSubmit:()=>{calls.push('after')},
 },async payload=>{calls.push(payload);return {accepted:true}})});
 const view=await f.runtime.prepare('Operator',f.id,{name:' Example '});
 assert.deepEqual(view.payload,{name:'Example',reference:'resolved'});
 assert.deepEqual(calls,['validate']);
 const results=await Promise.allSettled([f.runtime.confirm(view.id),f.runtime.confirm(view.id)]);
 assert.equal(results[0].value.status,'accepted');
 assert.equal(results[1].status,'rejected');
 assert.deepEqual(calls,['validate',{name:'Example',reference:'resolved'},'after']);
});
test('stale revisions, user/tenant switches, revocation, disable, unmount and expiry prevent writes',async()=>{
 for(const mutate of [f=>f.scope.revision++,f=>f.scope.user='other',f=>f.scope.tenant='other',f=>f.scope.instance='other',f=>f.scope.policyRevision='2',f=>f.revoke(),f=>f.configuration.enabled=false,f=>f.manifest.assistants[0].bindings=[],f=>f.expire(),f=>f.unregister()]) {
  const f=fixture();let writes=0;
  f.unregister=f.runtime.register(f.id,{prepare:input=>prepareCommand(input,undefined,async()=>{writes++})});
  const proposal=await f.runtime.prepare('Operator',f.id,{});mutate(f);
  await assert.rejects(()=>f.runtime.confirm(proposal.id));assert.equal(writes,0);
 }
});
test('edits during async preparation invalidate proposals',async()=>{
 const f=fixture();
 f.runtime.register(f.id,{prepare:async()=>{f.scope.revision++;return {payload:{},execute:async()=>assert.fail()}}});
 await assert.rejects(()=>f.runtime.prepare('Operator',f.id,{}),/scope changed/);
});
test('transport uncertainty, business rejection and projection delay are different results',async()=>{
 for(const [error,status] of [[new Error('timeout'),'unknown'],[Object.assign(new Error('ineligible'),{statusCode:422}),'rejected'],[Object.assign(new Error('gateway'),{statusCode:502}),'unknown']]){
  const f=fixture();let writes=0;
  f.runtime.register(f.id,{prepare:input=>prepareCommand(input,undefined,async()=>{writes++;throw error})});
  const p=await f.runtime.prepare('Operator',f.id,{});
  assert.equal((await f.runtime.confirm(p.id)).status,status);assert.equal(writes,1);
  await assert.rejects(()=>f.runtime.confirm(p.id));assert.equal(writes,1);
 }
 for(const verified of [true,false]){
  const f=fixture();f.runtime.register(f.id,{prepare:input=>prepareCommand(input,undefined,async()=>({id:'created'})),verify:async()=>verified});
  const p=await f.runtime.prepare('Operator',f.id,{});
  assert.equal((await f.runtime.confirm(p.id)).status,verified?'completed':'accepted');
 }
});
test('post-submit failure is accepted and prepared display values cannot modify execution',async()=>{
 const values={name:'A'};let submitted;
 const prepared=await prepareCommand(values,{afterSubmit:()=>{throw new Error('UI failed')}},async payload=>{submitted=payload;return {id:'created'}});
 values.name='B';prepared.payload.name='C';
 await assert.rejects(()=>prepared.execute(),error=>error.commandAccepted===true);
 assert.deepEqual(submitted,{name:'A'});await assert.rejects(()=>prepared.execute(),/consumed/);
 const f=fixture();f.runtime.register(f.id,{prepare:input=>prepareCommand(input,{afterSubmit:()=>{throw new Error()}},async()=>({id:'created'}))});
 const p=await f.runtime.prepare('Operator',f.id,{});assert.equal((await f.runtime.confirm(p.id)).status,'accepted');
});
test('policy edits invalidate already prepared arguments even if caller forgets to increment revision',async()=>{
 const f=fixture();let writes=0;
 f.runtime.register(f.id,{prepare:input=>prepareCommand(input,undefined,async()=>{writes++})});
 const p=await f.runtime.prepare('Operator',f.id,{});
 f.manifest.capabilities[0].fields.push({name:'newRequiredInput',type:'String'});
 await assert.rejects(()=>f.runtime.confirm(p.id),/Stale/);assert.equal(writes,0);
});
test('responses from a previous identity are not delivered to the new session',async()=>{
 const f=fixture();f.runtime.register(f.id,{prepare:input=>prepareCommand(input,undefined,async()=>{f.scope.tenant='another';return {privateData:'old tenant'}})});
 const p=await f.runtime.prepare('Operator',f.id,{});
 const result=await f.runtime.confirm(p.id);
 assert.equal(result.status,'unknown');assert.equal(result.data,undefined);
});
test('an unavailable completion check is bounded and retains accepted status',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture();
 f.runtime.register(f.id,{prepare:input=>prepareCommand(input,undefined,async()=>({accepted:true})),verify:()=>new Promise(()=>{})});
 const p=await f.runtime.prepare('Operator',f.id,{});
 const result=f.runtime.confirm(p.id);
 await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(3000);
 assert.equal((await result).status,'accepted');
});
