const assert = require('node:assert/strict');
const test = require('node:test');

const {commandWriterMethods} = require('../command-writer');
const {selectionFor} = require('../model-helpers');

test('generates backend command handler guards for projection eligibility selectors', () => {
    const command = {
        name: 'DefineTrainingRunConfiguration',
        title: 'Define Training Run Configuration',
        startsLifecycle: true,
        fields: [
            {name: 'trainingRunConfigurationId', type: 'UUID', idAttribute: true},
            {name: 'federationId', type: 'UUID', source: {kind: 'direct', from: ['FederationOverview.federationId']}},
            {name: 'federationName', type: 'String', optional: true, source: {kind: 'derived', from: ['FederationOverview.federationName']}}
        ]
    };
    const slice = {
        id: 'slice-define-training-run-configuration',
        name: 'DefineTrainingRunConfiguration',
        title: 'Define Training Run Configuration',
        context: 'TrainingOrchestration',
        concepts: ['TrainingRunConfiguration'],
        commands: [command],
        readmodels: []
    };
    const federationOverviewSlice = {
        id: 'slice-federation-overview',
        name: 'FederationOverview',
        title: 'Federation Overview',
        context: 'TrainingOrchestration',
        commands: [],
        events: [],
        readmodels: [{
            id: 'readmodel-federation-overview',
            name: 'FederationOverview',
            title: 'Federation Overview',
            listElement: true,
            fields: [
                {name: 'federationId', type: 'UUID', idAttribute: true},
                {name: 'state', type: 'Federation.State'}
            ],
            eligibility: [{
                operator: 'AND',
                conditions: [
                    {left: 'Federation.state', operator: '==', right: 'Active'}
                ]
            }]
        }]
    };
    const event = {
        id: 'event-training-run-configuration-defined',
        name: 'TrainingRunConfigurationDefined',
        title: 'Training Run Configuration Defined',
        fields: [
            {name: 'trainingRunConfigurationId', type: 'UUID', idAttribute: true},
            {name: 'federationId', type: 'UUID'}
        ],
        dependencies: [{
            id: 'command-define-training-run-configuration',
            direction: 'INBOUND',
            title: 'Define Training Run Configuration',
            elementType: 'COMMAND'
        }]
    };
    const model = {
        rootPackage: 'tech.medo',
        concepts: [{name: 'TrainingRunConfiguration', states: ['Draft']}],
        valueTypes: [],
        slices: [slice, federationOverviewSlice],
        transitions: []
    };
    const writes = new Map();
    const writer = {
        model,
        fs: {write: (path, content) => writes.set(path, content)},
        _kotlinPath: (path) => path
    };

    commandWriterMethods._writeCommandHandlers.call(
        writer,
        'tech.medo.trainingorchestration.definetrainingrunconfiguration',
        'trainingorchestration',
        'definetrainingrunconfiguration',
        slice,
        selectionFor(slice, model),
        [event],
        []
    );

    const handler = writes.get('trainingorchestration/definetrainingrunconfiguration/DefineTrainingRunConfigurationCommandHandler.kt');
    assert.match(handler, /import tech\.medo\.trainingorchestration\.federationoverview\.FederationOverviewReadModelRepository/);
    assert.match(handler, /import tech\.medo\.trainingorchestration\.domain\.states\.FederationStateEnum/);
    assert.equal((handler.match(/import tech\.medo\.trainingorchestration\.domain\.states\.FederationStateEnum/g) ?? []).length, 1);
    assert.match(handler, /private val federationOverviewReadModelRepository: FederationOverviewReadModelRepository/);
    assert.match(handler, /val federationOverviewReadModelSelection = federationOverviewReadModelRepository\.findById\(command\.federationId\)/);
    assert.doesNotMatch(handler, /findById\(it\)/);
    assert.match(handler, /require\(federationOverviewReadModelSelection != null && federationOverviewReadModelSelection\.state == FederationStateEnum\.Active\)/);
    assert.match(handler, /Federation Overview selection is not eligible\./);
    assert.deepEqual(writer.generationWarnings, undefined);
});

test('does not generate partial backend guards for eligibility blocks with unmapped conditions', () => {
    const command = {
        name: 'DefineTrainingRunConfiguration',
        title: 'Define Training Run Configuration',
        startsLifecycle: true,
        fields: [
            {name: 'trainingRunConfigurationId', type: 'UUID', idAttribute: true},
            {name: 'federationId', type: 'UUID', source: {kind: 'direct', from: ['FederationOverview.federationId']}}
        ]
    };
    const slice = {
        id: 'slice-define-training-run-configuration',
        name: 'DefineTrainingRunConfiguration',
        title: 'Define Training Run Configuration',
        context: 'TrainingOrchestration',
        concepts: ['TrainingRunConfiguration'],
        commands: [command],
        readmodels: []
    };
    const federationOverviewSlice = {
        id: 'slice-federation-overview',
        name: 'FederationOverview',
        title: 'Federation Overview',
        context: 'TrainingOrchestration',
        commands: [],
        events: [],
        readmodels: [{
            id: 'readmodel-federation-overview',
            name: 'FederationOverview',
            title: 'Federation Overview',
            listElement: true,
            fields: [
                {name: 'federationId', type: 'UUID', idAttribute: true},
                {name: 'state', type: 'Federation.State'}
            ],
            eligibility: [{
                operator: 'AND',
                conditions: [
                    {left: 'Federation.state', operator: '==', right: 'Active'},
                    {left: 'Runtime.status', operator: '==', right: 'Online'}
                ]
            }]
        }]
    };
    const model = {
        rootPackage: 'tech.medo',
        concepts: [{name: 'TrainingRunConfiguration', states: ['Draft']}],
        valueTypes: [],
        slices: [slice, federationOverviewSlice],
        transitions: []
    };
    const writes = new Map();
    const writer = {
        model,
        fs: {write: (path, content) => writes.set(path, content)},
        _kotlinPath: (path) => path
    };

    commandWriterMethods._writeCommandHandlers.call(
        writer,
        'tech.medo.trainingorchestration.definetrainingrunconfiguration',
        'trainingorchestration',
        'definetrainingrunconfiguration',
        slice,
        selectionFor(slice, model),
        [],
        []
    );

    const handler = writes.get('trainingorchestration/definetrainingrunconfiguration/DefineTrainingRunConfigurationCommandHandler.kt');
    assert.doesNotMatch(handler, /FederationOverviewReadModelRepository/);
    assert.doesNotMatch(handler, /selection is not eligible/);
    assert.equal(writer.generationWarnings.length, 1);
    assert.match(writer.generationWarnings[0], /Runtime\.status == "Online"/);
    assert.match(writer.generationWarnings[0], /Materialize these fields on the projection/);
});
