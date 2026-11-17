const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createAgentStore}=require('../templates/agent-runtime/src/ai/store.ts');
const {bindRuntimeCapabilities}=require('../ai-runtime-writer');

test('runtime bindings reach cloned form objects and create routes do not require an existing id',()=>{
 const command={id:'c1',name:'createOrder',requiresPage:true,interactionMode:'form',route:'create-order',dataProviderName:'orders',fields:[{name:'name'},{name:'customerId',select:{}}]};
 const resource={name:'orders',route:'orders',commands:[structuredClone(command)],createCommand:structuredClone(command),itemCommands:[],routedCommands:[]};
 const manifest={capabilities:[{id:'cap',kind:'command',reference:{modelId:'c1'},fields:[{name:'name'},{name:'customerId'}]}]};
 bindRuntimeCapabilities(manifest,{resources:[resource]});
 assert.equal(resource.createCommand.agentCapabilityId,'cap');
 assert.deepEqual(resource.createCommand.agentWritableFields,['name']);
 assert.equal(manifest.capabilities[0].binding.route,'/orders/command/create-order');
});
test('file and custom commands fail closed without a specialized adapter',()=>{
 const command={id:'c1',requiresPage:true,interactionMode:'form',hasFileFields:true};
 const manifest={capabilities:[{id:'cap',kind:'command',reference:{modelId:'c1'},fields:[]}]};
 bindRuntimeCapabilities(manifest,{resources:[{commands:[command]}]});
 assert.equal(manifest.capabilities[0].binding,undefined);assert.match(manifest.capabilities[0].unavailableReason,/specialized/);
});
test('unmount cancels an unconfirmed proposal but not an already submitted command',async()=>{
 const store=createAgentStore();const unregister=store.register('cap',{instance:'form'});
 const proposal={id:'p',scope:{instance:'form'}};
 const result=store.ask(proposal,'Create',async()=>({status:'accepted'}),()=>{});
 const confirmation=store.pending();
 await confirmation.confirm();unregister();assert.equal((await result).status,'accepted');
 const unregister2=store.register('cap',{instance:'form'});
 const cancelled=store.ask(proposal,'Create',async()=>assert.fail('Must not execute'),()=>{});
 unregister2();assert.equal((await cancelled).status,'rejected');
});
test('unmount during submission retains its accepted response and duplicate clicks do not submit again',async()=>{
 const store=createAgentStore();let release,writes=0;
 const unregister=store.register('cap',{instance:'form'});
 const result=store.ask({id:'p',scope:{instance:'form'}},'Create',async()=>{writes++;await new Promise(resolve=>{release=resolve});return {status:'accepted'};},()=>{});
 const confirmation=store.pending();const executing=confirmation.confirm();
 unregister();assert(store.pending());await confirmation.confirm();assert.equal(writes,1);
 release();await executing;assert.equal((await result).status,'accepted');
});
test('unknown outcomes require explicit user acknowledgement before any new attempt',()=>{
 const store=createAgentStore();store.recordResult('cap','form',1,{status:'unknown'});
 assert.throws(()=>store.assertCanPrepare('cap','another-form',2),/unknown/);
 store.acknowledgeUnknown('cap');assert.doesNotThrow(()=>store.assertCanPrepare('cap','another-form',2));
 store.recordResult('cap','form',2,{status:'accepted'});
 assert.throws(()=>store.assertCanPrepare('cap','form',2),/already submitted/);
});
test('private session snapshots do not cross account, tenant or assistant boundaries',async()=>{
 const {createSessionRepository}=await import('../templates/agent-runtime/agent-service/sessions.mjs');
 const directory=fs.mkdtempSync('/tmp/agent-session-test-');
 try {
  const repo=createSessionRepository(directory),owner={user:'u',tenant:'t',assistant:'a'},id=crypto.randomUUID();
  const messages=[{id:'m',role:'user',parts:[{type:'text',content:'Private request'}]}];
  await repo.save(owner,id,messages);assert.deepEqual((await repo.load(owner,id)).messages,messages);
  for(const other of [{...owner,user:'v'},{...owner,tenant:'x'},{...owner,assistant:'b'}]){
   assert.deepEqual((await repo.load(other,id)).messages,[]);assert.deepEqual(await repo.list(other),[]);
  }
  await assert.rejects(()=>repo.save(owner,'../../escape',messages));
  await assert.rejects(()=>repo.save(owner,id,[{id:'m',role:'assistant',parts:[{type:'tool-call',state:'approval-requested'}]}],1),/Pending/);
  const concurrent=await Promise.allSettled([repo.save(owner,id,messages,1),repo.save(owner,id,messages,1)]);
  assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(concurrent.find(result=>result.status==='rejected').reason.status,409);
  assert.equal((await repo.load(owner,id)).revision,2);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
