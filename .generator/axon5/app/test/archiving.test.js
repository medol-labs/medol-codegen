const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const {writeRuntime, localArchiving} = require('../archiving-writer');
function writer(local=true) {
 const writes = new Map();
 return {writes,model:{rootPackage:'example',archiving:{context:'Archiving'},slices:local?[{context:'Archiving'}]:[]},
  _rootKotlinPath:p=>p,_destPath:p=>p,_kotlinPath:p=>'context/'+p,_testKotlinPath:p=>'test/'+p,
  templatePath:p=>path.join(__dirname,'../templates',p),fs:{
   exists:p=>writes.has(p),read:p=>writes.get(p),delete:p=>writes.delete(p),
   copy:(s,t)=>writes.set(t,fs.readFileSync(s,'utf8')),
   copyTpl:(s,t,o)=>writes.set(t,ejs.render(fs.readFileSync(s,'utf8'),o))}};
}
test('archiving emits runtime only for its owning deployment',()=>{
 const g=writer(false);writeRuntime(g);assert.equal(g.writes.size,0);
 assert.equal(localArchiving(g),false);
});
test('tenant models fail closed until archive identities and authorization are tenant-aware',()=>{
 const g=writer();g.model.tenancy={};assert.throws(()=>writeRuntime(g),/non-tenant/);
});
test('regeneration removes owned runtime and preserves durable migrations and business adapters',()=>{
 const g=writer(false);g.writes.set('archiving/infrastructure/ArchivingApi.kt','// Generated MEDOL archiving contract.');
 g.writes.set('archiving/infrastructure/ArchivingRuntime.kt','runtime');
 g.writes.set('src/main/resources/db/migration/V2026110802__archiving.sql','schema');
 g.writes.set('infrastructure/orders/OrderArchiveAdapter.kt','custom');
 writeRuntime(g);
 assert(!g.writes.has('archiving/infrastructure/ArchivingRuntime.kt'));
 assert(g.writes.has('src/main/resources/db/migration/V2026110802__archiving.sql'));
 assert(g.writes.has('infrastructure/orders/OrderArchiveAdapter.kt'));
});
test('local archiving connects event integration, authenticated history and durable journal',()=>{
 const g=writer();writeRuntime(g);
 assert(g.writes.has('src/main/resources/db/migration/V2026110802__archiving.sql'));
 assert.match(g.writes.get('archiving/infrastructure/ArchivingIntegration.kt'),/@DisallowReplay/);
 assert.match(g.writes.get('archiving/infrastructure/ArchivingIntegration.kt'),/cutoffAt.toInstant\(ZoneOffset.UTC\)/);
 assert.match(g.writes.get('archiving/infrastructure/ArchivingEndpoints.kt'),/PreAuthorize/);
});
