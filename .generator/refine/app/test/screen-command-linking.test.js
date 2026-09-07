const assert = require('node:assert/strict');
const test = require('node:test');

const {buildFrontendModel} = require('../model-builder');

test('places a command on the read model that shares its explicit UI screen', () => {
    const registeredEvent = {
        id: 'event-runtime-registered',
        title: 'Runtime Infrastructure Registered',
        dependencies: []
    };
    const command = {
        id: 'command-confirm-runtime-prepared',
        title: 'Confirm Runtime Infrastructure Prepared',
        concept: 'RuntimeInfrastructure',
        fields: [
            {name: 'runtimeInstallationPlanId', type: 'UUID'},
            {name: 'runtimeInfrastructureId', type: 'UUID', idAttribute: true}
        ]
    };
    const model = {
        domain: 'Demo',
        contexts: [{name: 'RuntimeProvisioning', title: 'Runtime Provisioning'}],
        concepts: [{
            name: 'RuntimeInfrastructure',
            title: 'Runtime Infrastructure',
            states: ['Registered', 'Prepared']
        }],
        aggregates: [],
        deployments: [{
            name: 'Backend',
            title: 'Backend',
            contexts: ['RuntimeProvisioning']
        }],
        transitions: [{
            context: 'RuntimeProvisioning',
            owner: {name: 'RuntimeInfrastructure', title: 'Runtime Infrastructure'},
            command: {id: command.id, name: 'ConfirmRuntimeInfrastructurePrepared', title: command.title},
            from: ['Registered'],
            to: 'Prepared'
        }],
        slices: [{
            id: 'slice-guide',
            context: 'RuntimeProvisioning',
            chapter: 'RuntimeProvisioning',
            title: 'Runtime Installation Guide',
            concepts: ['RuntimeInstallationPlan'],
            commands: [],
            events: [],
            screens: [{name: 'RuntimeInstallationGuideScreen'}],
            readmodels: [{
                id: 'readmodel-guide',
                title: 'Runtime Installation Guide',
                listElement: true,
                fields: [
                    {name: 'runtimeInstallationPlanId', type: 'UUID', idAttribute: true},
                    {name: 'runtimeInfrastructureId', type: 'UUID'},
                    {name: 'runtimeInfrastructureState', type: 'RuntimeInfrastructure.State'}
                ],
                dependencies: [{
                    id: registeredEvent.id,
                    direction: 'INBOUND',
                    elementType: 'EVENT'
                }]
            }]
        }, {
            id: 'slice-infrastructure-catalog',
            context: 'RuntimeProvisioning',
            chapter: 'RuntimeProvisioning',
            title: 'Runtime Infrastructure Catalog',
            concepts: ['RuntimeInfrastructure'],
            commands: [],
            events: [registeredEvent],
            screens: [],
            readmodels: [{
                id: 'readmodel-infrastructure',
                title: 'Runtime Infrastructure Catalog',
                listElement: true,
                fields: [
                    {name: 'runtimeInfrastructureId', type: 'UUID', idAttribute: true},
                    {name: 'state', type: 'RuntimeInfrastructure.State'}
                ],
                dependencies: []
            }]
        }, {
            id: 'slice-confirm',
            context: 'RuntimeProvisioning',
            chapter: 'RuntimeProvisioning',
            title: command.title,
            concepts: ['RuntimeInfrastructure'],
            commands: [command],
            events: [],
            screens: [{name: 'RuntimeInstallationGuideScreen'}],
            readmodels: []
        }]
    };

    const frontend = buildFrontendModel(model);
    const guide = frontend.resources.find((resource) => resource.name === 'runtime_installation_guide');
    const infrastructure = frontend.resources.find((resource) => resource.name === 'runtime_infrastructure_catalog');
    const linked = guide?.itemCommands.find((item) => item.name === 'confirmRuntimeInfrastructurePrepared');

    assert.equal(linked?.stateField, 'runtimeInfrastructureState');
    assert.deepEqual(linked?.allowedStates, ['Registered']);
    assert.deepEqual(infrastructure?.itemCommands, []);
});
