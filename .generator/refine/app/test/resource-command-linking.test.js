const assert = require('node:assert/strict');
const test = require('node:test');

const {buildFrontendModel} = require('../model-builder');

test('links producer create commands to catalog read models across aggregate routes', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'IdentityAccessManagement', title: 'Identity Access Management'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'Support',
            title: 'Support',
            contexts: ['IdentityAccessManagement']
        }],
        slices: [{
            id: 'slice-register-role',
            context: 'IdentityAccessManagement',
            chapter: 'Identity Access Management',
            title: 'Register Role',
            commands: [{
                id: 'command-register-role',
                title: 'Register Role',
                startsLifecycle: true,
                concept: 'Role',
                fields: [
                    {name: 'roleCode', type: 'String', idAttribute: true},
                    {name: 'roleName', type: 'String'}
                ],
                dependencies: [{
                    id: 'event-role-registered',
                    direction: 'OUTBOUND',
                    title: 'Role Registered',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-role-registered',
                title: 'Role Registered',
                fields: [{name: 'roleCode', type: 'String', idAttribute: true}],
                dependencies: [{
                    id: 'command-register-role',
                    direction: 'INBOUND',
                    title: 'Register Role',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-role-catalog',
                    direction: 'OUTBOUND',
                    title: 'Role Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: []
        }, {
            id: 'slice-catalogs',
            context: 'IdentityAccessManagement',
            chapter: 'Identity Access Management',
            title: 'Identity Access Catalogs',
            commands: [],
            events: [],
            readmodels: [{
                id: 'readmodel-role-catalog',
                title: 'Role Catalog',
                slice: 'Identity Access Catalogs',
                listElement: true,
                fields: [
                    {name: 'roleCode', type: 'String', idAttribute: true},
                    {name: 'roleName', type: 'String'}
                ],
                dependencies: [{
                    id: 'event-role-registered',
                    direction: 'INBOUND',
                    title: 'Role Registered',
                    elementType: 'EVENT'
                }]
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const roleCatalog = frontend.resources.find((resource) => resource.name === 'role_catalog');

    assert.equal(roleCatalog?.createCommand?.title, 'Register Role');
    assert.deepEqual(roleCatalog?.commands.map((command) => command.title), ['Register Role']);
});

test('keeps command result fields out of form fields', () => {
    const model = {
        domain: 'Demo',
        contexts: [{name: 'IdentityAccessManagement', title: 'Identity Access Management'}],
        aggregates: [],
        transitions: [],
        deployments: [{
            name: 'Support',
            title: 'Support',
            contexts: ['IdentityAccessManagement']
        }],
        slices: [{
            id: 'slice-generate-password',
            context: 'IdentityAccessManagement',
            chapter: 'Identity Access Management',
            title: 'Generate User Account Login Password',
            commands: [{
                id: 'command-generate-password',
                title: 'Generate User Account Login Password',
                concept: 'UserAccount',
                startsLifecycle: true,
                fields: [
                    {name: 'userAccountId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'passwordResetRequired', type: 'Boolean'}
                ],
                resultFields: [
                    {name: 'temporaryPassword', type: 'String', technicalAttribute: true}
                ],
                dependencies: [{
                    id: 'event-password-generated',
                    direction: 'OUTBOUND',
                    title: 'User Account Login Password Generated',
                    elementType: 'EVENT'
                }]
            }],
            events: [{
                id: 'event-password-generated',
                title: 'User Account Login Password Generated',
                fields: [
                    {name: 'userAccountId', type: 'UUID', idAttribute: true, technicalAttribute: true},
                    {name: 'passwordHash', type: 'String', technicalAttribute: true, portOutput: true}
                ],
                dependencies: [{
                    id: 'command-generate-password',
                    direction: 'INBOUND',
                    title: 'Generate User Account Login Password',
                    elementType: 'COMMAND'
                }, {
                    id: 'readmodel-user-account-catalog',
                    direction: 'OUTBOUND',
                    title: 'User Account Catalog',
                    elementType: 'READMODEL'
                }]
            }],
            readmodels: [{
                id: 'readmodel-user-account-catalog',
                title: 'User Account Catalog',
                slice: 'Generate User Account Login Password',
                listElement: true,
                fields: [
                    {name: 'userAccountId', type: 'UUID', idAttribute: true},
                    {name: 'username', type: 'String', display: true}
                ],
                dependencies: [{
                    id: 'event-password-generated',
                    direction: 'INBOUND',
                    title: 'User Account Login Password Generated',
                    elementType: 'EVENT'
                }]
            }]
        }]
    };

    const frontend = buildFrontendModel(model);
    const resource = frontend.resources.find((item) => [
        item.createCommand,
        item.editCommand,
        item.deleteCommand,
        ...(item.commands ?? [])
    ].some((command) => command?.title === 'Generate User Account Login Password'));
    const command = [
        resource?.createCommand,
        resource?.editCommand,
        resource?.deleteCommand,
        ...(resource?.commands ?? [])
    ].find((item) => item?.title === 'Generate User Account Login Password');

    assert.deepEqual(command?.fields.map((field) => field.name), ['passwordResetRequired']);
    assert.deepEqual(command?.resultFields.map((field) => field.name), ['temporaryPassword']);
});
