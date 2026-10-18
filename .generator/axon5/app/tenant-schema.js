const {createHash} = require('node:crypto');
const {
    readModelTableName, readModelMetadataFields, readModelStorageType,
    readModelStorageField, valueTypeForField, isJpaEnumField, safeDatabaseName, safeDatabaseIdentifier
} = require('./model-helpers');

const sqlIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

function columnType(field) {
    if (field.cardinality === 'Multiple' || valueTypeForField(field)?.kind === 'object') return 'text';
    if (isJpaEnumField(field)) return 'varchar(255)';
    const storage = readModelStorageField(field);
    if (String(storage.type).toLowerCase() === 'text') return 'text';
    const type = readModelStorageType(field, false);
    const sql = {String: 'varchar(255)', UUID: 'uuid', Int: 'integer', Long: 'bigint',
        Double: 'double precision', Float: 'real', BigDecimal: 'numeric(38,2)', Boolean: 'boolean',
        LocalDate: 'date', LocalDateTime: 'timestamp(6)'}[type];
    if (!sql) throw new Error(`Tenant migration cannot map storage type ${type} for ${field.name}.`);
    return sql;
}

function tenantSchema(model) {
    if (!model.tenancy) return undefined;
    const tables = [];
    for (const slice of model.slices ?? []) {
        if (model.tenancy.managementContexts.includes(slice.context)) continue;
        for (const readmodel of slice.readmodels ?? []) {
            const fields = readmodel.fields ?? [];
            const ids = fields.filter((field) => field.idAttribute);
            if (!fields.length) throw new Error('Tenant migration requires a projection key.');
            const idFields = ids.length ? ids : fields.slice(0, 1);
            const metadata = readModelMetadataFields(readmodel);
            const tenant = metadata.find((field) => field.key === 'TENANT_ID');
            const primaryKey = [...idFields.map((field) => safeDatabaseName(field.name)), safeDatabaseName(tenant.name)];
            const columns = [...fields.map((field) => ({name: safeDatabaseName(field.name), type: columnType(field)})),
                ...metadata.map((field) => ({name: safeDatabaseName(field.name), type: field.type.startsWith('LocalDateTime') ? 'timestamp(6)' : 'varchar(255)'}))];
            if (new Set(columns.map((column) => column.name)).size !== columns.length) {
                throw new Error(`Tenant projection ${readmodel.name} has colliding physical column names.`);
            }
            tables.push({name: readModelTableName(model, slice.context, readmodel), columns,
                primaryKey, indexes: [[safeDatabaseName(tenant.name)]]});
        }
    }
    tables.push({name: 'medol_tenant_projection_receipt', columns: [
        {name: 'projector', type: 'varchar(255)'}, {name: 'event_id', type: 'varchar(255)'}
    ], primaryKey: ['projector', 'event_id'], indexes: []});
    if (new Set(tables.map((table) => table.name)).size !== tables.length) throw new Error('Tenant migration has duplicate physical tables.');
    tables.sort((a, b) => a.name.localeCompare(b.name));
    const sql = '-- Initial tenant schema. Once applied, retain this file and add versioned migrations.\n\n' + tables.map((table) => {
        const columns = table.columns.map((column) => `    ${sqlIdentifier(column.name)} ${column.type}${table.primaryKey.includes(column.name) ? ' NOT NULL' : ''}`);
        columns.push(`    PRIMARY KEY (${table.primaryKey.map(sqlIdentifier).join(', ')})`);
        return `CREATE TABLE ${table.name === 'medol_tenant_projection_receipt' ? 'IF NOT EXISTS ' : ''}${sqlIdentifier(table.name)} (\n${columns.join(',\n')}\n);\n` + table.indexes.map((index, position) =>
            `CREATE INDEX ${sqlIdentifier(safeDatabaseIdentifier(`${table.name}_tenant_${position}_idx`))} ON ${sqlIdentifier(table.name)} (${index.map(sqlIdentifier).join(', ')});\n`).join('');
    }).join('\n');
    return {tables, sql, hash: createHash('sha256').update(JSON.stringify(tables)).digest('hex')};
}

function migrationIdentity(generator) {
    const deployment = generator.currentDeployment?.name || generator.model.deployment || generator.modulePrefix || 'application';
    const key = safeDatabaseIdentifier(safeDatabaseName(deployment));
    return {deployment, location: `db/tenant-migration/${key}`, historyTable: safeDatabaseIdentifier(`${key}_tenant_flyway_history`)};
}

function writeTenantMigrations(generator) {
    const reference = generator._destPath('src/main/resources/db/tenant-reference-schema.sql');
    if (!generator.model.tenancy) { generator.fs.delete(reference); return; }
    const schema = tenantSchema(generator.model);
    const identity = migrationIdentity(generator);
    const baseline = generator._destPath(`src/main/resources/${identity.location}/V1__tenant_baseline.sql`);
    if (!generator.fs.exists(baseline)) generator.fs.write(baseline, schema.sql);
    generator.fs.write(reference, schema.sql);
}

module.exports = {tenantSchema, migrationIdentity, writeTenantMigrations};
