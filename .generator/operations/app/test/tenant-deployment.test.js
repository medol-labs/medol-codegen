const assert = require('node:assert/strict');
const test = require('node:test');
const {buildOperationsModel} = require('../operations-model-builder');
const {resolveOperationsModel} = require('../environment-resolver');
const {generateOperationsFiles} = require('../operations-generator');
const {resolveTenantStorage, tenantStorageYaml} = require('../tenant-deployment');

const source = {
    domain: 'TenantExample', tenancy: {enabled: true},
    deployments: [{name: 'Business', contexts: [{name: 'Records'}]}, {name: 'Support', contexts: [{name: 'TenantManagement'}]}],
    contexts: [{name: 'Records'}, {name: 'TenantManagement'}]
};
const config = {
    tenancy: {mode: 'separate-schema', controlSchema: 'control', schemas: {'Company.A-1': 'company_a'}, migration: {enabled: true}},
    environments: {prod: {tenancy: {schemas: {'Company.B-2': 'company_b'}, startupTimeoutSeconds: 900}}}
};

test('tenant deployment options remain opt-in and keep ordinary output unchanged', () => {
    const ordinary = {...source, tenancy: undefined};
    const expected = generateOperationsFiles(buildOperationsModel(ordinary));
    const actual = generateOperationsFiles(buildOperationsModel(ordinary, {tenancy: {mode: 'invalid', migration: {password: 'not-used'}}}));
    assert.deepEqual(actual, expected);
    assert(!Object.keys(actual).some((name) => name.includes('tenant-storage')));
    const enabled = generateOperationsFiles(buildOperationsModel(source));
    const yaml = enabled['operations/dev/configuration/tenant-storage.yml'];
    assert.match(yaml, /mode: "shared-schema"/);
    assert.match(yaml, /enabled: false/);
    assert.doesNotMatch(yaml, /ddl-auto/);
});

test('environment storage bindings replace base bindings without mutating the source model', () => {
    const model = buildOperationsModel(source, config);
    const snapshot = JSON.stringify(model);
    const prod = resolveOperationsModel(model, 'prod');
    const dev = resolveOperationsModel(model, 'dev');
    assert.equal(JSON.stringify(model), snapshot);
    for (const app of prod.applications.filter((app) => app.kind === 'backend')) {
        assert.deepEqual(app.tenantStorage.schemas, {'Company.B-2': 'company_b'});
        assert.equal(app.healthCheck.startupTimeoutSeconds, 900);
        assert.equal(app.healthCheck.startPeriodSeconds, 900);
        assert.equal(app.environmentVariables.find((item) => item.name === 'DB_SCHEMA').value, '${DB_SCHEMA:-control}');
    }
    assert.deepEqual(dev.applications.find((app) => app.kind === 'backend').tenantStorage.schemas, {'Company.A-1': 'company_a'});
    assert.equal(prod.applications.find((app) => app.kind === 'frontend').tenantStorage, undefined);
});

test('compose kubernetes and k3s share exact storage configuration and safe startup settings', () => {
    const files = generateOperationsFiles(buildOperationsModel(source, config), {environment: 'prod'});
    const yaml = files['operations/prod/configuration/tenant-storage.yml'];
    assert.match(files['operations/prod/.env-example'], /DB_SCHEMA=control/);
    assert.match(yaml, /"\[Company.B-2\]": "company_b"/);
    assert.match(yaml, /ddl-auto: "none"/);
    assert.match(files['operations/prod/docker-compose/docker-compose.yml'], /tenant-storage.yml:\/etc\/medol\/tenant-storage.yml:ro/);
    assert.match(files['operations/prod/docker-compose/docker-compose.yml'], /start_period: "900s"/);
    for (const target of ['kubernetes', 'k3s']) {
        const prefix = `operations/prod/${target}`;
        const maps = files[`${prefix}/environments/prod/configmap.yaml`];
        assert(maps.includes(`"tenant-storage.yml": ${JSON.stringify(yaml)}`));
        const workloads = files[`${prefix}/base/applications.yaml`];
        assert.equal((workloads.match(/startupProbe:/g) ?? []).length, 2);
        assert.equal((workloads.match(/type: "Recreate"/g) ?? []).length, 2);
        assert.match(workloads, /progressDeadlineSeconds: 1020/);
        assert.match(workloads, /failureThreshold: 90/);
        assert.doesNotMatch(workloads, /initialDelaySeconds: 900/);
        assert.match(workloads, /readOnly: true/);
        assert.match(workloads, /medol.dev\/tenant-storage-checksum/);
        assert.match(files[`${prefix}/README.md`], /Never automatically clean, repair/);
    }
});

test('migration credentials use explicit secrets without generated defaults or ConfigMap leakage', () => {
    const model = buildOperationsModel(source, {
        ...config, applications: {business: {environmentVariables: [
            {name: 'MEDOL_TENANCY_MIGRATION_USERNAME', valueFromSecret: {name: 'ddl-account', key: 'username'}},
            {name: 'MEDOL_TENANCY_MIGRATION_PASSWORD', valueFromSecret: {name: 'ddl-account', key: 'password'}}
        ]}}
    });
    const files = generateOperationsFiles(model);
    const deployment = files['operations/dev/kubernetes/base/applications.yaml'];
    assert.match(deployment, /name: "MEDOL_TENANCY_MIGRATION_USERNAME"[\s\S]*name: "ddl-account"/);
    assert.doesNotMatch(files['operations/dev/kubernetes/environments/dev/configmap.yaml'], /MEDOL_TENANCY_MIGRATION_(USERNAME|PASSWORD)/);
    assert.doesNotMatch(files['operations/dev/kubernetes/environments/dev/secrets.example.yaml'], /MEDOL_TENANCY_MIGRATION_(USERNAME|PASSWORD)/);
    assert.match(files['operations/dev/docker-compose/docker-compose.yml'], /MEDOL_TENANCY_MIGRATION_USERNAME.*Set MEDOL_TENANCY_MIGRATION_USERNAME/);
    const defaults = generateOperationsFiles(buildOperationsModel(source, config));
    assert.doesNotMatch(defaults['operations/dev/docker-compose/docker-compose.yml'], /MEDOL_TENANCY_MIGRATION_(USERNAME|PASSWORD)/);
});

test('storage settings reject invalid bindings modes and inline migration credentials', () => {
    for (const bad of [
        {mode: 'database'}, {migration: {enabled: true}}, {mode: 'separate-schema', migration: {enabled: 'true'}},
        {controlSchema: 'unsafe;sql'}, {schemas: {'': 'company_a'}}, {schemas: {a: 'public'}},
        {schemas: {a: 'company_a', b: 'company_a'}}, {businessPoolSize: 0}, {startupTimeoutSeconds: 1},
        {migration: {password: 'plaintext'}}, {migration: true}, {migration: []}, {migration: null},
        {mod: 'separate-schema'}, {startupTimeoutSeconds: 2_147_483_528}, true, []
    ]) assert.throws(() => resolveTenantStorage(bad));
    assert.doesNotThrow(() => resolveTenantStorage({mode: 'separate-schema', schemas: {}}));
    assert.match(tenantStorageYaml(resolveTenantStorage()), /schemas: \{\}/);
});

test('application environment overrides cannot contradict the common tenant storage contract', () => {
    for (const variable of [
        {name: 'MEDOL_TENANCY_MODE', value: 'shared-schema'},
        {name: 'MEDOL_TENANCY_MIGRATION_ENABLED', value: 'false'},
        {name: 'MEDOL_TENANCY_CONTROLSCHEMA', value: 'other'},
        {name: 'MEDOL_TENANCY_SCHEMAS_OTHER', value: 'other'},
        {name: 'DB_SCHEMA', value: 'other'},
        {name: 'SPRING_JPA_HIBERNATE_DDL_AUTO', value: 'update'}
    ]) {
        assert.throws(() => buildOperationsModel(source, {
            ...config, applications: {business: {environmentVariables: [variable]}}
        }));
        assert.throws(() => buildOperationsModel(source, {
            ...config, environments: {prod: {applicationOverrides: {business: {environmentVariables: [variable]}}}}
        }));
    }
    assert.doesNotThrow(() => buildOperationsModel(source, {
        ...config, applications: {business: {environmentVariables: [{name: 'DB_SCHEMA', value: 'control'}, {name: 'SPRING_JPA_HIBERNATE_DDL_AUTO', value: 'none'}]}}
    }));
});

test('model-only generation validates tenant settings before serializing configuration', () => {
    assert.throws(() => generateOperationsFiles(buildOperationsModel(source, {tenancy: {migration: true}}), {target: 'model'}));
    assert.throws(() => buildOperationsModel(source, {environments: {prod: {tenancy: {migration: {password: 'must-not-serialize'}}}}}));
    assert.throws(() => buildOperationsModel(source, {tenancy: {mode: 'separate-schema', migration: {password: 'must-not-serialize'}}}));
    const supplied = buildOperationsModel(source);
    supplied.tenancy = {migration: {password: 'must-not-serialize'}};
    assert.throws(() => generateOperationsFiles(supplied, {target: 'model'}));
});

test('externally managed storage also keeps rollout deadline beyond its startup budget', () => {
    const model = buildOperationsModel(source, {tenancy: {startupTimeoutSeconds: 1800}});
    const files = generateOperationsFiles(model);
    const workloads = files['operations/dev/kubernetes/base/applications.yaml'];
    assert.match(workloads, /progressDeadlineSeconds: 1920/);
    assert.doesNotMatch(workloads, /type: "Recreate"/);
});

test('tenant mount appends to existing Spring config locations and changes checksum with bindings', () => {
    const model = buildOperationsModel(source, {
        ...config, applications: {business: {environmentVariables: [{name: 'SPRING_CONFIG_ADDITIONAL_LOCATION', value: 'optional:file:/custom/'}]}}
    });
    const resolved = resolveOperationsModel(model);
    const app = resolved.applications.find((app) => app.name === 'business');
    assert.equal(app.environmentVariables.find((item) => item.name === 'SPRING_CONFIG_ADDITIONAL_LOCATION').value, 'optional:file:/custom/,file:/etc/medol/tenant-storage.yml');
    const repeated = resolveOperationsModel(resolved);
    assert.equal(repeated.applications.find((app) => app.name === 'business').environmentVariables.find((item) => item.name === 'SPRING_CONFIG_ADDITIONAL_LOCATION').value, 'optional:file:/custom/,file:/etc/medol/tenant-storage.yml');
    const dev = generateOperationsFiles(model)['operations/dev/kubernetes/base/applications.yaml'];
    const prod = generateOperationsFiles(model, {environment: 'prod'})['operations/prod/kubernetes/base/applications.yaml'];
    assert.notEqual(dev.match(/medol.dev\/tenant-storage-checksum": "([^"]+)"/)[1], prod.match(/medol.dev\/tenant-storage-checksum": "([^"]+)"/)[1]);
});

const physical = {
    mode: 'separate-database', migration: {enabled: true},
    dataSources: {a: {url: 'jdbc:postgresql://pg-a:5432/tenant_a', username: '${PG_A_USER}', password: '${PG_A_PASSWORD}'}},
    eventStores: {a: {target: 'uma-a:50051', plaintext: true, apiKey: '${UMA_A_API_KEY}'}},
    bindings: {'Company.A-1': {dataSource: 'a', schema: 'business', eventStore: 'a'}}
};

test('physical storage configuration preserves independent resources and secret references', () => {
    const files = generateOperationsFiles(buildOperationsModel(source, {tenancy: physical}));
    const yaml = files['operations/dev/configuration/tenant-storage.yml'];
    assert.match(yaml, /mode: "separate-database"/);
    assert.match(yaml, /data-sources:/);
    assert.match(yaml, /event-stores:/);
    assert.match(yaml, /"\[Company.A-1\]":/);
    assert.match(yaml, /data-source: "a"/);
    assert.match(yaml, /ddl-auto: "none"/);
    assert.match(yaml, /\$\{PG_A_PASSWORD\}/);
    const kube = files['operations/dev/kubernetes/environments/dev/configmap.yaml'];
    assert(kube.includes(JSON.stringify(yaml)));
});

test('physical configuration rejects unresolved resources literal credentials and location aliasing', () => {
    for (const settings of [
        {...physical, bindings: {a: {schema: 'business', dataSource: 'missing'}}},
        {...physical, bindings: {a: {schema: 'business', dataSource: 'a', eventStore: 'missing'}}},
        {...physical, bindings: {a: {schema: 'business', dataSource: 'a'}, b: {schema: 'business', dataSource: 'a'}}},
        {...physical, dataSources: {a: {...physical.dataSources.a, password: 'literal-secret'}}},
        {...physical, dataSources: {a: {...physical.dataSources.a, url: 'jdbc:postgresql://pg-a/tenant_a?password=literal-secret'}}},
        {...physical, eventStores: {a: {...physical.eventStores.a, apiKey: 'literal-secret'}}},
        {...physical, schemas: {a: 'legacy_schema'}},
        {...physical, dataSources: {a: physical.dataSources.a, alias: physical.dataSources.a}}
    ]) assert.throws(() => resolveTenantStorage(settings));
});

test('shared relational schema can use explicit physical event bindings without enabling database migration', () => {
    const storage = resolveTenantStorage({eventStores: physical.eventStores, bindings: {
        a: {schema: 'public', eventStore: 'a'}, b: {schema: 'public', eventStore: 'a'}
    }});
    assert.match(tenantStorageYaml(storage), /event-stores:/);
    assert.doesNotMatch(tenantStorageYaml(storage), /ddl-auto/);
});

test('additional storage instances have independent volumes initialization and secret references', () => {
    const model = buildOperationsModel(source, {tenancy: physical, infrastructure: {additional: [
        {type: 'postgres', name: 'pg-a', databases: ['tenant_a'], environmentVariables: [
            {name: 'POSTGRES_USER', value: '${PG_A_USER:?Set PG_A_USER}', valueFromSecret: {name: 'pg-a', key: 'username'}},
            {name: 'POSTGRES_PASSWORD', value: '${PG_A_PASSWORD:?Set PG_A_PASSWORD}', valueFromSecret: {name: 'pg-a', key: 'password'}},
            {name: 'POSTGRES_DB', value: 'tenant_a'}
        ]},
        {type: 'umadb', name: 'uma-a', environmentVariables: [{name: 'UMADB_API_KEY', value: '${UMA_A_API_KEY:?Set UMA_A_API_KEY}', valueFromSecret: {name: 'uma-a', key: 'api-key'}}]}
    ]}});
    const files = generateOperationsFiles(model);
    const compose = files['operations/dev/docker-compose/docker-compose.yml'];
    assert.match(compose, /pg-a_data/);
    assert.match(compose, /uma-a_data/);
    assert.match(compose, /PG_A_PASSWORD/);
    assert.match(compose, /pg-a:\n\s+condition: "service_healthy"/);
    assert.match(files['operations/dev/infrastructure/pg-a/init/01-create-databases.sql'], /CREATE DATABASE "tenant_a"/);
    for (const target of ['kubernetes', 'k3s']) {
        const infra = files[`operations/dev/${target}/base/infrastructure.yaml`];
        assert.match(infra, /name: "pg-a-init"/);
        assert.match(infra, /name: "pg-a"[\s\S]*key: "password"/);
    }
    assert.equal(resolveOperationsModel(model).infrastructure.find((component) => component.name === 'pg-a').exposePorts, false);
    assert.throws(() => buildOperationsModel(source, {infrastructure: {additional: [{type: 'umadb', name: 'other', volumeName: 'umadb_data'}]}}));
    assert.throws(() => buildOperationsModel(source, {infrastructure: {additional: [{type: 'umadb', name: 'other', volumeName: 'umadb-data'}]}}));
});
