/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { previewValue } = require('../deterministic-data');
const { generateSimulationFiles } = require('../simulation-generator');
const { buildSimulationModel } = require('../simulation-model-builder');

test('unmodeled fields remain unresolved, not inferred by field names', () => {
    const source = structuredClone(sampleModel);
    for (const slice of source.slices) for (const command of slice.commands || []) {
        for (const field of command.fields || []) {
            delete field.source;
            delete field.mappings;
            delete field.generated;
        }
    }
    const model = buildSimulationModel(source);
    const inputs = model.scenarios.filter(s => s.kind !== 'SPECIFICATION').flatMap(s => s.steps.flatMap(step => step.inputs || []));
    assert(inputs.length > 0);
    assert(inputs.some(input => input.name.endsWith('Id') && input.source.kind === 'Unresolved'));
    assert(!inputs.some(input => input.source.kind === 'PreviousEvent'));
});

const sampleModel = {
    rootPackage: 'tech.medo',
    domain: 'Organization Platform',
    contexts: [{
        name: 'OrganizationManagement',
        title: 'Organization Management'
    }, {
        name: 'TeamManagement',
        title: 'Team Management'
    }],
    concepts: [{
        name: 'Organization',
        title: 'Organization',
        context: 'OrganizationManagement',
        states: ['REGISTERED', 'VERIFIED']
    }],
    valueTypes: [{
        name: 'OrganizationType',
        title: 'Organization Type',
        context: 'OrganizationManagement',
        kind: 'enum',
        baseType: 'String',
        values: ['HOSPITAL', 'LAB']
    }],
    slices: [{
        id: 'slice-register-org',
        name: 'RegisterOrganization',
        title: 'Register Organization',
        context: 'OrganizationManagement',
        concepts: ['Organization'],
        commands: [{
            id: 'command-register-org',
            name: 'RegisterOrganization',
            title: 'Register Organization',
            startsLifecycle: true,
            fields: [{
                name: 'organizationId',
                type: 'UUID',
                idAttribute: true,
                generated: true
            }, {
                name: 'organizationName',
                type: 'String'
            }, {
                name: 'organizationType',
                type: 'OrganizationType'
            }],
            dependencies: [{
                id: 'event-org-registered',
                direction: 'OUTBOUND',
                elementType: 'EVENT',
                title: 'Organization Registered'
            }]
        }],
        events: [{
            id: 'event-org-registered',
            name: 'OrganizationRegistered',
            title: 'Organization Registered',
            fields: [{
                name: 'organizationId',
                type: 'UUID',
                idAttribute: true
            }, {
                name: 'organizationName',
                type: 'String'
            }, {
                name: 'organizationType',
                type: 'OrganizationType'
            }],
            dependencies: [{
                id: 'command-register-org',
                direction: 'INBOUND',
                elementType: 'COMMAND',
                title: 'Register Organization'
            }, {
                id: 'command-verify-org',
                direction: 'OUTBOUND',
                elementType: 'COMMAND',
                title: 'Verify Organization'
            }]
        }],
        specifications: [{
            id: 'spec-duplicate-org',
            title: 'Reject Duplicate Organization',
            given: [{
                title: 'Organization Registered',
                type: 'EVENT',
                fields: [{
                    name: 'organizationName',
                    example: 'Acme'
                }]
            }],
            when: [{
                id: 'command-register-org',
                title: 'Register Organization',
                type: 'COMMAND',
                fields: [{
                    name: 'organizationName',
                    example: 'Acme'
                }]
            }],
            then: {
                title: 'Rejected',
                outcome: 'REJECT',
                description: 'Organization Already Exists'
            }
        }]
    }, {
        id: 'slice-verify-org',
        name: 'VerifyOrganization',
        title: 'Verify Organization',
        context: 'OrganizationManagement',
        concepts: ['Organization'],
        commands: [{
            id: 'command-verify-org',
            name: 'VerifyOrganization',
            title: 'Verify Organization',
            fields: [{
                name: 'organizationId',
                type: 'UUID',
                idAttribute: true,
                source: {
                    kind: 'direct',
                    from: ['OrganizationRegistered.organizationId']
                }
            }, {
                name: 'verificationProvider',
                type: 'String',
                example: 'KYC'
            }],
            dependencies: [{
                id: 'event-org-registered',
                direction: 'INBOUND',
                elementType: 'EVENT',
                title: 'Organization Registered'
            }, {
                id: 'event-org-verified',
                direction: 'OUTBOUND',
                elementType: 'EVENT',
                title: 'Organization Verified'
            }]
        }],
        events: [{
            id: 'event-org-verified',
            name: 'OrganizationVerified',
            title: 'Organization Verified',
            fields: [{
                name: 'organizationId',
                type: 'UUID',
                idAttribute: true
            }, {
                name: 'verificationProvider',
                type: 'String'
            }],
            dependencies: [{
                id: 'command-verify-org',
                direction: 'INBOUND',
                elementType: 'COMMAND',
                title: 'Verify Organization'
            }]
        }],
        processors: [{
            id: 'processor-verify-org',
            name: 'VerifyWhenOrganizationRegistered',
            title: 'Verify When Organization Registered',
            type: 'PROCESSOR',
            dependencies: [{
                id: 'event-org-registered',
                direction: 'INBOUND',
                elementType: 'EVENT',
                title: 'Organization Registered'
            }, {
                id: 'command-verify-org',
                direction: 'OUTBOUND',
                elementType: 'COMMAND',
                title: 'Verify Organization'
            }],
            metadata: {
                on: 'OrganizationRegistered',
                emits: 'VerifyOrganization'
            }
        }]
    }, {
        id: 'slice-create-team',
        name: 'CreateTeam',
        title: 'Create Team',
        context: 'TeamManagement',
        concepts: ['Team'],
        commands: [{
            id: 'command-create-team',
            name: 'CreateTeam',
            title: 'Create Team',
            startsLifecycle: true,
            fields: [{
                name: 'teamId',
                type: 'UUID',
                idAttribute: true,
                generated: true
            }],
            dependencies: [{
                id: 'event-team-created',
                direction: 'OUTBOUND',
                elementType: 'EVENT',
                title: 'Team Created'
            }]
        }],
        events: [{
            id: 'event-team-created',
            name: 'TeamCreated',
            title: 'Team Created',
            fields: [{
                name: 'teamId',
                type: 'UUID',
                idAttribute: true
            }]
        }]
    }]
};

test('Case 1: command to event produces a scenario step', () => {
    const model = buildSimulationModel(sampleModel);
    const scenario = model.scenarios.find((item) => item.id.startsWith('register-organization'));

    assert(scenario);
    assert.equal(scenario.steps[0].command, 'RegisterOrganization');
    assert.deepEqual(scenario.steps[0].http, {
        method: 'POST',
        path: '/organization/registerorganization',
        conceptRoute: 'organization',
        commandRoute: 'registerorganization'
    });
    assert.deepEqual(scenario.steps[0].expectedEvents.map((event) => event.name), ['OrganizationRegistered']);
});

test('Case 2: event to automation to command produces an automatic downstream step', () => {
    const model = buildSimulationModel(sampleModel);
    const scenario = model.scenarios.find((item) =>
        item.steps.map((step) => step.command).join('>') === 'RegisterOrganization>VerifyOrganization'
    );

    assert(scenario);
    assert.equal(scenario.steps[1].execution, 'AUTOMATIC');
    assert.equal(scenario.steps[1].triggeredBy.event, 'OrganizationRegistered');
});

test('Case 3: command input source can be PreviousEvent', () => {
    const model = buildSimulationModel(sampleModel);
    const scenario = model.scenarios.find((item) =>
        item.steps.map((step) => step.command).includes('VerifyOrganization')
    );
    const organizationId = scenario.steps[1].inputs.find((input) => input.name === 'organizationId');

    assert.deepEqual(organizationId.source, {
        kind: 'PreviousEvent',
        event: 'OrganizationRegistered',
        eventTitle: 'Organization Registered',
        field: 'organizationId'
    });
});

test('Case 4: two startsLifecycle slices produce separate scenarios', () => {
    const model = buildSimulationModel(sampleModel);
    const firstCommands = model.scenarios
        .filter((scenario) => scenario.kind === 'FLOW')
        .map((scenario) => scenario.steps[0].command);

    assert(firstCommands.includes('RegisterOrganization'));
    assert(firstCommands.includes('CreateTeam'));
});

test('Case 5: cycles stop traversal instead of repeating forever', () => {
    const cycleModel = {
        ...sampleModel,
        slices: sampleModel.slices.slice(0, 2).map((slice) => JSON.parse(JSON.stringify(slice)))
    };
    cycleModel.slices[1].events[0].dependencies.push({
        id: 'command-register-org',
        direction: 'OUTBOUND',
        elementType: 'COMMAND',
        title: 'Register Organization'
    });
    cycleModel.slices[0].commands[0].startsLifecycle = true;

    const model = buildSimulationModel(cycleModel, { maxDepth: 6 });
    const scenario = model.scenarios.find((item) =>
        item.notes.some((note) => note.includes('Cycle detected'))
    );

    assert(scenario);
    assert.equal(scenario.steps.filter((step) => step.command === 'RegisterOrganization').length, 1);
});

test('Case 6: specification given/when/then becomes a specification scenario', () => {
    const model = buildSimulationModel(sampleModel);
    const scenario = model.scenarios.find((item) => item.kind === 'SPECIFICATION');

    assert(scenario);
    assert.equal(scenario.name, 'Reject Duplicate Organization');
    assert.equal(scenario.given[0].supported, false);
    assert.equal(scenario.steps[0].expectedRejection.reason, 'Organization Already Exists');
    assert.equal(scenario.steps[0].inputs.find((input) => input.name === 'organizationName').source.value, 'Acme');
});

test('Case 7: deterministic generator preview is stable for the same seed', () => {
    const field = { name: 'organizationId', type: 'UUID' };

    assert.equal(previewValue(field, 1001, 'register.organizationId'), previewValue(field, 1001, 'register.organizationId'));
    assert.notEqual(previewValue(field, 1001, 'register.organizationId'), previewValue(field, 1002, 'register.organizationId'));
});

test('generates simulation service, model, runtime, and scenario files', () => {
    const model = buildSimulationModel(sampleModel);
    const files = generateSimulationFiles(model, { target: 'all' });

    assert(files['simulation-model.json']);
    assert(files['package.json']);
    assert(files['Dockerfile']);
    assert(files['src/server.js']);
    assert(files['src/cli.js']);
    assert(files['src/task.mjs']);
    assert(files['src/runtime/readiness.mjs']);
    assert.match(files['src/runtime/kubernetes-access.mjs'], /from '\.\/readiness\.mjs'/);
    assert(files['src/worker.mjs']);
    assert(files['EXTENSIONS.md']);
    assert.match(files['src/worker.mjs'], /from '\.\/task\.mjs'/);
    assert(!files['src/task.mjs'].includes('federation-learning'));
    assert(!files['src/worker.mjs'].includes('fl-test'));
    assert(files['cases/README.md']);
    for (const directory of ['generated', 'manual', 'ai', 'approved']) {
        assert(Object.hasOwn(files, `cases/${directory}/.gitkeep`));
    }
    assert(!Object.keys(files).some(name => /^cases\/(manual|ai|approved)\/.*\.json$/.test(name)));
    assert.equal(JSON.parse(files['package.json']).scripts['cases:draft'], 'node src/cases.mjs draft simulation-model.json');
    assert(files['DATA-PREPARATION.md']);
    assert(files['data/baseline.plan.json-example']);
    assert(files['data/case.plan.json-example']);
    assert(files['pipelines/data-preparation.json-example']);
    assert.match(files['src/prepare-data.mjs'], /from '\.\/data-plan\.mjs'/);
    assert.match(files['src/prepare-data.mjs'], /from '\.\/cases\.mjs'/);
    assert.equal(JSON.parse(files['package.json']).scripts['data:baseline'], 'node src/prepare-data.mjs baseline');
    assert.equal(JSON.parse(files['package.json']).scripts['data:case'], 'node src/prepare-data.mjs case');
    assert(files['src/runtime/runner.js']);
    assert(files['src/runtime/business-client.js']);
    assert(files['src/runtime/event-observer.js']);
    assert(files[`scenarios/${model.scenarios[0].id}.json`]);
    assert.match(files['src/server.js'], /url\.pathname === '\/simulations'/);
    assert.match(files['src/runtime/business-client.js'], /BUSINESS_BASE_URL/);
    assert.match(files['src/runtime/event-observer.js'], /createEventJournal/);
    assert.match(files['src/runtime/runner.js'], /client\.execute\(step, payload\)/);
});

test('supports explicit output root when a caller wants a nested directory', () => {
    const model = buildSimulationModel(sampleModel);
    const files = generateSimulationFiles(model, {
        target: 'model',
        root: 'simulation/generated'
    });

    assert(files['simulation/generated/simulation-model.json']);
});
