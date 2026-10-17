const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {tenantContract, writeTenantRuntimeContract, writeTenantBootstrap} = require('../tenant-support');
const {filterModelByDeployment, readModelMetadataFields} = require('../model-helpers');
const {readModelWriterMethods} = require('../read-model-writer');
const {writeMetadataSupport} = require('../metadata-support');
const {fromConfig, fromCodegenModel, toGeneratorConfig} = require('../../../common/core/codegen-model');

const tenancy = () => ({
    enabled: true,
    directory: {context: 'Customers', readModel: 'Accounts', mappings: {id: 'accountKey', state: 'status'}},
    memberships: {context: 'Customers', readModel: 'Members', mappings: {id: 'memberKey', tenant: 'accountKey', user: 'personKey', state: 'status'}},
    managementContexts: ['Customers']
});

function generator(model) {
    const files = new Map();
    return {
        model: {rootPackage: 'sample.app', ...model}, files,
        fs: {write: (path, content) => files.set(path, content), delete: (path) => files.delete(path)},
        _rootKotlinPath: (path) => `application/${path}`,
        _sharedKernelKotlinPath: (path) => `shared/${path}`
    };
}

test('tenant bootstrap is opt-in and removing capability removes stale generated configuration', () => {
    const gen = generator({tenancy: tenancy()});
    writeTenantBootstrap(gen);
    assert.equal(gen.files.size, 1);
    gen.model.tenancy = undefined;
    writeTenantBootstrap(gen);
    assert.equal(gen.files.size, 0);
    assert.equal(tenantContract(gen.model), undefined);
});

test('provider names do not enable tenant bootstrap without an explicit exported contract', () => {
    const gen = generator({capabilityExtensions: [{
        target: 'OtherCapability',
        providers: [{kind: 'tenantDirectory'}, {kind: 'tenantMemberships'}]
    }]});
    writeTenantBootstrap(gen);
    assert.equal(tenantContract(gen.model), undefined);
    assert.equal(gen.files.size, 0);
});

test('tenant activation consumes the resolved application contract instead of context names', () => {
    assert.equal(tenantContract({contexts: [{name: 'TenantManagement'}]}), undefined);
    assert.deepEqual(tenantContract({tenancy: tenancy()}), tenancy());
});

test('custom provider field mappings reach the runtime contract without builtin table names', () => {
    const gen = generator({tenancy: tenancy()});
    writeTenantRuntimeContract(gen);
    writeTenantBootstrap(gen);
    const bootstrap = gen.files.get('application/infrastructure/tenancy/TenantCapabilityConfiguration.kt');
    assert.match(bootstrap, /readModel = "Accounts"/);
    assert.match(bootstrap, /"tenant" to "accountKey"/);
    assert.doesNotMatch(bootstrap, /TenantCatalog|UserAccountCatalog/);
    assert.match(bootstrap, /check\(adapters.size == 1\)/);
    assert.match(bootstrap, /adapters.single\(\).initialize\(contract\)/);
    assert.doesNotMatch(bootstrap, /ConditionalOnProperty|havingValue/);
});

test('business deployments retain opt-in even when tenant management is hosted elsewhere', () => {
    const model = {
        tenancy: tenancy(),
        contexts: [{name: 'Customers'}, {name: 'Orders'}],
        slices: [{context: 'Orders', readmodels: []}]
    };
    const business = filterModelByDeployment(model, {name: 'Business', contexts: [{name: 'Orders'}]});
    assert.equal(business.contexts.length, 1);
    assert.deepEqual(tenantContract(business), tenancy());
    const normalized = fromCodegenModel(model);
    assert.deepEqual(toGeneratorConfig(normalized).tenancy, tenancy());
});

test('invalid explicit tenant configuration fails instead of switching isolation off', () => {
    for (const value of [null, false, {}, {...tenancy(), enabled: false}, {...tenancy(), directory: {}}, {...tenancy(), managementContexts: []}]) {
        assert.throws(() => tenantContract({tenancy: value}), /Invalid tenant capability/);
        assert.throws(() => tenantContract(fromCodegenModel({tenancy: value})), /Invalid tenant capability/);
        assert.throws(() => tenantContract(toGeneratorConfig(fromConfig({tenancy: value}))), /Invalid tenant capability/);
    }
});

test('business identifiers do not collide with or get overwritten by technical metadata', () => {
    const readmodel = {
        title: 'Tenant Catalog', fields: [
            {name: 'tenantId', type: 'UUID', idAttribute: true},
            {name: 'userId', type: 'UUID'},
            {name: 'metadataTenantId', type: 'String'}
        ]
    };
    const fields = readModelMetadataFields(readmodel);
    assert.equal(fields.find((field) => field.key === 'TENANT_ID').name, 'metadataTenantId2');
    assert.equal(fields.find((field) => field.key === 'USER_ID').name, 'metadataUserId');
    const gen = generator({});
    Object.assign(gen, {
        _kotlinPath: (path) => path,
        _writeReadModelAccessPolicySupport() {}, _writeReadModelJpaRepository() {},
        _writeReadModelResource() {}, _writeReadModelProjector() {},
        _writeDictionaryDataExportLabelProviderIfNeeded() {}
    });
    readModelWriterMethods._writeReadModel.call(gen, 'sample.app.catalog', 'catalog', 'tenants', {}, readmodel);
    const source = gen.files.get('catalog/tenants/TenantCatalogReadModel.kt');
    assert.match(source, /var tenantId: UUID\?/);
    assert.match(source, /var metadataTenantId2: String\?/);
    assert.match(source, /this.metadataTenantId2 = metadata.tenantId/);
    assert.doesNotMatch(source, /this.tenantId = metadata.tenantId/);
    writeMetadataSupport(gen);
    const support = gen.files.get('shared/shared/application/metadata/ProjectionMetadata.kt');
    assert.match(support, /target.assignMetadata\(metadata\)/);
    assert.match(support, /updateTimestamp = false/);
});

test('single-module skeleton declares the client used by its shared Kubernetes configuration', () => {
    const template = fs.readFileSync(path.join(__dirname, '../templates/pom.xml.tpl'), 'utf8');
    const sharedTemplate = fs.readFileSync(path.join(__dirname, '../templates/shared-kernel/pom.xml.tpl'), 'utf8');
    const version = sharedTemplate.match(/<fabric8-kubernetes-client.version>([^<]+)</)[1];
    assert(template.includes(`<fabric8-kubernetes-client.version>${version}</fabric8-kubernetes-client.version>`));
    assert.match(template, /<groupId>io\.fabric8<\/groupId>\s*<artifactId>kubernetes-client<\/artifactId>\s*<version>\$\{fabric8-kubernetes-client.version\}<\/version>/);
});
