const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const test = require('node:test');

const {toReadModelResource} = require('../resource-model');

test('carries exportable read model metadata into frontend resources', () => {
    const resource = toReadModelResource(
        {
            title: 'Runtime Node Inventory',
            chapter: 'Runtime Governance',
            slice: 'Runtime Node Inventory',
            commands: [],
            deployment: {
                name: 'Support',
                label: 'Support',
                dataProviderName: 'support'
            }
        },
        {
            id: 'readmodel-runtime-node-inventory-catalog',
            title: 'Runtime Node Inventory Catalog',
            listElement: true,
            exportable: {capability: 'PlatformDataExchange'},
            fields: [
                {name: 'runtimeNodeInventoryId', type: 'UUID', idAttribute: true},
                {name: 'runtimeName', type: 'String'}
            ]
        },
        [],
        {commandSliceFor: () => undefined}
    );

    assert.deepEqual(resource.exportable, {capability: 'PlatformDataExchange'});
    assert.equal(resource.aggregateRoute, 'runtimenodeinventory');
    assert.equal(resource.queryRoute, 'runtimenodeinventorycatalog');
    assert.equal(resource.dataProviderName, 'support');
});

test('list page template exports current table state and visible columns', () => {
    const template = readFileSync(join(__dirname, '../templates/src/pages/list.tsx.tpl'), 'utf8');

    assert.match(template, /useNotification/);
    assert.match(template, /requestDataExport/);
    assert.match(template, /const tableState = table\.reactTable\.getState\(\)/);
    assert.match(template, /tableState\.columnFilters\.flatMap/);
    assert.match(template, /operator: currentFilter\.operator/);
    assert.match(template, /const sorters: CrudSorting = tableState\.sorting\.map/);
    assert.match(template, /column\.getIsVisible\(\)/);
    assert.match(template, /!\["select", "actions"\]\.includes\(column\.id\)/);
    assert.match(template, /<Download className="size-4" \/>/);
});

test('data export client posts to generated resource export endpoint', () => {
    const source = readFileSync(join(__dirname, '../templates/root/src/lib/data-export.ts'), 'utf8');

    assert.match(source, /appendSpringCriteriaFilters\(query, params\.filters\)/);
    assert.match(source, /const path = `\/\$\{params\.aggregateRoute\}\/\$\{params\.queryRoute\}\/export`/);
    assert.match(source, /method: "POST"/);
    assert.match(source, /requestedLocale: params\.requestedLocale \?\? currentLocale\(\)/);
    assert.match(source, /filenameFromDisposition/);
});
