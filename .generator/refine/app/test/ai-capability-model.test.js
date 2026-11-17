const test=require('node:test');const assert=require('node:assert/strict');
const {resolveCapabilities,resolveAssistant,resolveConfiguration,writeCapabilities}=require('../ai-capability-model');
const model={agentAssistance:{assistants:[{name:'operator',mode:'operator',bindings:[{kind:'command',context:'Orders',element:'CreateOrder',confirmation:'required'}]},{name:'chat',mode:'chat',bindings:[]},{name:'bi',mode:'bi',bindings:[]}]},slices:[{context:'Orders',name:'Create',commands:[{id:'c1',name:'CreateOrder',fields:[{name:'id',type:'UUID',generated:true},{name:'name',type:'String'}]}],readmodels:[{id:'r1',name:'Orders',fields:[]}]}]};
test('candidate generation is deterministic, opt-in and excludes generated command inputs',()=>{
 const result=resolveCapabilities(model);assert.deepEqual(result,resolveCapabilities(model));
 assert(result.capabilities.every(c=>c.exposure==='disabled'));
 assert.deepEqual(result.capabilities.find(c=>c.kind==='command').fields.map(f=>f.name),['name']);
});
test('profiles cannot expose unknown tools or elevate read-only assistants',()=>{
 const manifest=resolveCapabilities(model);const command=manifest.capabilities.find(c=>c.kind==='command');
 assert.throws(()=>resolveAssistant(manifest,{id:'chat',mode:'chat',capabilities:[command.id]}),/Read-only/);
 assert.throws(()=>resolveAssistant(manifest,{id:'bi',mode:'bi',capabilities:['unknown']}),/Unknown/);
 assert.equal(resolveAssistant(manifest,{id:'operator',mode:'operator',capabilities:[command.id]})[0].confirmation,'required');
});
test('regeneration preserves developer assistant configuration',()=>{
 const files=new Map([['src/ai/assistants.custom.json',JSON.stringify({enabled:false,profiles:[]})]]);
 const g={destinationPath:p=>p,templatePath:p=>p,fs:{copy:()=>{},read:p=>files.get(p),write:(p,v)=>files.set(p,v),exists:p=>files.has(p)}};
 writeCapabilities(g,model);assert.equal(files.get('src/ai/assistants.custom.json'),JSON.stringify({enabled:false,profiles:[]}));assert(files.has('src/ai/capabilities.generated.json'));
});

test('real export semantics exclude technical, derived, numbered and port-output inputs',()=>{
 const fixture=structuredClone(model);
 fixture.slices[0].commands[0].fields.push(
  {name:'tenant',type:'String',technicalAttribute:true},
  {name:'snapshot',type:'String',source:{kind:'derived',from:['Catalog.name']}},
  {name:'number',type:'String',numbering:{rule:'Order'}},
  {name:'external',type:'String',portOutput:true});
 assert.deepEqual(resolveCapabilities(fixture).capabilities.find(c=>c.kind==='command').fields.map(f=>f.name),['name']);
 // Moving a slice does not invalidate a declared Context.Command identity.
 fixture.slices[0].commands[0].id='changed-parser-id';
 assert.deepEqual(resolveCapabilities(fixture).capabilities.map(c=>c.id),resolveCapabilities(model).capabilities.map(c=>c.id));
});
test('preserved profiles are validated even when globally disabled',()=>{
 const manifest=resolveCapabilities(model), id=manifest.capabilities.find(c=>c.kind==='command').id;
 const config={enabled:false,profiles:[{id:'operator',mode:'operator',capabilities:[id]}]};
 assert.deepEqual(resolveConfiguration(manifest,config),[]);
 assert.throws(()=>resolveConfiguration(manifest,{...config,profiles:[{...config.profiles[0],capabilities:[id,id]}]}),/duplicate/);
 const revoked=structuredClone(manifest);revoked.assistants[0].bindings=[];
 assert.throws(()=>resolveConfiguration(revoked,config),/boundary/);
 const files=new Map([['src/ai/assistants.custom.json',JSON.stringify({...config,enabled:true,profiles:[{id:'unknown',mode:'operator',capabilities:[]}]})]]);
 const generator={destinationPath:p=>p,fs:{exists:p=>files.has(p),read:p=>files.get(p),write:()=>assert.fail('Must validate before emitting output')}};
 assert.throws(()=>writeCapabilities(generator,model),/not declared/);
});
