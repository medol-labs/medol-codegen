const assert = require('node:assert/strict');
const test = require('node:test');
const {processorWriterMethods} = require('../processor-writer');
const {configureValueTypes} = require('../../../common/util/value-types');

test('writes system notification processors for notifiable events', () => {
    const model = {
        rootPackage: 'tech.medo',
        contexts: [
            {name: 'TrainingOperations'},
            {name: 'SystemNotification'}
        ],
        valueTypes: [
            {name: 'NotificationCategory', context: 'SystemNotification', kind: 'enum', baseType: 'String', values: ['SYSTEM', 'TRAINING']},
            {name: 'NotificationSeverity', context: 'SystemNotification', kind: 'enum', baseType: 'String', values: ['INFO', 'SUCCESS', 'ERROR']},
            {name: 'NotificationToastPolicy', context: 'SystemNotification', kind: 'enum', baseType: 'String', values: ['NONE', 'DEFAULT', 'IMPORTANT']}
        ],
        slices: [
            {
                id: 'slice-training',
                name: 'CompleteTrainingJob',
                title: 'Complete Training Job',
                context: 'TrainingOperations',
                commands: [],
                events: [{
                    id: 'event-training-completed',
                    name: 'TrainingJobCompleted',
                    title: 'Training Job Completed',
                    notifiable: {capability: 'PlatformNotification'},
                    fields: [
                        {name: 'trainingJobId', type: 'UUID', cardinality: 'Single', optional: false, id: true},
                        {name: 'trainingJobObjective', type: 'String', cardinality: 'Single', optional: false}
                    ]
                }],
                readmodels: [],
                processors: []
            },
            {
                id: 'slice-notification',
                name: 'PublishSystemNotification',
                title: 'Publish System Notification',
                context: 'SystemNotification',
                commands: [{
                    id: 'command-publish-notification',
                    name: 'PublishSystemNotification',
                    title: 'Publish System Notification',
                    fields: []
                }],
                events: [],
                readmodels: [],
                processors: []
            }
        ]
    };
    configureValueTypes(model.valueTypes, model.rootPackage, []);
    const writes = new Map();
    const writer = {
        ...processorWriterMethods,
        model,
        fullModel: model,
        fs: {write: (path, content) => writes.set(path, content)},
        _kotlinPath: (path) => `kotlin/${path}`
    };

    writer._writeProcessors(model.slices[0]);

    const processor = writes.get('kotlin/trainingoperations/completetrainingjob/TrainingJobCompletedEventSystemNotification1Processor.kt');
    assert.match(processor, /class TrainingJobCompletedEventSystemNotification1Processor/);
    assert.match(processor, /fun on\(event: TrainingJobCompletedEvent\)/);
    assert.match(processor, /PublishSystemNotificationCommand/);
    assert.match(processor, /category = NotificationCategory\.TRAINING/);
    assert.match(processor, /severity = NotificationSeverity\.SUCCESS/);
    assert.match(processor, /messageKey = "notifications.trainingJobCompleted"/);
    assert.match(processor, /objectMapper\.writeValueAsString\(mapOf\("trainingJobId" to event\.trainingJobId, "trainingJobObjective" to event\.trainingJobObjective\)\)/);
    assert.match(processor, /targetType = "CompleteTrainingJob"/);
    assert.match(processor, /targetId = event\.trainingJobId\.toString\(\)/);
    assert.match(processor, /toastPolicy = NotificationToastPolicy\.DEFAULT/);
});
