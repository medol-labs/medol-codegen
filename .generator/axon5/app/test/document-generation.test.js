const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const {writeRuntime}=require('../document-generation-writer');
function writer(local=true) {
 const writes=new Map();
 return {writes,model:{rootPackage:'example',documentGeneration:{context:'DocumentGeneration'},slices:local?[{context:'DocumentGeneration',events:[]}]:[]},
 _rootKotlinPath:p=>p,_destPath:p=>p,_kotlinPath:p=>'context/'+p,_testKotlinPath:p=>'test/'+p,templatePath:p=>path.join(__dirname,'../templates',p),
 fs:{exists:p=>writes.has(p),read:p=>writes.get(p),delete:p=>writes.delete(p),write:(p,v)=>writes.set(p,v),copy:(s,t)=>writes.set(t,fs.readFileSync(s,'utf8')),copyTpl:(s,t,o)=>writes.set(t,ejs.render(fs.readFileSync(s,'utf8'),o))}};
}
test('document runtime installs only for owning deployment and rejects tenant mixing',()=>{
 const absent=writer(false);writeRuntime(absent);assert.equal(absent.writes.size,0);
 const tenant=writer();tenant.model.tenancy={};assert.throws(()=>writeRuntime(tenant),/non-tenant/);
 const local=writer();writeRuntime(local);
 assert(local.writes.has('documentgeneration/infrastructure/PdfDocumentRenderer.kt'));
 assert(local.writes.has('src/main/resources/db/migration/V2026110803__document_generation.sql'));
 assert.match(local.writes.get('documentgeneration/infrastructure/DocumentEndpoints.kt'),/Document|service.download\(id,actor\(\)\)/);
});
test('opting out preserves artifacts and migrations while removing owned infrastructure',()=>{
 const g=writer(false);g.writes.set('documentgeneration/infrastructure/DocumentsApi.kt','// Generated MEDOL document-generation');g.writes.set('documentgeneration/infrastructure/DocumentService.kt','old');g.writes.set('src/main/resources/db/migration/V2026110803__document_generation.sql','schema');
 writeRuntime(g);assert(!g.writes.has('documentgeneration/infrastructure/DocumentService.kt'));assert(g.writes.has('src/main/resources/db/migration/V2026110803__document_generation.sql'));
});
