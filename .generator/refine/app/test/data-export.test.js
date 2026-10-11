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

test('uses the read model route for generated list and show pages', () => {
    const resource = toReadModelResource(
        {
            title: 'System Notification',
            chapter: 'System Notification',
            slice: {title: 'System Notification Catalog', context: 'SystemNotification'},
            commands: [],
            deployment: {
                name: 'Support',
                label: 'Support',
                dataProviderName: 'support'
            }
        },
        {
            id: 'readmodel-system-notification-summary',
            title: 'System Notification Summary',
            listElement: true,
            fields: [
                {name: 'recipientUserId', type: 'String', idAttribute: true},
                {name: 'unreadCount', type: 'Long'}
            ]
        },
        [],
        {commandSliceFor: () => undefined}
    );

    assert.equal(resource.pagePath, 'systemnotification/read-models/system-notification-summary');
    assert.equal(resource.listPagePath, 'systemnotification/slices/system-notification-summary');
    assert.equal(resource.showPagePath, 'systemnotification/slices/system-notification-summary');
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
    assert.match(template, /leadingActions=\{\s*<>/);
    assert.ok(
        template.indexOf('<Download className="size-4" />') < template.indexOf('<Upload className="size-4" />'),
        'export actions should render before import actions'
    );
});

test('list toolbar keeps reset on the left and export import before right-side view controls', () => {
    const toolbar = readFileSync(join(__dirname, '../templates/root/src/components/data-table/data-table-toolbar.tsx'), 'utf8');
    const listView = readFileSync(join(__dirname, '../templates/root/src/components/refine-ui/views/list-view.tsx'), 'utf8');

    assert.ok(
        toolbar.indexOf('{isFiltered && (') < toolbar.indexOf('{children}'),
        'reset should render on the left before active filter badges'
    );
    assert.ok(
        toolbar.indexOf('{children}') < toolbar.indexOf('{leadingActions}'),
        'resource actions should not render in the left toolbar content'
    );
    assert.match(toolbar, /<div className="flex shrink-0 items-center gap-2">\s*\{leadingActions\}\s*<DataTableViewOptions table=\{table\} align="end" \/>\s*\{trailingActions\}/);
    assert.ok(
        listView.indexOf('trailingActions={') < listView.indexOf('<DataTableFilterList table={table} />'),
        'filter should be part of right-side actions'
    );
    assert.ok(
        listView.indexOf('<DataTableFilterList table={table} />') < listView.indexOf('<DataTableSortList table={table}>'),
        'filter should render before sort'
    );
    assert.ok(
        listView.indexOf('<DataTableSortList table={table}>') < listView.indexOf('<Search className="h-4 w-4" />'),
        'sort should render before search'
    );
});

test('data export client posts to generated resource export endpoint', () => {
    const source = readFileSync(join(__dirname, '../templates/root/src/lib/data-export.ts'), 'utf8');

    assert.match(source, /appendSpringCriteriaFilters\(query, params\.filters\)/);
    assert.match(source, /const path = `\/\$\{params\.aggregateRoute\}\/\$\{params\.queryRoute\}\/export`/);
    assert.match(source, /method: "POST"/);
    assert.match(source, /requestedLocale: params\.requestedLocale \?\? currentLocale\(\)/);
    assert.match(source, /filenameFromDisposition/);
});

test('data export list template does not special-case export job downloads', () => {
    const template = readFileSync(join(__dirname, '../templates/src/pages/list.tsx.tpl'), 'utf8');
    const source = readFileSync(join(__dirname, '../templates/root/src/lib/data-export.ts'), 'utf8');

    assert.doesNotMatch(template, /hasDataExportJobDownload/);
    assert.doesNotMatch(template, /downloadDataExportJob/);
    assert.doesNotMatch(source, /export async function downloadDataExportJob/);
    assert.match(source, /const downloadBlob/);
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
