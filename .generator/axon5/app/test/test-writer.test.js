const assert = require('node:assert/strict');
const test = require('node:test');
const {testWriterMethods} = require('../test-writer');
const {configureValueTypes} = require('../../../common/util/value-types');

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
