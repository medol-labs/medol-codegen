const assert = require('node:assert/strict');
const test = require('node:test');

const {outboundEvents, relatedStateForCommand} = require('../model-helpers');

test('resolves related concept state for lifecycle-starting commands with derived event fields', () => {
    const command = {
        name: 'CreateWorkItem',
        startsLifecycle: true,
        fields: [
            {name: 'workItemId', type: 'UUID', idAttribute: true},
            {name: 'configurationId', type: 'UUID'}
        ]
    };
    const event = {
        id: 'work-item-created',
        name: 'WorkItemCreated',
        fields: [
            {
                name: 'schemaId',
                type: 'UUID',
                source: {kind: 'derived', from: ['Configuration.schemaId']}
            }
        ]
    };
    const slice = {
        context: 'Example',
        name: 'CreateWorkItem',
        concepts: ['WorkItem'],
        commands: [command]
    };
    const configurationSlice = {
        context: 'Example',
        name: 'DefineConfiguration',
        concepts: ['Configuration'],
        commands: [{
            name: 'DefineConfiguration',
            fields: [{name: 'configurationId', type: 'UUID', idAttribute: true}]
        }]
    };
    const model = {
        rootPackage: 'example',
        slices: [slice, configurationSlice]
    };

    const relatedState = relatedStateForCommand(model, slice, command, [event]);

    assert.equal(relatedState.concept, 'Configuration');
    assert.equal(relatedState.idProperty, 'configurationId');
    assert.equal(relatedState.stateTarget.name, 'ConfigurationState');
    assert.equal(relatedState.stateTarget.packageName, 'example.example.configuration');
});

test('infers outbound event by command and event names before using legacy first-event fallback', () => {
    const events = [
        {id: 'requested', name: 'DataExportRequested'},
        {id: 'processing', name: 'DataExportProcessingStarted'},
        {id: 'completed', name: 'DataExportCompleted'},
        {id: 'failed', name: 'DataExportFailed'}
    ];

    assert.deepEqual(outboundEvents({name: 'CompleteDataExport'}, events).map((event) => event.name), ['DataExportCompleted']);
    assert.deepEqual(outboundEvents({name: 'FailDataExport'}, events).map((event) => event.name), ['DataExportFailed']);
    assert.deepEqual(outboundEvents({name: 'MarkDataExportProcessing'}, events).map((event) => event.name), ['DataExportProcessingStarted']);
});
