const assert = require('node:assert/strict');
const test = require('node:test');

const {commandWriterMethods} = require('../command-writer');
const {selectionFor} = require('../model-helpers');

test('tenant references are checked for existence even without business eligibility', () => {
    const command = {id: 'create', name: 'CreateEntry', title: 'Create Entry', startsLifecycle: true, fields: [
        {name: 'entryId', type: 'UUID', idAttribute: true},
        {name: 'parentId', type: 'UUID', source: {kind: 'direct', from: ['Entries.EntryCatalog.entryId']}}
    ]};
    const slice = {name: 'CreateEntry', title: 'Create Entry', context: 'Entries', concepts: ['Entry'], commands: [command], events: [], readmodels: []};
    const catalogSlice = {context: 'Entries', name: 'EntryCatalog', title: 'Entry Catalog', commands: [], events: [], readmodels: [{
        name: 'EntryCatalog', title: 'Entry Catalog', fields: [{name: 'entryId', type: 'UUID', idAttribute: true}]
    }]};
    const model = {rootPackage: 'sample.app', slices: [slice, catalogSlice], concepts: [], valueTypes: [], transitions: [], tenancy: {
        enabled: true, directory: {context: 'Admin', readModel: 'Tenants', mappings: {id: 'id', state: 'state'}},
        memberships: {context: 'Admin', readModel: 'Members', mappings: {id: 'id', tenant: 'tenant', user: 'user', state: 'state'}}, managementContexts: ['Admin']
    }};
    let result;
    const writer = {model, fs: {write: (_, content) => { result = content; }}, _kotlinPath: (value) => value};
    commandWriterMethods._writeCommandHandlers.call(writer, 'sample.app.entries.createentry', 'entries', 'createentry', slice, selectionFor(slice, model), [], []);
    assert.match(result, /findById\(command.parentId\)/);
    assert.match(result, /entryCatalogReadModelSelection != null && true/);
    assert.match(result, /TenantScope.withIdentity/);
});

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
    assert.match(handler, /if \(!\(federationOverviewReadModelSelection != null && federationOverviewReadModelSelection\.state == FederationStateEnum\.Active\)\)/);
    assert.match(handler, /code = "SELECTION_NOT_ELIGIBLE"/);
    assert.match(handler, /i18nKey = "errors\.trainingorchestration\.defineTrainingRunConfiguration\.federationOverview\.notEligible"/);
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

test('writes import support for importable commands', () => {
    const command = {
        name: 'ImportRuntimeNodeInventory',
        title: 'Import Runtime Node Inventory',
        importable: {capability: 'PlatformDataExchange'},
        fields: [
            {name: 'runtimeNodeInventoryId', type: 'UUID', idAttribute: true},
            {name: 'runtimeName', type: 'String'},
            {name: 'nodeReady', type: 'Boolean', optional: true}
        ]
    };
    const slice = {
        id: 'slice-runtime-node-inventory',
        name: 'RuntimeNodeInventory',
        title: 'Runtime Node Inventory',
        context: 'RuntimeGovernance',
        concepts: ['RuntimeNodeInventory'],
        commands: [command],
        events: [],
        readmodels: []
    };
    const model = {
        rootPackage: 'tech.medo',
        concepts: [],
        valueTypes: [],
        slices: [
            slice,
            {
                name: 'DataImportJob',
                events: [],
                commands: [],
                processors: [{
                    name: 'ExecuteDataImport',
                    metadata: {
                        on: 'DataImportRequested',
                        uses: 'PlatformDataExchange.import',
                        emits: 'MarkDataImportProcessing',
                        emits2: 'CompleteDataImport',
                        emits3: 'FailDataImport'
                    }
                }]
            }
        ],
        transitions: []
    };
    const writes = new Map();
    const writer = {
        ...commandWriterMethods,
        model,
        fs: {write: (path, content) => writes.set(path, content)},
        _kotlinPath: (path) => `kotlin/${path}`,
        _sharedKernelKotlinPath: (path) => `shared/${path}`
    };

    writer._writeCommandResource(
        'tech.medo.runtimegovernance.runtimenodeinventory',
        'runtimegovernance',
        'runtimenodeinventory',
        slice
    );

    const resource = writes.get('kotlin/runtimegovernance/runtimenodeinventory/RuntimeNodeInventoryResource.kt');
    const service = writes.get('shared/shared/application/importing/DataImportService.kt');
    const ports = writes.get('shared/shared/application/importing/DataImportPorts.kt');
    const axonPorts = writes.get('kotlin/dataexchange/dataimportjob/DataImportJobPorts.kt');
    const processor = writes.get('kotlin/dataexchange/dataimportjob/ExecuteDataImportProcessor.kt');
    const executor = writes.get('kotlin/runtimegovernance/runtimenodeinventory/ImportRuntimeNodeInventoryDataImportCommandExecutor.kt');

    assert.match(resource, /@PostMapping\("\/importruntimenodeinventory\/import"/);
    assert.match(resource, /dataImportService\.request/);
    assert.match(resource, /metadata = MetadataFactory\.from\(request\)/);
    assert.match(service, /DataImportJobRequestMessage/);
    assert.match(ports, /fun request\(message: DataImportJobRequestMessage, metadata: Metadata\)/);
    assert.match(axonPorts, /override fun request\(message: DataImportJobRequestMessage, metadata: Metadata\)/);
    assert.match(axonPorts, /RequestDataImportCommand\([\s\S]*\),\n            metadata/);
    assert.match(service, /Only CSV import is supported/);
    assert.match(service, /fun processCsv\(filePath: String, consumer: \(Long, Map<String, String>, String\) -> Unit\): Long/);
    assert.match(service, /fun writeFailureIndex/);
    assert.match(service, /failure-index\.csv/);
    assert.match(processor, /fun on\(event: DataImportRequestedEvent, message: EventMessage\)/);
    assert.match(processor, /userId = MetadataFactory\.value\(message\.metadata\[MetadataKeys\.USER_ID\]\?\.toString\(\)\)/);
    assert.doesNotMatch(processor, /lifecyclePort\.markProcessing/);
    assert.match(executor, /override val commandName: String = "ImportRuntimeNodeInventory"/);
    assert.match(executor, /runtimeNodeInventoryId = dataImportService\.uuid\(row, "runtimeNodeInventoryId", true\)!!/);
    assert.match(executor, /nodeReady = dataImportService\.boolean\(row, "nodeReady", false\)/);
    assert.match(executor, /val metadata = MetadataFactory\.fromValues/);
    assert.match(executor, /commandGateway\.send\(command, metadata\)\.resultMessage/);
    assert.match(executor, /rowHash = rowHash/);
    assert.match(executor, /errorCode = ex\.javaClass\.simpleName/);
    assert.doesNotMatch(executor, /rawValue = row\.toString\(\)/);
});
