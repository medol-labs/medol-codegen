const test = require('node:test');
const assert = require('node:assert/strict');
const {tenantSchema, migrationIdentity, writeTenantMigrations} = require('../tenant-schema');

function model() {
    return {rootPackage: 'sample.app', tenancy: {managementContexts: ['Administration']}, slices: [
        {context: 'Administration', readmodels: [{name: 'Tenants', fields: [{name: 'id', type: 'UUID', idAttribute: true}]}]},
        {context: 'Business', readmodels: [{name: 'Entries', title: 'Entries', fields: [
            {name: 'entryId', type: 'UUID', idAttribute: true},
            {name: 'tenantId', type: 'UUID'}, {name: 'description', type: 'Text'},
            {name: 'count', type: 'Long'}, {name: 'active', type: 'Boolean'}, {name: 'amount', type: 'Decimal'},
            {name: 'ratio', type: 'Double'}, {name: 'weight', type: 'Float'}, {name: 'onDate', type: 'Date'}, {name: 'atTime', type: 'DateTime'},
            {name: 'state', type: 'Entry.State'}, {name: 'tags', type: 'String', cardinality: 'Multiple'},
            {name: 'customId', type: 'Identifier', valueType: {kind: 'scalar', baseType: 'UUID'}},
            {name: 'profile', type: 'Profile', valueType: {kind: 'object', fields: []}}
        ]}]}
    ]};
}

test('tenant baseline uses storage metadata, technical tenant key and excludes control tables', () => {
    const schema = tenantSchema(model());
    assert.equal(schema.tables.length, 2);
    assert.doesNotMatch(schema.sql, /administration|CREATE SCHEMA|audit_log|token_entry/i);
    assert.match(schema.sql, /"description" text/);
    assert.match(schema.sql, /"amount" numeric\(38,2\)/);
    assert.match(schema.sql, /"ratio" double precision/);
    assert.match(schema.sql, /"weight" real/);
    assert.match(schema.sql, /"on_date" date/);
    assert.match(schema.sql, /"at_time" timestamp\(6\)/);
    assert.match(schema.sql, /"state" varchar\(255\)/);
    assert.match(schema.sql, /"tags" text/);
    assert.match(schema.sql, /"profile" text/);
    assert.match(schema.sql, /"custom_id" uuid/);
    assert.match(schema.sql, /PRIMARY KEY \("entry_id", "metadata_tenant_id"\)/);
    assert.match(schema.sql, /CREATE INDEX .*\("metadata_tenant_id"\)/);
    assert.match(schema.sql, /CREATE TABLE IF NOT EXISTS "medol_tenant_projection_receipt"/);
    assert.equal(schema.hash, tenantSchema(model()).hash);
    assert.equal(tenantSchema({}), undefined);
});

test('initial migrations are preserved while desired reference and model fingerprint evolve', () => {
    const files = new Map();
    const gen = {model: model(), currentDeployment: {name: 'Business'},
        _destPath: (name) => name, fs: {exists: (name) => files.has(name), write: (name, content) => files.set(name, content), delete: (name) => files.delete(name)}};
    writeTenantMigrations(gen);
    const path = 'src/main/resources/db/tenant-migration/business/V1__tenant_baseline.sql';
    const baseline = files.get(path);
    const before = tenantSchema(gen.model).hash;
    gen.model.slices[1].readmodels[0].fields.push({name: 'newField', type: 'String'});
    writeTenantMigrations(gen);
    assert.equal(files.get(path), baseline);
    assert.match(files.get('src/main/resources/db/tenant-reference-schema.sql'), /new_field/);
    assert.notEqual(tenantSchema(gen.model).hash, before);
    assert.deepEqual(migrationIdentity(gen), migrationIdentity({...gen, currentDeployment: undefined, model: {...gen.model, deployment: 'Business'}}));
    assert.equal(migrationIdentity({model: {}, modulePrefix: ''}).deployment, 'application');
    delete gen.model.tenancy;
    writeTenantMigrations(gen);
    assert.equal(files.get(path), baseline);
    assert(!files.has('src/main/resources/db/tenant-reference-schema.sql'));
});

test('tenant migration refuses physical table and column collisions', () => {
    const source = model();
    source.slices[1].readmodels[0].fields.push({name: 'entry_id', type: 'UUID'});
    assert.throws(() => tenantSchema(source), /colliding physical column/);
    source.slices[1].readmodels[0].fields.pop();
    source.slices[1].readmodels.push({...source.slices[1].readmodels[0]});
    assert.throws(() => tenantSchema(source), /duplicate physical tables/);
});
