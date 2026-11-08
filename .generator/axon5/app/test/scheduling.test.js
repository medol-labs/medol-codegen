const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const {writeRuntime}=require('../scheduling-writer');
function writer(local, targets=[],tenancy) {
 const writes=new Map();
 return {writes,model:{rootPackage:'example',scheduling:{context:'Scheduling',targets},tenancy,slices:local?[{context:'Scheduling',events:[]}]:[]},
  _rootKotlinPath:p=>p,_destPath:p=>p,_kotlinPath:p=>'context/'+p,_testKotlinPath:p=>'test/'+p,templatePath:p=>path.join(__dirname,'../templates',p),
  fs:{delete:p=>writes.delete(p),copy:(s,t)=>writes.set(t,fs.readFileSync(s,'utf8')),copyTpl:(s,t,o)=>writes.set(t,ejs.render(fs.readFileSync(s,'utf8'),o))}};
}
test('scheduling has a local provider boundary and durable operational data',()=>{
 const g=writer(true);writeRuntime(g);
 assert(g.writes.has('scheduling/infrastructure/SnailJobProvider.kt'));
 assert(g.writes.has('src/main/resources/db/migration/V2026110701__scheduling.sql'));
 assert.match(g.writes.get('scheduling/infrastructure/SchedulingStore.kt'),/DisallowReplay/);
 assert.match(g.writes.get('scheduling/infrastructure/SchedulingStore.kt'),/CheckScheduledOccurrence/);
 assert.match(g.writes.get('scheduling/infrastructure/SchedulingApi.kt'),/interface SchedulingProvider/);
});
test('target-only deployments do not generate a scheduler or its schema',()=>{
 const g=writer(false);writeRuntime(g);
 assert.deepEqual([...g.writes.keys()],['scheduling/infrastructure/SchedulingApi.kt','scheduling/infrastructure/SchedulingTargets.kt']);
});
test('control-plane operational tables and transactions preserve tenant isolation',()=>{
 const g=writer(true,[],{managementContexts:['Scheduling']});writeRuntime(g);
 assert.match(g.writes.get('scheduling/infrastructure/SchedulingStore.kt'),/schema="__medol_control__"/);
 assert.match(g.writes.get('scheduling/infrastructure/SchedulingStore.kt'),/TenantScope.control/);
});
test('removing scheduling cleans only owned runtime code, preserving migrations',()=>{
 const g=writer(false);delete g.model.scheduling;
 const deleted=[];g.fs.exists=()=>true;g.fs.read=p=>p.endsWith('SchedulingApi.kt')?'// Generated MEDOL scheduling contract.':'SchedulingLogic';g.fs.delete=p=>deleted.push(p);
 writeRuntime(g);assert(deleted.includes('scheduling/infrastructure'));assert(deleted.includes('context/scheduling'));assert(!deleted.some(p=>p.includes('migration')));
});

test('relocating scheduling removes old scheduler components from target-only deployments',()=>{
 const g=writer(false);g.writes.set('scheduling/infrastructure/SchedulingLogic.kt','old');g.writes.set('scheduling/infrastructure/SnailJobProvider.kt','old');
 writeRuntime(g);assert(!g.writes.has('scheduling/infrastructure/SchedulingLogic.kt'));assert(!g.writes.has('scheduling/infrastructure/SnailJobProvider.kt'));
});
