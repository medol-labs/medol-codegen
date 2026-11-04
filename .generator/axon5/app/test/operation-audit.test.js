const test = require('node:test');
const assert = require('node:assert/strict');
const {writeOperationAudit, cleanupOperationAudit} = require('../operation-audit-writer');
const {applicationWriterMethods} = require('../application-writer');
const {writeMetadataSupport} = require('../metadata-support');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('audit adapter is explicit, read-only, context-scoped and observes transaction completion', () => {
    const writes = new Map();
    const fields = ['auditRecordId','occurredAt','completedAt','category','operation','outcome','actorId','auditTenantId','messageId','correlationId','targetId','durationMs','errorCode','httpStatus'].map(name => ({name}));
    const model = {rootPackage: 'example', slices: [{context: 'Orders', commands: [{fields: [], dependencies: []}], events: [{name: 'OrderAccepted', title: 'Order Accepted'}]}]};
    const writer = {model, _kotlinPath: name => name, templatePath: name => path.join(__dirname, '../templates', name),
        fs: {copyTpl: (source, target, options) => writes.set(target, ejs.render(fs.readFileSync(source, 'utf8'), options))}};
    const options = {packageName: 'example.audit.catalog', context: 'audit', slicePackage: 'catalog', slice: {context: 'Audit'}, readmodel: {name: 'Catalog', fields}, name: 'CatalogReadModel'};
    writeOperationAudit(writer, options);
    assert.equal(writes.size, 0);
    model.operationAudit = {context: 'Audit', readModel: 'Catalog'};
    writeOperationAudit(writer, options);
    const output = [...writes.values()][0];
    assert.match(output, /val tenant: String\? = null/);
    assert.match(output, /context.whenComplete/);
    assert.match(output, /context.onError[\s\S]*record\(failed\)/);
    assert.match(output, /completed.isCommitted && !completed.isError/);
    assert.match(output, /PROPAGATION_REQUIRES_NEW/);
    assert.match(output, /AsyncListener/);
    assert.doesNotMatch(output, /writeValueAsString|eventGateway|commandGateway|getQueryString/);
    assert.doesNotMatch(output, /repository.save/);
    assert.match(output, /stores.getObject\(\).publish\(null, listOf\(message\)\)/);
    const projection = writes.get('audit/catalog/AuditTrailProjection.kt');
    assert.match(projection, /private val repository: CatalogReadModelRepository/);
    assert.match(projection, /event is OperationExecutionRecorded/);
    assert.match(projection, /fun onRecorded\(event: OperationExecutionRecorded/);
    assert.match(projection, /fun onBusiness0\(event: example.orders.events.OrderAcceptedEvent/);
    assert.doesNotMatch(projection, /@EventHandler\s+fun on\(event: Any/);
    assert.match(projection, /repository.findById\(id\) == null/);
    assert.doesNotMatch(projection, /catch \(|publish\(/);
    assert.match(projection, /audit-application-trail-v2/);
    assert.throws(() => writeOperationAudit(writer, {...options, readmodel: {name: 'Catalog', fields: []}}), /required infrastructure fields/);
});

for (const tenancy of [undefined, {}]) test(`metadata identity is trusted and legacy event audit excludes payload, tenancy=${!!tenancy}`, () => {
    const writes = new Map();
    writeMetadataSupport({model: {rootPackage: 'example', tenancy}, _sharedKernelKotlinPath: name => name,
        fs: {write: (name, value) => writes.set(name, value), delete: name => writes.delete(name)}});
    const factory = writes.get('shared/application/metadata/MetadataFactory.kt');
    assert.doesNotMatch(factory, /header\(request, MetadataHeaders.USER_ID\)/);
    assert.match(factory, /medol.audit.correlationId/);
    assert.equal(writes.has('shared/application/metadata/AuditTrailProjection.kt'), false);
    assert.equal(writes.has('shared/application/metadata/AuditTrailResource.kt'), false);
});


test('audit processor is opt-in and scoped to its local deployment', () => {
    const contract = {context: 'OperationAudit', readModel: 'OperationAuditCatalog'};
    const scope = {currentDeployment: {name: 'Support'}, model: {operationAudit: contract, slices: []}};
    assert.deepEqual(applicationWriterMethods._eventProcessorNamespaces.call(scope), []);
    scope.model.slices = [{context: 'OperationAudit', readmodels: [{name: 'OperationAuditCatalog'}]}];
    assert(applicationWriterMethods._eventProcessorNamespaces.call(scope).includes('audit-support-trail-v2'));
    scope.currentDeployment.name = 'Agent';
    assert(applicationWriterMethods._eventProcessorNamespaces.call(scope).includes('audit-agent-trail-v2'));
});


test('regeneration removes old audit sources and declares a shared versioned event only when imported', () => {
    const writes = new Map();
    const legacy = ['AuditLogEntry.kt', 'AuditLogRepository.kt', 'AuditTrailProjection.kt', 'AuditTrailResource.kt'];
    for (const file of legacy) writes.set('shared/application/metadata/' + file, 'legacy');
    const writer = {model: {rootPackage: 'example', operationAudit: {context: 'OperationAudit', readModel: 'OperationAuditCatalog'}},
        _sharedKernelKotlinPath: name => name, templatePath: name => path.join(__dirname, '../templates', name),
        fs: {write: (name, value) => writes.set(name, value), delete: name => writes.delete(name),
            copyTpl: (source, target, options) => writes.set(target, ejs.render(fs.readFileSync(source, 'utf8'), options))}};
    writeMetadataSupport(writer);
    for (const file of legacy) assert.equal(writes.has('shared/application/metadata/' + file), false);
    assert.match(writes.get('shared/application/metadata/OperationExecutionRecorded.kt'), /@Event\(namespace = "medol.audit"/);
    delete writer.model.operationAudit;
    writeMetadataSupport(writer);
    assert.equal(writes.has('shared/application/metadata/OperationExecutionRecorded.kt'), false);
});


test('disabling or relocating audit removes owned adapters but preserves custom sources', () => {
    const support = 'operationaudit/operationauditcatalog/OperationAuditSupport.kt';
    const projection = 'operationaudit/operationauditcatalog/AuditTrailProjection.kt';
    const files = new Map([[support, 'class OperationAuditRecorder { // medol.audit.httpState'],
        [projection, '// Generated by MEDOL operation-audit.\nclass AuditTrailProjection']]);
    const generator = {model: {slices: []}, _kotlinPath: name => name,
        fs: {exists: name => files.has(name), read: name => files.get(name), delete: name => files.delete(name)}};
    cleanupOperationAudit(generator);
    assert.equal(files.size, 0);
    files.set(projection, 'class AuditTrailProjection { /* custom implementation */ }');
    cleanupOperationAudit(generator);
    assert.equal(files.size, 1);
});
