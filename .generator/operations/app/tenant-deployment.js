const {createHash} = require('node:crypto');
const {renderYaml} = require('./renderers/yaml');

function resolveTenantStorage(base = {}, override = {}) {
    const keys = new Set(['mode', 'controlSchema', 'schemas', 'businessPoolSize', 'startupTimeoutSeconds', 'migration', 'dataSources', 'eventStores', 'bindings']);
    for (const value of [base, override]) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tenant storage configuration must be an object.');
        if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('Unknown tenant storage option.');
        if (value.migration !== undefined && (!value.migration || typeof value.migration !== 'object' || Array.isArray(value.migration))) {
            throw new Error('Tenant migration configuration must be an object with an enabled boolean.');
        }
    }
    const storage = {
        mode: 'shared-schema', controlSchema: 'public', schemas: {}, dataSources: {}, eventStores: {}, bindings: {}, businessPoolSize: 10,
        startupTimeoutSeconds: 600, ...base, ...override,
        migration: {enabled: false, ...base.migration, ...override.migration}
    };
    if (!['shared-schema', 'separate-schema', 'separate-database'].includes(storage.mode)) throw new Error('Invalid tenant storage mode.');
    const validSchema = (name) => typeof name === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(name);
    if (!validSchema(storage.controlSchema)) throw new Error('Invalid tenant control schema.');
    if (!storage.schemas || Array.isArray(storage.schemas) || typeof storage.schemas !== 'object') throw new Error('Tenant schemas must be a tenant-to-schema map.');
    const bindings = Object.entries(storage.schemas);
    if (bindings.some(([tenant, schema]) => !tenant.trim() || tenant.length > 255 || !validSchema(schema) || schema === storage.controlSchema)
        || new Set(bindings.map(([, schema]) => schema)).size !== bindings.length) throw new Error('Invalid or duplicate tenant schema binding.');
    if (!Number.isInteger(storage.businessPoolSize) || storage.businessPoolSize < 1) throw new Error('Invalid tenant business pool size.');
    if (!Number.isInteger(storage.startupTimeoutSeconds) || storage.startupTimeoutSeconds < 30 || storage.startupTimeoutSeconds > 2_147_483_527) throw new Error('Tenant startup timeout must fit the Kubernetes deadline and be at least 30 seconds.');
    if (typeof storage.migration.enabled !== 'boolean' || (storage.migration.enabled && storage.mode === 'shared-schema')) throw new Error('Managed tenant migration requires isolated storage.');
    if (Object.keys(storage.migration).some((key) => key !== 'enabled')) throw new Error('Configure migration credentials through environment Secret references, not tenant storage configuration.');
    const secret = (value) => typeof value === 'string' && /^\$\{[A-Z][A-Z0-9_]*\}$/.test(value);
    for (const [kind, entries] of [['dataSources', storage.dataSources], ['eventStores', storage.eventStores]]) {
        if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 32) throw new Error('Invalid tenant resource map.');
        const endpoints = new Set();
        for (const [id, settings] of Object.entries(entries)) {
            if (id === 'default' || !/^[a-z][a-z0-9_-]{0,47}$/.test(id) || !settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid tenant resource.');
            const allowed = kind === 'dataSources' ? ['url', 'username', 'password', 'driverClassName', 'poolSize', 'migrationUsername', 'migrationPassword'] : ['target', 'plaintext', 'apiKey', 'generation'];
            if (Object.keys(settings).some((key) => !allowed.includes(key))) throw new Error('Unknown tenant resource option.');
            const endpoint = kind === 'dataSources' ? settings.url : settings.target;
            if (typeof endpoint !== 'string' || !endpoint.trim() || endpoints.has(endpoint)) throw new Error('Missing or aliased tenant endpoint.');
            if (kind === 'dataSources' && /[?&;](?:user|username|password)=|:\/\/[^/?#]*@/i.test(endpoint)) throw new Error('Do not embed credentials in tenant datasource URLs.');
            endpoints.add(endpoint);
            for (const key of kind === 'dataSources' ? ['username', 'password', 'migrationUsername', 'migrationPassword'] : ['apiKey']) {
                if (settings[key] !== undefined && !secret(settings[key])) throw new Error('Tenant resource credentials must reference environment secrets, not literal values.');
            }
            if (settings.poolSize !== undefined && (!Number.isInteger(settings.poolSize) || settings.poolSize < 1)) throw new Error('Invalid tenant resource pool size.');
            if (settings.plaintext !== undefined && typeof settings.plaintext !== 'boolean') throw new Error('Invalid tenant event transport setting.');
            if (settings.generation !== undefined && !/^[a-zA-Z0-9_-]{1,32}$/.test(settings.generation)) throw new Error('Invalid event store generation.');
        }
    }
    if (!storage.bindings || typeof storage.bindings !== 'object' || Array.isArray(storage.bindings)) throw new Error('Invalid tenant bindings.');
    const owners = new Set(bindings.map(([, schema]) => 'default/' + schema));
    for (const [tenant, location] of Object.entries(storage.bindings)) {
        if (!tenant.trim() || tenant.length > 255 || Object.hasOwn(storage.schemas, tenant) || !location || typeof location !== 'object' || Array.isArray(location)) throw new Error('Invalid or conflicting tenant binding.');
        if (Object.keys(location).some((key) => !['schema', 'dataSource', 'eventStore', 'version'].includes(key))) throw new Error('Unknown tenant binding option.');
        const {schema, dataSource = 'default', eventStore = 'default', version = '1'} = location;
        if (!validSchema(schema) || !/^[a-zA-Z0-9_-]{1,32}$/.test(version) || (eventStore !== 'default' && !Object.hasOwn(storage.eventStores, eventStore))) throw new Error('Invalid tenant storage location.');
        if (storage.mode === 'shared-schema' && (dataSource !== 'default' || schema !== storage.controlSchema)) throw new Error('Shared-schema bindings must use the control database and schema.');
        if (storage.mode === 'separate-schema' && (dataSource !== 'default' || schema === storage.controlSchema)) throw new Error('Separate-schema bindings must use a distinct schema in the default database.');
        if (storage.mode === 'separate-database' && !Object.hasOwn(storage.dataSources, dataSource)) throw new Error('Separate database bindings require a configured datasource.');
        const key = dataSource + '/' + schema;
        if (storage.mode !== 'shared-schema' && owners.has(key)) throw new Error('Tenant storage locations must be exclusive.');
        owners.add(key);
    }
    if (storage.mode === 'separate-database' && bindings.length) throw new Error('Use complete bindings for separate database isolation.');
    return storage;
}

function validateTenantEnvironment(variables, storage) {
    for (const variable of variables) {
        const key = String(variable.name).replace(/[^a-z0-9]/gi, '').toUpperCase();
        if (['MEDOLTENANCYMODE', 'MEDOLTENANCYCONTROLSCHEMA', 'MEDOLTENANCYMIGRATIONENABLED'].includes(key) || ['MEDOLTENANCYSCHEMAS', 'MEDOLTENANCYBINDINGS', 'MEDOLTENANCYDATASOURCES', 'MEDOLTENANCYEVENTSTORES'].some((prefix) => key.startsWith(prefix))) {
            throw new Error(`Configure ${variable.name} through environment-wide operations.tenancy, not application environmentVariables.`);
        }
        if (key === 'DBSCHEMA' && (variable.valueFromSecret || ![storage.controlSchema, '${DB_SCHEMA:-public}', `\${DB_SCHEMA:-${storage.controlSchema}}`].includes(variable.value))) {
            throw new Error('DB_SCHEMA must agree with environment-wide operations.tenancy.controlSchema.');
        }
        if (storage.mode !== 'shared-schema' && key === 'SPRINGJPAHIBERNATEDDLAUTO' && (variable.valueFromSecret || variable.value !== 'none')) {
            throw new Error('Separate tenant schemas require ddl-auto=none.');
        }
    }
}

function tenantStorageYaml(storage) {
    // Bracketed keys preserve custom tenant identifiers in Spring's Map binder.
    const schemas = Object.fromEntries(Object.entries(storage.schemas).sort(([a], [b]) => a.localeCompare(b)).map(([tenant, schema]) => [`[${tenant}]`, schema]));
    const control = `\${DB_SCHEMA:${storage.controlSchema}}`;
    const resources = {};
    if (Object.keys(storage.dataSources).length) resources['data-sources'] = Object.fromEntries(Object.entries(storage.dataSources).map(([id, value]) => [id, {
        url: value.url, username: value.username, password: value.password,
        'driver-class-name': value.driverClassName ?? 'org.postgresql.Driver', 'pool-size': value.poolSize ?? 5,
        'migration-username': value.migrationUsername, 'migration-password': value.migrationPassword
    }]));
    if (Object.keys(storage.eventStores).length) resources['event-stores'] = Object.fromEntries(Object.entries(storage.eventStores).map(([id, value]) => [id, {
        target: value.target, plaintext: value.plaintext ?? false, 'api-key': value.apiKey, generation: value.generation ?? '1'
    }]));
    if (Object.keys(storage.bindings).length) resources.bindings = Object.fromEntries(Object.entries(storage.bindings).map(([tenant, value]) => [`[${tenant}]`, {
        schema: value.schema, 'data-source': value.dataSource ?? 'default', 'event-store': value.eventStore ?? 'default', version: value.version ?? '1'
    }]));
    return renderYaml({
        spring: {
            datasource: {hikari: {schema: control}}, flyway: {'default-schema': control},
            ...(storage.mode !== 'shared-schema' ? {jpa: {hibernate: {'ddl-auto': 'none'}}} : {})
        },
        medol: {tenancy: {
            mode: storage.mode, 'control-schema': control, schemas,
            'business-pool-size': storage.businessPoolSize, migration: {enabled: storage.migration.enabled}, ...resources
        }}
    });
}

function tenantStorageChecksum(storage) {
    return createHash('sha256').update(tenantStorageYaml(storage)).digest('hex');
}

function tenantDeploymentNotes() {
    return [
        '## Tenant Storage', '',
        'Only models importing tenant-management generate tenant runtime configuration. Operations settings never enable the capability by themselves.',
        'Configure operations.tenancy, or operations.environments.<environment>.tenancy, with mode (shared-schema by default), controlSchema, schemas (tenant ID to schema), businessPoolSize, startupTimeoutSeconds (600 by default), and migration.enabled (false by default). Environment schemas replace the entire base map.',
        'Physical storage uses mode=separate-database, dataSources, eventStores and complete bindings referencing resource IDs. These maps replace their base values per environment; legacy schemas still use default resources. Resource credentials must be ${ENV_NAME} references supplied through each backend application Secret environment. UmaDB is currently the only supported physical event adapter.',
        'Optional operations.infrastructure.additional entries reuse PostgreSQL/UmaDB rendering with unique names and volumes. PostgreSQL entries require explicit databases and POSTGRES_USER/PASSWORD/DB variables. Additional resources do not expose host ports by default. valueFromSecret uses secretKeyRef on Kubernetes; an accompanying value may select an instance-specific Compose environment variable.',
        'All tenant-enabled backends mount the same environment-owned tenant-storage.yml. Bracketed tenant keys preserve custom identifiers; UUID tenant IDs must use canonical lowercase values. Do not override these settings independently in individual deployments. Custom storage resolvers may keep schemas empty and must enumerate bindings when startup migration is enabled.',
        'Generation validates every environment, including model-only output. Unknown storage options, malformed migration settings, application-level tenant mode/binding overrides, inconsistent DB_SCHEMA and unsafe DDL overrides are rejected. Changes made directly to deployment files or external Spring configuration remain operator-owned.',
        'For separate-schema mode, Hibernate DDL is disabled. Initialize the control schema and all control-plane tables separately before starting applications. With migration disabled, provision and migrate every business schema externally; with migration enabled, package immutable versioned SQL in each backend image.',
        'Optional DDL credentials use MEDOL_TENANCY_MIGRATION_USERNAME and MEDOL_TENANCY_MIGRATION_PASSWORD through application environmentVariables/Secret references. Omit both to reuse the business account; do not inject empty or example credentials. Grant the business account USAGE on the control schema and SELECT on medol_tenant_storage_binding and medol_tenant_storage_progress, plus required business-schema privileges. Never commit credentials.',
        'Physical database migration also requires medol_tenant_storage_location in the control schema and medol_storage.database_identity in each physical database. Business accounts need SELECT/USAGE on the corresponding metadata. When automatic migration is disabled, provision these identities externally. Unknown resources, conflicting identities and unsafe rebinding fail closed; they never fall back to the default store.',
        'Managed migration uses Recreate on Kubernetes to avoid rolling two versions of the same deployment together. Drain requests and coordinate all deployments for incompatible upgrades; schema locks do not provide zero-downtime migration or cancel in-flight transactions. Configuration changes require application restarts.',
        'On failure, inspect storage status and migration logs, correct the cause and retry. Never automatically clean, repair, rebind tenants or roll back the database when rolling back an image. Existing PostgreSQL volumes do not rerun initialization SQL.', ''
    ];
}

module.exports = {resolveTenantStorage, validateTenantEnvironment, tenantStorageYaml, tenantStorageChecksum, tenantDeploymentNotes};
