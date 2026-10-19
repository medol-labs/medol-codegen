const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {tenantContract, tenantScoped, tenantAccessQuery, writeTenantRuntimeContract, writeTenantBootstrap} = require('../tenant-support');
const {filterModelByDeployment, readModelMetadataFields} = require('../model-helpers');
const {readModelWriterMethods} = require('../read-model-writer');
const {writeMetadataSupport} = require('../metadata-support');
const {fromConfig, fromCodegenModel, toGeneratorConfig} = require('../../../common/core/codegen-model');
const {applicationWriterMethods} = require('../application-writer');

const tenancy = () => ({
    enabled: true,
    directory: {context: 'Customers', readModel: 'Accounts', mappings: {id: 'accountKey', state: 'status'}},
    memberships: {context: 'Customers', readModel: 'Members', mappings: {id: 'memberKey', tenant: 'accountKey', user: 'personKey', state: 'status'}},
    managementContexts: ['Customers']
});

function generator(model) {
    const files = new Map();
    const eligibility = [{operator: 'AND', conditions: [{left: 'status', operator: '==', right: 'Ready'}]}];
    const slices = [{context: 'Customers', readmodels: [
        {name: 'Accounts', title: 'Customer Accounts', fields: [{name: 'accountKey', type: 'UUID'}, {name: 'status', type: 'String'}], eligibility: structuredClone(eligibility)},
        {name: 'Members', title: 'Customer Members', fields: [{name: 'memberKey', type: 'UUID'}, {name: 'accountKey', type: 'UUID'}, {name: 'personKey', type: 'UUID'}, {name: 'status', type: 'String'}], eligibility: structuredClone(eligibility)}
    ]}];
    return {
        model: {rootPackage: 'sample.app', slices, ...model}, files,
        fs: {write: (path, content) => files.set(path, content), delete: (path) => files.delete(path),
            copyTpl: (source, target, data) => files.set(target, require('ejs').render(fs.readFileSync(source, 'utf8'), data))},
        templatePath: (source) => path.join(__dirname, '../templates', source),
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

test('runtime generation is absent without configuration and removes stale generated files', () => {
    const gen = generator({tenancy: tenancy()});
    writeTenantRuntimeContract(gen);
    assert(gen.files.has('shared/shared/application/tenancy/TenantScope.kt'));
    gen.model.tenancy = undefined;
    writeTenantRuntimeContract(gen);
    assert.equal(gen.files.size, 0);
    assert.equal(tenantScoped(gen.model, 'Orders'), false);
});

test('tenant entry points depend on access contract and schema routing is independently configured', () => {
    const gen = generator({tenancy: tenancy()});
    writeTenantRuntimeContract(gen);
    for (const file of ['TenantDispatchInterceptor.kt', 'TenantWebConfiguration.kt', 'TenantBackgroundRunner.kt']) {
        const code = gen.files.get(`shared/shared/application/tenancy/${file}`);
        assert.match(code, /access: TenantAccess/);
        assert.doesNotMatch(code, /access: SameSchemaTenantAccess/);
    }
    const persistence = gen.files.get('shared/shared/application/tenancy/TenantPersistenceConfiguration.kt');
    assert.match(persistence, /ConditionalOnMissingBean\(TenantAccess::class\)/);
    assert.match(persistence, /ConditionalOnMissingBean\(TenantStorageResolver::class\)/);
    assert.match(persistence, /PROPAGATION_REQUIRES_NEW/);
    assert.match(persistence, /hibernate.default_schema/);
    assert.match(persistence, /connection.schema = resets.remove\(connection\)/);
    assert.match(persistence, /connection.abort/);
    assert.match(gen.files.get('shared/META-INF/medol-tenant-control.orm.xml'), /TokenEntry/);
});

test('only tenant-enabled backend defaults share a database and schema endpoint', () => {
    const gen = generator({domain: 'ExampleSystem', tenancy: tenancy()});
    Object.assign(gen, {currentDeployment: {name: 'Business'}, currentDeploymentIndex: 1,
        _deploymentFrontends: () => [], _externalSystemConfigs: () => [], _integrationClientConfigs: () => [], _syncSourceContextConfigs: () => []});
    const shared = applicationWriterMethods._runtimeConfig.call(gen, 'business');
    assert.equal(shared.dbName, 'example_system_shared');
    assert.equal(shared.dbPort, 5432);
    assert.equal(shared.dockerComposeEnabled, 'false');
    delete gen.model.tenancy;
    const ordinary = applicationWriterMethods._runtimeConfig.call(gen, 'business');
    assert.equal(ordinary.dbName, 'business');
    assert.equal(ordinary.dbPort, 5433);
    assert.equal(ordinary.dockerComposeEnabled, 'true');
});

test('tenant access SQL uses modeled sources, eligibility and bounded indexed lookups', () => {
    const gen = generator({tenancy: tenancy()});
    const query = tenantAccessQuery(gen.model);
    assert.match(query.sql, /JOIN "__medol_control__"\."customers_members"/);
    assert.match(query.sql, /d\."account_key" = :tenant/);
    assert.match(query.sql, /m\."person_key" = :user/);
    assert.match(query.sql, /FETCH FIRST 1 ROW ONLY/);
    assert.deepEqual(query.parameters, {d0: 'Ready', m0: 'Ready'});
    assert.equal(tenantScoped(gen.model, 'Customers'), false);
    assert.equal(tenantScoped(gen.model, 'Orders'), true);
    assert.equal(tenantScoped(gen.model, 'IdentityAccessManagement'), true);
    delete gen.model.slices[0].readmodels[0].eligibility;
    assert.throws(() => tenantAccessQuery(gen.model), /default eligible when/);
});

test('tenant availability never guesses unrelated owners or treats field references as literals', () => {
    const gen = generator({tenancy: tenancy()});
    const directory = gen.model.slices[0].readmodels[0];
    const condition = directory.eligibility[0].conditions[0];
    condition.left = 'Other.status';
    assert.throws(() => tenantAccessQuery(gen.model), /not materialized/);
    condition.left = 'Accounts.status';
    condition.right = 'Accounts.status';
    condition.rightReference = 'Accounts.status';
    assert.match(tenantAccessQuery(gen.model).sql, /d\."status" = d\."status"/);
    condition.rightReference = 'Other.status';
    assert.throws(() => tenantAccessQuery(gen.model), /not materialized/);
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

test('tenant choices use mapped labels, member identity and bounded keyset pagination', () => {
    const gen = generator({tenancy: tenancy()});
    gen.model.tenancy.directory.mappings.label = 'accountName';
    gen.model.slices[0].readmodels[0].fields.push({name: 'accountName', type: 'String'});
    const query = tenantAccessQuery(gen.model);
    assert.match(query.choiceSql, /SELECT DISTINCT d\."account_key", d\."account_name"/);
    assert.match(query.choiceSql, /m\."person_key" = :user/);
    assert.match(query.choiceSql, /d\."status" = :d0 AND m\."status" = :m0/);
    writeTenantRuntimeContract(gen);
    const runtime = gen.files.get('shared/shared/application/tenancy/SameSchemaTenantAccess.kt');
    assert.match(runtime, /require\(size in 1\.\.200\)/);
    assert.match(runtime, / > :after/);
    assert.match(runtime, /\(size \+ 1\)/);
    const web = gen.files.get('shared/shared/application/tenancy/TenantWebConfiguration.kt');
    assert.match(web, /access\.choices\(users\.currentUser\(\)\.id\.toString\(\)/);
    assert.match(web, /PreAuthorize\("isAuthenticated\(\)"\)/);
    assert.ok(web.indexOf('handler.beanType == TenantChoiceResource::class.java') < web.indexOf('request.getHeader("X-Tenant-Id")'));
});

test('flat tenant-enabled applications compile embedded UmaDB without introducing a reactor', () => {
    const template = fs.readFileSync(path.join(__dirname, '../templates/pom.xml.tpl'), 'utf8');
    const render = embeddedInfra => require('ejs').render(template, {
        rootPackage: 'sample.app', appName: 'sample', appPort: 8080,
        hasSharedKernel: false, hasInfra: false, embeddedInfra
    });
    const enabled = render(true);
    assert.match(enabled, /protobuf-maven-plugin/);
    assert.match(enabled, /src\/main\/java/);
    assert.match(enabled, /generated-sources\/protobuf\/java/);
    assert.match(enabled, /<phase>process-test-sources<\/phase>/);
    assert.doesNotMatch(enabled, /<modules>|<artifactId>axon-event-storage-umadb<\/artifactId>/);
    assert.doesNotMatch(render(false), /grpc-netty-shaded|protobuf-maven-plugin/);
});
