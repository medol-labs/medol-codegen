const assert = require('node:assert/strict');
const test = require('node:test');

const {readModelWriterMethods} = require('../read-model-writer');
const {safeDatabaseIdentifier} = require('../model-helpers');

test('keeps generated database identifiers within PostgreSQL identifier length', () => {
    const name = safeDatabaseIdentifier(
        'Extremely Long Runtime Infrastructure Participant Execution Plan Coordination Dashboard'
    );

    assert.ok(name.length <= 63);
    assert.match(name, /^extremely_long_runtime_infrastructure_participant_[a-z0-9_]*_[a-f0-9]{10}$/);
    assert.ok(!name.includes('read_model_entity'));
    assert.equal(
        name,
        safeDatabaseIdentifier(
            'Extremely Long Runtime Infrastructure Participant Execution Plan Coordination Dashboard'
        )
    );
});

test('appends singular event fields into plural read model fields', () => {
    const event = {
        id: 'role-assigned',
        name: 'RoleAssignedToUser',
        title: 'Role Assigned To User',
        fields: [
            {name: 'userAccountId', type: 'UUID'},
            {name: 'roleCode', type: 'String'}
        ]
    };
    const readmodel = {
        fields: [
            {name: 'userAccountId', type: 'UUID'},
            {name: 'roleCodes', type: 'String', cardinality: 'Multiple'}
        ]
    };
    const writer = {
        model: {
            slices: [{events: [event]}],
            transitions: []
        }
    };

    const assignments = readModelWriterMethods
        ._readModelConventionalAssignments.call(writer, readmodel, event, new Set(['userAccountId']));

    assert.deepEqual(assignments, [{
        fieldName: 'roleCodes',
        code: 'entity.roleCodes = (entity.roleCodes + event.roleCode).distinct()',
        usesEventTime: false
    }]);
});

test('maps lifecycle state changes onto boolean read model fields', () => {
    const registered = {
        id: 'registered',
        name: 'UserAccountRegistered',
        title: 'User Account Registered',
        fields: [{name: 'userAccountId', type: 'UUID'}]
    };
    const deactivated = {
        id: 'deactivated',
        name: 'UserAccountDeactivated',
        title: 'User Account Deactivated',
        fields: [{name: 'userAccountId', type: 'UUID'}]
    };
    const readmodel = {
        fields: [
            {name: 'userAccountId', type: 'UUID'},
            {name: 'active', type: 'Boolean'}
        ]
    };
    const writer = {
        model: {
            slices: [
                {events: [registered], stateChange: {eventId: 'registered', to: 'Active'}},
                {events: [deactivated], stateChange: {eventId: 'deactivated', to: 'Deactivated'}}
            ],
            transitions: [
                {event: {id: 'registered'}, from: undefined, to: 'Active'},
                {event: {id: 'deactivated'}, from: 'Active', to: 'Deactivated'}
            ]
        }
    };

    const registeredAssignments = readModelWriterMethods
        ._readModelConventionalAssignments.call(writer, readmodel, registered, new Set(['userAccountId']));
    const deactivatedAssignments = readModelWriterMethods
        ._readModelConventionalAssignments.call(writer, readmodel, deactivated, new Set(['userAccountId']));

    assert.equal(registeredAssignments.find((assignment) => assignment.fieldName === 'active')?.code, 'entity.active = true');
    assert.equal(deactivatedAssignments.find((assignment) => assignment.fieldName === 'active')?.code, 'entity.active = false');
});

test('maps Text read model fields to PostgreSQL text columns', () => {
    assert.equal(
        readModelWriterMethods._jpaEntityColumnAnnotation({name: 'bootstrapCommand', type: 'Text'}),
        '    @Column(columnDefinition = "text")\n'
    );
});

test('writes shared sync read model support with switchable adapters and checkpoints', () => {
    const writes = new Map();
    const writer = syncWriter(writes);

    readModelWriterMethods._writeSyncReadModelSupport.call(writer);
    readModelWriterMethods._writeSyncReadModelSupport.call(writer);

    assert.equal([...writes.keys()].filter((path) => path.endsWith('SyncReadModelScheduler.kt')).length, 1);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelAdapter.kt'), /interface SyncReadModelAdapter/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelAdapter.kt'), /fun supports\(mode: String\): Boolean/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelAdapter.kt'), /fun syncOnce\(target: SyncReadModelTarget, checkpoint: SyncReadModelCheckpoint\?\): SyncReadModelResult/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelTarget.kt'), /val queryParameters: \(SyncReadModelContext\) -> Map<String, String>/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelProperties.kt'), /var parameters: Map<String, String> = emptyMap\(\)/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /mode\.equals\("pull-http", ignoreCase = true\)/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /target\.queryParameters\(context\)\.forEach/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /queryParam\("updatedAfter", it\)/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /mode\.equals\("outbox-delta", ignoreCase = true\)/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /afterSequence/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /bootstrapCompleted/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /target\.sourcePath/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /nextCursor/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /highWatermarkSequence/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelOutbox.kt'), /medol_sync_read_model_outbox/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelOutbox.kt'), /uk_sync_read_model_outbox_event/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelOutbox.kt'), /idx_sync_read_model_outbox_source_sequence/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelOutbox.kt'), /existsBySourceContextAndSourceReadModelAndReadModelKeyAndEventIdAndOperation/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /requires medol\.sync\.source-base-url/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelScheduler.kt'), /adapters\.firstOrNull \{ it\.supports\(properties\.mode\) \}/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelScheduler.kt'), /adapter\.syncOnce\(target, checkpoint\)/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelCheckpoint.kt'), /medol_sync_read_model_checkpoint/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelCheckpoint.kt'), /lastSequence/);
});

test('writes sync read model target registration with field aliases and local syncedAt', () => {
    const writes = new Map();
    const writer = syncWriter(writes);
    writer.fullModel = {
        slices: [{
            context: 'DatasetGovernance',
            readmodels: [{
                name: 'FeatureSchemaCatalog',
                fields: [
                    {name: 'featureSchemaId', type: 'UUID'},
                    {name: 'featureDomain', type: 'String'},
                    {name: 'version', type: 'String'}
                ]
            }]
        }]
    };
    const readmodel = {
        name: 'AgentFeatureSchemaCatalog',
        title: 'Agent Feature Schema Catalog',
        sync: true,
        syncSource: 'DatasetGovernance.FeatureSchemaCatalog',
        syncFilters: [{target: 'organizationId', source: 'sync.organizationId'}],
        fields: [
            {name: 'featureSchemaId', type: 'UUID', idAttribute: true, source: {kind: 'direct', from: ['featureSchemaId']}},
            {name: 'featureDomain', type: 'String', display: true},
            {name: 'featureSchemaVersion', type: 'String', source: {kind: 'direct', from: ['version']}},
            {name: 'localDisplayOrder', type: 'Integer'},
            {name: 'syncedAt', type: 'DateTime'}
        ]
    };

    readModelWriterMethods._writeSyncReadModelRegistration.call(
        writer,
        'tech.medo.runtimeagent.agentfeatureschemacatalog',
        'runtimeagent',
        'AgentFeatureSchemaCatalog',
        readmodel,
        'AgentFeatureSchemaCatalog',
        [readmodel.fields[0]]
    );

    const registration = writes.get('kotlin/runtimeagent/AgentFeatureSchemaCatalog/AgentFeatureSchemaCatalogSyncRegistration.kt');
    assert.match(registration, /source = "DatasetGovernance\.FeatureSchemaCatalog"/);
    assert.match(registration, /sourcePath = "\/sync\/read-models\/dataset-governance\/feature-schema-catalog"/);
    assert.match(registration, /"organizationId" to context\.requiredParameter\("organizationId", targetName\)/);
    assert.match(registration, /"featureDomain" to "featureDomain"/);
    assert.match(registration, /"featureSchemaVersion" to "version"/);
    assert.doesNotMatch(registration, /localDisplayOrder/);
    assert.match(registration, /val targetName = "AgentFeatureSchemaCatalog"/);
    assert.match(registration, /val id = SyncValueConverters\.required\(SyncValueConverters\.uuid\(row\["featureSchemaId"\]\), targetName, "featureSchemaId"\)/);
    assert.match(registration, /projection\.featureDomain = SyncValueConverters\.required\(SyncValueConverters\.string\(row\["featureDomain"\]\), targetName, "featureDomain"\)/);
    assert.match(registration, /projection\.featureSchemaVersion = SyncValueConverters\.required\(SyncValueConverters\.string\(row\["version"\]\), targetName, "featureSchemaVersion"\)/);
    assert.match(registration, /projection\.syncedAt = syncedAt/);
    assert.match(registration, /repository\.save\(projection\)/);
});

test('writes sync read model source resource for referenced source read models', () => {
    const writes = new Map();
    const writer = syncWriter(writes);
    writer.fullModel = {
        slices: [{
            context: 'RuntimeAgentOperations',
            readmodels: [{
                name: 'AgentFeatureSchemaCatalog',
                sync: true,
                syncSource: 'DatasetGovernance.FeatureSchemaCatalog'
            }]
        }]
    };
    const slice = {
        context: 'DatasetGovernance',
        concepts: ['FeatureSchema'],
        name: 'FeatureSchemaCatalog'
    };
    const readmodel = {
        name: 'FeatureSchemaCatalog',
        title: 'Feature Schema Catalog'
    };

    readModelWriterMethods._writeReadModelResource.call(
        writer,
        'tech.medo.datasetgovernance.featureschemacatalog',
        'datasetgovernance',
        'FeatureSchemaCatalog',
        slice,
        readmodel,
        'FeatureSchemaCatalogReadModel',
        [{name: 'featureSchemaId', type: 'UUID'}]
    );

    const sourceResource = writes.get(
        'kotlin/datasetgovernance/FeatureSchemaCatalog/FeatureSchemaCatalogReadModelSyncReadModelResource.kt'
    );
    assert.match(sourceResource, /@RequestMapping\("\/sync\/read-models\/dataset-governance\/feature-schema-catalog"\)/);
    assert.match(sourceResource, /@RequestParam\(required = false\) cursor: String\?/);
    assert.match(sourceResource, /repository\.findAll\(PageRequest\.of\(pageNumber, size\.coerceIn\(1, 1000\)\)\)/);
    assert.match(sourceResource, /payload\[name\]\?\.toString\(\) != value/);
    assert.match(sourceResource, /highWatermarkSequence/);
    assert.match(sourceResource, /page\.hasNext\(\)/);
    assert.match(sourceResource, /@GetMapping\("\/deltas"\)/);
    assert.match(sourceResource, /SyncReadModelOutboxRepository/);
    assert.match(sourceResource, /afterSequence/);
    assert.match(sourceResource, /"items" to items/);
});

test('writes read model projector as overridable projection updater', () => {
    const writes = new Map();
    const event = {
        id: 'event-1',
        title: 'OrganizationRegisteredEvent',
        fields: [
            {name: 'organizationId', type: 'UUID'},
            {name: 'organizationName', type: 'String'}
        ]
    };
    const slice = {
        context: 'OrganizationManagement',
        concepts: [{name: 'Organization'}],
        events: [event]
    };
    const readmodel = {
        name: 'OrganizationDirectory',
        dependencies: [{direction: 'INBOUND', elementType: 'EVENT', id: 'event-1'}],
        fields: [
            {name: 'organizationId', type: 'UUID', idAttribute: true},
            {name: 'organizationName', type: 'String'}
        ]
    };
    const writer = {
        ...readModelWriterMethods,
        model: {rootPackage: 'tech.medo', slices: [slice]},
        fs: {
            write(path, content) {
                writes.set(path, content);
            }
        },
        _kotlinPath(relative) {
            return `kotlin/${relative}`;
        }
    };

    readModelWriterMethods._writeReadModelProjector.call(
        writer,
        'tech.medo.organizationmanagement.organizationdirectory',
        'organizationmanagement',
        'organizationdirectory',
        slice,
        readmodel,
        'OrganizationDirectory',
        [readmodel.fields[0]]
    );

    const projector = writes.get('kotlin/organizationmanagement/organizationdirectory/OrganizationDirectoryProjector.kt');
    assert.match(projector, /interface OrganizationDirectoryProjectionUpdater/);
    assert.match(projector, /class DefaultOrganizationDirectoryProjectionUpdater/);
    assert.match(projector, /@ConditionalOnMissingBean\(OrganizationDirectoryProjectionUpdater::class\)/);
    assert.match(projector, /class OrganizationDirectoryProjector\(\n    private val updater: OrganizationDirectoryProjectionUpdater\n\)/);
    assert.match(projector, /updater\.update\(event, message\)/);
    assert.doesNotMatch(projector, /outbox\.append/);
    assert.doesNotMatch(projector, /SyncReadModelOutboxAppender/);
});

test('does not write sync registration for read models without sync source or a single id', () => {
    const writes = new Map();
    const writer = syncWriter(writes);
    const readmodel = {
        name: 'LocalCatalog',
        title: 'Local Catalog',
        sync: true,
        fields: [{name: 'localId', type: 'UUID', idAttribute: true}]
    };

    readModelWriterMethods._writeSyncReadModelRegistration.call(
        writer,
        'tech.medo.local',
        'local',
        'LocalCatalog',
        readmodel,
        'LocalCatalog',
        [readmodel.fields[0]]
    );

    assert.equal(writes.size, 0);
});

function syncWriter(writes) {
    return {
        ...readModelWriterMethods,
        model: {rootPackage: 'tech.medo'},
        fs: {
            write(path, content) {
                writes.set(path, content);
            }
        },
        _sharedKernelKotlinPath(relative) {
            return `shared/${relative}`;
        },
        _kotlinPath(relative) {
            return `kotlin/${relative}`;
        }
    };
}
