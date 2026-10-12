const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const test = require('node:test');

const {readModelWriterMethods} = require('../read-model-writer');
const {safeDatabaseIdentifier} = require('../model-helpers');
const {configureValueTypes} = require('../../../common/util/value-types');

test('places UmaDB event storage settings under medol.axon', () => {
    const template = readFileSync(join(__dirname, '../templates/application.yml'), 'utf8');

    assert.match(template, /  axon:[\s\S]*?    umadb:[\s\S]*?  sync:/);
    assert.doesNotMatch(template, /  sync:[\s\S]*?    umadb:/);
});

test('security template exposes an internal rest client bean', () => {
    const template = readFileSync(join(__dirname, '../templates/security/MedolRestClientSecurityConfiguration.kt.tpl'), 'utf8');

    assert.match(template, /fun medolInternalRestClient\(/);
    assert.match(template, /defaultHeader\(InternalTokenAuthenticationFilter\.INTERNAL_TOKEN_HEADER, token\)/);
});

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
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelTarget.kt'), /relaxedKey\(key\) == relaxedKey\(name\)/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelProperties.kt'), /var sourceBaseUrls: Map<String, String> = emptyMap\(\)/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelProperties.kt'), /fun sourceBaseUrlFor\(target: SyncReadModelTarget\): String/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelProperties.kt'), /sourceBaseUrls\.firstMatching\(target\.sourceContext\)/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelProperties.kt'), /var parameters: Map<String, String> = emptyMap\(\)/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /mode\.equals\("pull-http", ignoreCase = true\)/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /@param:Qualifier\("medolInternalRestClient"\) private val restClient: RestClient/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /val sourceBaseUrl = properties\.sourceBaseUrlFor\(target\)/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /\.fromHttpUrl\(sourceBaseUrl\)/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /target\.queryParameters\(context\)\.forEach/);
    assert.match(writes.get('shared/shared/application/sync/HttpPullSyncReadModelAdapter.kt'), /queryParam\("updatedAfter", it\)/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /mode\.equals\("outbox-delta", ignoreCase = true\)/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /@param:Qualifier\("medolInternalRestClient"\) private val restClient: RestClient/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /val sourceBaseUrl = properties\.sourceBaseUrlFor\(target\)/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /\.fromHttpUrl\(sourceBaseUrl\)/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /afterSequence/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /bootstrapCompleted/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /target\.sourcePath/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /nextCursor/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /highWatermarkSequence/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /SYNC READMODEL snapshot pull/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /SYNC READMODEL snapshot stored/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /SYNC READMODEL delta pull/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /SYNC READMODEL delta stored/);
    const outbox = writes.get('shared/shared/application/outbox/MedolOutbox.kt');
    assert.match(outbox, /medol_outbox/);
    assert.match(outbox, /uk_medol_outbox_event/);
    assert.match(outbox, /idx_medol_outbox_channel_sequence/);
    assert.match(outbox, /idx_medol_outbox_source_sequence/);
    assert.match(outbox, /idx_medol_outbox_queue_available/);
    assert.match(outbox, /object MedolOutboxStatus/);
    assert.match(outbox, /class MedolOutboxQueue/);
    assert.match(outbox, /LockModeType\.PESSIMISTIC_WRITE/);
    assert.match(outbox, /fun findAvailableForClaim/);
    assert.match(outbox, /fun findExpiredClaimsForClaim/);
    assert.match(outbox, /fun claimAvailable/);
    assert.match(outbox, /fun markProcessed/);
    assert.match(outbox, /fun markFailed/);
    assert.match(outbox, /fun purgeProcessedBefore/);
    assert.match(outbox, /existsByChannelAndMessageKeyAndEventIdAndOperation/);
    assert.match(outbox, /existsBySourceContextAndSourceNameAndMessageKeyAndEventIdAndOperation/);
    assert.match(outbox, /MEDOL OUTBOX stored/);
    assert.match(outbox, /@JdbcTypeCode\(SqlTypes\.LONGVARCHAR\)/);
    assert.doesNotMatch(outbox, /@Lob/);
    assert.match(writes.get('shared/shared/application/sync/OutboxDeltaSyncReadModelAdapter.kt'), /requires medol\.sync\.source-base-url/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelScheduler.kt'), /adapters\.firstOrNull \{ it\.supports\(properties\.mode\) \}/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelScheduler.kt'), /adapter\.syncOnce\(target, checkpoint\)/);
    assert.match(writes.get('shared/shared/application/sync/SyncReadModelScheduler.kt'), /SYNC READMODEL checkpoint stored/);
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
    assert.match(sourceResource, /repository\.findAllByCriteria\(null, PageRequest\.of\(pageNumber, size\.coerceIn\(1, 1000\)\)\)/);
    assert.match(sourceResource, /payload\[name\]\?\.toString\(\) != value/);
    assert.match(sourceResource, /highWatermarkSequence/);
    assert.match(sourceResource, /page\.hasNext\(\)/);
    assert.match(sourceResource, /@GetMapping\("\/deltas"\)/);
    assert.match(sourceResource, /MedolOutboxRepository/);
    assert.match(sourceResource, /findBySourceContextAndSourceNameAndSequenceGreaterThanOrderBySequenceAsc/);
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
    assert.match(projector, /open class DefaultOrganizationDirectoryProjectionUpdater/);
    assert.match(projector, /open override fun update\(/);
    assert.match(projector, /@Configuration\(proxyBeanMethods = false\)/);
    assert.match(projector, /class OrganizationDirectoryProjectionUpdaterConfiguration/);
    assert.match(projector, /@Bean/);
    assert.match(projector, /@ConditionalOnMissingBean\(OrganizationDirectoryProjectionUpdater::class\)/);
    assert.doesNotMatch(projector, /@Component\s+@ConditionalOnMissingBean\(OrganizationDirectoryProjectionUpdater::class\)\s+class Default/);
    assert.match(projector, /class OrganizationDirectoryProjector\(\n    private val updater: OrganizationDirectoryProjectionUpdater\n\)/);
    assert.match(projector, /updater\.update\(event, message\)/);
    assert.doesNotMatch(projector, /outbox\.append/);
    assert.doesNotMatch(projector, /MedolOutboxAppender/);
});

test('writes sync source read model updater with transactional outbox append', () => {
    const writes = new Map();
    const event = {
        id: 'event-1',
        title: 'FeatureSchemaDefinedEvent',
        fields: [
            {name: 'featureSchemaId', type: 'UUID'},
            {name: 'featureDomain', type: 'String'}
        ]
    };
    const slice = {
        context: 'DatasetGovernance',
        concepts: [{name: 'FeatureSchema'}],
        events: [event]
    };
    const readmodel = {
        name: 'FeatureSchemaCatalog',
        dependencies: [{direction: 'INBOUND', elementType: 'EVENT', id: 'event-1'}],
        fields: [
            {name: 'featureSchemaId', type: 'UUID', idAttribute: true},
            {name: 'featureDomain', type: 'String'}
        ]
    };
    const writer = {
        ...readModelWriterMethods,
        fullModel: {
            slices: [{
                context: 'RuntimeAgentOperations',
                readmodels: [{
                    name: 'AgentFeatureSchemaCatalog',
                    sync: true,
                    syncSource: 'DatasetGovernance.FeatureSchemaCatalog'
                }]
            }]
        },
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
        'tech.medo.datasetgovernance.featureschemacatalog',
        'datasetgovernance',
        'featureschemacatalog',
        slice,
        readmodel,
        'FeatureSchemaCatalog',
        [readmodel.fields[0]]
    );

    const projector = writes.get('kotlin/datasetgovernance/featureschemacatalog/FeatureSchemaCatalogProjector.kt');
    assert.match(projector, /MedolOutboxAppender/);
    assert.match(projector, /private val outbox: MedolOutboxAppender/);
    assert.match(projector, /outbox\.appendReadModel/);
    assert.match(projector, /sourceContext = "DatasetGovernance"/);
    assert.match(projector, /sourceReadModel = "FeatureSchemaCatalog"/);
    assert.match(projector, /payload = entity\.toReadModel\(\)/);
});

test('writes system notification summary projector with unread count and latest notification state', () => {
    const writes = new Map();
    const published = {
        id: 'event-published',
        name: 'SystemNotificationPublished',
        title: 'System Notification Published',
        fields: []
    };
    const read = {
        id: 'event-read',
        name: 'SystemNotificationRead',
        title: 'System Notification Read',
        fields: []
    };
    const allRead = {
        id: 'event-all-read',
        name: 'AllSystemNotificationsRead',
        title: 'All System Notifications Read',
        fields: []
    };
    const slices = [
        {context: 'SystemNotification', name: 'PublishSystemNotification', title: 'Publish System Notification', events: [published]},
        {context: 'SystemNotification', name: 'MarkSystemNotificationRead', title: 'Mark System Notification Read', events: [read]},
        {context: 'SystemNotification', name: 'MarkAllSystemNotificationsRead', title: 'Mark All System Notifications Read', events: [allRead]}
    ];
    const readmodel = {
        name: 'SystemNotificationSummary',
        dependencies: [
            {direction: 'INBOUND', elementType: 'EVENT', id: 'event-published'},
            {direction: 'INBOUND', elementType: 'EVENT', id: 'event-read'},
            {direction: 'INBOUND', elementType: 'EVENT', id: 'event-all-read'}
        ],
        fields: [
            {name: 'recipientUserId', type: 'String', idAttribute: true},
            {name: 'unreadCount', type: 'Long'},
            {name: 'latestNotificationId', type: 'UUID', optional: true},
            {name: 'latestSeverity', type: 'NotificationSeverity', optional: true},
            {name: 'latestPublishedAt', type: 'DateTime', optional: true},
            {name: 'messageKey', type: 'String', optional: true},
            {name: 'fallbackTitle', type: 'String', optional: true},
            {name: 'fallbackBody', type: 'Text', optional: true},
            {name: 'toastPolicy', type: 'NotificationToastPolicy', optional: true},
            {name: 'hasUnreadError', type: 'Boolean'}
        ]
    };
    configureValueTypes([
        {name: 'NotificationSeverity', context: 'SystemNotification'},
        {name: 'NotificationToastPolicy', context: 'SystemNotification'}
    ], 'tech.medo', []);
    const writer = {
        ...readModelWriterMethods,
        model: {
            rootPackage: 'tech.medo',
            slices
        },
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
        'tech.medo.systemnotification.systemnotificationcatalog',
        'systemnotification',
        'systemnotificationcatalog',
        {context: 'SystemNotification'},
        readmodel,
        'SystemNotificationSummary',
        [readmodel.fields[0]]
    );

    const projector = writes.get('kotlin/systemnotification/systemnotificationcatalog/SystemNotificationSummaryProjector.kt');
    assert.match(projector, /open class DefaultSystemNotificationSummaryProjectionUpdater/);
    assert.match(projector, /entity\.unreadCount = \(entity\.unreadCount \?: 0L\) \+ 1L/);
    assert.match(projector, /entity\.latestNotificationId = event\.notificationId/);
    assert.match(projector, /entity\.messageKey = event\.messageKey/);
    assert.match(projector, /entity\.toastPolicy = event\.toastPolicy/);
    assert.match(projector, /entity\.hasUnreadError = \(entity\.hasUnreadError == true\) \|\| event\.severity == NotificationSeverity\.ERROR/);
    assert.match(projector, /entity\.unreadCount = maxOf\(0L, \(entity\.unreadCount \?: 0L\) - 1L\)/);
    assert.match(projector, /entity\.unreadCount = 0L/);
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

test('writes export support for exportable read models', () => {
    const writes = new Map();
    const writer = syncWriter(writes);
    writer.model.slices = [{
        name: 'DataExportJob',
        processors: [{
            name: 'ExecuteDataExport',
            metadata: {
                on: 'DataExportRequested',
                onKind: 'event',
                uses: 'PlatformDataExchange.export',
                emits: 'MarkDataExportProcessing',
                emits2: 'CompleteDataExport',
                emits3: 'FailDataExport'
            }
        }]
    }];
    const slice = {
        name: 'RuntimeNodeInventory',
        concepts: [{name: 'RuntimeNodeInventory'}]
    };
    const readmodel = {
        name: 'RuntimeNodeInventoryCatalog',
        title: 'Runtime Node Inventory Catalog',
        exportable: {capability: 'PlatformDataExchange'},
        fields: [
            {name: 'runtimeNodeInventoryId', type: 'UUID', idAttribute: true},
            {name: 'runtimeName', type: 'String', label: 'Runtime Name'},
            {name: 'nodeReady', type: 'Boolean'},
            {name: 'version', type: 'Long'}
        ]
    };

    readModelWriterMethods._writeDataExportSupport.call(writer);
    readModelWriterMethods._writeReadModelResource.call(
        writer,
        'tech.medo.context.runtimegovernance.runtimenodeinventory',
        'runtimegovernance',
        'runtimenodeinventory',
        slice,
        readmodel,
        'RuntimeNodeInventoryCatalog',
        [readmodel.fields[0]]
    );

    const service = writes.get('shared/shared/application/export/DataExportService.kt');
    const ports = writes.get('shared/shared/application/export/DataExportPorts.kt');
    const registry = writes.get('shared/shared/application/export/DataExportResourceExecutorRegistry.kt');
    const jobResource = writes.get('shared/shared/application/export/DataExportJobResource.kt');
    const processor = writes.get('kotlin/dataexchange/dataexportjob/ExecuteDataExportProcessor.kt');
    const resource = writes.get('kotlin/runtimegovernance/runtimenodeinventory/RuntimeNodeInventoryCatalogResource.kt');

    assert.match(service, /fun <T : Any> export\(/);
    assert.match(service, /DataExportJobRequestMessage/);
    assert.doesNotMatch(service, /outbox\.appendExternal/);
    assert.match(service, /DataExportJobResponse\(jobId, "REQUESTED", fileName\) as Any/);
    assert.match(service, /ByteArrayResource\(content\) as Any/);
    assert.match(ports, /interface DataExportJobRequestPort/);
    assert.match(ports, /interface DataExportJobLifecyclePort/);
    assert.match(ports, /interface DataExportResourceExecutor/);
    assert.match(registry, /class DataExportResourceExecutorRegistry/);
    assert.match(registry, /executorsByResourceName/);
    assert.match(jobResource, /@PreAuthorize\("isAuthenticated\(\)"\)/);
    assert.match(jobResource, /@RestController\("dataExportJobDownloadResource"\)/);
    assert.match(jobResource, /Files\.readAllBytes\(path\)/);
    assert.match(processor, /class ExecuteDataExportProcessor/);
    assert.match(processor, /fun on\(event: DataExportRequestedEvent, message: EventMessage\)/);
    assert.match(processor, /@Namespace\("automation-application-data-exchange-execute-data-export"\)/);
    assert.match(processor, /MetadataKeys\.DEPLOYMENT_NAME/);
    assert.match(processor, /AxonDataExportJobRequestPort\.DEPLOYMENT_NAME/);
    assert.match(processor, /requestedAt = event\.requestedAt\.toInstant\(ZoneOffset\.UTC\)/);
    assert.match(processor, /snapshotUpperBound = event\.snapshotUpperBound\.toInstant\(ZoneOffset\.UTC\)/);
    assert.doesNotMatch(processor, /lifecyclePort\.markProcessing/);
    assert.match(processor, /registry\.executor\(event\.resourceName\)\.execute\(task\)/);
    assert.match(processor, /lifecyclePort\.complete\(event\.dataExportJobId, result\.fileName, result\.filePath, result\.rowCount\)/);
    assert.doesNotMatch(processor, /outbox|DataExportWorker|DataExportJobWorkPort/);
    const jobPorts = writes.get('kotlin/dataexchange/dataexportjob/DataExportJobPorts.kt');
    assert.match(jobPorts, /val downloadUri = "\/data-export\/jobs\/download\?filePath=\$encodedFilePath&fileName=\$encodedFileName"/);
    assert.match(jobPorts, /CompleteDataExportCommand\(dataExportJobId, fileName, filePath, downloadUri, rowCount, DataExportJobStatus\.COMPLETED\)/);
    assert.match(resource, /private val exportColumns = listOf\(/);
    assert.match(resource, /DataExportColumn\("runtimeNodeInventoryId", "runtimeNodeInventoryId"\)/);
    assert.match(resource, /DataExportColumn\("runtimeName", "Runtime Name"\)/);
    assert.doesNotMatch(resource, /DataExportColumn\("version"/);
    assert.match(resource, /@PostMapping\("\/export"\)/);
    assert.match(resource, /dataExportService\.validatedColumns\(request\?\.columns, exportColumns\)/);
    assert.match(resource, /val snapshotUpperBound = LocalDateTime\.now\(ZoneOffset\.UTC\)/);
    assert.match(resource, /val snapshotCriteria = applyExportSnapshot\(criteria, snapshotUpperBound\)/);
    assert.match(resource, /PageRequest\.of\(0, dataExportService\.pageSize\(\), pageable\.sort\)/);
    assert.match(resource, /findPage\(snapshotCriteria, nextPage\)/);
    assert.match(resource, /requestedLocale = request\?\.requestedLocale/);
    assert.match(resource, /snapshotUpperBound = snapshotUpperBound\.toInstant\(ZoneOffset\.UTC\)/);
    assert.match(resource, /requestedLocale = task\.requestedLocale/);
    assert.match(resource, /class RuntimeNodeInventoryCatalogDataExportExecutor/);
    assert.match(resource, /repository\.findByIdWithAccessPolicy\(id\)/);
    assert.match(resource, /criteria\.projectionUpdatedAt/);
    assert.match(resource, /projectionUpdatedAt\.getLessThanOrEqual\(\)/);
    assert.match(resource, /requestedUpperBound == null \|\| requestedUpperBound\.isAfter\(snapshotUpperBound\)/);
    assert.match(resource, /applyExportSnapshot\(criteria, snapshotUpperBound\)/);
});

test('writes data export job ports for every generated backend module', () => {
    const writes = new Map();
    const writer = syncWriter(writes);
    writer.model.slices = [{
        name: 'DataExportJob',
        processors: [{
            name: 'ExecuteDataExport',
            metadata: {
                on: 'DataExportRequested',
                onKind: 'event',
                uses: 'PlatformDataExchange.export',
                emits: 'MarkDataExportProcessing',
                emits2: 'CompleteDataExport',
                emits3: 'FailDataExport'
            }
        }]
    }];
    let moduleName = 'platform';
    writer._kotlinPath = (relative) => `${moduleName}/${relative}`;

    readModelWriterMethods._writeDataExportSupport.call(writer);
    moduleName = 'support';
    readModelWriterMethods._writeDataExportSupport.call(writer);

    assert.match(
        writes.get('platform/dataexchange/dataexportjob/DataExportJobPorts.kt'),
        /class AxonDataExportJobRequestPort/
    );
    assert.match(
        writes.get('support/dataexchange/dataexportjob/DataExportJobPorts.kt'),
        /class AxonDataExportJobRequestPort/
    );
    assert.match(
        writes.get('support/dataexchange/dataexportjob/DataExportJobPorts.kt'),
        /const val DEPLOYMENT_NAME = "application"/
    );
    assert.match(
        writes.get('support/dataexchange/dataexportjob/ExecuteDataExportProcessor.kt'),
        /class ExecuteDataExportProcessor/
    );
});

test('writes read model access policy filter and applies it in JPA queries', () => {
    const writes = new Map();
    const writer = syncWriter(writes);
    writer.model = {
        rootPackage: 'tech.medo',
        defaultAccessPolicy: 'DefaultAccess',
        accessPolicies: [{
            name: 'DefaultAccess',
            rules: [{kind: 'fields', fields: ['RuntimeMonitoring.RuntimeIdentityCatalog.organizationId']}]
        }, {
            name: 'PublicAccess',
            rules: []
        }]
    };
    const readmodel = {
        name: 'RuntimeIdentityCatalog',
        title: 'Runtime Identity Catalog',
        fields: [
            {name: 'runtimeId', type: 'UUID', idAttribute: true},
            {name: 'organizationId', type: 'UUID', query: true}
        ]
    };
    const slice = {
        context: 'RuntimeMonitoring',
        chapter: 'RuntimeMonitoring'
    };

    readModelWriterMethods._writeReadModelAccessPolicySupport.call(writer);
    readModelWriterMethods._writeReadModelJpaRepository.call(
        writer,
        'tech.medo.runtimemonitoring.runtimeidentitycatalog',
        'runtimemonitoring',
        'RuntimeIdentityCatalogs',
        slice,
        readmodel,
        'RuntimeIdentityCatalogReadModel',
        [readmodel.fields[0]],
        false
    );

    const support = writes.get('shared/shared/application/access/ReadModelAccessPolicyFilter.kt');
    const adapter = [...writes.entries()]
        .find(([path]) => path.endsWith('JpaRuntimeIdentityCatalogReadModelRepository.kt'))?.[1];
    const queryService = [...writes.entries()]
        .find(([path]) => path.endsWith('RuntimeIdentityCatalogReadModelQueryService.kt'))?.[1];

    assert.match(support, /interface ReadModelAccessPolicyFilter/);
    assert.match(support, /class PermitAllReadModelAccessPolicyFilter/);
    assert.match(support, /Specification<T> = Specification\.where\(null\)/);
    assert.match(adapter, /private val accessPolicyFilter: ReadModelAccessPolicyFilter/);
    assert.match(adapter, /queryService\.createSpecification\(criteria\)\.and\(accessSpecification\(\)\)/);
    assert.match(adapter, /jpaRepository\.findOne\(idSpecification\(id\)\.and\(accessSpecification\(\)\)\)/);
    assert.match(adapter, /override fun findByIdWithAccessPolicy\(id: UUID\): RuntimeIdentityCatalogReadModel\?/);
    assert.match(adapter, /contextName = "RuntimeMonitoring"/);
    assert.match(adapter, /readModelName = "RuntimeIdentityCatalog"/);
    assert.match(adapter, /name = "DefaultAccess"/);
    assert.match(adapter, /fields = listOf\("RuntimeMonitoring\.RuntimeIdentityCatalog\.organizationId"\)/);
    assert.match(queryService, /fun createSpecification\(criteria: RuntimeIdentityCatalogReadModelCriteria\?\): Specification<RuntimeIdentityCatalogReadModelEntity>/);
    assert.doesNotMatch(queryService, /fun findByCriteria/);
    assert.doesNotMatch(queryService, /private val repository:/);
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
