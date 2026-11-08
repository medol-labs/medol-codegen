const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const {writeRuntime,isManagement}=require('../management-writer');
function writer(capabilities={organizationManagement:{context:'OrganizationManagement'},systemConfiguration:{context:'SystemConfiguration'}}) {
 const writes=new Map();
 return {writes,model:{rootPackage:'example',...capabilities,slices:Object.values(capabilities).filter(v=>v?.context).map(v=>({context:v.context,events:[],commands:[]}))},
 _rootKotlinPath:p=>p,_destPath:p=>p,_kotlinPath:p=>'context/'+p,_testKotlinPath:p=>'test/'+p,templatePath:p=>path.join(__dirname,'../templates',p),
 fs:{exists:p=>writes.has(p),read:p=>writes.get(p),delete:p=>writes.delete(p),write:(p,v)=>writes.set(p,v),copy:(s,t)=>writes.set(t,fs.readFileSync(s,'utf8')),copyTpl:(s,t,o)=>writes.set(t,ejs.render(fs.readFileSync(s,'utf8'),o))}};
}
test('management is explicitly opted in and only emitted on owning deployments',()=>{
 assert.equal(isManagement({},'OrganizationManagement'),false);
 const absent=writer({});writeRuntime(absent);assert.equal(absent.writes.size,0);
 const remote=writer();remote.model.slices=[];writeRuntime(remote);assert.equal(remote.writes.size,0);
 const local=writer();writeRuntime(local);assert(local.writes.has('management/infrastructure/OrganizationService.kt'));assert(local.writes.has('management/infrastructure/SystemConfigurationService.kt'));
});
test('configuration tenancy uses the established access verifier; organization mixing is rejected',()=>{
 const org=writer();org.model.tenancy={};assert.throws(()=>writeRuntime(org),/does not support tenancy/);
 const config=writer({systemConfiguration:{context:'SystemConfiguration'}});config.model.tenancy={};writeRuntime(config);
 assert.match(config.writes.get('management/infrastructure/SystemConfigurationService.kt'),/tenants.verify\(id,actor\)/);
 assert(!config.writes.has('management/infrastructure/OrganizationService.kt'));
});
test('disabling a capability removes owned adapters but retains durable migration data',()=>{
 const g=writer();writeRuntime(g);g.model.organizationManagement=undefined;g.model.slices=g.model.slices.filter(s=>s.context!=='OrganizationManagement');writeRuntime(g);
 assert(!g.writes.has('management/infrastructure/OrganizationService.kt'));assert(g.writes.has('management/infrastructure/SystemConfigurationService.kt'));
 assert(g.writes.has('src/main/resources/db/migration/V2026110804__management.sql'));
});
test('calendar runtime is independently scoped and adds a migration without changing existing locks',()=>{
 const g=writer({businessCalendar:{context:'BusinessCalendar'}});writeRuntime(g);
 assert(g.writes.has('management/infrastructure/BusinessCalendarService.kt'));
 assert(!g.writes.has('management/infrastructure/OrganizationService.kt'));
 assert.match(g.writes.get('management/infrastructure/ManagementOutboxPublisher.kt'),/capability in \('calendar'\)/);
 assert(g.writes.has('src/main/resources/db/migration/V2026110805__business_calendar.sql'));
 g.model.tenancy={};assert.throws(()=>writeRuntime(g),/does not support tenancy/);
});
test('reporting runtime is opt-in, owns its migration and cleans adapters without deleting durable records',()=>{
 const g=writer({reporting:{context:'Reporting'}});writeRuntime(g);
 assert(g.writes.has('management/infrastructure/ReportingService.kt'));
 assert(g.writes.has('management/infrastructure/ReportingWorker.kt'));
 assert(g.writes.has('src/main/resources/db/migration/V2026110806__reporting.sql'));
 assert.match(g.writes.get('management/infrastructure/ManagementOutboxPublisher.kt'),/capability in \('reporting'\)/);
 assert(!g.writes.has('management/infrastructure/OrganizationService.kt'));
 g.model.tenancy={};assert.throws(()=>writeRuntime(g),/does not support tenancy/);delete g.model.tenancy;
 g.model.reporting=undefined;g.model.slices=[];writeRuntime(g);
 assert(!g.writes.has('management/infrastructure/ReportingService.kt'));
 assert(g.writes.has('src/main/resources/db/migration/V2026110806__reporting.sql'));
});
