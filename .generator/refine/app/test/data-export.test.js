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

test('carries importable command metadata into frontend resources', () => {
    const resource = toReadModelResource(
        {
            title: 'Runtime Node Inventory',
            chapter: 'Runtime Governance',
            slice: 'Runtime Node Inventory',
            commands: [
                {
                    title: 'Import Runtime Node Inventory',
                    name: 'importRuntimeNodeInventory',
                    importable: {capability: 'PlatformDataExchange'},
                    fields: [
                        {name: 'runtimeNodeInventoryId', type: 'UUID', idAttribute: true},
                        {name: 'runtimeName', type: 'String'}
                    ]
                }
            ],
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
            fields: [
                {name: 'runtimeNodeInventoryId', type: 'UUID', idAttribute: true},
                {name: 'runtimeName', type: 'String'}
            ]
        },
        [],
        {
            commandSliceFor: () => undefined,
            selectionFieldsForCommand: () => [],
            stateControlForCommand: () => ({allowedStates: [], targetState: undefined, stateField: undefined}),
            selectForSnapshotField: () => undefined,
            selectForField: () => undefined,
            selectableReadModels: new Map(),
            dictionaryValueSelect: () => undefined
        }
    );

    assert.equal(resource.importCommands.length, 1);
    assert.equal(resource.importCommands[0].importable, true);
    assert.equal(resource.importCommands[0].route, 'import-runtime-node-inventory');
    assert.equal(resource.importCommands[0].httpRoute, 'importruntimenodeinventory');
});

test('list page template imports CSV files through importable commands', () => {
    const template = readFileSync(join(__dirname, '../templates/src/pages/list.tsx.tpl'), 'utf8');

    assert.match(template, /requestDataImport/);
    assert.match(template, /type="file"/);
    assert.match(template, /accept="\.csv,text\/csv"/);
    assert.match(template, /<Upload className="size-4" \/>/);
    assert.match(template, /handleChooseImportFile/);
});

test('data import client posts to generated command import endpoint', () => {
    const source = readFileSync(join(__dirname, '../templates/root/src/lib/data-import.ts'), 'utf8');

    assert.match(source, /const path = `\/\$\{params\.aggregateRoute\}\/\$\{params\.commandRoute\}\/import`/);
    assert.match(source, /body\.append\("file", params\.file\)/);
    assert.match(source, /requestedLocale/);
});
