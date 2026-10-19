const assert = require('node:assert/strict');
const test = require('node:test');
const {testWriterMethods} = require('../test-writer');
const {configureValueTypes} = require('../../../common/util/value-types');

test('new scalar fixtures without examples respect numeric ranges', () => {
    configureValueTypes([{name: 'PositiveCount', context: 'Items', kind: 'scalar', baseType: 'Int', constraints: [{kind: 'range', min: 1, max: 10}]}], 'sample.app');
    const command = {id: 'create', name: 'CreateItem', title: 'Create Item', startsLifecycle: true, fields: [{name: 'count', type: 'PositiveCount'}]};
    const event = {id: 'created', name: 'ItemCreated', title: 'Item Created', fields: command.fields};
    const slice = {name: 'CreateItem', title: 'Create Item', context: 'Items', commands: [command], events: [event]};
    const files = new Map();
    const writer = Object.assign({model: {rootPackage: 'sample.app', slices: [slice], concepts: [], transitions: []}, fs: {write: (path, code) => files.set(path, code)}, _testKotlinPath: path => path, _eventPackage: () => 'sample.app.items.events'}, testWriterMethods);
    try {
        writer._writeDecisionTest('sample.app.items.create', 'items', 'create', slice, {fields: [], tags: []}, [event]);
        assert.match([...files.values()].join('\n'), /PositiveCount\(1\)/);
        assert.doesNotMatch([...files.values()].join('\n'), /PositiveCount\(0\)/);
    } finally { configureValueTypes([]); }
});

test('adding a required business port removes its stale generated direct integration test', () => {
    const deleted = [];
    const command = {id: 'create', name: 'CreateItem', title: 'Create Item', startsLifecycle: true, port: true, fields: []};
    const event = {id: 'created', name: 'ItemCreated', title: 'Item Created', fields: []};
    const slice = {name: 'CreateItem', title: 'Create Item', context: 'Items', port: true, commands: [command], events: [event]};
    const writer = Object.assign({model: {rootPackage: 'sample.app', slices: [slice]}, fs: {delete: path => deleted.push(path)}, _testKotlinPath: path => path}, testWriterMethods);
    writer._writeSliceIntegrationTest('sample.app.items.create', 'items', 'create', slice, {fields: [], tags: []}, [event]);
    assert.deepEqual(deleted, ['items/create/CreateItemIntegrationTest.kt']);
});

test('decision fixtures preserve modeled examples for constrained scalar types', () => {
    const scalar = {name: 'ProjectCode', context: 'Projects', kind: 'scalar', baseType: 'String'};
    configureValueTypes([scalar], 'sample.app');
    const command = {
        id: 'create', name: 'CreateProject', title: 'Create Project', startsLifecycle: true,
        fields: [{name: 'code', type: 'ProjectCode', example: 'project-01'}]
    };
    const event = {id: 'created', name: 'ProjectCreated', title: 'Project Created', fields: command.fields};
    const slice = {name: 'CreateProject', title: 'Create Project', context: 'Projects', commands: [command], events: [event]};
    const files = new Map();
    const writer = Object.assign({
        model: {rootPackage: 'sample.app', slices: [slice], concepts: [], transitions: []},
        fs: {write: (path, content) => files.set(path, content)},
        _testKotlinPath: (path) => path,
        _eventPackage: () => 'sample.app.projects.events'
    }, testWriterMethods);
    try {
        writer._writeDecisionTest('sample.app.projects.create', 'projects', 'create', slice, {fields: [], tags: []}, [event]);
        const source = [...files.values()].join('\n');
        assert.match(source, /ProjectCode\("project-01"\)/);
        assert.doesNotMatch(source, /ProjectCode\(""\)/);
    } finally {
        configureValueTypes([]);
    }
});

test('decimal scalar examples compile without relying on an underlying primitive import', () => {
    configureValueTypes([{name: 'Amount', context: 'Billing', kind: 'scalar', baseType: 'Decimal'}], 'sample.app');
    const command = {
        id: 'create', name: 'RecordCharge', title: 'Record Charge', startsLifecycle: true,
        fields: [{name: 'amount', type: 'Amount', example: '12.50'}]
    };
    const event = {id: 'created', name: 'ChargeRecorded', title: 'Charge Recorded', fields: command.fields};
    const slice = {name: 'RecordCharge', title: 'Record Charge', context: 'Billing', commands: [command], events: [event]};
    const files = new Map();
    const writer = Object.assign({
        model: {rootPackage: 'sample.app', slices: [slice], concepts: [], transitions: []},
        fs: {write: (path, content) => files.set(path, content)},
        _testKotlinPath: path => path,
        _eventPackage: () => 'sample.app.billing.events'
    }, testWriterMethods);
    try {
        writer._writeDecisionTest('sample.app.billing.record', 'billing', 'record', slice, {fields: [], tags: []}, [event]);
        assert.match([...files.values()].join('\n'), /Amount\(java\.math\.BigDecimal\("12\.50"\)\)/);
    } finally {
        configureValueTypes([]);
    }
});

test('assertion rejection does not seed a unique reservation with the invalid command value', () => {
    configureValueTypes([{name: 'Count', context: 'Items', kind: 'scalar', baseType: 'Int'}], 'sample.app');
    const command = {id: 'create', name: 'CreateItem', title: 'Create Item', startsLifecycle: true, fields: [{name: 'count', type: 'Count'}]};
    const event = {id: 'created', name: 'ItemCreated', title: 'Item Created', fields: command.fields};
    const slice = {name: 'CreateItem', title: 'Create Item', context: 'Items', commands: [command], events: [event]};
    const writer = Object.assign({model: {rootPackage: 'sample.app', slices: [slice], concepts: [], transitions: []}}, testWriterMethods);
    try {
        const generated = writer._decisionSpecificationTest({
            title: 'Reject invalid count', expressions: ['unique Item.count', 'assert CreateItem.count > 0'],
            validates: ['assert CreateItem.count > 0'],
            when: [{id: 'create', title: 'Create Item', fields: [{name: 'count', example: 0}]}], then: {outcome: 'REJECT'}
        }, 'sample.app.items.create', slice, {fields: [], tags: []}, [event], [{
            stateName: 'ReservationState', stateParam: 'reservation', idFields: [], originalFields: [], normalizedFields: []
        }], 'CreateItemDecision', 'ItemState');
        assert.ok(generated.throws);
        assert.doesNotMatch(generated.body, /reservation\.evolve/);
        assert.match(generated.body, /assertThrows<IllegalArgumentException> \{[\s\S]*Count\(0\)/);
    } finally {
        configureValueTypes([]);
    }
});
