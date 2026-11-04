const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const {writeNumberingRuntime, numberAssignments} = require('../numbering-writer');
function writer(tenancy, local=true) {
    const writes=new Map();
    return {writes,model:{rootPackage:'example',numbering:{context:'Numbering'},tenancy,slices:local?[{context:'Numbering',commands:[],events:[]}]:[]},
        _rootKotlinPath:p=>p,_destPath:p=>p,templatePath:p=>path.join(__dirname,'../templates',p),
        fs:{delete:p=>writes.delete(p),copyTpl:(source,target,options)=>writes.set(target,ejs.render(fs.readFileSync(source,'utf8'),options))}};
}
for(const tenancy of [undefined,{}]) test(`numbering authoritative storage and outbox, tenancy=${!!tenancy}`,()=>{
    const g=writer(tenancy);writeNumberingRuntime(g);
    const service=g.writes.get('numbering/infrastructure/NumberingService.kt');
    assert.match(service,/PROPAGATION_REQUIRES_NEW/);
    assert.match(service,/PESSIMISTIC_WRITE/);
    assert(service.indexOf('if (previous != null)')<service.indexOf('if (found.status != "Active")'));
    assert.match(service,/Math.addExact\(start, request.count.toLong\(\) - 1\)/);
    assert.doesNotMatch(service,/Redis|MAX\(|max\(/);
    const publisher=g.writes.get('numbering/infrastructure/NumberingOutboxPublisher.kt');
    assert.match(publisher,/row.id.toString\(\)/);
    if(tenancy) assert.match(publisher,/if \(processed != true\) return@control/);
    assert(g.writes.has('src/main/resources/db/migration/V2026110401__numbering.sql'));
});
test('remote deployment has client but no local allocator or migrations',()=>{
    const g=writer(undefined,false);writeNumberingRuntime(g);
    assert.deepEqual([...g.writes.keys()],['shared/application/numbering/NumberingClient.kt']);
    const client=[...g.writes.values()][0];assert.match(client,/X-MEDOL-INTERNAL-TOKEN/);
    assert.match(client,/medol.numbering.base-url/);
});
test('field binding uses stable field and object identity and trusted tenant scope',()=>{
    const g=writer({});
    const code=numberAssignments(g,{context:'Orders'},{name:'Create',fields:[{name:'id',idAttribute:true},{name:'code',numbering:{rule:'order'}}]});
    assert.match(code,/numbering.requestKey\("Orders.Create.code"/);
    assert.match(code,/TenantScope.current\(\)\?\.tenantId/);
    assert.match(code,/value.length/);
    assert.doesNotMatch(code,/command.code|randomUUID/);
});
test('pre-allocation validation defers assertions on computed numbering fields',()=>{
    const {renderCommandAssertions}=require('../command-assertions');
    const command={name:'Create',fields:[{name:'code',type:'String'},{name:'name',type:'String'}]};
    const slice={commands:[command],specifications:[{expressions:['assert Create.code != ""','assert Create.name != ""']}]};
    const before=renderCommandAssertions({rootPackage:'example'},slice,command,{excludeFields:['code']});
    assert.doesNotMatch(before,/command.code/);assert.match(before,/command.name/);
    assert.match(renderCommandAssertions({rootPackage:'example'},slice,command),/command.code/);
});
test('removing builtin numbering cleans its generated command endpoints but preserves migrations',()=>{
    const g=writer(undefined,false);
    g.model.numbering=undefined;
    const deleted=[];
    g._kotlinPath=p=>'context/'+p;
    g._testKotlinPath=p=>'test/'+p;
    g.fs.exists=p=>p.endsWith('DefineNumberingRuleCommandHandler.kt');
    g.fs.read=()=> 'private val service: example.numbering.infrastructure.NumberingService';
    g.fs.delete=p=>deleted.push(p);
    writeNumberingRuntime(g);
    assert(deleted.includes('context/numbering'));
    assert(deleted.includes('test/numbering'));
    assert(!deleted.some(p=>p.includes('db/migration')));
});
